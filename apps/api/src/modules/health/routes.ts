import { Router } from 'express';
import mongoose from 'mongoose';
import { providerStatus } from '../../ai/providers';
import { env } from '../../config/env';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  let db = 'disconnected';
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db!.admin().command({ ping: 1 });
      db = 'ok';
    }
  } catch {
    db = 'error';
  }
  const ai = providerStatus();
  res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ok' : 'degraded', db, ai: { provider: ai.id, mode: ai.mode }, email: env.EMAIL_MODE, jobs: env.JOBS_ENABLED ? 'enabled' : 'disabled' });
});
