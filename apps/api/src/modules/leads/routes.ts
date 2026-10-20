import { Router } from 'express';
import { z } from 'zod';
import { leadNoteSchema, leadSchema, leadUpdateSchema, paginationSchema, pipelineSchema, reminderSchema, stageChangeSchema } from '@closewell/shared';
import { toCsv } from '../../lib/csv';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { body, escapeRegex, ok, paged, parse, query } from '../../lib/http';
import { can, ctx, requirePermission } from '../../middleware/auth';
import { Conversation, Message } from '../../models/conversations';
import { Membership } from '../../models/identity';
import { Lead, LeadActivity, Pipeline, Reminder } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { changeStage, getPipeline, leadReadFilter, leadWriteFilter, logActivity, oid, rescore, serializeLead } from './service';

export const leadsRouter = Router({ mergeParams: true });
export const pipelineRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

const listQuery = z.object({
  q: z.string().max(100).optional(),
  stage: z.string().max(40).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('none'), idParam]).optional(),
  source: z.string().max(30).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  includeTest: z.enum(['true', 'false']).optional(),
  sort: z.enum(['recent', 'score', 'updated', 'followup']).default('recent'),
});

function buildFilter(req: import('express').Request) {
  const c = ctx(req);
  const q = query(req, listQuery);
  const f: Record<string, unknown> = { ...leadReadFilter(req) };
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    f.$or = [{ name: rx }, { email: rx }, { company: rx }, { phone: rx }];
  }
  if (q.stage) f.stageKey = q.stage;
  if (q.assignedTo === 'me') f.assignedTo = c.userId;
  else if (q.assignedTo === 'none') f.assignedTo = null;
  else if (q.assignedTo) f.assignedTo = oid(q.assignedTo);
  // Reps can never widen their scope through filters: the scope stays in $and from leadReadFilter.
  if (q.source) f.source = q.source;
  if (q.minScore !== undefined) f.score = { $gte: q.minScore };
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.includeTest !== 'true') f.isTest = { $ne: true };
  const sort = { recent: { createdAt: -1 }, score: { score: -1 }, updated: { updatedAt: -1 }, followup: { nextFollowUpAt: 1 } }[q.sort] as Record<string, 1 | -1>;
  return { f, sort };
}

leadsRouter.get('/', requirePermission('leads:read:all', 'leads:read:assigned'), async (req, res) => {
  const { page, pageSize } = query(req, paginationSchema);
  const { f, sort } = buildFilter(req);
  const [items, total] = await Promise.all([Lead.find(f).sort(sort).skip((page - 1) * pageSize).limit(pageSize).lean(), Lead.countDocuments(f)]);
  res.json(paged(items.map(serializeLead), page, pageSize, total));
});

/** The signed-in member's open reminders. */
leadsRouter.get('/reminders/mine', requirePermission('leads:read:all', 'leads:read:assigned'), async (req, res) => {
  const c = ctx(req);
  const items = await Reminder.find({ orgId: c.orgId, userId: c.userId, doneAt: null }).sort({ dueAt: 1 }).limit(50).lean();
  const leads = await Lead.find({ orgId: c.orgId, _id: { $in: items.map((r) => r.leadId) } }, { name: 1, company: 1 }).lean();
  res.json(ok(items.map((r) => ({ id: String(r._id), leadId: String(r.leadId), leadName: leads.find((l) => String(l._id) === String(r.leadId))?.name ?? '', dueAt: r.dueAt, note: r.note }))));
});

/** CSV export of leads the caller may read. Excludes internal fields. */
leadsRouter.get('/export.csv', requirePermission('leads:export'), async (req, res) => {
  const c = ctx(req);
  const { f, sort } = buildFilter(req);
  const items = await Lead.find(f).sort(sort).limit(10_000).lean();
  const cols = ['name', 'email', 'phone', 'company', 'source', 'stage', 'score', 'budget', 'timeline', 'requirements', 'deal_value', 'contact_allowed', 'marketing_allowed', 'created_at'];
  const csv = toCsv(
    cols,
    items.map((l) => ({
      name: l.name,
      email: l.email,
      phone: l.phone,
      company: l.company,
      source: l.source,
      stage: l.stageKey,
      score: l.score,
      budget: l.budget?.amount ?? '',
      timeline: l.timeline,
      requirements: l.requirements,
      deal_value: l.dealValue ?? '',
      contact_allowed: l.consent?.contactAllowed ? 'yes' : 'no',
      marketing_allowed: l.consent?.marketingAllowed ? 'yes' : 'no',
      created_at: l.createdAt,
    })),
  );
  await audit(c.orgId, userActor(c.userId), 'leads.exported', { type: 'lead' }, { count: items.length });
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

leadsRouter.post('/', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, leadSchema);
  const stages = await getPipeline(c.orgId);
  const stage = stages.find((s) => s.key === (input.stageKey ?? stages[0].key)) ?? stages[0];
  // Reps create leads assigned to themselves.
  const assignedTo = can(req, 'leads:assign') ? (input.assignedTo ? oid(input.assignedTo) : null) : c.userId;
  if (assignedTo && !(await Membership.exists({ orgId: c.orgId, userId: assignedTo }))) throw new AppError('validation_failed', 'Assignee is not a member', { fields: { assignedTo: 'Choose a team member' } });
  const lead = await Lead.create({
    ...input,
    orgId: c.orgId,
    assignedTo,
    stageKey: stage.key,
    stageType: stage.type,
    consent: { ...input.consent, recordedAt: input.consent ? new Date() : undefined },
  });
  await logActivity(c.orgId, lead._id, 'created', userActor(c.userId));
  await rescore(c.orgId, lead._id);
  await audit(c.orgId, userActor(c.userId), 'lead.created', { type: 'lead', id: lead._id });
  res.status(201).json(ok(serializeLead((await Lead.findOne({ _id: lead._id, orgId: c.orgId }).lean())!)));
});

