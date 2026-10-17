# services/api: public HTTP API

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
The single HTTP entry point for `apps/web`, `apps/admin` and API customers. It handles authentication, authorization,
tenancy and rate limits, and passes meeting work to the meeting engine.

## Current state
The v0 routes live in `src/app.ts` and have no login. They rely on being reachable only from localhost, which won't
work for a shared deployment.

## In scope
- Resources: sessions, meetings, handoffs, orgs, members, API keys
- Authentication and authorization middleware, with every query scoped to an org
- Rate limiting, request validation, API versioning, and an OpenAPI description
- Outbound webhooks to customers (for example "handoff ready"), if we want them

## Out of scope
- Receiving Recall webhooks and running meetings. That stays in `services/meeting-engine`.

## Depends on / provides
- Depends on: `services/auth`, `db`, `packages/shared`
- Provides: the API contract the apps build against. Publish it before the apps start building on it.

## Open decisions
- Framework, and API style (REST with OpenAPI, or another)
- Whether the meeting engine is a separate service or a module inside the API process

## First tasks
- [ ] A draft API contract for sessions and handoffs
- [ ] An ADR on where the API ends and the meeting engine begins
