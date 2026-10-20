import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { conversationUpdateSchema, messageInputSchema, paginationSchema } from '@closewell/shared';
import { runAgentTurn } from '../../ai/runner';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { body, escapeRegex, ok, paged, parse, query } from '../../lib/http';
import { can, ctx, requirePermission } from '../../middleware/auth';
import { PendingAction } from '../../models/ai';
import { Conversation, Message } from '../../models/conversations';
import { Membership, User } from '../../models/identity';
import { Lead } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { serializeLead } from '../leads/service';
import { serializeConversation, serializeMessage } from './serialize';

export const conversationsRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

const listQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  channel: z.enum(['web', 'whatsapp', 'voice', 'playground']).optional(),
  aiMode: z.enum(['ai', 'paused', 'human']).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('none'), idParam]).optional(),
  escalated: z.enum(['true', 'false']).optional(),
  tag: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  includeTest: z.enum(['true', 'false']).optional(),
});

conversationsRouter.get('/', requirePermission('conversations:read'), async (req, res) => {
  const c = ctx(req);
  const { page, pageSize } = query(req, paginationSchema);
  const q = query(req, listQuery);
  const f: Record<string, unknown> = { orgId: c.orgId };
  if (q.status !== 'all') f.status = q.status;
  if (q.channel) f.channel = q.channel;
  else f.channel = { $ne: 'playground' };
  if (q.aiMode) f.aiMode = q.aiMode;
  if (q.assignedTo === 'me') f.assignedTo = c.userId;
  else if (q.assignedTo === 'none') f.assignedTo = null;
  else if (q.assignedTo) f.assignedTo = new mongoose.Types.ObjectId(q.assignedTo);
  if (q.escalated) f.escalated = q.escalated === 'true';
  if (q.tag) f.tags = q.tag;
  if (q.includeTest !== 'true') f.isTest = { $ne: true };
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    f.$or = [{ 'contact.name': rx }, { 'contact.email': rx }, { lastMessagePreview: rx }, { summary: rx }];
  }
  const [items, total] = await Promise.all([Conversation.find(f).sort({ lastActivityAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(), Conversation.countDocuments(f)]);
  res.json(paged(items.map(serializeConversation), page, pageSize, total));
});

async function load(req: import('express').Request) {
  const c = ctx(req);
  const conv = await Conversation.findOne({ _id: parse(idParam, req.params.id), orgId: c.orgId });
  if (!conv) throw notFound('Conversation');
  return conv;
}

async function event(orgId: mongoose.Types.ObjectId, conversationId: mongoose.Types.ObjectId, type: string, content: string, authorId: mongoose.Types.ObjectId, data: Record<string, unknown> = {}) {
  await Message.create({ orgId, conversationId, kind: 'event', role: 'system', authorId, content, event: { type, data } });
}

conversationsRouter.get('/:id', requirePermission('conversations:read'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const [messages, lead, approvals, assignee] = await Promise.all([
    Message.find({ orgId: c.orgId, conversationId: conv._id }).sort({ createdAt: 1 }).limit(1000).lean(),
    conv.leadId ? Lead.findOne({ _id: conv.leadId, orgId: c.orgId }).lean() : null,
    PendingAction.find({ orgId: c.orgId, conversationId: conv._id }).sort({ createdAt: -1 }).limit(20).lean(),
    conv.assignedTo ? User.findById(conv.assignedTo, { name: 1 }).lean() : null,
  ]);
  const authorIds = [...new Set(messages.map((m) => m.authorId).filter(Boolean).map(String))];
  const authors = await User.find({ _id: { $in: authorIds } }, { name: 1 }).lean();
  const canSeeLead = lead && (can(req, 'leads:read:all') || (can(req, 'leads:read:assigned') && (!lead.assignedTo || String(lead.assignedTo) === String(c.userId))));
  res.json(
    ok({
      ...serializeConversation(conv.toObject()),
      assignee: assignee ? { id: String(assignee._id), name: assignee.name } : null,
      messages: messages.map((m) => ({ ...serializeMessage(m), authorName: authors.find((a) => String(a._id) === String(m.authorId))?.name })),
      lead: canSeeLead ? serializeLead(lead) : null,
      approvals: approvals.map((a) => ({ id: String(a._id), tool: a.tool, summary: a.summary, status: a.status, createdAt: a.createdAt })),
    }),
  );
});

/** A team member's reply. Replying takes over the conversation so the AI stops. */
conversationsRouter.post('/:id/messages', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const { content } = body(req, messageInputSchema);
  if (conv.status === 'closed') throw new AppError('conflict', 'Reopen the conversation before replying.');
  if (conv.aiMode !== 'human') {
    await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { aiMode: 'human', assignedTo: conv.assignedTo ?? c.userId } });
    await event(c.orgId, conv._id, 'takeover', 'A team member took over the conversation', c.userId);
  }
  const m = await Message.create({ orgId: c.orgId, conversationId: conv._id, kind: 'message', role: 'human', authorId: c.userId, content });
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { lastActivityAt: new Date(), lastMessagePreview: content.slice(0, 140) } });
  // Delivery: website chat reads messages from the server. Other channels send through their adapter (next milestone).
  res.status(201).json(ok({ ...serializeMessage(m.toObject()), delivery: conv.channel === 'web' || conv.channel === 'playground' ? 'delivered_to_widget' : 'channel_not_connected' }));
});

