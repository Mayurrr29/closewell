import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { emailSchema, messageInputSchema } from '@closewell/shared';
import { runAgentTurn } from '../../ai/runner';
import { handOff } from '../../ai/tools';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { body, coarseIp, ok, parse } from '../../lib/http';
import { logger } from '../../lib/logger';
import { widgetMessageLimiter, widgetSessionLimiter } from '../../middleware/rateLimit';
import { Agent } from '../../models/ai';
import { Conversation, Message, WidgetConfig, WidgetSession } from '../../models/conversations';
import { ProcessedEvent } from '../../models/platform';
import { Lead } from '../../models/sales';
import { audit } from '../../services/audit';
import { getPipeline, logActivity, rescore } from '../leads/service';
import { publicMessage } from '../conversations/serialize';

/**
 * Public, unauthenticated surface used by the embeddable widget.
 *
 * Security model:
 *  - The widget key is public (it is in the page source). It identifies the
 *    widget; it grants no access to the dashboard API.
 *  - Browser requests must come from an Origin on the widget's allow-list.
 *    (Origin can be forged by non-browser clients, so rate limits, session
 *    caps and plan usage limits are the real abuse controls.)
 *  - Each visitor gets a random session token (stored hashed) that can only
 *    read and write its own conversation.
 */
export const publicWidgetRouter = Router();

const SESSION_TTL_MS = 30 * 86400_000;
const MAX_MESSAGES_PER_SESSION = 300;
const MAX_MESSAGES_PER_MINUTE = 12;

type WidgetDoc = InstanceType<typeof WidgetConfig>;
interface WidgetReq extends Request {
  widget?: WidgetDoc;
  isPreview?: boolean;
  session?: InstanceType<typeof WidgetSession>;
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    const u = new URL(origin);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return false;
  }
  const hostname = host.split(':')[0];
  return allowed.some((d) => {
    if (d.startsWith('localhost')) return host === d || (d === 'localhost' && hostname === 'localhost');
    if (d.startsWith('*.')) return hostname.endsWith(d.slice(1)) && hostname !== d.slice(2);
    return hostname === d || hostname === `www.${d}`;
  });
}

/** Load the widget by key and enforce the origin allow-list; answers CORS preflight. */
async function widgetGuard(req: WidgetReq, res: Response, next: NextFunction) {
  const key = String(req.params.key ?? '');
  if (!/^wk_[A-Za-z0-9_-]{10,40}$/.test(key)) return next(new AppError('not_found', 'Widget not found'));
  const w = await WidgetConfig.findOne({ publicKey: key }).setOptions({ crossTenant: true });
  if (!w) return next(new AppError('not_found', 'Widget not found'));
  const origin = req.get('origin');
  const isPreview = !!origin && origin === env.APP_ORIGIN;
  if (!isPreview && !originAllowed(origin, w.allowedDomains)) {
    return next(new AppError('forbidden', 'This website is not allowed to use this chat widget. Add the domain in Widget settings.'));
  }
  res.setHeader('Access-Control-Allow-Origin', origin!);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!w.enabled && !isPreview) return next(new AppError('not_found', 'This chat is not available right now.'));
  req.widget = w;
  req.isPreview = isPreview;
  next();
}

async function sessionGuard(req: WidgetReq, _res: Response, next: NextFunction) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!token || token.length < 20) return next(new AppError('unauthenticated', 'Start a chat session first.'));
  const s = await WidgetSession.findOne({ tokenHash: sha256(token), orgId: req.widget!.orgId });
  if (!s || s.expiresAt < new Date() || s.blockedAt) return next(new AppError('unauthenticated', 'Your chat session has ended. Refresh to start a new one.'));
  if (s.origin !== req.get('origin')) return next(new AppError('unauthenticated', 'Session does not belong to this website.'));
  req.session = s;
  next();
}

function isOnline(bh: WidgetDoc['businessHours']): boolean {
  if (!bh?.enabled) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: bh.timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  const hm = `${parts.find((p) => p.type === 'hour')!.value.replace('24', '00')}:${parts.find((p) => p.type === 'minute')!.value}`;
  return (bh.days ?? []).includes(wd) && hm >= (bh.start ?? '00:00') && hm < (bh.end ?? '23:59');
}

const r = Router({ mergeParams: true });
publicWidgetRouter.use('/:key', widgetGuard as express.RequestHandler, r);

