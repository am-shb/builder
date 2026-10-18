# 0008: The boundary between the api and the engine

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** api and meeting engine (`contracts/`)

## Context
Blocking decision 5 in [workstreams.md](../workstreams.md). Today the engine is the whole product. Its `/` and
`/api/*` routes start sessions, with no notion of a user, org or plan. Once accounts and billing exist, something has
to decide who may start a meeting and how much they may spend, and the engine's usage has to reach billing. Nothing
caps spend today (deployment blocker 4).

## Options considered
1. **The engine as a module inside the api process.** No network hop. But the api can no longer scale apart from the
   single-instance engine, and an api deploy drops live meetings.
2. **Separate services. The api owns accounts and money. The engine owns meetings. They talk over internal HTTP.**
   Each scales and deploys on its own. Costs one contract to maintain.
3. **A queue between them.** Durable, but another moving part we don't need at this volume.

## Decision
Option 2.

**The api owns:** users, orgs, roles, plans, quotas, spend limits, billing and the list of meetings.
**The engine owns:** running a meeting. That covers the Recall bot, transcripts, both loops, the stage and the
hand-off.

**Starting a session.** `web` calls `POST /v1/sessions` on the api with the meeting URL. The api checks the user's
org role, the plan and remaining allowance. It then calls the engine on the private network:
`POST /internal/sessions` with `{ sessionId, orgId, meetingUrl, limits: { maxUsd, maxMinutes } }`. The engine returns
the session's status and stage URL.

**Engine to api events.** `POST /internal/engine-events` on the api, one event per call:
- `session.status`: joining, in meeting, ended, failed (with an error code)
- `session.usage`: cumulative bot minutes, model USD and TTS characters so far. Sent every minute and once more at
  the end
- `handoff.ready`: the hand-off's id and URL

Each event has an id. Usage values are cumulative, so a retried or duplicated event is harmless. The api stores the
latest value.

**Spend limits.** The engine enforces `limits` itself and ends the session with a clear message when either is reached.
The api decides the limits from the plan. This clears deployment blocker 4.

**Auth between them.** Both internal routes require a shared bearer token from Render's environment, even on the
private network. The engine refuses `/internal/*` requests that arrive through Render's public proxy, using the same
proxy-header check v0 uses for its control routes. The engine's v0 operator routes (`/`, `/api/*`) stay for local mode
and are off in production.

**What crosses.** Ids, statuses, counts, costs and error codes. Never transcript text, prompts or model output, the
same rule as for logs.

**Contracts.** Every request and event shape is a zod schema in `contracts/` (ADR 0004). Both sides parse with it,
and each side's tests use it to build fakes. Changes are additive, because the engine and the api deploy separately.

## Consequences
- Settles the engine README's open question: usage reaches billing through the api, not a worker.
- The api and web can deploy at any time without dropping meetings.
- The engine needs a small change: accept `orgId` and `limits`, stop at the limits, and send events. The local mode
  and replay tooling don't change.
- Follow-up: the `contracts/` schemas come first (engine and api owners together), then both sides build
  against fakes in parallel. Also: an org-deletion route on the engine (ADR 0007), and an access rule for hand-off
  links (signed links, or an org check through the api).
