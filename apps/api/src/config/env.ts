import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/closewell'),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  TRUST_PROXY: z.string().default('loopback'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  ENCRYPTION_KEY: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  AI_TIMEOUT_MS: z.coerce.number().int().default(30000),
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().default(4),
  /** JSON: {"model": {"inputPerMTok": 0.4, "outputPerMTok": 1.6}} in USD. Estimates only. */
  AI_PRICE_TABLE: z.string().optional(),
  EMAIL_MODE: z.enum(['mock', 'smtp']).default('mock'),
  EMAIL_FROM: z.string().default('Closewell <no-reply@localhost>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  JOBS_ENABLED: bool.default(true),
  JOBS_POLL_MS: z.coerce.number().int().default(2000),
  KNOWLEDGE_MAX_FILE_MB: z.coerce.number().default(5),
  URL_INGEST_ENABLED: bool.default(true),
  WIDGET_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(20),
  SEED_DEMO_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof schema> & {
  jwtAccessSecret: string;
  encryptionKey: Buffer;
  cookieSecure: boolean;
  isProd: boolean;
  isTest: boolean;
  warnings: string[];
};

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const warnings: string[] = [];

  let jwtAccessSecret = e.JWT_ACCESS_SECRET;
  if (!jwtAccessSecret) {
    if (isProd) throw new Error('JWT_ACCESS_SECRET is required in production (32+ random characters).');
    jwtAccessSecret = randomBytes(32).toString('hex');
    if (e.NODE_ENV !== 'test') warnings.push('JWT_ACCESS_SECRET not set: using a temporary secret; sign-ins reset when the API restarts.');
  }

  let encryptionKey: Buffer;
  if (e.ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(e.ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).');
  } else {
    if (isProd) throw new Error('ENCRYPTION_KEY is required in production (openssl rand -base64 32).');
    encryptionKey = randomBytes(32);
    if (e.NODE_ENV !== 'test') warnings.push('ENCRYPTION_KEY not set: stored integration credentials will be unreadable after a restart.');
  }

  if (e.AI_PROVIDER === 'openai' && !e.OPENAI_API_KEY) {
    if (isProd) throw new Error('AI_PROVIDER=openai requires OPENAI_API_KEY.');
    warnings.push('AI_PROVIDER=openai but OPENAI_API_KEY is missing: AI replies will fail and conversations will be handed to a human.');
  }
  if (e.EMAIL_MODE === 'smtp' && !e.SMTP_HOST) throw new Error('EMAIL_MODE=smtp requires SMTP_HOST.');
  if (isProd && e.EMAIL_MODE === 'mock') warnings.push('EMAIL_MODE=mock in production: verification and reset emails are not delivered.');

  return {
    ...e,
    jwtAccessSecret,
    encryptionKey,
    cookieSecure: e.COOKIE_SECURE ?? isProd,
    isProd,
    isTest: e.NODE_ENV === 'test',
    warnings,
  };
}

export const env: Env = load();
