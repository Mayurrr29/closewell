import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { parseTrustProxy } from './lib/http';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/routes';
import { devRouter } from './modules/dev/routes';
import { invitationsRouter, orgsRouter } from './modules/orgs/routes';
import { tenantRouter } from './modules/tenant';
import { publicWidgetRouter, widgetScriptHandler } from './modules/widget/public';
import { healthRouter } from './modules/health/routes';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

  app.use((req, res, next) => {
    req.id = (req.get('x-request-id') ?? '').slice(0, 64) || randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // API responses are per-user and must never be stored by a CDN or proxy (e.g. a Vercel rewrite).
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---- Public widget surface: its own CORS policy, validated per widget against allowed domains ----
  app.get('/widget.js', widgetScriptHandler);
  app.use('/api/public/widget', express.json({ limit: '16kb' }), publicWidgetRouter);

  // ---- Application API: only the app origin may call it from a browser ----
  const api = Router();
  api.use(cors({ origin: [env.APP_ORIGIN], credentials: true }));
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use(apiLimiter);
  api.use('/health', healthRouter);
  api.use('/auth', authRouter);
  api.use('/invitations', invitationsRouter);
  api.use('/orgs', orgsRouter);
  api.use('/orgs/:orgId', tenantRouter);
  if (!env.isProd) api.use('/dev', devRouter);
  app.use('/api', api);

  // ---- Serve the built web app in production (single origin keeps cookies first-party) ----
  const webDist = path.resolve(here, '../../web/dist');
  if (env.isProd && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