r.get('/config', async (req: WidgetReq, res) => {
  const w = req.widget!;
  const agent = w.agentId ? await Agent.findOne({ _id: w.agentId, orgId: w.orgId }, { status: 1, published: 1, config: 1 }).lean() : null;
  const cfg = (req.isPreview ? agent?.config : agent?.published) as { persona?: { displayName?: string } } | null;
  res.json(
    ok({
      brandName: w.brandName,
      greeting: w.greeting,
      primaryColor: w.primaryColor,
      position: w.position,
      collectContact: w.collectContact,
      assistantName: cfg?.persona?.displayName ?? 'Assistant',
      teamOnline: isOnline(w.businessHours),
      offlineMessage: w.businessHours?.offlineMessage ?? '',
      available: !!cfg,
      preview: !!req.isPreview,
    }),
  );
});

/** Start a session or resume one (conversation continuity across page loads). */
r.post('/sessions', widgetSessionLimiter, async (req: WidgetReq, res) => {
  const w = req.widget!;
  const { resumeToken } = body(req, z.object({ resumeToken: z.string().max(100).optional() }));
  const origin = req.get('origin')!;
  if (resumeToken) {
    const s = await WidgetSession.findOne({ tokenHash: sha256(resumeToken), orgId: w.orgId });
    if (s && s.expiresAt > new Date() && !s.blockedAt && s.origin === origin) {
      const conv = await Conversation.findOne({ _id: s.conversationId, orgId: w.orgId }).lean();
      if (conv && conv.status === 'open') {
        await WidgetSession.updateOne({ _id: s._id, orgId: w.orgId }, { $set: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
        const messages = await Message.find({ orgId: w.orgId, conversationId: conv._id, kind: 'message' }).sort({ createdAt: 1 }).limit(200).lean();
        return res.json(ok({ token: resumeToken, resumed: true, messages: messages.map(publicMessage), contactCollected: !!conv.contact?.email || !!conv.leadId }));
      }
    }
  }
  const token = randomToken(32);
  const conv = await Conversation.create({ orgId: w.orgId, agentId: w.agentId, channel: 'web', isTest: !!req.isPreview });
  await WidgetSession.create({ orgId: w.orgId, tokenHash: sha256(token), conversationId: conv._id, origin, preview: !!req.isPreview, expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastSeenAt: new Date() });
  if (w.greeting) await Message.create({ orgId: w.orgId, conversationId: conv._id, kind: 'message', role: 'ai', content: w.greeting, meta: { automated: true, greeting: true } });
  const messages = await Message.find({ orgId: w.orgId, conversationId: conv._id, kind: 'message' }).sort({ createdAt: 1 }).lean();
  res.status(201).json(ok({ token, resumed: false, messages: messages.map(publicMessage), contactCollected: false }));
});

r.get('/messages', sessionGuard as express.RequestHandler, async (req: WidgetReq, res) => {
  const s = req.session!;
  const { after } = parse(z.object({ after: z.coerce.date().optional() }), req.query);
  const messages = await Message.find({ orgId: s.orgId, conversationId: s.conversationId, kind: 'message', ...(after ? { createdAt: { $gt: after } } : {}) }).sort({ createdAt: 1 }).limit(200).lean();
  const conv = await Conversation.findOne({ _id: s.conversationId, orgId: s.orgId }, { aiMode: 1, status: 1 }).lean();
  await WidgetSession.updateOne({ _id: s._id, orgId: s.orgId }, { $set: { lastSeenAt: new Date() } });
  res.json(ok({ messages: messages.map(publicMessage), status: conv?.status, withTeam: conv?.aiMode !== 'ai' }));
});

/**
 * Send a customer message. Idempotent on clientMessageId: a retried request
 * (flaky network, double click) returns the original result without a
 * second AI reply. Responds with Server-Sent Events when the client asks
 * for text/event-stream, otherwise JSON.
 */
r.post('/messages', widgetMessageLimiter, sessionGuard as express.RequestHandler, async (req: WidgetReq, res) => {
  const s = req.session!;
  const w = req.widget!;
  const input = body(req, messageInputSchema);
  if (input.content.length > 2000) throw new AppError('validation_failed', 'Messages are limited to 2,000 characters.');
  const sse = (req.get('accept') ?? '').includes('text/event-stream');
  const send = (event: string, data: unknown) => {
    if (sse) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const dedupeKey = input.clientMessageId ? `widget:${s._id}:${input.clientMessageId}` : null;
  if (dedupeKey) {
    const seen = await ProcessedEvent.findOne({ key: dedupeKey }).lean();
    if (seen) {
      const replies = await Message.find({ orgId: s.orgId, conversationId: s.conversationId, kind: 'message', createdAt: { $gt: (seen.result as { at: string })?.at ? new Date((seen.result as { at: string }).at) : new Date(0) }, role: { $ne: 'customer' } }).sort({ createdAt: 1 }).limit(5).lean();
      const payload = { duplicate: true, messageId: (seen.result as { messageId?: string })?.messageId, replies: replies.map(publicMessage) };
      if (sse) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        send('ack', payload);
        send('done', {});
        return res.end();
      }
      return res.json(ok(payload));
    }
  }

  // Abuse controls per session.
  if (s.messageCount >= MAX_MESSAGES_PER_SESSION) {
    await WidgetSession.updateOne({ _id: s._id, orgId: s.orgId }, { $set: { blockedAt: new Date() } });
    throw new AppError('rate_limited', 'This chat has reached its message limit. Please contact the business directly.');
  }
  const recent = await Message.countDocuments({ orgId: s.orgId, conversationId: s.conversationId, role: 'customer', createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent >= MAX_MESSAGES_PER_MINUTE) throw new AppError('rate_limited', 'You are sending messages too quickly. Wait a moment and try again.');

  const conv = await Conversation.findOne({ _id: s.conversationId, orgId: s.orgId });
  if (!conv) throw new AppError('not_found', 'Conversation not found');
  if (conv.status === 'closed') {
    // A closed conversation is reopened by a new customer message.
    await Conversation.updateOne({ _id: conv._id, orgId: s.orgId }, { $set: { status: 'open', closedAt: null } });
  }
  const m = await Message.create({ orgId: s.orgId, conversationId: s.conversationId, kind: 'message', role: 'customer', content: input.content, meta: { ip: coarseIp(req.ip) } });
  if (dedupeKey) {
    try {
      await ProcessedEvent.create({ key: dedupeKey, orgId: s.orgId, result: { messageId: String(m._id), at: m.createdAt.toISOString() } });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        // Lost a race with an identical concurrent request: undo our copy.
        await Message.deleteOne({ _id: m._id, orgId: s.orgId });
        return res.json(ok({ duplicate: true }));
      }
      throw err;
    }
  }
  await Conversation.updateOne({ _id: s.conversationId, orgId: s.orgId }, { $set: { lastActivityAt: m.createdAt, lastCustomerMessageAt: m.createdAt, lastMessagePreview: input.content.slice(0, 140) } });
  await WidgetSession.updateOne({ _id: s._id, orgId: s.orgId }, { $inc: { messageCount: 1 }, $set: { lastSeenAt: new Date() } });
  if (conv.leadId) await Lead.updateOne({ _id: conv.leadId, orgId: s.orgId }, { $set: { lastContactAt: new Date() } });

  if (sse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    send('ack', { messageId: String(m._id), createdAt: m.createdAt });
  }
  const freshConv = await Conversation.findOne({ _id: s.conversationId, orgId: s.orgId }, { aiMode: 1 }).lean();
  if (freshConv?.aiMode !== 'ai') {
    send('status', { withTeam: true });
    send('done', {});
    return sse ? res.end() : res.json(ok({ messageId: String(m._id), replies: [], withTeam: true }));
  }
  send('typing', {});
  let outcome;
  try {
    outcome = await runAgentTurn({ orgId: s.orgId, conversationId: s.conversationId, useDraft: !!s.preview });
  } catch (err) {
    logger.error({ err }, 'Agent turn crashed');
    outcome = { status: 'error' as const };
  }
  const replies = outcome.message ? [publicMessage({ _id: outcome.message.id, role: outcome.message.role, content: outcome.message.content, createdAt: outcome.message.createdAt })] : [];
  const after = await Conversation.findOne({ _id: s.conversationId, orgId: s.orgId }, { aiMode: 1 }).lean();
  if (outcome.status === 'skipped' && outcome.reason === 'agent_not_published') {
    replies.push({ id: 'na', role: 'assistant', content: 'This assistant is not available yet. Please check back soon.', createdAt: new Date() });
  }
  if (sse) {
    for (const rep of replies) send('message', rep);
    send('status', { withTeam: after?.aiMode !== 'ai' });
    send('done', {});
    return res.end();
  }
  res.json(ok({ messageId: String(m._id), replies, withTeam: after?.aiMode !== 'ai' }));
});

/** Contact form. Consent recorded here comes from the customer's own action. */
r.post('/contact', sessionGuard as express.RequestHandler, async (req: WidgetReq, res) => {
  const s = req.session!;
  const input = body(
    req,
    z.object({
      name: z.string().trim().max(120).optional(),
      email: emailSchema.optional(),
      phone: z.string().trim().max(40).optional(),
      consentToContact: z.boolean(),
      consentToMarketing: z.boolean().default(false),
    }),
  );
  if (!input.email && !input.phone) throw new AppError('validation_failed', 'Enter an email or phone number', { fields: { email: 'Email or phone required' } });
  const conv = await Conversation.findOne({ _id: s.conversationId, orgId: s.orgId });
  if (!conv) throw new AppError('not_found', 'Conversation not found');
  const consent = { contactAllowed: input.consentToContact, marketingAllowed: input.consentToMarketing, preferredChannel: input.email ? 'email' : 'phone', recordedAt: new Date(), optedOutAt: input.consentToContact ? null : new Date() };
  let leadId = conv.leadId;
  if (leadId && (await Lead.exists({ _id: leadId, orgId: s.orgId }))) {
    await Lead.updateOne({ _id: leadId, orgId: s.orgId }, { $set: { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email } : {}), ...(input.phone ? { phone: input.phone } : {}), consent, lastContactAt: new Date() } });
  } else {
    const stages = await getPipeline(s.orgId);
    const lead = await Lead.create({ orgId: s.orgId, name: input.name ?? '', email: input.email ?? '', phone: input.phone ?? '', source: 'web_widget', stageKey: stages[0].key, stageType: stages[0].type, consent, conversationIds: [conv._id], isTest: conv.isTest, lastContactAt: new Date() });
    leadId = lead._id;
    await logActivity(s.orgId, lead._id, 'created', { type: 'customer', label: 'Website visitor' }, 'Submitted the chat contact form');
  }
  await Conversation.updateOne({ _id: conv._id, orgId: s.orgId }, { $set: { leadId, contact: { name: input.name ?? conv.contact?.name ?? '', email: input.email ?? conv.contact?.email ?? '', phone: input.phone ?? conv.contact?.phone ?? '' } } });
  await logActivity(s.orgId, leadId!, 'consent', { type: 'customer', label: 'Website visitor' }, '', { contactAllowed: input.consentToContact, marketingAllowed: input.consentToMarketing });
  await rescore(s.orgId, leadId!);
  await audit(s.orgId, { type: 'customer', label: 'Website visitor' }, 'lead.consent_recorded', { type: 'lead', id: leadId }, { contactAllowed: input.consentToContact, marketingAllowed: input.consentToMarketing });
  res.json(ok({ saved: true }));
});