leadsRouter.get('/:id', requirePermission('leads:read:all', 'leads:read:assigned'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const lead = await Lead.findOne({ ...leadReadFilter(req), _id: id }).lean();
  if (!lead) throw notFound('Lead');
  const [activities, reminders, conversations] = await Promise.all([
    LeadActivity.find({ orgId: c.orgId, leadId: lead._id }).sort({ createdAt: -1 }).limit(200).lean(),
    Reminder.find({ orgId: c.orgId, leadId: lead._id, doneAt: null }).sort({ dueAt: 1 }).lean(),
    Conversation.find({ orgId: c.orgId, leadId: lead._id }, { channel: 1, status: 1, lastActivityAt: 1, summary: 1, lastMessagePreview: 1 }).sort({ lastActivityAt: -1 }).limit(50).lean(),
  ]);
  res.json(
    ok({
      ...serializeLead(lead),
      activities: activities.map((a) => ({ id: String(a._id), type: a.type, actor: a.actor, body: a.body, data: a.data, createdAt: a.createdAt })),
      reminders: reminders.map((r) => ({ id: String(r._id), dueAt: r.dueAt, note: r.note, userId: String(r.userId) })),
      conversations: conversations.map((cv) => ({ id: String(cv._id), channel: cv.channel, status: cv.status, lastActivityAt: cv.lastActivityAt, summary: cv.summary, preview: cv.lastMessagePreview })),
    }),
  );
});

leadsRouter.patch('/:id', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const input = body(req, leadUpdateSchema);
  const { stageKey, assignedTo, consent, ...rest } = input;
  if (assignedTo !== undefined && !can(req, 'leads:assign')) throw forbidden('You cannot reassign leads.');
  const set: Record<string, unknown> = { ...rest };
  if (assignedTo !== undefined) {
    if (assignedTo && !(await Membership.exists({ orgId: c.orgId, userId: oid(assignedTo) }))) throw new AppError('validation_failed', 'Assignee is not a member', { fields: { assignedTo: 'Choose a team member' } });
    set.assignedTo = assignedTo ? oid(assignedTo) : null;
  }
  if (consent) {
    for (const [k, v] of Object.entries(consent)) set[`consent.${k}`] = v;
    set['consent.recordedAt'] = new Date();
    if (consent.contactAllowed === false) set['consent.optedOutAt'] = new Date();
  }
  const lead = await Lead.findOneAndUpdate({ ...leadWriteFilter(req), _id: id }, { $set: set }, { new: true });
  if (!lead) throw notFound('Lead');
  if (stageKey) await changeStage(c.orgId, { orgId: c.orgId }, lead._id, stageKey, userActor(c.userId));
  await logActivity(c.orgId, lead._id, consent ? 'consent' : 'updated', userActor(c.userId), '', { fields: Object.keys(input) });
  await rescore(c.orgId, lead._id);
  res.json(ok(serializeLead((await Lead.findOne({ _id: lead._id, orgId: c.orgId }).lean())!)));
});

leadsRouter.post('/:id/stage', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, stageChangeSchema);
  const lead = await changeStage(c.orgId, leadWriteFilter(req), parse(idParam, req.params.id), input.stageKey, userActor(c.userId), input.reason);
  await audit(c.orgId, userActor(c.userId), 'lead.stage_changed', { type: 'lead', id: lead._id }, { to: input.stageKey });
  res.json(ok(serializeLead(lead.toObject())));
});

