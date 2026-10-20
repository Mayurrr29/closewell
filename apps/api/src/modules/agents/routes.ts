import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { TOOL_CATALOG, agentConfigSchema, messageInputSchema, type ToolMode } from '@closewell/shared';
import { providerStatus } from '../../ai/providers';
import { loadAgentConfig, runAgentTurn } from '../../ai/runner';
import { resolveMode } from '../../ai/tools';
import { AppError, notFound } from '../../lib/errors';
import { body, ok, parse } from '../../lib/http';
import { ctx, requirePermission, requireVerifiedEmail } from '../../middleware/auth';
import { Agent, AgentRun } from '../../models/ai';
import { Conversation, Message, WidgetConfig } from '../../models/conversations';
import { Organization } from '../../models/identity';
import { KnowledgeSource } from '../../models/knowledge';
import { Product } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { serializeMessage } from '../conversations/serialize';

export const agentsRouter = Router({ mergeParams: true });
const idParam = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

async function readiness(orgId: mongoose.Types.ObjectId, agent: { config: unknown; lastSimulationAt?: Date | null }) {
  const org = await Organization.findById(orgId).lean();
  const [products, knowledge, widget] = await Promise.all([
    Product.countDocuments({ orgId, active: true }),
    KnowledgeSource.countDocuments({ orgId, status: 'ready' }),
    WidgetConfig.findOne({ orgId }).lean(),
  ]);
  const cfg = loadAgentConfig(agent.config);
  const checks = [
    { key: 'profile', label: 'Business profile completed', ok: !!(org?.name && org.description && org.description.length >= 10 && org.currency && org.timezone), step: 1 },
    { key: 'catalog', label: 'At least one product, service or knowledge entry', ok: products + knowledge > 0, step: 2 },
    { key: 'persona', label: 'Agent identity configured', ok: !!cfg.persona.displayName, step: 3 },
    { key: 'qualification', label: 'Qualification questions reviewed', ok: (org?.onboarding?.completedSteps ?? []).includes(4) || cfg.qualificationQuestions.length > 0, step: 4 },
    { key: 'rules', label: 'Sales rules and approvals reviewed', ok: (org?.onboarding?.completedSteps ?? []).includes(5), step: 5 },
    { key: 'channel', label: 'A channel chosen (website widget)', ok: !!widget && (widget.allowedDomains?.length ?? 0) > 0, step: 6 },
    { key: 'simulation', label: 'Simulated conversation run since the last change', ok: !!agent.lastSimulationAt, step: 7 },
  ];
  return checks;
}

function serializeAgent(a: Record<string, any>) {
  return {
    id: String(a._id),
    status: a.status,
    config: a.config,
    publishedVersion: a.publishedVersion,
    publishedAt: a.publishedAt,
    hasUnpublishedChanges: !!a.published && JSON.stringify(a.published) !== JSON.stringify(a.config),
    lastSimulationAt: a.lastSimulationAt,
    updatedAt: a.updatedAt,
  };
}

agentsRouter.get('/', requirePermission('agents:read'), async (req, res) => {
  const agents = await Agent.find({ orgId: ctx(req).orgId }).sort({ createdAt: 1 }).lean();
  res.json(ok(agents.map(serializeAgent)));
});

agentsRouter.get('/tools', requirePermission('agents:read'), (_req, res) => {
  res.json(ok({ tools: TOOL_CATALOG, provider: providerStatus() }));
});

agentsRouter.get('/:id', requirePermission('agents:read'), async (req, res) => {
  const c = ctx(req);
  const a = await Agent.findOne({ _id: parse(idParam, req.params.id), orgId: c.orgId }).lean();
  if (!a) throw notFound('Agent');
  const cfg = loadAgentConfig(a.config);
  res.json(
    ok({
      ...serializeAgent(a),
      effectiveToolModes: Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, resolveMode(cfg, t.name)])),
      readiness: await readiness(c.orgId, a),
      provider: providerStatus(),
    }),
  );
});

agentsRouter.put('/:id/config', requirePermission('agents:write'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const config = body(req, agentConfigSchema);
  // Reject tool modes the catalogue does not allow (e.g. making a sensitive tool automatic).
  const bad: Record<string, string> = {};
  for (const [name, mode] of Object.entries(config.tools)) {
    const entry = TOOL_CATALOG.find((t) => t.name === name);
    if (!entry) bad[`tools.${name}`] = 'Unknown tool';
    else if (!entry.allowedModes.includes(mode as ToolMode)) bad[`tools.${name}`] = `“${mode}” is not allowed for this action. Allowed: ${entry.allowedModes.join(', ')}`;
  }
  if (Object.keys(bad).length) throw new AppError('validation_failed', 'Some action permissions are not allowed', { fields: bad });
  const keys = config.qualificationQuestions.map((q) => q.key);
  if (new Set(keys).size !== keys.length) throw new AppError('validation_failed', 'Question keys must be unique', { fields: { qualificationQuestions: 'Duplicate key' } });
  const a = await Agent.findOneAndUpdate({ _id: id, orgId: c.orgId }, { $set: { config, lastSimulationAt: null } }, { new: true }).lean();
  if (!a) throw notFound('Agent');
  await audit(c.orgId, userActor(c.userId), 'agent.config_updated', { type: 'agent', id }, { tools: config.tools, maxAutoDiscountPercent: config.policies.autoDiscountEnabled ? config.policies.maxAutoDiscountPercent : 0 });
  res.json(ok(serializeAgent(a)));
});

