# API reference

All responses use one envelope:

```json
{ "data": ... }                                   // success
{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }   // lists
{ "error": { "code", "message", "details?", "requestId" } }               // errors
```

Error codes: `bad_request` 400, `unauthenticated` 401, `limit_exceeded` 402, `forbidden` 403, `email_not_verified` 403, `not_found` 404, `conflict` 409, `payload_too_large` 413, `unsupported_media_type` 415, `validation_failed` 422 (with `details.fields`), `rate_limited` 429, `internal` 500, `provider_unavailable` 503.

Lists accept `page` (default 1) and `pageSize` (default 25, max 100).

## Authentication

Send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes. The refresh token is an httpOnly, `SameSite=Strict` cookie scoped to `/api/auth`; refresh and logout also require the header `X-Requested-With: closewell`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` → `{ user, accessToken }` + cookie; sends verification email |
| POST | `/api/auth/login` | `{ email, password }`; 10 failures lock the account for 15 minutes |
| POST | `/api/auth/refresh` | Rotates the refresh token. Reuse of an old token revokes the whole session family; a near-simultaneous double refresh returns 409 (retry) |
| POST | `/api/auth/logout` | Revokes the session family |
| GET | `/api/auth/me` | User and memberships |
| POST | `/api/auth/verify-email` | `{ token }` (single use, 48 h) |
| POST | `/api/auth/resend-verification` | |
| POST | `/api/auth/forgot-password` | `{ email }`; same response whether or not the email exists |
| POST | `/api/auth/reset-password` | `{ token, password }`; signs out every session |
| GET/DELETE | `/api/auth/sessions[/:id]` | List and revoke devices |
| GET | `/api/invitations/:token` | Preview an invitation |
| POST | `/api/invitations/accept` | `{ token }`; must be signed in as the invited email |

## Organizations

| Method | Path | Permission |
|---|---|---|
| POST | `/api/orgs` | signed in; caller becomes owner. Provisions pipeline, draft agent and widget |
| GET | `/api/orgs` | platform admin only; metadata only |
| GET/PATCH | `/api/orgs/:orgId` | `org:read` / `org:update` |
| PATCH | `/api/orgs/:orgId/retention` | `org:update` |
| POST | `/api/orgs/:orgId/onboarding/steps/:n` | `org:update` |
| GET | `/members`, PATCH/DELETE `/members/:userId` | `members:read` / `members:manage` |
| GET/POST | `/invitations`, DELETE `/invitations/:id` | `members:manage` (+ verified email to invite; seat limit enforced) |

All paths below are relative to `/api/orgs/:orgId`.

## Products and knowledge

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/products` | `products:read` / `products:write` (filters: `q`, `kind`, `active`) |
| GET/PATCH/DELETE | `/products/:id` | |
| POST | `/products/import` | multipart `file` (CSV, ≤ 2 MB, ≤ 1000 rows) → `{ created, errors[{row,message}] }` |
| GET | `/knowledge` | `knowledge:read` (filters `type`, `status`, `q`) |
| GET | `/knowledge/search?q=` | retrieval exactly as the agent sees it |
| GET | `/knowledge/:id` | includes content |
| POST | `/knowledge/text` | `{ title, type: 'text'|'faq', content | faqs }` |
| POST | `/knowledge/upload` | multipart `file`: PDF/TXT/MD/CSV, ≤ `KNOWLEDGE_MAX_FILE_MB`; content-validated |
| POST | `/knowledge/url` | `{ url, title? }`; own website domain only |
| PUT | `/knowledge/:id` | text/FAQ sources; re-indexes only if content changed |
| POST | `/knowledge/:id/reindex` | |
| DELETE | `/knowledge/:id` | product-generated sources are managed through the product |

## Agent

| Method | Path | Permission |
|---|---|---|
| GET | `/agents`, `/agents/:id` | `agents:read`; detail includes readiness checklist and provider status |
| GET | `/agents/tools` | tool catalogue |
| PUT | `/agents/:id/config` | `agents:write`; rejects tool modes the catalogue forbids |
| POST | `/agents/:id/publish` | `agents:publish` + verified email + all readiness checks |
| POST | `/agents/:id/unpublish` | |
| GET | `/agents/:id/runs` | per-turn logs (tools, flags, tokens, cost) |
| POST | `/agents/:id/playground` | new test conversation (draft config, excluded from reports) |
| GET/POST | `/agents/:id/playground/:cid[/messages]` | |

## Conversations

| Method | Path | Permission |
|---|---|---|
| GET | `/conversations` | `conversations:read`; filters `status`, `channel`, `aiMode`, `assignedTo` (`me`/`none`/id), `escalated`, `tag`, `q`, `includeTest` |
| GET | `/conversations/:id` | timeline, lead (if you may see it), approvals |
| POST | `/conversations/:id/messages` | `conversations:reply`; replying takes over from the AI |
| POST | `/conversations/:id/notes` | internal note |
| POST | `/conversations/:id/takeover`, `/pause`, `/resume` (`{ replyNow }`), `/escalate` | |
| PATCH | `/conversations/:id` | `{ assignedTo, tags, status }` |

## Leads and pipeline

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/leads` | `leads:read:*` / `leads:write:*`; reps see own + unassigned, edit own only |
| GET | `/leads/export.csv` | `leads:export`; formula-injection safe |
| GET | `/leads/reminders/mine` | |
| GET/PATCH/DELETE | `/leads/:id` | delete supports `?purgeConversations=true` |
| POST | `/leads/:id/stage`, `/notes`, `/reminders`, `/reminders/:rid/done` | |
| GET/PUT | `/pipeline` | `pipeline:manage` to change; stages holding leads cannot be removed |

## Approvals

| Method | Path | Permission |
|---|---|---|
| GET | `/approvals?status=` | `approvals:read` |
| GET | `/approvals/:id` | |
| POST | `/approvals/:id/approve`, `/reject` (`{ note? }`), `/retry` | `approvals:decide` |

## Widget, analytics, billing, audit, integrations

| Method | Path | Permission |
|---|---|---|
| GET/PUT | `/widget`, POST `/widget/rotate-key` | `widget:read` / `widget:manage` |
| GET | `/analytics/overview?from&to&channel` | `analytics:read`; includes metric definitions |
| GET | `/billing`, POST `/billing/plan` | plan switch is development-only |
| GET | `/audit` | `audit:read` |
| GET | `/integrations` | real status of every integration |

## Public widget API

Base `/api/public/widget/:publicKey`. Browser requests must come from an allowed origin (or the app origin, which is treated as preview).

| Method | Path | Notes |
|---|---|---|
| GET | `/config` | branding only, no internal configuration |
| POST | `/sessions` | `{ resumeToken? }` → `{ token, messages }` (30-day session, stored hashed) |
| GET | `/messages?after=` | `Authorization: Bearer <session token>` |
| POST | `/messages` | `{ content, clientMessageId? }`; idempotent on `clientMessageId`; `Accept: text/event-stream` for SSE (`ack`, `typing`, `message`, `status`, `done`) |
| POST | `/contact` | `{ name?, email?, phone?, consentToContact, consentToMarketing }` |
| POST | `/handover` | ask for a person |

Limits: 20 messages/min per IP (`WIDGET_RATE_LIMIT_PER_MIN`), 12/min and 300 total per session, 2,000 characters per message.
