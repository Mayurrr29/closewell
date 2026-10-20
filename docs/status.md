# Completion report: milestone 1 (core platform)

Date: 20 October 2026. Scope agreed: start fresh (no existing repository), core platform first, MongoDB as the only infrastructure dependency.

## 1. Features implemented

- **Foundation**: npm-workspaces monorepo (API, web, widget, shared). Express 5 + Mongoose 8 API with Zod validation, a consistent response envelope, structured logs with redaction, request ids, Helmet/CSP, CORS, rate limits, and a MongoDB-backed durable job queue with leases, retries and idempotency keys.
- **Auth**: registration, login with lockout, 15-minute access tokens, rotating refresh tokens with reuse detection, logout, session list/revoke, email verification, password reset (signs out everywhere), team invitations, role assignment.
- **Tenancy and RBAC**: membership checked server-side on every org route (404 to non-members), a database guard that rejects unscoped tenant queries, 5 org roles plus a platform-admin flag with no implicit tenant access.
- **Onboarding**: 8-step wizard (profile, products and FAQs, identity, qualification, rules and approvals, channel, simulated conversation, publish with readiness checks). Everything stays editable afterwards; drafts are separate from the published agent.
- **Products**: CRUD with pricing models (fixed, starting at, quote only), availability, FAQs, CSV catalogue import.
- **Knowledge base**: text, FAQs, PDF/TXT/MD/CSV uploads (validated by content, size-limited, text-only storage), own-domain web pages (SSRF-guarded), chunking, keyword (BM25) retrieval, processing status, re-index on change, deletion, retrieval test UI. Products sync into it automatically.
- **AI agent**: modular prompt with explicit trust levels; 7 sales strategies; tool calling with strict schemas; action categories A/B/C with server-side clamping; bounded automatic discount rule; approval requests; output guard (prices, discounts, commitments, restricted topics, instruction leaks) with one corrected retry; prompt-injection flagging for messages and documents; deterministic escalation; per-conversation locking; takeover checks before and after generation; timeouts and provider-failure fallback; per-turn run logs; usage and estimated cost; async summaries and suggested next action.
- **Approvals**: queue, approve/reject with notes, expiry sweep, idempotent execution through jobs, retry of failed actions, audit trail. Executors: approved discount message, custom-terms acknowledgement, stage change, quotation email built from catalogue prices (requires consent).
- **CRM**: leads with all requested fields, configurable pipeline, list and drag-and-drop board, documented rule-based score with breakdown, notes, reminders, assignment, consent record, activity history, CSV export (formula-safe), deletion with conversation scrubbing or purge.
- **Inbox**: filters and search, timeline of messages, internal notes and events, take over, pause, resume, escalate, tags, assignment, closing, summary and next action, lead panel, approvals panel.
- **Website widget**: one script tag, Shadow DOM, branding, greeting, colour, position, business hours, allowed domains, preview, enable/disable, key rotation, SSE replies, conversation continuity, retry on failure, contact form with consent, "Talk to a person".
- **Dashboard**: leads, qualified leads, won deals, recorded revenue, open conversations, conversion rate, AI replies, estimated AI cost, pending approvals, daily chart with table view, channel and source breakdowns, date ranges, a definition for every metric, empty states, test data excluded.
- **Billing architecture**: plans and prices in one file, entitlements enforced server-side (seats, agents, products, knowledge sources and bytes, monthly AI replies, overage on paid plans, trial expiry), usage metering, billing page. No payment provider.
- **Marketing site**: hero with an annotated example conversation, how it works, the three action categories, industries, integrations with honest status, security, pricing from the shared plan file, FAQ, calls to action. No testimonials, customer counts or invented statistics.
- **Also**: audit log page, integrations status page, settings (profile, retention policy, devices), dev mailbox, light and dark themes, responsive layouts, seed script, documentation.

## 2–3. Tests executed and results

All run in this environment on 20 Oct 2026 against FerretDB 1.24 (MongoDB-compatible, SQLite backend), Node 22, Chromium (Playwright 1.56):

| Suite | Result |
|---|---|
| `packages/shared` (Vitest) | **9 passed** |
| `apps/api` (Vitest + Supertest, real HTTP + database) | **108 passed** across 9 files |
| `apps/web` (Vitest + Testing Library) | **6 passed** |
| End-to-end (Playwright, Chromium) | **2 passed**, then 4 consecutive clean runs of the full suite |
| Type checks (all 4 packages) | **pass** |
| Production build (widget, web, API) and production start | **pass**: app, API, widget served from one origin; CSP sent; dev mailbox returns 404 in production |

The adversarial cases from the spec are covered: cross-tenant reads, system-prompt extraction, malicious document instructions, unauthorized discounts (by tool and in plain text), duplicate message delivery, provider timeout, usage-limit overrun, consent withdrawn before a queued action, and human takeover (including mid-generation). See [testing](testing.md).

Bugs found by these tests and fixed in the code: a findAndModify projection incompatibility, null matching in a rep's lead filter, empty POST bodies failing validation, "guarantee"/"refund issued" phrasing slipping past the guard, coming-soon tools reported as unknown, Indian digit grouping (₹2,50,000) misread by the price guard, legacy browser timezone names hiding Asia/Kolkata, a one-time verification token submitted twice by a double-mounted component, verification sharing a rate limit with email sending, the API not reading `apps/api/.env`, and several UI issues found in screenshots.

**Not tested against real MongoDB** (only FerretDB was available) and **not tested live**: OpenAI, SMTP.

## 4. Features in mock mode

- **AI replies** when `AI_PROVIDER=mock` (the default): a rule-based simulator, labelled "Mock AI" wherever it appears.
- **Email** when `EMAIL_MODE=mock` (the default): captured in the dev mailbox, not delivered.
- **Plan changes**: development-only switch; no payment is taken.

## 5. Features requiring credentials

- OpenAI: `OPENAI_API_KEY` (adapter implemented, untested live).
- SMTP email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`.
- Production secrets: `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`.

## 6. Environment variables

See `.env.example` (every variable, with comments) and [setup](setup.md#3-environment).

## 7. Commands

```bash
npm install
cp .env.example apps/api/.env
npm run seed          # optional sample data
npm run dev           # http://localhost:5173
npm test              # unit + API tests (needs MongoDB)
npm run test:e2e      # browser journey (needs npm run dev)
npm run build && NODE_ENV=production npm start
```

## 8. Known limitations

- Not built yet: WhatsApp, voice calls, appointments and Google Calendar, automated follow-ups, payments. Their tools are disabled and the UI says "not available yet".
- Retrieval is keyword-based (no embeddings). Synonyms and paraphrases match less well than vector search would.
- The output guard is heuristic: it can block a legitimate reply (for example a total the model calculated from catalogue prices) and cannot catch every possible unapproved promise.
- Replies are released after the guard runs, so the widget streams events, not individual tokens.
- Retention period is recorded but not yet enforced automatically.
- Rate limits are per process. No 2FA or SSO. One agent per organization in the UI (the data model supports several).
- Reps can read all conversations in the inbox; lead details are still restricted to their own leads.

## 9. Recommended next steps

1. Configure an OpenAI key and run the agent's Test tab; adjust prompts with real transcripts.
2. Run the test suite against real MongoDB 7 (or Atlas) in CI.
3. Milestone 2: appointments with conflict-safe booking and Google Calendar, automated follow-ups (quiet hours, consent, cancellation) on the existing job queue.
4. Milestone 3: WhatsApp Cloud API adapter with sandbox mode, then voice.
5. Payments (Stripe) on the existing entitlement layer; automatic retention purge; vector search on Atlas.
