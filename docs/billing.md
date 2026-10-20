# Billing, plans and limits

**Payment processing is not connected.** No charges are made and no invoices exist. The product never claims otherwise.

## What exists

- **Plans** (Free trial, Starter, Professional, Business, Enterprise) with monthly/annual prices, usage-based AI overage and limits are defined once in `packages/shared/src/plans.ts`. The pricing page, the billing page and server enforcement all read that file. Change prices and limits there only.
- **Entitlements** (`apps/api/src/services/entitlements.ts`), enforced on the server:
  - countable limits checked before creating: seats (members + pending invitations), agents, products, knowledge sources, stored knowledge bytes → HTTP 402 `limit_exceeded`
  - metered limits checked before spending: AI replies per calendar month (UTC). On plans with overage pricing, replies continue and the excess is billable; on others the agent hands the conversation to the team instead of replying.
  - an expired trial stops AI replies.
- **Usage metering**: monthly counters per organization for AI replies, tokens, estimated AI cost, channel messages and voice minutes (the last two are reserved for future channels).
- **Development plan switch**: `POST /billing/plan` works only when `NODE_ENV` is not production, so limits can be tested.

## To connect payments (e.g. Stripe)

1. Create products/prices that mirror `plans.ts` (or generate them from it).
2. Add a checkout endpoint and a customer portal link for upgrades, downgrades and cancellation.
3. Add a webhook endpoint that verifies the signature (`Stripe-Signature`), records events in `processedevents` for idempotency, and updates `organization.subscription` (`planId`, `status`, `interval`, `currentPeriodEnd`, `provider: 'stripe'`).
4. Report AI overage from `usagecounters` as metered usage at period end.
5. Only then show payments as live, and remove the development plan switch.