leadsRouter.post('/:id/notes', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const { body: text } = body(req, leadNoteSchema);
  const lead = await Lead.findOne({ ...leadWriteFilter(req), _id: parse(idParam, req.params.id) }).lean();
  if (!lead) throw notFound('Lead');
  await logActivity(c.orgId, lead._id, 'note', userActor(c.userId), text);
  res.status(201).json(ok({ added: true }));
});

leadsRouter.post('/:id/reminders', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, reminderSchema);
  const lead = await Lead.findOne({ ...leadWriteFilter(req), _id: parse(idParam, req.params.id) }).lean();
  if (!lead) throw notFound('Lead');
  const r = await Reminder.create({ orgId: c.orgId, leadId: lead._id, userId: c.userId, dueAt: input.dueAt, note: input.note });
  await Lead.updateOne({ _id: lead._id, orgId: c.orgId }, { $set: { nextFollowUpAt: input.dueAt } });
  await logActivity(c.orgId, lead._id, 'reminder', userActor(c.userId), input.note, { dueAt: input.dueAt });
  res.status(201).json(ok({ id: String(r._id), dueAt: r.dueAt, note: r.note }));
});

leadsRouter.post('/:id/reminders/:rid/done', requirePermission('leads:write:all', 'leads:write:assigned'), async (req, res) => {
  const c = ctx(req);
  const r = await Reminder.findOneAndUpdate({ _id: parse(idParam, req.params.rid), orgId: c.orgId, leadId: parse(idParam, req.params.id) }, { $set: { doneAt: new Date() } }, { new: true });
  if (!r) throw notFound('Reminder');
  const next = await Reminder.findOne({ orgId: c.orgId, leadId: r.leadId, doneAt: null }).sort({ dueAt: 1 }).lean();
  await Lead.updateOne({ _id: r.leadId, orgId: c.orgId }, { $set: { nextFollowUpAt: next?.dueAt ?? null } });
  res.json(ok({ done: true }));
});

/** Erase a lead (e.g. a data-deletion request). Linked conversations are kept but their contact details are scrubbed. */
leadsRouter.delete('/:id', requirePermission('leads:write:all'), async (req, res) => {
  const c = ctx(req);
  const id = oid(parse(idParam, req.params.id));
  const lead = await Lead.findOneAndDelete({ orgId: c.orgId, _id: id });
  if (!lead) throw notFound('Lead');
  await Promise.all([
    LeadActivity.deleteMany({ orgId: c.orgId, leadId: id }),
    Reminder.deleteMany({ orgId: c.orgId, leadId: id }),
    Conversation.updateMany({ orgId: c.orgId, leadId: id }, { $set: { leadId: null, contact: { name: '', email: '', phone: '' } } }),
  ]);
  const purge = query(req, z.object({ purgeConversations: z.enum(['true', 'false']).optional() })).purgeConversations === 'true';
  if (purge && lead.conversationIds?.length) {
    await Message.deleteMany({ orgId: c.orgId, conversationId: { $in: lead.conversationIds } });
    await Conversation.deleteMany({ orgId: c.orgId, _id: { $in: lead.conversationIds } });
  }
  await audit(c.orgId, userActor(c.userId), 'lead.deleted', { type: 'lead', id }, { purgeConversations: purge });
  res.json(ok({ deleted: true }));
});

// ---------- Pipeline ----------
pipelineRouter.get('/', requirePermission('leads:read:all', 'leads:read:assigned'), async (req, res) => {
  const c = ctx(req);
  const stages = await getPipeline(c.orgId);
  const counts = await Lead.aggregate<{ _id: string; n: number }>([{ $match: { orgId: c.orgId, isTest: { $ne: true } } }, { $group: { _id: '$stageKey', n: { $sum: 1 } } }]);
  res.json(ok(stages.map((s) => ({ ...s, count: counts.find((x) => x._id === s.key)?.n ?? 0 }))));
});

pipelineRouter.put('/', requirePermission('pipeline:manage'), async (req, res) => {
  const c = ctx(req);
  const { stages } = body(req, pipelineSchema);
  const current = await getPipeline(c.orgId);
  const removed = current.filter((s) => !stages.some((n) => n.key === s.key)).map((s) => s.key);
  if (removed.length && (await Lead.exists({ orgId: c.orgId, stageKey: { $in: removed } }))) {
    throw new AppError('conflict', `Move leads out of these stages before removing them: ${removed.join(', ')}`);
  }
  await Pipeline.updateOne({ orgId: c.orgId }, { $set: { stages } }, { upsert: true });
  for (const s of stages) await Lead.updateMany({ orgId: c.orgId, stageKey: s.key }, { $set: { stageType: s.type } });
  await audit(c.orgId, userActor(c.userId), 'pipeline.updated', { type: 'pipeline' }, { stages: stages.map((s) => s.key) });
  res.json(ok(stages));
});
