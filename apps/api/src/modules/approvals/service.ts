import mongoose, { type Types } from 'mongoose';
import { enqueue, registerJob, registerSweep } from '../../jobs/queue';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { PendingAction } from '../../models/ai';
import { Conversation, Message } from '../../models/conversations';
import { Organization } from '../../models/identity';
import { Lead, Product } from '../../models/sales';
import { audit, SYSTEM_ACTOR, userActor } from '../../services/audit';
import { sendEmail } from '../../services/email';
import { changeStage } from '../leads/service';

type PA = InstanceType<typeof PendingAction>;

async function postTeamMessage(pa: PA, content: string, approverId: Types.ObjectId | null) {
  if (!pa.conversationId) return;
  const conv = await Conversation.findOne({ _id: pa.conversationId, orgId: pa.orgId }, { status: 1 }).lean();
  if (!conv || conv.status !== 'open') return;
  await Message.create({ orgId: pa.orgId, conversationId: pa.conversationId, kind: 'message', role: 'human', authorId: approverId, content, meta: { pendingActionId: String(pa._id), approvedAction: true } });
  await Conversation.updateOne({ _id: pa.conversationId, orgId: pa.orgId }, { $set: { lastActivityAt: new Date(), lastMessagePreview: content.slice(0, 140) } });
}

/** Executors for approved actions. Each must be safe to retry (idempotent). */
const executors: Record<string, (pa: PA) => Promise<Record<string, unknown>>> = {
  async offer_discount(pa) {
    const pct = Number(pa.args.percent);
    let target = '';
    if (pa.args.productId) {
      const p = await Product.findOne({ _id: pa.args.productId, orgId: pa.orgId }, { name: 1 }).lean();
      if (p) target = ` on ${p.name}`;
    }
    await postTeamMessage(pa, `Good news: our team has approved a ${pct}% discount${target}. Let us know if you'd like to go ahead.`, pa.decidedBy ?? null);
    return { percent: pct };
  },
  async propose_custom_terms(pa) {
    await postTeamMessage(pa, `Our team has reviewed your request about ${String(pa.args.type).replace('_', ' ')} and approved it in principle. A team member will follow up with the written details.`, pa.decidedBy ?? null);
    return { notified: true };
  },
  async update_lead_stage(pa) {
    const lead = await changeStage(pa.orgId, { orgId: pa.orgId }, String(pa.args.leadId), String(pa.args.stageKey), userActor(pa.decidedBy!, 'approved AI request'));
    return { stageKey: lead.stageKey };
  },
  async send_quotation(pa) {
    const lead = await Lead.findOne({ _id: pa.args.leadId, orgId: pa.orgId }).lean();
    if (!lead?.email) throw new AppError('bad_request', 'Lead has no email address');
    if (!lead.consent?.contactAllowed || lead.consent.optedOutAt) throw new AppError('forbidden', 'Lead has not consented to be contacted');
    const org = await Organization.findById(pa.orgId, { name: 1, currency: 1 }).lean();
    const items = pa.args.items as { productId: string; quantity: number }[];
    const products = await Product.find({ orgId: pa.orgId, _id: { $in: items.map((i) => new mongoose.Types.ObjectId(i.productId)) } }).lean();
    const lines = items.map((i) => {
      const p = products.find((x) => String(x._id) === i.productId);
      if (!p || p.price == null) throw new AppError('bad_request', 'A quoted product no longer has a price');
      const cur = p.currency || org!.currency;
      return { name: p.name, qty: i.quantity, unit: p.price, cur, total: Math.round(p.price * i.quantity * 100) / 100 };
    });
    const currencies = new Set(lines.map((l) => l.cur));
    const total = lines.reduce((s, l) => s + l.total, 0);
    const text = [
      `Quotation from ${org!.name}`,
      '',
      ...lines.map((l) => `${l.qty} × ${l.name} @ ${l.unit} ${l.cur} = ${l.total} ${l.cur}`),
      '',
      currencies.size === 1 ? `Total: ${Math.round(total * 100) / 100} ${[...currencies][0]}` : 'Totals are shown per line because items use different currencies.',
      pa.args.note ? `\nNote: ${pa.args.note}` : '',
      '\nThis quotation is based on current list prices and is subject to confirmation.',
    ].join('\n');
    const mail = await sendEmail({ to: lead.email, subject: `Your quotation from ${org!.name}`, text });
    await postTeamMessage(pa, mail.delivered ? `We've emailed your quotation to ${lead.email}.` : `Your quotation has been prepared. Our team will send it to ${lead.email} shortly.`, pa.decidedBy ?? null);
    return { emailMode: mail.mode, delivered: mail.delivered, total };
  },
};

