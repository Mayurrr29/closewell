import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * In-process rate limits. They protect a single API instance; when you run
 * several instances, plug a shared store (e.g. Redis) into these limiters.
 */
const base = (o: Partial<Options>) =>
  rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.isTest && process.env.RATE_LIMIT_IN_TESTS !== '1',
    handler: (req, res) =>
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.', requestId: req.id } }),
    ...o,
  });

export const loginLimiter = base({ windowMs: 15 * 60_000, limit: 20 });
export const registerLimiter = base({ windowMs: 60 * 60_000, limit: 20 });
export const emailLimiter = base({ windowMs: 60 * 60_000, limit: 10 });
export const apiLimiter = base({ windowMs: 60_000, limit: 600 });
export const widgetSessionLimiter = base({ windowMs: 60 * 60_000, limit: 60 });
export const widgetMessageLimiter = base({
  windowMs: 60_000,
  limit: () => env.WIDGET_RATE_LIMIT_PER_MIN,
  skip: () => env.isTest && process.env.RATE_LIMIT_IN_TESTS !== '1',
});
