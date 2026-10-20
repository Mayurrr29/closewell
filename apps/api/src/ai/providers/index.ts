import { env } from '../../config/env';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';
import type { AiProvider } from './types';

let override: AiProvider | null = null;
let instance: AiProvider | null = null;

export function getProvider(): AiProvider {
  if (override) return override;
  instance ??= env.AI_PROVIDER === 'openai' ? new OpenAiProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_BASE_URL) : new MockProvider();
  return instance;
}

/** Test hook: inject a scripted provider. */
export function setProviderOverride(p: AiProvider | null) {
  override = p;
}

export function providerStatus() {
  const p = getProvider();
  return {
    id: p.id,
    label: p.label,
    mode: p.isMock ? ('mock' as const) : env.OPENAI_API_KEY ? ('live' as const) : ('not_configured' as const),
    model: env.AI_PROVIDER === 'openai' ? env.OPENAI_MODEL : 'mock-v1',
  };
}

export * from './types';