agentsRouter.post('/:id/publish', requirePermission('agents:publish'), requireVerifiedEmail, async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const a = await Agent.findOne({ _id: id, orgId: c.orgId }).lean();
  if (!a) throw notFound('Agent');
  const checks = await readiness(c.orgId, a);
  const missing = checks.filter((x) => !x.ok);
  if (missing.length) throw new AppError('validation_failed', `Finish these first: ${missing.map((m) => m.label).join('; ')}`, { checks });
  const updated = await Agent.findOneAndUpdate({ _id: id, orgId: c.orgId }, { $set: { published: a.config, status: 'published', publishedAt: new Date() }, $inc: { publishedVersion: 1 } }, { new: true }).lean();
  await Organization.updateOne({ _id: c.orgId, 'onboarding.completedAt': null }, { $set: { 'onboarding.completedAt': new Date() }, $addToSet: { 'onboarding.completedSteps': 8 } });
  await audit(c.orgId, userActor(c.userId), 'agent.published', { type: 'agent', id }, { version: updated!.publishedVersion });
  res.json(ok(serializeAgent(updated!)));
});

agentsRouter.post('/:id/unpublish', requirePermission('agents:publish'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const a = await Agent.findOneAndUpdate({ _id: id, orgId: c.orgId }, { $set: { status: 'disabled', published: null } }, { new: true }).lean();
  if (!a) throw notFound('Agent');
  await audit(c.orgId, userActor(c.userId), 'agent.unpublished', { type: 'agent', id });
  res.json(ok(serializeAgent(a)));
});

agentsRouter.get('/:id/runs', requirePermission('agents:read'), async (req, res) => {
  const c = ctx(req);
  const { conversationId } = parse(z.object({ conversationId: idParam.optional() }), req.query);
  const runs = await AgentRun.find({ orgId: c.orgId, agentId: parse(idParam, req.params.id), ...(conversationId ? { conversationId } : {}) }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(ok(runs.map((r) => ({ id: String(r._id), conversationId: String(r.conversationId), channel: r.channel, provider: r.provider, model: r.model, status: r.status, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs, toolCalls: r.toolCalls, flags: r.flags, error: r.error, createdAt: r.createdAt }))));
});

// ---------- Simulation console (onboarding step 7). Uses the DRAFT config; data is marked as test. ----------

agentsRouter.post('/:id/playground', requirePermission('agents:write'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  if (!(await Agent.exists({ _id: id, orgId: c.orgId }))) throw notFound('Agent');
  const conv = await Conversation.create({ orgId: c.orgId, agentId: id, channel: 'playground', isTest: true, contact: { name: 'Test customer' } });
  res.status(201).json(ok({ conversationId: String(conv._id) }));
});

agentsRouter.get('/:id/playground/:cid', requirePermission('agents:read'), async (req, res) => {
  const c = ctx(req);
  const cid = parse(idParam, req.params.cid);
  const conv = await Conversation.findOne({ _id: cid, orgId: c.orgId, channel: 'playground' }).lean();
  if (!conv) throw notFound('Test conversation');
  const [messages, runs] = await Promise.all([
    Message.find({ orgId: c.orgId, conversationId: cid }).sort({ createdAt: 1 }).lean(),
    AgentRun.find({ orgId: c.orgId, conversationId: cid }).sort({ createdAt: 1 }).lean(),
  ]);
  res.json(ok({ conversation: { id: String(conv._id), aiMode: conv.aiMode, escalated: conv.escalated, leadId: conv.leadId ? String(conv.leadId) : null }, messages: messages.map(serializeMessage), runs: runs.map((r) => ({ id: String(r._id), status: r.status, toolCalls: r.toolCalls, flags: r.flags, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: r.latencyMs, createdAt: r.createdAt })) }));
});

agentsRouter.post('/:id/playground/:cid/messages', requirePermission('agents:write'), async (req, res) => {
  const c = ctx(req);
  const id = parse(idParam, req.params.id);
  const cid = new mongoose.Types.ObjectId(parse(idParam, req.params.cid));
  const { content } = body(req, messageInputSchema);
  const conv = await Conversation.findOne({ _id: cid, orgId: c.orgId, channel: 'playground' });
  if (!conv) throw notFound('Test conversation');
  if (conv.aiMode !== 'ai') await Conversation.updateOne({ _id: cid, orgId: c.orgId }, { $set: { aiMode: 'ai', escalated: false } }); // tests always resume
  const m = await Message.create({ orgId: c.orgId, conversationId: cid, kind: 'message', role: 'customer', content });
  await Conversation.updateOne({ _id: cid, orgId: c.orgId }, { $set: { lastCustomerMessageAt: m.createdAt, lastActivityAt: m.createdAt } });
  const outcome = await runAgentTurn({ orgId: c.orgId, conversationId: cid, useDraft: true });
  await Agent.updateOne({ _id: id, orgId: c.orgId }, { $set: { lastSimulationAt: new Date() } });
  const run = outcome.runId ? await AgentRun.findOne({ _id: outcome.runId, orgId: c.orgId }).lean() : null;
  res.json(ok({ customerMessage: serializeMessage(m.toObject()), outcome: { status: outcome.status, reason: outcome.reason, message: outcome.message ?? null }, run: run ? { toolCalls: run.toolCalls, flags: run.flags, status: run.status, latencyMs: run.latencyMs } : null }));
});
