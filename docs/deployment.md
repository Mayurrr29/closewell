# Deployment

The app deploys as **one Node service** plus MongoDB. The API serves the built web app and `widget.js`, which keeps the refresh cookie first-party.

## Build and run

```bash
npm ci
npm run build                      # widget → web → api
NODE_ENV=production node apps/api/dist/server.js
```

## Production configuration

Required: `NODE_ENV=production`, `MONGODB_URI`, `JWT_ACCESS_SECRET` (32+ chars), `ENCRYPTION_KEY` (32 bytes base64), `APP_ORIGIN` and `API_PUBLIC_URL` (both your public https URL when served together), `TRUST_PROXY` (e.g. `1` behind one proxy). The API refuses to start without the secrets.

Strongly recommended: `EMAIL_MODE=smtp` with SMTP settings (otherwise verification emails are not delivered), `AI_PROVIDER=openai` with a key, `AI_PRICE_TABLE`.

Behind a reverse proxy (nginx, a load balancer): terminate TLS, forward `X-Forwarded-*`, and **disable response buffering for `/api/public/widget/*/messages`** so SSE streams (`X-Accel-Buffering: no` is already sent).

## Scaling notes

- The job worker runs inside the API process. Several instances are safe (jobs are claimed atomically with leases), or set `JOBS_ENABLED=false` on web instances and run one worker instance.
- Rate limits are per process; add a shared store for multiple instances.
- MongoDB: use a replica set or Atlas, enable backups.

## Example: container

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
```

Nothing has been deployed publicly as part of this work.
