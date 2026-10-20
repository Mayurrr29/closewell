# Closewell

A multi-tenant AI sales agent platform. Businesses describe what they sell and how they sell it; an AI agent then handles website chat conversations, qualifies leads and moves deals forward **within limits the business sets**. Anything sensitive (discounts above a limit, refunds, custom terms) waits in an approval queue for a person.

> "Closewell" is a working name, set in `packages/shared/src/index.ts`.

## Status: milestone 1 (core platform)

| Area | Status |
|---|---|
| Accounts: register, login, rotating refresh tokens, email verification, password reset, sessions | **Working** |
| Organizations, team invitations, 5 roles with least-privilege permissions, tenant isolation | **Working** |
| 8-step onboarding wizard (profile → products → identity → qualification → rules → channel → test → publish) | **Working** |
| Products and services, CSV catalogue import | **Working** |
| Knowledge base: text, FAQs, PDF/TXT/MD/CSV upload, website pages (own domain only), keyword retrieval | **Working** (keyword search, no vectors yet) |
| AI agent: modular prompt, tool calling, approval categories A/B/C, output guards, prompt-injection defences | **Working** |
| Approval queue: approve, reject, expiry, retries, idempotent execution, audit trail | **Working** |
| Leads/CRM: pipeline, board, rule-based score, notes, reminders, assignment, CSV export, deletion | **Working** |
| Conversation inbox: takeover, pause/resume, notes, tags, assignment, closing | **Working** |
| Embeddable website chat widget (SSE replies, continuity, contact form, handover) | **Working** |
| Dashboard with metric definitions; plans, limits and usage metering | **Working** |
| OpenAI provider | **Implemented, not tested live** (no key/network in the build environment) |
| Email via SMTP | **Implemented, not tested live**; mock mode captures emails |
| WhatsApp, voice calls, appointments/calendar, automated follow-ups | **Not built yet** (next milestones). Shown as "not available yet" in the UI |
| Payments | **Not connected.** Plans and limits are enforced; nothing is charged |

See [docs/status.md](docs/status.md) for the full completion report.

## Quick start

Requirements: Node.js 20+ (22 recommended) and MongoDB 6+ (local, Docker or Atlas).

```bash
npm install
cp .env.example apps/api/.env      # defaults work for local development
# start MongoDB, e.g.: docker run -d -p 27017:27017 mongo:7
npm run seed                        # optional: sample organization, prints a login
npm run dev                         # API on :4000, web app on :5173
```

Open http://localhost:5173. Without an OpenAI key the agent runs on the **mock AI**, a rule-based simulator that is clearly labelled in the UI. Emails are captured at http://localhost:5173/dev/mailbox.

To use OpenAI, set `AI_PROVIDER=openai` and `OPENAI_API_KEY` in `apps/api/.env`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Builds the widget, then runs API and web app with reload |
| `npm run build` | Production build of widget, web app and API |
| `npm start` | Runs the built API, which also serves the web app and `widget.js` (set `NODE_ENV=production`) |
| `npm test` | All unit and API tests (API tests need MongoDB on `TEST_MONGODB_URI`, default `mongodb://127.0.0.1:27017`) |
| `npm run test:e2e` | Browser journey with Playwright (needs `npm run dev` running) |
| `npm run typecheck` | Type-checks every package |
| `npm run seed` | Creates the sample organization (refuses in production) |

## Repository layout

```
apps/api      Express + Mongoose API, AI engine, job worker
apps/web      React + Vite app: marketing site and dashboard
apps/widget   Embeddable chat widget (vanilla TS, Shadow DOM)
packages/shared  Roles, plans and prices, catalogues, validation schemas, lead scoring
docs/         Architecture, setup, API, integrations, security, testing, deployment
```

## Documentation

- [Architecture](docs/architecture.md)
- [Setup: environment and database](docs/setup.md)
- [API reference](docs/api.md)
- [Integrations and modes](docs/integrations.md)
- [Security and privacy](docs/security.md)
- [Lead scoring rules](docs/lead-scoring.md) · [Billing and limits](docs/billing.md)
- [Deploy for free (Vercel + Render + Atlas)](docs/deploy-render-vercel.md)
- [Testing](docs/testing.md) · [Deployment](docs/deployment.md) · [Troubleshooting](docs/troubleshooting.md)
- [Completion report](docs/status.md)
