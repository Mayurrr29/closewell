import { Router } from 'express';
import { z } from 'zod';
import { PLANS, PLAN_IDS } from '@closewell/shared';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { body, ok } from '../../lib/http';
import { ctx, requirePermission } from '../../middleware/auth';
import { Agent } from '../../models/ai';
import { Invitation, Membership, Organization } from '../../models/identity';
import { KnowledgeSource } from '../../models/knowledge';
import { Product } from '../../models/sales';
import { audit, userActor } from '../../services/audit';
import { currentPeriod, planFor, usageFor } from '../../services/entitlements';

export const billingRouter = Router({ mergeParams: true });

/** Payment processing is not connected. This reports the plan, limits and metered usage honestly. */
billingRouter.get('/', requirePermission('billing:read', 'org:read'), async (req, res) => {
  const c = ctx(req);
  const { plan, status, trialEndsAt } = await planFor(c.orgId);
  const usage = await usageFor(c.orgId);
  const [members, invites, agents, products, sources, bytes] = await Promise.all([
    Membership.countDocuments({ orgId: c.orgId }),
    Invitation.countDocuments({ orgId: c.orgId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }),
    Agent.countDocuments({ orgId: c.orgId }),
    Product.countDocuments({ orgId: c.orgId }),
    KnowledgeSource.countDocuments({ orgId: c.orgId, type: { $ne: 'product' } }),
    KnowledgeSource.aggregate<{ t: number }>([{ $match: { orgId: c.orgId } }, { $group: { _id: null, t: { $sum: '$bytes' } } }]),
  ]);
  const org = await Organization.findById(c.orgId, { subscription: 1 }).lean();
  res.json(
    ok({
      plan: { id: plan.id, name: plan.name, interval: org?.subscription?.interval ?? 'month' },
      status,
      trialEndsAt,
      period: currentPeriod(),
      paymentProvider: { status: 'not_configured', message: 'Payment processing is not connected. No charges are made and no invoices exist.' },
      limits: plan.limits,
      usage: {
        seats: members + invites,
        agents,
        products,
        knowledge_sources: sources,
        knowledge_bytes: bytes[0]?.t ?? 0,
        ai_messages: usage.ai_messages ?? 0,
        ai_tokens: usage.ai_tokens ?? 0,
        channel_messages: usage.channel_messages ?? 0,
        voice_minutes: usage.voice_minutes ?? 0,
        estimated_ai_cost_usd: (usage.ai_cost_micro_usd ?? 0) / 1e6,
      },
      plans: PLAN_IDS.map((id) => PLANS[id]),
      canSwitchPlanWithoutPayment: !env.isProd,
      billingHistory: [],
    }),
  );
});

/**
 * Development-only plan switch so limits can be tested. In production this
 * endpoint refuses: upgrades must go through a payment provider once one is
 * integrated (see docs/billing.md).
 */
billingRouter.post('/plan', requirePermission('billing:manage'), async (req, res) => {
  const c = ctx(req);
  if (env.isProd) throw new AppError('provider_unavailable', 'Plan changes need a payment provider, which is not configured.');
  const { planId, interval } = body(req, z.object({ planId: z.enum(PLAN_IDS), interval: z.enum(['month', 'year']).default('month') }));
  await Organization.updateOne(
    { _id: c.orgId },
    { $set: { 'subscription.planId': planId, 'subscription.status': planId === 'trial' ? 'trialing' : 'active', 'subscription.interval': interval, 'subscription.provider': 'none' } },
  );
  await audit(c.orgId, userActor(c.userId), 'billing.plan_changed_dev', { type: 'organization', id: c.orgId }, { planId, interval, note: 'Development switch; no payment taken' });
  res.json(ok({ planId, interval, note: 'Changed in development mode. No payment was taken.' }));
});
