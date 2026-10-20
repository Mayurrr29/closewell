import type { Types } from 'mongoose';
import { PLANS, type PlanDefinition, type PlanLimits, type UsageMetric } from '@closewell/shared';
import { AppError } from '../lib/errors';
import { Agent } from '../models/ai';
import { Invitation, Membership, Organization } from '../models/identity';
import { KnowledgeSource } from '../models/knowledge';
import { UsageCounter } from '../models/platform';
import { Product } from '../models/sales';

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);

export async function planFor(orgId: Types.ObjectId): Promise<{ plan: PlanDefinition; status: string; trialEndsAt?: Date | null }> {
  const org = await Organization.findById(orgId, { subscription: 1 }).lean();
  const sub = org?.subscription;
  const plan = PLANS[(sub?.planId as keyof typeof PLANS) ?? 'trial'] ?? PLANS.trial;
  let status = sub?.status ?? 'trialing';
  if (plan.id === 'trial' && sub?.trialEndsAt && sub.trialEndsAt < new Date()) status = 'expired';
  return { plan, status, trialEndsAt: sub?.trialEndsAt };
}

export async function usageFor(orgId: Types.ObjectId, period = currentPeriod()) {
  const rows = await UsageCounter.find({ orgId, period }).lean();
  const out: Partial<Record<string, number>> = {};
  for (const r of rows) out[r.metric] = r.value;
  return out;
}

export async function incrementUsage(orgId: Types.ObjectId, metric: UsageMetric | 'ai_cost_micro_usd', by: number) {
  if (!by) return;
  await UsageCounter.updateOne({ orgId, period: currentPeriod(), metric }, { $inc: { value: by } }, { upsert: true });
}

type Countable = 'seats' | 'agents' | 'products' | 'knowledge_sources';

async function countCurrent(orgId: Types.ObjectId, what: Countable): Promise<number> {
  switch (what) {
    case 'seats': {
      const [m, i] = await Promise.all([
        Membership.countDocuments({ orgId }),
        Invitation.countDocuments({ orgId, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } }),
      ]);
      return m + i;
    }
    case 'agents':
      return Agent.countDocuments({ orgId });
    case 'products':
      return Product.countDocuments({ orgId });
    case 'knowledge_sources':
      return KnowledgeSource.countDocuments({ orgId, type: { $ne: 'product' } });
  }
}

/** Throws limit_exceeded (HTTP 402) when adding `adding` more would exceed the plan. Enforced server-side. */
export async function assertCanAdd(orgId: Types.ObjectId, what: Countable, adding = 1) {
  const { plan } = await planFor(orgId);
  const limit = plan.limits[what as keyof PlanLimits];
  const current = await countCurrent(orgId, what);
  if (current + adding > limit) {
    throw new AppError('limit_exceeded', `Your ${plan.name} plan allows ${limit} ${what.replace('_', ' ')}. Upgrade or remove some to add more.`, { limit, current, metric: what });
  }
}

/** Metered check used before spending (AI replies, outbound messages). */
export async function checkMetered(orgId: Types.ObjectId, metric: UsageMetric, adding = 1): Promise<{ allowed: boolean; limit: number; used: number; reason?: string }> {
  const { plan, status } = await planFor(orgId);
  if (status === 'expired' || status === 'canceled') return { allowed: false, limit: 0, used: 0, reason: 'subscription_inactive' };
  const limit = plan.limits[metric as keyof PlanLimits] as number;
  const used = (await usageFor(orgId))[metric] ?? 0;
  if (used + adding <= limit) return { allowed: true, limit, used };
  // Paid plans with overage pricing keep working; usage beyond the included amount is billable.
  if (plan.aiMessageOverageCents !== null && metric === 'ai_messages') return { allowed: true, limit, used, reason: 'overage' };
  return { allowed: false, limit, used, reason: 'limit_reached' };
}
