/**
 * Single source of truth for plans, prices and limits.
 * Both the API (entitlement enforcement) and the web app (pricing page,
 * billing page) read from here. Change prices or limits in this file only.
 *
 * Prices are placeholders for a product that has not launched; payment
 * processing is NOT connected (see docs/billing.md).
 */
export const PLAN_IDS = ['trial', 'starter', 'professional', 'business', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const USAGE_METRICS = ['ai_messages', 'ai_tokens', 'channel_messages', 'voice_minutes', 'knowledge_bytes'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export interface PlanLimits {
  seats: number;
  agents: number;
  /** AI replies per calendar month (UTC). */
  ai_messages: number;
  /** Outbound messages on external channels per month. */
  channel_messages: number;
  voice_minutes: number;
  /** Total extracted knowledge text stored, in bytes. */
  knowledge_bytes: number;
  knowledge_sources: number;
  products: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price in USD cents; null = contact sales. */
  monthlyPriceCents: number | null;
  /** Annual price in USD cents (billed yearly); null = contact sales. */
  annualPriceCents: number | null;
  /** Usage-based overage per AI message beyond the included amount, USD cents. null = hard cap. */
  aiMessageOverageCents: number | null;
  limits: PlanLimits;
  features: string[];
  trialDays?: number;
}

const MB = 1024 * 1024;

export const PLANS: Record<PlanId, PlanDefinition> = {
  trial: {
    id: 'trial',
    name: 'Free trial',
    description: 'Evaluate the platform with one agent and the website widget.',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    aiMessageOverageCents: null,
    trialDays: 14,
    limits: { seats: 3, agents: 1, ai_messages: 300, channel_messages: 0, voice_minutes: 0, knowledge_bytes: 5 * MB, knowledge_sources: 25, products: 50 },
    features: ['Website chat widget', 'Knowledge base', 'Lead CRM', 'Approval queue'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'For small teams running one sales agent on their website.',
    monthlyPriceCents: 4900,
    annualPriceCents: 49000,
    aiMessageOverageCents: null,
    limits: { seats: 3, agents: 1, ai_messages: 2000, channel_messages: 1000, voice_minutes: 0, knowledge_bytes: 25 * MB, knowledge_sources: 100, products: 200 },
    features: ['Everything in trial', 'Higher usage limits'],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    description: 'For growing teams that need more agents and channels.',
    monthlyPriceCents: 14900,
    annualPriceCents: 149000,
    aiMessageOverageCents: 2,
    limits: { seats: 10, agents: 3, ai_messages: 10000, channel_messages: 10000, voice_minutes: 300, knowledge_bytes: 100 * MB, knowledge_sources: 500, products: 2000 },
    features: ['Everything in Starter', 'Multiple agents', 'Usage-based AI overage'],
  },
  business: {
    id: 'business',
    name: 'Business',
    description: 'For sales organizations with several teams.',
    monthlyPriceCents: 39900,
    annualPriceCents: 399000,
    aiMessageOverageCents: 2,
    limits: { seats: 30, agents: 10, ai_messages: 40000, channel_messages: 50000, voice_minutes: 1500, knowledge_bytes: 500 * MB, knowledge_sources: 2500, products: 10000 },
    features: ['Everything in Professional', 'Audit log export'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom limits, terms and support.',
    monthlyPriceCents: null,
    annualPriceCents: null,
    aiMessageOverageCents: null,
    limits: { seats: 500, agents: 100, ai_messages: 1_000_000, channel_messages: 1_000_000, voice_minutes: 50_000, knowledge_bytes: 10_000 * MB, knowledge_sources: 100_000, products: 1_000_000 },
    features: ['Custom limits', 'Custom terms'],
  },
};

export function formatPrice(cents: number | null, currency = 'USD'): string {
  if (cents === null) return 'Contact us';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
