import { Router } from 'express';
import { widgetConfigSchema } from '@closewell/shared';
import { env } from '../../config/env';
import { randomToken } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import { body, ok } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { Agent } from '../../models/ai';
import { WidgetConfig } from '../../models/conversations';
import { Organization } from '../../models/identity';
import { audit, userActor } from '../../services/audit';

export const widgetAdminRouter = Router({ mergeParams: true });

export function snippet(publicKey: string) {
  return `<script src="${env.API_PUBLIC_URL.replace(/\/$/, '')}/widget.js" data-closewell-key="${publicKey}" async></script>`;
}

function serialize(w: Record<string, any>, agentStatus: string | null) {
  return {
    publicKey: w.publicKey,
    enabled: w.enabled,
    agentId: w.agentId ? String(w.agentId) : null,
    agentStatus,
    brandName: w.brandName,
    greeting: w.greeting,
    primaryColor: w.primaryColor,
    position: w.position,
    allowedDomains: w.allowedDomains,
    collectContact: w.collectContact,
    businessHours: w.businessHours,
    snippet: snippet(w.publicKey),
    scriptUrl: `${env.API_PUBLIC_URL.replace(/\/$/, '')}/widget.js`,
    apiBase: env.API_PUBLIC_URL.replace(/\/$/, ''),
  };
}

async function getOrCreate(orgId: import('mongoose').Types.ObjectId) {
  let w = await WidgetConfig.findOne({ orgId }).lean();
  if (!w) {
    const org = await Organization.findById(orgId, { name: 1 }).lean();
    const agent = await Agent.findOne({ orgId }).sort({ createdAt: 1 }).lean();
    await WidgetConfig.create({ orgId, publicKey: `wk_${randomToken(18)}`, brandName: org?.name ?? '', agentId: agent?._id ?? null });
    w = await WidgetConfig.findOne({ orgId }).lean();
  }
  return w!;
}

widgetAdminRouter.get('/', requirePermission('widget:read'), async (req, res) => {
  const c = ctx(req);
  const w = await getOrCreate(c.orgId);
  const agent = w.agentId ? await Agent.findOne({ _id: w.agentId, orgId: c.orgId }, { status: 1 }).lean() : null;
  res.json(ok(serialize(w, agent?.status ?? null)));
});

widgetAdminRouter.put('/', requirePermission('widget:manage'), async (req, res) => {
  const c = ctx(req);
  const input = body(req, widgetConfigSchema);
  await getOrCreate(c.orgId);
  if (input.agentId && !(await Agent.exists({ _id: input.agentId, orgId: c.orgId }))) throw new AppError('validation_failed', 'Unknown agent', { fields: { agentId: 'Choose one of your agents' } });
  if (input.enabled && !input.allowedDomains.length) throw new AppError('validation_failed', 'Add at least one allowed domain before enabling the widget', { fields: { allowedDomains: 'Required to enable' } });
  const w = await WidgetConfig.findOneAndUpdate({ orgId: c.orgId }, { $set: input }, { new: true }).lean();
  if (!w) throw notFound('Widget');
  await audit(c.orgId, userActor(c.userId), 'widget.updated', { type: 'widget' }, { enabled: input.enabled, domains: input.allowedDomains });
  const agent = w.agentId ? await Agent.findOne({ _id: w.agentId, orgId: c.orgId }, { status: 1 }).lean() : null;
  res.json(ok(serialize(w, agent?.status ?? null)));
});

/** Rotating the public key breaks existing embeds (useful if the key is being abused). */
widgetAdminRouter.post('/rotate-key', requirePermission('widget:manage'), async (req, res) => {
  const c = ctx(req);
  const w = await WidgetConfig.findOneAndUpdate({ orgId: c.orgId }, { $set: { publicKey: `wk_${randomToken(18)}` } }, { new: true }).lean();
  if (!w) throw notFound('Widget');
  await audit(c.orgId, userActor(c.userId), 'widget.key_rotated', { type: 'widget' });
  res.json(ok(serialize(w, null)));
});
