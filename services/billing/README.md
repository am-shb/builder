# services/billing: plans, metering and payments

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
Charging customers, and enforcing what each plan allows.

## Current state
v0 already records the cost of every model call: the `model_calls` table, `src/agent/cost.ts`, and `cost_usd` on the
session view. A live meeting measured about $0.32 in model cost. Recall bot minutes and TTS characters aren't metered
yet.

## In scope
- Plans, trials, checkout, invoices, payment methods, and failed-payment handling
- Usage metering per org and per session: bot minutes, model tokens and cost, TTS characters
- Entitlements and limits, including a hard cost cap per session and per org to stop runaway spend (see known
  issue I5)
- Usage and receipts shown to customers in `apps/web`

## Depends on / provides
- Depends on: `services/auth` (orgs), `db`, and usage events from the meeting engine
- Provides: an entitlement check before a bot is sent to a meeting

## Open decisions
- Pricing model: per seat, per meeting minute, per session, or a mix
- Payment provider
- Whether usage is billed in real time or reconciled from provider invoices

## First tasks
- [ ] A cost model per meeting hour, covering Recall, the models and TTS
- [ ] An ADR on pricing