conversationsRouter.post('/:id/notes', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const { content } = body(req, messageInputSchema);
  const m = await Message.create({ orgId: c.orgId, conversationId: conv._id, kind: 'note', role: 'human', authorId: c.userId, content });
  res.status(201).json(ok(serializeMessage(m.toObject())));
});

conversationsRouter.post('/:id/takeover', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { aiMode: 'human', assignedTo: c.userId } });
  await event(c.orgId, conv._id, 'takeover', 'A team member took over the conversation', c.userId);
  await audit(c.orgId, userActor(c.userId), 'conversation.takeover', { type: 'conversation', id: conv._id });
  res.json(ok({ aiMode: 'human' }));
});

conversationsRouter.post('/:id/pause', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { aiMode: 'paused' } });
  await event(c.orgId, conv._id, 'ai_paused', 'AI paused', c.userId);
  await audit(c.orgId, userActor(c.userId), 'conversation.ai_paused', { type: 'conversation', id: conv._id });
  res.json(ok({ aiMode: 'paused' }));
});

conversationsRouter.post('/:id/resume', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const { replyNow } = body(req, z.object({ replyNow: z.boolean().default(false) }).default({ replyNow: false }));
  if (conv.status === 'closed') throw new AppError('conflict', 'Reopen the conversation before resuming the AI.');
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { aiMode: 'ai', escalated: false, escalationReason: '' } });
  await event(c.orgId, conv._id, 'ai_resumed', 'AI resumed', c.userId);
  await audit(c.orgId, userActor(c.userId), 'conversation.ai_resumed', { type: 'conversation', id: conv._id });
  let outcome = null;
  if (replyNow) {
    const last = await Message.findOne({ orgId: c.orgId, conversationId: conv._id, kind: 'message' }).sort({ createdAt: -1 }).lean();
    if (last?.role === 'customer') outcome = await runAgentTurn({ orgId: c.orgId, conversationId: conv._id, useDraft: conv.channel === 'playground' || conv.isTest });
  }
  res.json(ok({ aiMode: 'ai', outcome }));
});

conversationsRouter.post('/:id/escalate', requirePermission('conversations:reply'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(2).max(300) }));
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: { escalated: true, escalationReason: reason } });
  await event(c.orgId, conv._id, 'escalated', `Escalated: ${reason}`, c.userId);
  res.json(ok({ escalated: true }));
});

conversationsRouter.patch('/:id', requirePermission('conversations:reply', 'conversations:manage'), async (req, res) => {
  const c = ctx(req);
  const conv = await load(req);
  const input = body(req, conversationUpdateSchema);
  const set: Record<string, unknown> = {};
  if (input.assignedTo !== undefined) {
    const selfAssign = input.assignedTo === String(c.userId) || input.assignedTo === null;
    if (!can(req, 'conversations:manage') && !selfAssign) throw forbidden('You can only assign conversations to yourself.');
    if (input.assignedTo && !(await Membership.exists({ orgId: c.orgId, userId: new mongoose.Types.ObjectId(input.assignedTo) }))) throw new AppError('validation_failed', 'Assignee is not a member', { fields: { assignedTo: 'Choose a team member' } });
    set.assignedTo = input.assignedTo ? new mongoose.Types.ObjectId(input.assignedTo) : null;
  }
  if (input.tags) set.tags = [...new Set(input.tags.map((t) => t.toLowerCase()))];
  if (input.status) {
    if (!can(req, 'conversations:manage') && !can(req, 'conversations:reply')) throw forbidden();
    set.status = input.status;
    set.closedAt = input.status === 'closed' ? new Date() : null;
  }
  await Conversation.updateOne({ _id: conv._id, orgId: c.orgId }, { $set: set });
  if (input.status && input.status !== conv.status) await event(c.orgId, conv._id, input.status === 'closed' ? 'closed' : 'reopened', input.status === 'closed' ? 'Conversation closed' : 'Conversation reopened', c.userId);
  if (input.assignedTo !== undefined) await event(c.orgId, conv._id, 'assigned', input.assignedTo ? 'Conversation assigned' : 'Conversation unassigned', c.userId, { assignedTo: input.assignedTo });
  const updated = await Conversation.findOne({ _id: conv._id, orgId: c.orgId }).lean();
  res.json(ok(serializeConversation(updated!)));
});
