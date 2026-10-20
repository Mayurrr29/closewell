import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import { TOOL_CATALOG, emailSchema, type ActionCategory, type ToolMode } from '@closewell/shared';
import { sha256 } from '../lib/crypto';
import { escapeRegex } from '../lib/http';
import { Conversation, Message } from '../models/conversations';
import { PendingAction } from '../models/ai';
import { Lead, Product } from '../models/sales';
import { AI_ACTOR, audit } from '../services/audit';
import { retrieve } from '../modules/knowledge/service';
import { changeStage, getPipeline, logActivity, rescore } from '../modules/leads/service';
import type { AgentConfig } from './prompt';
import { referenceBlock } from './prompt';
import type { ToolSpec } from './providers/types';
import { detectInjection, type SafetyFlag } from './safety';

export interface TurnState {
  allowedAmounts: number[];
  approvedDiscountPercents: number[];
  commitmentApproved: boolean;
  handedOff: boolean;
  retrievedChunkIds: string[];
  referenceTexts: string[];
  pendingActionIds: string[];
  flags: SafetyFlag[];
}

export interface ToolContext {
  orgId: Types.ObjectId;
  conversationId: Types.ObjectId;
  runId: Types.ObjectId;
  agent: AgentConfig;
  channel: string;
  isTest: boolean;
  orgCurrency: string;
  state: TurnState;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

interface ToolDef<S extends z.ZodType> {
  name: string;
  schema: S;
  description: string;
  run(ctx: ToolContext, args: z.output<S>, mode: ToolMode): Promise<ToolResult>;
}

const catalog = (name: string) => TOOL_CATALOG.find((t) => t.name === name);

/**
 * Server-side permission resolution. The organisation's configured mode is
 * clamped to the modes the catalogue allows for that tool, so a
 * misconfiguration (or a tampered request) can never make a Category C
 * tool fully automatic.
 */
export function resolveMode(agent: AgentConfig, name: string): ToolMode {
  const entry = catalog(name);
  if (!entry || entry.comingSoon) return 'disabled';
  const configured = (agent.tools?.[name] as ToolMode | undefined) ?? entry.defaultMode;
  return entry.allowedModes.includes(configured) ? configured : entry.allowedModes.includes(entry.defaultMode) ? entry.defaultMode : 'disabled';
}

export function categoryOf(name: string): ActionCategory | null {
  return catalog(name)?.category ?? null;
}

// ---------- helpers ----------

export function priceText(p: { pricingModel: string; price?: number | null; currency?: string | null; priceUnit?: string | null }, orgCurrency: string) {
  if (p.pricingModel === 'quote_only' || p.price == null) return 'price on request (quote only)';
  return `${p.pricingModel === 'starting_at' ? 'from ' : ''}${p.price} ${p.currency || orgCurrency}${p.priceUnit ? ` ${p.priceUnit}` : ''}`;
}

async function ensureLead(ctx: ToolContext) {
  const conv = await Conversation.findOne({ _id: ctx.conversationId, orgId: ctx.orgId });
  if (!conv) throw new Error('Conversation not found');
  if (conv.leadId) {
    const existing = await Lead.findOne({ _id: conv.leadId, orgId: ctx.orgId });
    if (existing) return existing;
  }
  const stages = await getPipeline(ctx.orgId);
  const lead = await Lead.create({
    orgId: ctx.orgId,
    source: ctx.channel === 'web' ? 'web_widget' : ctx.channel,
    name: conv.contact?.name ?? '',
    email: conv.contact?.email ?? '',
    phone: conv.contact?.phone ?? '',
    stageKey: stages[0].key,
    stageType: stages[0].type,
    conversationIds: [conv._id],
    isTest: ctx.isTest,
    lastContactAt: new Date(),
  });
  await Conversation.updateOne({ _id: conv._id, orgId: ctx.orgId }, { $set: { leadId: lead._id } });
  await logActivity(ctx.orgId, lead._id, 'created', AI_ACTOR, 'Created from a conversation');
  return lead;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Create (or reuse, if the identical request is already pending) an approval request. */
export async function requestApproval(ctx: ToolContext, tool: string, args: Record<string, unknown>, summary: string, reason: string) {
  const key = sha256(`${ctx.conversationId}:${tool}:${stable(args)}`);
  const existing = await PendingAction.findOne({ orgId: ctx.orgId, idempotencyKey: key }).lean();
  if (existing && ['pending', 'approved', 'executing'].includes(existing.status)) return existing;
  const conv = await Conversation.findOne({ _id: ctx.conversationId, orgId: ctx.orgId }, { leadId: 1 }).lean();
  const hours = ctx.agent.policies.approvalExpiryHours ?? 48;
  // A previously decided identical request gets a fresh key suffix so it can be asked again.
  const idempotencyKey = existing ? `${key}:${Date.now()}` : key;
  const pa = await PendingAction.create({
    orgId: ctx.orgId,
    conversationId: ctx.conversationId,
    leadId: conv?.leadId ?? null,
    agentRunId: ctx.runId,
    tool,
    category: categoryOf(tool) ?? 'C',
    args,
    summary,
    reason,
    expiresAt: new Date(Date.now() + hours * 3600_000),
    idempotencyKey,
  });
  await Message.create({ orgId: ctx.orgId, conversationId: ctx.conversationId, kind: 'event', role: 'system', content: `Approval requested: ${summary}`, event: { type: 'approval_requested', data: { pendingActionId: String(pa._id), tool } } });
  await audit(ctx.orgId, AI_ACTOR, 'approval.requested', { type: 'pending_action', id: pa._id }, { tool, category: pa.category });
  ctx.state.pendingActionIds.push(String(pa._id));
  return pa.toObject();
}

// ---------- tool definitions ----------

const tools: ToolDef<any>[] = [];
function def<S extends z.ZodType>(t: ToolDef<S>) {
  tools.push(t);
}

def({
  name: 'search_knowledge',
  description: "Search the business's approved knowledge base (FAQs, documents, policies). Use before answering factual questions.",
  schema: z.strictObject({ query: z.string().min(2).max(300) }),
  async run(ctx, { query }) {
    const hits = await retrieve(ctx.orgId, query, 4);
    ctx.state.retrievedChunkIds.push(...hits.map((h) => h.chunkId));
    ctx.state.referenceTexts.push(...hits.map((h) => h.text));
    const results = hits.map((h, i) => ({ ref: `K${i + 1}`, title: h.title, text: h.text.slice(0, 1500) }));
    if (results.some((r) => detectInjection(r.text))) ctx.state.flags.push({ type: 'injection_in_knowledge', detail: 'A retrieved document contains instruction-like text' });
    return { ok: true, data: { results, instructions: referenceBlock(results).split('\n')[0] } };
  },
});

def({
  name: 'get_products',
  description: 'Look up products and services with their exact list prices and availability. Always use this before quoting a price.',
  schema: z.strictObject({ query: z.string().max(200).optional(), productId: z.string().regex(/^[a-f0-9]{24}$/).optional() }),
  async run(ctx, { query, productId }) {
    const filter: Record<string, unknown> = { orgId: ctx.orgId, active: true };
    let items;
    if (productId) items = await Product.find({ ...filter, _id: productId }).limit(1).lean();
    else {
      const words = (query ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
      const generic = new Set(['price', 'prices', 'pricing', 'cost', 'costs', 'much', 'plan', 'plans', 'product', 'products', 'service', 'services', 'offer', 'what', 'your', 'have', 'does', 'buy', 'package', 'packages', 'catalog', 'the', 'and', 'for', 'how']);
      const specific = words.filter((w) => !generic.has(w));
      items = specific.length
        ? await Product.find({ ...filter, $or: specific.flatMap((w) => [{ name: { $regex: escapeRegex(w), $options: 'i' } }, { tags: { $regex: `^${escapeRegex(w)}`, $options: 'i' } }, { description: { $regex: escapeRegex(w), $options: 'i' } }]) }).limit(8).lean()
        : [];
      if (!items.length) items = await Product.find(filter).sort({ name: 1 }).limit(8).lean();
    }
    for (const p of items) if (p.price != null && p.pricingModel !== 'quote_only') ctx.state.allowedAmounts.push(p.price);
    return {
      ok: true,
      data: {
        products: items.map((p) => ({
          id: String(p._id),
          name: p.name,
          kind: p.kind,
          priceText: priceText(p, ctx.orgCurrency),
          availability: p.availability,
          description: (p.description ?? '').slice(0, 400),
        })),
      },
    };
  },
});

def({
  name: 'record_lead_details',
  description: 'Save contact details or requirements the customer has explicitly shared. Only include fields the customer actually stated.',
  schema: z.strictObject({
    name: z.string().max(120).optional(),
    email: emailSchema.optional(),
    phone: z.string().max(40).regex(/^[+\d\s().-]{6,}$/, 'Invalid phone').optional(),
    company: z.string().max(160).optional(),
    requirements: z.string().max(2000).optional(),
    budgetAmount: z.number().nonnegative().max(1e10).optional(),
    timeline: z.string().max(200).optional(),
  }),
  async run(ctx, args) {
    const lead = await ensureLead(ctx);
    const set: Record<string, unknown> = { lastContactAt: new Date() };
    const contactSet: Record<string, string> = {};
    for (const k of ['name', 'email', 'phone', 'company', 'timeline'] as const) if (args[k]) set[k] = args[k];
    if (args.requirements) set.requirements = lead.requirements ? `${lead.requirements}\n${args.requirements}`.slice(0, 5000) : args.requirements;
    if (args.budgetAmount !== undefined) {
      set['budget.amount'] = args.budgetAmount;
      set['budget.currency'] = ctx.orgCurrency;
      ctx.state.allowedAmounts.push(args.budgetAmount);
    }
    for (const k of ['name', 'email', 'phone'] as const) if (args[k]) contactSet[`contact.${k}`] = args[k]!;
    await Lead.updateOne({ _id: lead._id, orgId: ctx.orgId }, { $set: set });
    if (Object.keys(contactSet).length) await Conversation.updateOne({ _id: ctx.conversationId, orgId: ctx.orgId }, { $set: contactSet });
    await logActivity(ctx.orgId, lead._id, 'ai_update', AI_ACTOR, 'Recorded customer-provided details', { fields: Object.keys(args) });
    await rescore(ctx.orgId, lead._id);
    return { ok: true, data: { saved: Object.keys(args), note: 'Stored as customer-provided (unverified) information.' } };
  },
});

def({
  name: 'record_qualification_answer',
  description: "Save the customer's answer to one of the configured qualification questions.",
  schema: z.strictObject({ questionKey: z.string().max(40), answer: z.string().min(1).max(1000) }),
  async run(ctx, { questionKey, answer }) {
    const q = ctx.agent.qualificationQuestions.find((x) => x.key === questionKey);
    if (!q) return { ok: false, error: `Unknown question key "${questionKey}". Use one of: ${ctx.agent.qualificationQuestions.map((x) => x.key).join(', ')}` };
    const lead = await ensureLead(ctx);
    const set: Record<string, unknown> = { [`qualificationAnswers.${questionKey}`]: answer, lastContactAt: new Date() };
    if (q.kind === 'timeline' && !lead.timeline) set.timeline = answer;
    if (q.kind === 'need' && !lead.requirements) set.requirements = answer;
    if (q.kind === 'budget' && lead.budget?.amount == null) {
      const m = answer.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s?(k)?/i);
      if (m) {
        set['budget.amount'] = Number(m[1]) * (m[2] ? 1000 : 1);
        set['budget.currency'] = ctx.orgCurrency;
      }
    }
    await Lead.updateOne({ _id: lead._id, orgId: ctx.orgId }, { $set: set });
    const score = await rescore(ctx.orgId, lead._id);
    await logActivity(ctx.orgId, lead._id, 'ai_update', AI_ACTOR, `Answered: ${q.question}`, { key: questionKey });
    return { ok: true, data: { saved: questionKey, leadScore: score?.score } };
  },
});

def({
  name: 'request_human_handoff',
  description: 'Hand the conversation to a human team member. The AI stops replying until a team member resumes it.',
  schema: z.strictObject({ reason: z.string().min(2).max(300) }),
  async run(ctx, { reason }) {
    await handOff(ctx.orgId, ctx.conversationId, reason);
    ctx.state.handedOff = true;
    return { ok: true, data: { status: 'handed_off' } };
  },
});

def({
  name: 'update_lead_stage',
  description: 'Move the lead to another OPEN pipeline stage (e.g. qualified). Cannot mark deals won or lost.',
  schema: z.strictObject({ stageKey: z.string().max(40), reason: z.string().max(300) }),
  async run(ctx, args, mode) {
    const stages = await getPipeline(ctx.orgId);
    const stage = stages.find((s) => s.key === args.stageKey);
    if (!stage) return { ok: false, error: `Unknown stage. Open stages: ${stages.filter((s) => s.type === 'open').map((s) => s.key).join(', ')}` };
    if (stage.type !== 'open') return { ok: false, error: 'Only a team member can mark a deal won or lost.' };
    const lead = await ensureLead(ctx);
    if (mode === 'approval') {
      const pa = await requestApproval(ctx, 'update_lead_stage', { leadId: String(lead._id), stageKey: stage.key }, `Move lead to “${stage.name}”`, args.reason);
      return { ok: true, data: { status: 'pending_approval', approvalId: String(pa._id) } };
    }
    await changeStage(ctx.orgId, { orgId: ctx.orgId }, lead._id, stage.key, AI_ACTOR, args.reason);
    return { ok: true, data: { status: 'updated', stage: stage.name } };
  },
});

def({
  name: 'send_quotation',
  description: 'Request a quotation for catalogue items. The team reviews it before it is sent. Prices are taken from the catalogue, not from you.',
  schema: z.strictObject({
    items: z.array(z.strictObject({ productId: z.string().regex(/^[a-f0-9]{24}$/), quantity: z.number().int().min(1).max(10000) })).min(1).max(20),
    note: z.string().max(500).optional(),
  }),
  async run(ctx, args) {
    const lead = await ensureLead(ctx);
    if (!lead.email) return { ok: false, error: 'No email address on file. Ask the customer for their email first.' };
    if (!lead.consent?.contactAllowed || lead.consent?.optedOutAt) return { ok: false, error: 'The customer has not given consent to be contacted. Ask them to share their details through the contact form so the team can send a quote.' };
    const ids = args.items.map((i) => new mongoose.Types.ObjectId(i.productId));
    const products = await Product.find({ orgId: ctx.orgId, _id: { $in: ids }, active: true }).lean();
    if (products.length !== new Set(args.items.map((i) => i.productId)).size) return { ok: false, error: 'One or more products were not found. Use get_products to find valid ids.' };
    if (products.some((p) => p.pricingModel === 'quote_only' || p.price === null)) return { ok: false, error: 'A quote-only item needs a custom quote from the team. Use request_human_handoff.' };
    const pa = await requestApproval(ctx, 'send_quotation', { leadId: String(lead._id), items: args.items, note: args.note ?? '' }, `Send a quotation for ${products.map((p) => p.name).join(', ')} to ${lead.email}`, args.note ?? 'Customer requested a quote');
    return { ok: true, data: { status: 'pending_approval', approvalId: String(pa._id) } };
  },
});

def({
  name: 'offer_discount',
  description: 'Request a percentage discount. Within the business’s automatic limit it is approved immediately; otherwise it goes to the team for approval.',
  schema: z.strictObject({ percent: z.number().positive().max(100), productId: z.string().regex(/^[a-f0-9]{24}$/).optional(), reason: z.string().min(2).max(300) }),
  async run(ctx, args) {
    const pol = ctx.agent.policies;
    const withinBounds = !!pol.autoDiscountEnabled && args.percent <= (pol.maxAutoDiscountPercent ?? 0);
    if (withinBounds) {
      // Bounded workflow explicitly authorised by the business: record and allow.
      ctx.state.approvedDiscountPercents.push(args.percent);
      const prods = await Product.find({ orgId: ctx.orgId, active: true, price: { $ne: null } }, { price: 1 }).lean();
      for (const p of prods) ctx.state.allowedAmounts.push(Math.round(p.price! * (100 - args.percent)) / 100);
      await audit(ctx.orgId, AI_ACTOR, 'discount.auto_approved', { type: 'conversation', id: ctx.conversationId }, { percent: args.percent, limit: pol.maxAutoDiscountPercent });
      await Message.create({ orgId: ctx.orgId, conversationId: ctx.conversationId, kind: 'event', role: 'system', content: `Discount of ${args.percent}% offered within the automatic limit (${pol.maxAutoDiscountPercent}%)`, event: { type: 'discount_auto_approved', data: { percent: args.percent } } });
      return { ok: true, data: { status: 'approved_within_policy', percent: args.percent } };
    }
    const pa = await requestApproval(ctx, 'offer_discount', { percent: args.percent, productId: args.productId ?? null }, `Offer a ${args.percent}% discount`, args.reason);
    return { ok: true, data: { status: 'pending_approval', approvalId: String(pa._id), message: 'Not approved yet. Tell the customer the team will review the request. Do not promise the discount.' } };
  },
});

def({
  name: 'propose_custom_terms',
  description: 'Request a decision on payment terms, refunds, contract or legal terms, or any commitment. Always reviewed by the team.',
  schema: z.strictObject({ type: z.enum(['payment_terms', 'refund', 'contract', 'legal', 'other']), details: z.string().min(2).max(1000) }),
  async run(ctx, args) {
    const pa = await requestApproval(ctx, 'propose_custom_terms', args, `Custom ${args.type.replace('_', ' ')} request`, args.details);
    return { ok: true, data: { status: 'pending_approval', approvalId: String(pa._id), message: 'Not approved. Tell the customer the team will review it.' } };
  },
});

const registry = new Map(tools.map((t) => [t.name, t]));

/** Tool specs exposed to the model: only tools that are not disabled for this agent. */
export function toolSpecs(agent: AgentConfig): ToolSpec[] {
  return tools
    .filter((t) => resolveMode(agent, t.name) !== 'disabled')
    .map((t) => ({ name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) as Record<string, unknown> }));
}

/**
 * Execute one tool call from the model. Every call is re-authorised here,
 * whatever the model was shown: unknown or disabled tools are refused and
 * arguments are validated against the strict schema.
 */
export async function executeTool(ctx: ToolContext, name: string, rawArgs: string): Promise<{ result: ToolResult; mode: ToolMode; category: ActionCategory | null }> {
  const tool = registry.get(name);
  const category = categoryOf(name);
  if (!tool && catalog(name)) {
    ctx.state.flags.push({ type: 'tool_denied', detail: `${name} is not available in this release` });
    return { result: { ok: false, error: 'This action is not available. Offer to connect the customer with the team instead.' }, mode: 'disabled', category };
  }
  if (!tool) {
    ctx.state.flags.push({ type: 'tool_unknown', detail: name.slice(0, 60) });
    return { result: { ok: false, error: `There is no tool called "${name}".` }, mode: 'disabled', category };
  }
  const mode = resolveMode(ctx.agent, name);
  if (mode === 'disabled') {
    ctx.state.flags.push({ type: 'tool_denied', detail: `${name} is disabled for this agent` });
    return { result: { ok: false, error: 'This action is not enabled. Offer to connect the customer with the team instead.' }, mode, category };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArgs || '{}');
  } catch {
    ctx.state.flags.push({ type: 'tool_invalid_args', detail: `${name}: arguments were not valid JSON` });
    return { result: { ok: false, error: 'Arguments must be valid JSON.' }, mode, category };
  }
  const parsed = tool.schema.safeParse(parsedJson);
  if (!parsed.success) {
    ctx.state.flags.push({ type: 'tool_invalid_args', detail: `${name}: ${parsed.error.issues[0]?.message}` });
    return { result: { ok: false, error: `Invalid arguments: ${parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}` }, mode, category };
  }
  try {
    return { result: await tool.run(ctx, parsed.data, mode), mode, category };
  } catch (err) {
    return { result: { ok: false, error: 'The action failed. Offer to connect the customer with the team.' }, mode, category };
  }
}

export async function handOff(orgId: Types.ObjectId, conversationId: Types.ObjectId, reason: string) {
  await Conversation.updateOne({ _id: conversationId, orgId }, { $set: { aiMode: 'paused', escalated: true, escalationReason: reason.slice(0, 300) } });
  await Message.create({ orgId, conversationId, kind: 'event', role: 'system', content: `Handed off to the team: ${reason}`, event: { type: 'escalated', data: { reason } } });
  await audit(orgId, AI_ACTOR, 'conversation.escalated', { type: 'conversation', id: conversationId }, { reason });
}
