import { Router } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { ok } from '../../lib/http';
import { EmailOutbox } from '../../models/identity';

/**
 * Development helpers. Never mounted when NODE_ENV=production, and only
 * answered for requests from this machine.
 */
export const devRouter = Router();

devRouter.use((req, _res, next) => {
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  if (env.isProd || !['127.0.0.1', '::1'].includes(ip)) return next(new AppError('not_found', 'Not found'));
  next();
});

/** Emails captured in mock mode (verification links, invitations, quotations). */
devRouter.get('/mailbox', async (_req, res) => {
  const items = await EmailOutbox.find({ mode: 'mock' }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(ok(items.map((m) => ({ id: String(m._id), to: m.to, subject: m.subject, text: m.text, createdAt: m.createdAt }))));
});
