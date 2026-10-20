# Setup: environment and database

## 1. Install

```bash
node -v        # 20.11+ (22 recommended)
npm install    # installs all workspaces
```

## 2. Database

Any of:

- **Docker**: `docker run -d --name closewell-mongo -p 27017:27017 mongo:7`
- **Local MongoDB** 6+: default URI `mongodb://127.0.0.1:27017/closewell`
- **MongoDB Atlas**: create a cluster, a database user and an IP allow-list entry, then set `MONGODB_URI=mongodb+srv://USER:PASS@CLUSTER/closewell`

Indexes (including the unique indexes behind idempotency) are created automatically on startup. No migrations are needed for this release.

The code avoids transactions, `$lookup`, text and vector indexes, so it also runs on MongoDB-compatible servers. The automated tests in this repository were run against **FerretDB 1.24 (SQLite backend)**; production should use MongoDB.

Sample data: `npm run seed` creates "Sunrise Solar (sample data)" and prints the login. It refuses to run when `NODE_ENV=production`.

## 3. Environment

```bash
cp .env.example apps/api/.env
```

The API loads `apps/api/.env` at startup (real environment variables take precedence). The existing file is never overwritten by any script.

| Variable | Needed | Notes |
|---|---|---|
| `MONGODB_URI` | always | |
| `APP_ORIGIN` | always | Origin of the web app; used for CORS and email links |
| `API_PUBLIC_URL` | always | Used in the widget snippet |
| `JWT_ACCESS_SECRET` | production | `openssl rand -hex 32`. In development a temporary one is generated (sessions reset on restart) |
| `ENCRYPTION_KEY` | production | `openssl rand -base64 32`; encrypts stored integration credentials |
| `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL` | for real AI | Without them the mock AI is used |
| `EMAIL_MODE=smtp`, `SMTP_*`, `EMAIL_FROM` | for real email | Without them emails are captured (dev mailbox) |
| `AI_PRICE_TABLE` | optional | Cost estimates; without it cost shows as "Unknown" for real models |

The API validates the environment at startup and refuses to start in production with missing secrets. The full list with comments is in `.env.example`.

## 4. Run

```bash
npm run dev
```

- Web app: http://localhost:5173 (Vite proxies `/api` and `/widget.js` to the API, so everything is same-origin)
- API: http://localhost:4000, health at `/api/health`
- Dev mailbox: http://localhost:5173/dev/mailbox (only on non-production servers and only from this machine)

## 5. Try the widget on another site

In **Website chat**, add `localhost:8080` to allowed domains and enable the chat. Then:

```bash
mkdir /tmp/site && cd /tmp/site
echo '<h1>Test shop</h1><script src="http://localhost:4000/widget.js" data-closewell-key="YOUR_KEY" async></script>' > index.html
npx serve -l 8080 .
```
