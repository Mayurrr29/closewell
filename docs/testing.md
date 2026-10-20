# Testing

## Suites

| Suite | Command | Needs |
|---|---|---|
| Shared (scoring) | `npm test -w @closewell/shared` | nothing |
| API: unit + HTTP (Vitest + Supertest) | `npm test -w @closewell/api` | MongoDB at `TEST_MONGODB_URI` (default `mongodb://127.0.0.1:27017`); each file uses its own throwaway database |
| Web: components and API client (Vitest + Testing Library) | `npm test -w @closewell/web` | nothing |
| End-to-end (Playwright) | `npm run test:e2e` | `npm run dev` running; Chromium (`npx playwright install chromium` once) |

`npm test` at the root runs the first three.

## What the API tests cover

- `auth.test.ts`: registration and validation, login errors that don't reveal accounts, refresh rotation, **stolen refresh-token reuse revoking the family**, benign double refresh, logout, email verification (single use), password reset signing out everywhere, session revocation.
- `tenancy.test.ts`: **organization B trying to read, change or delete organization A's leads, products, knowledge, conversations, agents, approvals, widget, audit, analytics and members**; org-id smuggling in bodies; retrieval isolation; the database guard throwing on unscoped queries.
- `rbac.test.ts`: analyst read-only; reps limited to own and unassigned leads, including filter-based escalation attempts; admins unable to grant owner or remove the last owner; invitations bound to the invited email; seat limits.
- `knowledge.test.ts`: indexing, FAQs, re-indexing on change, deletion, product sync, upload validation (fake PDF, executable, invalid UTF-8), own-domain URL rule, SSRF address blocking, chunking.
- `agent.test.ts`: answers from knowledge and catalogue, "I don't know" when nothing matches, lead capture; **out-of-policy discount → approval; bounded discount auto-approved; discount claimed in plain text blocked; fabricated price blocked; refund/guarantee commitment blocked; disabled and unknown tools refused; strict tool arguments; sensitive tools cannot be configured automatic; AI cannot mark a deal won; system-prompt extraction blocked; malicious document instructions ignored; reference material wrapped as untrusted; no replies during takeover; reply discarded when a human takes over mid-generation; provider timeout → fallback + handoff; keyword escalation without a model call; usage limit stops AI replies.**
- `approvals.test.ts`: approve executes exactly once, reject, expiry, idempotent duplicate requests, a failed action (consent withdrawn) recorded and retried successfully, analysts cannot decide.
- `widget.test.ts`: origin allow-list, no internal config exposed, continuity, **duplicate message delivery (same `clientMessageId`) handled once**, SSE format, takeover stops the AI and team replies reach the widget, session isolation, consent capture, handover, per-session rate limiting, disabled widget.
- `leads.test.ts`: score breakdown, stages and won-deal analytics, test data excluded from analytics, notes and reminders, search escaping, CSV formula injection, pipeline safety, deletion scrubbing, catalogue import limits.
- `src/ai/safety.test.ts`: amount extraction (including Indian digit grouping), guard verdicts, injection and escalation detectors.

Scripted AI providers (`ScriptedProvider` in `test/helpers.ts`) let tests make the "model" misbehave deliberately.

## End-to-end journey

`apps/web/e2e/journey.spec.ts`: the marketing page renders with honest integration labels; then a new user registers, completes all 8 onboarding steps, tests the agent (a price answer and a discount sent for approval), verifies their email through the dev mailbox, publishes, sees the approval in the queue, and chats through the real embedded widget. Set `E2E_SCREENSHOTS=/some/dir` to save screenshots.
