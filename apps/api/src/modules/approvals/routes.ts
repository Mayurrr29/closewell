import { Router } from 'express';
import { z } from 'zod';
import { approvalDecisionSchema, paginationSchema } from '@closewell/shared';
import { notFound } from '../../lib/errors';
import { body, ok, paged, parse, query } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { PendingAction } from '../../models/ai';
import { Conversation } from '../../models/conversations';
import { User } from '../../models/identity';
import { approve, reject, retry } from './service';

export const approvalsRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

const serialize = (p: Record<string, any>, names: Map<string, string> = new Map()) => ({
  id: String(p._id),
  tool: p.tool,
  category: p.category,
  args: p.args,
  summary: p.summary,
  reason: p.reason,
  status: p.status === 'pending' && p.expiresAt < new Date() ? 'expired' : p.status,
  conversationId: p.conversationId ? String(p.conversationId) : null,
  leadId: p.leadId ? String(p.leadId) : null,
  decidedBy: p.decidedBy ? { id: String(p.decidedBy), name: names.get(String(p.decidedBy)) ?? '' } : null,
  decidedAt: p.decidedAt,
  decisionNote: p.decisionNote,
  expiresAt: p.expiresAt,
  attempts: p.attempts,
  result: p.result,
  error: p.error,
  executedAt: p.executedAt,
  createdAt: p.createdAt,
});

approvalsRouter.get('/', requirePermission('approvals:read'), async (req, res) => {
  const c = ctx(req);
  const { page, pageSize } = query(req, paginationSchema);
  const { status } = query(req, z.object({ status: z.enum(['pending', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed', 'all']).default('pending') }));
  const filter: Record<string, unknown> = { orgId: c.orgId };
  if (status === 'pending') Object.assign(filter, { status: 'pending', expiresAt: { $gt: new Date() } });
  else if (status !== 'all') filter.status = status;
  const [items, total] = await Promise.all([PendingAction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), PendingAction.countDocuments(filter)]);
  const users = await User.find({ _id: { $in: items.map((i) => i.decidedBy).filter(Boolean) } }, { name: 1 }).lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  res.json(paged(items.map((i) => serialize(i, names)), page, pageSize, total));
});

approvalsRouter.get('/:id', requirePermission('approvals:read'), async (req, res) => {
  const c = ctx(req);
  const pa = await PendingAction.findOne({ _id: parse(idParam, req.params.id), orgId: c.orgId }).lean();
  if (!pa) throw notFound('Approval request');
  const conv = pa.conversationId ? await Conversation.findOne({ _id: pa.conversationId, orgId: c.orgId }, { contact: 1, channel: 1 }).lean() : null;
  res.json(ok({ ...serialize(pa), conversation: conv ? { id: String(conv._id), channel: conv.channel, contact: conv.contact } : null }));
});

approvalsRouter.post('/:id/approve', requirePermission('approvals:decide'), async (req, res) => {
  const c = ctx(req);
  const { note } = body(req, approvalDecisionSchema);
  const pa = await approve(c.orgId, parse(idParam, req.params.id), c.userId, note);
  res.json(ok(serialize(pa.toObject())));
});

approvalsRouter.post('/:id/reject', requirePermission('approvals:decide'), async (req, res) => {
  const c = ctx(req);
  const { note } = body(req, approvalDecisionSchema);
  const pa = await reject(c.orgId, parse(idParam, req.params.id), c.userId, note);
  res.json(ok(serialize(pa.toObject())));
});

approvalsRouter.post('/:id/retry', requirePermission('approvals:decide'), async (req, res) => {
  const c = ctx(req);
  const pa = await retry(c.orgId, parse(idParam, req.params.id), c.userId);
  res.json(ok(serialize(pa.toObject())));
});