/** Job: execute an approved action exactly once (claim approved → executing atomically). */
registerJob('approval.execute', async (payload, job) => {
  const orgId = job.orgId!;
  const pa = await PendingAction.findOneAndUpdate(
    { _id: payload.pendingActionId, orgId, status: { $in: ['approved', 'executing'] } },
    { $set: { status: 'executing' }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!pa) return; // already executed, rejected or expired
  const exec = executors[pa.tool];
  try {
    if (!exec) throw new Error(`No executor for ${pa.tool}`);
    const result = await exec(pa);
    await PendingAction.updateOne({ _id: pa._id, orgId, status: 'executing' }, { $set: { status: 'executed', result, executedAt: new Date(), error: null } });
    await audit(orgId, SYSTEM_ACTOR, 'approval.executed', { type: 'pending_action', id: pa._id }, { tool: pa.tool });
  } catch (err) {
    const message = (err as Error).message.slice(0, 300);
    const final = job.attempts >= 3 || err instanceof AppError;
    await PendingAction.updateOne({ _id: pa._id, orgId }, { $set: { status: final ? 'failed' : 'executing', error: message } });
    logger.warn({ pendingActionId: String(pa._id), err: message, final }, 'Approved action failed');
    if (!final) throw err;
  }
});

export async function approve(orgId: Types.ObjectId, id: string, userId: Types.ObjectId, note?: string) {
  const pa = await PendingAction.findOneAndUpdate(
    { _id: id, orgId, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'approved', decidedBy: userId, decidedAt: new Date(), decisionNote: note } },
    { new: true },
  );
  if (!pa) {
    const existing = await PendingAction.findOne({ _id: id, orgId }).lean();
    if (!existing) throw notFound('Approval request');
    if (existing.status === 'pending') {
      await PendingAction.updateOne({ _id: id, orgId, status: 'pending' }, { $set: { status: 'expired' } });
      throw new AppError('conflict', 'This request has expired and can no longer be approved.');
    }
    throw new AppError('conflict', `This request is already ${existing.status}.`);
  }
  await audit(orgId, userActor(userId), 'approval.approved', { type: 'pending_action', id: pa._id }, { tool: pa.tool, note });
  await enqueue('approval.execute', { pendingActionId: String(pa._id) }, { orgId, idempotencyKey: `pa:${pa._id}:exec`, maxAttempts: 3 });
  return pa;
}

export async function reject(orgId: Types.ObjectId, id: string, userId: Types.ObjectId, note?: string) {
  const pa = await PendingAction.findOneAndUpdate({ _id: id, orgId, status: 'pending' }, { $set: { status: 'rejected', decidedBy: userId, decidedAt: new Date(), decisionNote: note } }, { new: true });
  if (!pa) {
    const existing = await PendingAction.findOne({ _id: id, orgId }).lean();
    if (!existing) throw notFound('Approval request');
    throw new AppError('conflict', `This request is already ${existing.status}.`);
  }
  if (['offer_discount', 'propose_custom_terms'].includes(pa.tool)) {
    await postTeamMessage(pa, "Our team reviewed your request and isn't able to approve it this time. We're happy to talk through other options.", userId);
  }
  await audit(orgId, userActor(userId), 'approval.rejected', { type: 'pending_action', id: pa._id }, { tool: pa.tool, note });
  return pa;
}

export async function retry(orgId: Types.ObjectId, id: string, userId: Types.ObjectId) {
  const pa = await PendingAction.findOneAndUpdate({ _id: id, orgId, status: 'failed' }, { $set: { status: 'approved', error: null } }, { new: true });
  if (!pa) throw new AppError('conflict', 'Only failed actions can be retried.');
  await audit(orgId, userActor(userId), 'approval.retried', { type: 'pending_action', id: pa._id });
  await enqueue('approval.execute', { pendingActionId: String(pa._id) }, { orgId, idempotencyKey: `pa:${pa._id}:retry:${pa.attempts}`, maxAttempts: 3 });
  return pa;
}

/** Expire stale requests. Runs across tenants by design (system maintenance). */
export async function expireApprovals() {
  const r = await PendingAction.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } }).setOptions({ crossTenant: true });
  return r.modifiedCount;
}
registerSweep('approvals.expire', 30_000, expireApprovals);
