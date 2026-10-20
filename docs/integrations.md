# Integrations and modes

Every integration reports its real status on the **Integrations** page (`GET /api/orgs/:orgId/integrations`). Modes:

- **mock**: simulated locally. Never sends a real message, email, call or payment, and is labelled "Mock" in the UI.
- **sandbox**: a provider's test environment (none implemented yet).
- **live**: configured with real credentials.

## AI provider

| Mode | How |
|---|---|
| mock (default) | `AI_PROVIDER=mock`. A deterministic rule-based simulator (`apps/api/src/ai/providers/mock.ts`). It calls the real tools and only repeats what tools return, so it exercises approvals, guards and the inbox. It is **not a language model**: replies are formulaic. |
| live | `AI_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_MODEL` (default `gpt-4.1-mini`) and `OPENAI_BASE_URL`. |

The OpenAI adapter uses Chat Completions with function calling (`tools`, `tool_choice: auto`, `parallel_tool_calls: false`), retries once on 429/5xx, and aborts after `AI_TIMEOUT_MS`. **It was written against the public API documentation but has not been exercised against the live API**, because the build environment had no key and no network access to OpenAI. Run a test conversation in the agent's Test tab after configuring it.

Adding a provider: implement `AiProvider` (`providers/types.ts`) and select it in `providers/index.ts`. Tool schemas are generated from Zod as JSON Schema, which most providers accept.

Cost tracking: token counts are stored per turn; cost is estimated from `AI_PRICE_TABLE` (USD per million tokens). Without a price for the model, cost is shown as "Unknown" rather than $0.

## Email

| Mode | How |
|---|---|
| mock (default) | Emails are stored in `emailoutboxes` and readable at `/dev/mailbox` on non-production servers. Nothing is delivered. |
| live | `EMAIL_MODE=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. Any SMTP provider works (SES, Postmark, SendGrid, Mailgun). In SMTP mode bodies are not stored, because they contain one-time links. |

Used for verification, password reset, invitations and approved quotations. In production, mock mode logs a warning at startup.

## Website chat widget

Built in and live. See [setup](setup.md#5-try-the-widget-on-another-site). Security notes are in [security](security.md#widget).

## Not built yet (next milestones)

These appear in the UI as "Not available yet" and are never reported as working:

- **WhatsApp Business Platform** (official Cloud API): webhook verification (`hub.verify_token`, `X-Hub-Signature-256`), messages and status webhooks, 24-hour service window and template messages, opt-out handling, a clearly labelled sandbox mode. The conversation model already has a `whatsapp` channel, and inbound dedupe will reuse `processedevents`.
- **Voice agent**: telephony adapter (e.g. Twilio or Vonage), speech-to-text and text-to-speech adapters kept separate from the AI provider, a call simulator, recording disclosure and do-not-call checks.
- **Appointments / Google Calendar**: availability, conflict detection with idempotent booking, reminders. `book_appointment` is in the tool catalogue but disabled.
- **Automated follow-ups**: rules, quiet hours, consent checks, cancellation on opt-out or conversion, on top of the existing durable job queue. `schedule_follow_up` is disabled.
- **Payments** (e.g. Stripe): checkout, verified webhooks, invoices. Plans, limits and metering already exist; see [billing](billing.md).
