# Architecture

## Overview

```
 Browser (dashboard)            Customer's website
   React app  ──── /api ───┐      widget.js (Shadow DOM)
                            │         │  /api/public/widget/:key/*
                            ▼         ▼
                ┌──────────────────────────────┐
                │ Express API                   │
                │  auth · tenant · RBAC         │
                │  modules (REST)               │
                │  AI engine ── provider layer ─┼──► OpenAI (or mock)
                │  job worker (Mongo-backed)    │
                └──────────────┬───────────────┘
                               ▼
                           MongoDB
```

One Node process serves the API, the job worker, `widget.js` and (in production) the built web app, so the refresh cookie stays first-party.

## Packages

- **packages/shared**: single source of truth for roles and permissions, plans/prices/limits, industries, sales strategies, the tool catalogue (actions and their risk category), Zod input schemas (used by both API and forms) and the lead-scoring function.
- **apps/api**: `src/modules/<area>` holds routes per area; `src/ai` holds the agent; `src/services` holds cross-cutting services (audit, email, entitlements); `src/jobs` holds the queue.
- **apps/web**: React 19, React Router 7, TanStack Query, React Hook Form + Zod, Tailwind 4, Recharts, Framer Motion.
- **apps/widget**: dependency-free TypeScript bundled with esbuild into `dist/widget.js` (~12 KB).

## Multi-tenancy

- Every tenant-owned document has `orgId`. Routes live under `/api/orgs/:orgId/...`.
- `requireOrg` checks, on the server, that the signed-in user has a `Membership` in that org. Non-members get **404** (not 403) so org ids cannot be probed. Platform admins get no implicit tenant access.
- Handlers always use `req.ctx.orgId` from that check, never a client-supplied org id.
- **Database guard** (`src/db/tenant.ts`): a Mongoose plugin on every tenant model throws if a query, update, delete or aggregate lacks an `orgId` filter. System jobs that legitimately span tenants (expiring approvals) opt out explicitly with `crossTenant: true`.
- Cross-tenant tests: `apps/api/test/tenancy.test.ts`.

## The AI agent (`apps/api/src/ai`)

Not one big prompt. Each concern is a separate module:

| Concern | Where |
|---|---|
| System instructions, business facts, sales policy, conversation state | `prompt.ts` (separate sections, explicit trust levels: VERIFIED / CUSTOMER / REFERENCE) |
| Knowledge retrieval | `modules/knowledge/service.ts` `retrieve()` (BM25 keyword scoring, org-scoped) |
| Tool permissions and execution | `tools.ts` (strict Zod schemas, server-side mode resolution, approvals) |
| Safety checks | `safety.ts` (injection detection, output guard, escalation rules) |
| Escalation / handoff | `safety.ts` `shouldEscalate`, `tools.ts` `handOff` |
| Turn orchestration, takeover enforcement, timeouts, usage | `runner.ts` |
| Provider abstraction | `providers/` (`openai.ts`, `mock.ts`) |
| Evaluation and logging | `AgentRun` records: tool calls, flags, tokens, cost, latency |

### One turn

1. Take a per-conversation lease (`aiLockUntil`) so only one turn runs at a time.
2. Skip if the conversation is closed or `aiMode !== 'ai'` (paused or human takeover).
3. Check the plan's AI message limit. Over the limit → hand off, no model call.
4. Deterministic escalation (customer asks for a person, configured keyword, turn cap) → hand off, no model call.
5. Build the prompt from the **published** agent config (the draft for test conversations), catalogue, lead facts and qualification progress; flag injection attempts.
6. Loop: call the model with only the tools that are enabled → execute tool calls (re-authorised server-side) → repeat, up to `AI_MAX_TOOL_ROUNDS`.
7. **Output guard** on the draft reply. If it states an amount not in the catalogue, an unapproved discount, a commitment (refund, guarantee, contract), restricted topics or quotes the instructions, the draft is not sent. The model gets one corrected retry; if that also fails, a safe fallback is sent and the conversation is handed off.
8. **Re-check takeover** immediately before sending. If a human took over during generation, the reply is discarded.
9. Persist the message, increment usage, write the `AgentRun`, queue a summary job.

Provider errors and timeouts produce an honest "having trouble" message and a handoff.

### Action categories

Defined in `packages/shared/src/catalog.ts` (`TOOL_CATALOG`):

- **A (low risk)**: search knowledge, look up products, record lead details, record qualification answers, hand off. Automatic.
- **B (controlled)**: update pipeline stage (auto/approval/off), send quotation (approval/off, requires recorded consent and an email). Appointment booking and follow-ups are listed but **disabled** (not built).
- **C (sensitive)**: offer discount, propose custom terms. Never automatic, except the bounded rule "discounts up to N%" that the business must switch on explicitly.

The configured mode is **clamped** to the catalogue's allowed modes on every call, and the config API rejects disallowed modes.

## Durable jobs

`src/jobs/queue.ts`: jobs are MongoDB documents with a unique `idempotencyKey`, claimed atomically with a lease (`lockedUntil`). A crashed worker's job is reclaimed when the lease expires. Failures retry with exponential backoff up to `maxAttempts`, then go `dead`. Used for knowledge indexing, approved-action execution and summaries. Periodic sweeps (expiring approvals) are idempotent DB updates. In-memory timers are never the source of truth.

## Data model (main collections)

`users`, `sessions` (hashed refresh tokens, rotation families), `authtokens`, `organizations`, `memberships`, `invitations`, `products`, `knowledgesources`, `knowledgechunks`, `agents` (draft `config` + frozen `published`), `agentruns`, `pendingactions`, `conversations`, `messages` (messages, internal notes and events in one timeline), `leads`, `leadactivities`, `reminders`, `pipelines`, `widgetconfigs`, `widgetsessions`, `usagecounters`, `processedevents` (dedupe ledger), `jobs`, `auditlogs`, `emailoutboxes`.

## Why keyword search, not vectors (yet)

The spec asked to start simple and add vector search only when the infrastructure supports it. Retrieval uses stemmed terms indexed per chunk and BM25 scoring, which works on any MongoDB-compatible server. `retrieve()` is the single seam to replace with Atlas Vector Search (store an `embedding` per chunk, `$vectorSearch` filtered by `orgId`).
