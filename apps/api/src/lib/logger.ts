import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logger. Secrets and tokens are redacted at the logger
 * level so that an accidental `log.info({ body })` cannot leak them.
 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  '*.passwordHash',
  'token',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.apiKey',
  '*.secret',
  '*.credentials',
  'headers.authorization',
];

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'closewell-api' },
  ...(env.NODE_ENV === 'development' && process.stdout.isTTY
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});

/** Mask an email for logs: jane.doe@example.com -> j***@example.com */
export function maskEmail(email: string | undefined | null): string {
  if (!email) return '';
  const [u, d] = email.split('@');
  return `${u?.[0] ?? ''}***@${d ?? ''}`;
}
