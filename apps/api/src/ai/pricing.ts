import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * ESTIMATED cost per million tokens (USD). These are configuration, not
 * facts: check your provider's current price list and override with
 * AI_PRICE_TABLE='{"gpt-4.1-mini":{"inputPerMTok":0.4,"outputPerMTok":1.6}}'.
 */
const DEFAULTS: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'mock-v1': { inputPerMTok: 0, outputPerMTok: 0 },
};

let table = DEFAULTS;
if (env.AI_PRICE_TABLE) {
  try {
    table = { ...DEFAULTS, ...JSON.parse(env.AI_PRICE_TABLE) };
  } catch {
    logger.warn('AI_PRICE_TABLE is not valid JSON; cost estimates will show as unknown');
  }
}

/** Returns null when no price is configured for the model, so the UI can say "unknown" instead of $0. */
export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const key = Object.keys(table).find((k) => model === k || model.startsWith(`${k}-`));
  if (!key) return null;
  const p = table[key];
  return (inputTokens * p.inputPerMTok + outputTokens * p.outputPerMTok) / 1_000_000;
}