r.post('/handover', sessionGuard as express.RequestHandler, async (req: WidgetReq, res) => {
  const s = req.session!;
  const w = req.widget!;
  await handOff(s.orgId, s.conversationId, 'Customer pressed “Talk to a person”');
  const online = isOnline(w.businessHours);
  const text = online ? "Thanks! I've asked a member of our team to join. They'll reply here." : w.businessHours?.offlineMessage || 'Our team is offline right now. Leave your details and we will get back to you.';
  const m = await Message.create({ orgId: s.orgId, conversationId: s.conversationId, kind: 'message', role: 'ai', content: text, meta: { automated: true, handover: true } });
  res.json(ok({ message: publicMessage(m.toObject()), teamOnline: online }));
});

// ---------- widget.js ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, '../../../../widget/dist/widget.js'), path.resolve(here, '../../widget/dist/widget.js'), path.resolve(process.cwd(), '../widget/dist/widget.js'), path.resolve(process.cwd(), 'apps/widget/dist/widget.js')];
let cached: { body: string; at: number } | null = null;

export function widgetScriptHandler(_req: Request, res: Response) {
  if (!cached || (!env.isProd && Date.now() - cached.at > 2000)) {
    const file = candidates.find((p) => existsSync(p));
    cached = file ? { body: readFileSync(file, 'utf8'), at: Date.now() } : null;
  }
  res.setHeader('content-type', 'application/javascript; charset=utf-8');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('cache-control', env.isProd ? 'public, max-age=300' : 'no-cache');
  if (!cached) return res.status(503).send('/* Closewell widget is not built. Run: npm run build -w @closewell/widget */');
  res.send(cached.body.replace('__CLOSEWELL_API__', env.API_PUBLIC_URL.replace(/\/$/, '')));
}

