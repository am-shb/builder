# apps/api: accounts, sessions, billing and jobs

**Status:** skeleton. It serves `GET /health` and nothing else. **Owner:** TBD. Claim it in
[docs/workstreams.md](../../docs/workstreams.md).

## Purpose
The one backend for `apps/web` and later for API customers. It owns users, orgs, roles, plans, quotas, spend limits,
billing and the list of meetings. It decides who may start a meeting, then asks the engine to run it. See
[ADR 0008](../../docs/adr/0008-api-engine-boundary.md).

## Planned folders
Created when they have code, under `src/`:

| Folder | What goes there |
|---|---|
| `routes/` | HTTP routes, such as `POST /v1/sessions` and `POST /internal/engine-events` |
| `auth/` | Checking the sign-in token and the org role ([ADR 0006](../../docs/adr/0006-identity-and-tenancy.md)) |
| `db/` | The SurrealDB schema and migrations, in database `api` ([ADR 0011](../../docs/adr/0011-surrealdb.md)) |
| `billing/` | Plans, usage metering, entitlements and payments ([ADR 0009](../../docs/adr/0009-pricing-model.md)) |
| `notifications/` | Email, such as "your handoff is ready" and failed payments |
| `jobs/` | Background work: calendar sync, retention, usage sync |

## In scope
- Resources: sessions, meetings, handoffs, orgs, members, API keys. Every query is scoped to an org.
- Plans, trials, checkout, invoices, usage metering and spend limits, including the cap per session (known issue I5)
- Calling the engine on `POST /internal/sessions` and storing the events it sends back
- Request validation, rate limits and API versioning
- Scoped capability tokens for the stage and the hand-off (known issue I7)

## Out of scope
- Running meetings: the Recall bot, transcripts, both loops, the stage and the hand-off. That stays in `apps/engine`.
- Pages customers see. Those belong in `apps/web`.

## Depends on / provides
- Depends on: `@builder/contracts`, SurrealDB, Clerk
- Provides: the API that `apps/web` builds against, and the receiving end of the engine's events

## Open decisions
- Framework and API style. The skeleton uses plain `node:http` until the owner records a choice in an ADR.
- Email provider, and who owns the templates
- Queue and scheduler technology for `jobs/`

## First tasks
- [ ] Parse and verify the Clerk token ([ADR 0006](../../docs/adr/0006-identity-and-tenancy.md))
- [ ] The first SurrealDB schema: orgs, users, sessions, usage
- [ ] `POST /v1/sessions` and `POST /internal/engine-events`, built against fakes with `@builder/contracts`
- [ ] A cost model per meeting hour (Recall, models, TTS)
