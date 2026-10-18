# 0009: Usage-based pricing per meeting hour

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** billing and metering (`apps/api/src/billing`)

## Context
Blocking decision 6 in [workstreams.md](../workstreams.md). Our costs rise with time in meetings: Recall bills
per bot-hour, and the model and TTS costs grow with how long people talk. The engine already records the cost of
every model call (`src/agent/cost.ts`, stored as `model_calls`). A flat per-seat price would lose money on teams
with many long meetings.

## Options considered
1. **Per seat per month.** Familiar and predictable for buyers. Costs don't follow seats, so heavy teams lose us money.
2. **Per meeting hour, with a monthly plan that includes hours plus metered overage.** Revenue follows cost. A buyer
   can still predict the bill from the plan.
3. **Pure pay-as-you-go credits.** Simple, but no recurring revenue, and it makes every meeting feel like a purchase.

## Decision
Option 2.
- **The unit is the bot-minute:** from the bot joining the meeting to it leaving, rounded up to the minute, taken
  from the engine's final `session.usage` event (ADR 0008).
- **Free trial:** a small allowance of minutes for a new org, with no card. Hard-capped, with no overage.
- **Paid plan:** a monthly subscription per org that includes a set number of hours, then metered overage per
  minute. An org admin can set a monthly spend ceiling, and the api turns it into each session's `limits`.
- **Stripe Billing.** The Stripe customer is the org. Usage goes to a Stripe meter when a session ends. Stripe
  Checkout handles payment, and the customer portal handles plan changes.
- **Build in Stripe test mode** until the company can take live payments.
- **Prices aren't set here.** Set them once we know cost per meeting-hour: measure model and TTS cost from
  `model_calls` over real sessions, add Recall's per-hour rate, and target a gross margin. Record the numbers in a
  later ADR.

## Consequences
- Billing can be built now against Stripe test mode, before prices are final.
- Long meetings cost the customer more, which is honest but needs clear display. Show minutes used and the
  allowance left in the web app.
- Follow-up (api owner): `apps/api/src/billing`, a cost-per-meeting-hour report from `model_calls`, and the
  pricing-numbers ADR.
