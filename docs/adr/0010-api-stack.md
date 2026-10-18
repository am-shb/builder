# 0010: The api's stack: plain node:http, Clerk tokens checked offline, no auto-retry to the engine

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** ma-shamshiri (api)
- **Area:** api (`apps/api`)

## Context
The api's README leaves its framework and API style open until an ADR records them, and AGENTS.md asks for an
area's open decisions to be settled before its code. The first slice ([plan](../plans/api-first-slice.md)) adds
Clerk auth (ADR 0006), `POST` and `GET /v1/sessions`, and a client for the engine's `/internal/sessions` (ADR 0008).
The hackathon submission is due 2026-10-25, so each choice here is the simplest one that holds up after it.

## Options considered
1. **Plain `node:http` with a small router of our own.** No dependency. It's what the skeleton and the engine
   already use, and it runs under Node's type stripping with no build step. We write about fifty lines of routing and
   body parsing.
2. **Hono or Fastify.** Routing, body limits and validation hooks come built in. One more dependency and its
   conventions to learn, for an api with a handful of routes.

## Decision
Option 1, with these rules:

- **HTTP.** `createServer(deps)` takes `{ config, log, ... }` and later the db, auth and engine client, so tests pass
  fakes, as the engine's `createApp` does. Routes live in `src/routes/`. Bodies are capped (1 MB) and parsed with
  zod. Every error answers `{ error: { code, message } }`, where `code` is a stable snake_case string the web app can
  branch on and `message` is for people. Unknown paths answer 404 `not_found`. A known path with the wrong method
  answers 405 `method_not_allowed`.
- **Config.** `src/config.ts` reads the environment once at start and throws on a bad value, naming the variable but
  never its value. Optional parts (the engine client, Clerk) are off when their variables are unset, and the routes
  that need them answer 503 instead of the process refusing to start. `apps/api/.env.example` lists the names.
- **Auth.** `@clerk/backend`'s `verifyToken` with `jwtKey` (Clerk's PEM public key), so checking a token makes no
  network call, and with `authorizedParties` set to the web app's origins. The org and role come from the v2 token's
  `o` claim. A token with no active org gets 403 `no_active_org`. The org id always comes from the verified token,
  never from a body or query. Tests sign their own tokens with a key pair made at test time.
- **Data.** Postgres and Drizzle in the `api` schema, as ADR 0007 decides, with PGlite in tests. Whether the api
  uses `node:sqlite` until the hackathon submission is open with the repo owner. Either way, every db function takes
  `orgId` as its first argument, and only `src/db/` knows which database is underneath.
- **Ids.** Session ids are UUIDs from `randomUUID()`, because the engine's stage and hand-off routes only match UUIDs.
  Org and user ids are Clerk's.
- **Calling the engine.** One client in `src/engine/`, with the shared bearer token and a timeout. Requests and
  replies are parsed with the `@builder/contracts` schemas. **No automatic retries**, because a retry can send a
  second paid bot. A timeout or an unreadable reply is recorded as `start_unknown`, not as a failure.
- **Statuses.** The api's session status is the contract's `SessionStatus` plus three of its own: `starting`,
  `start_failed` and `start_unknown`.
- **Api-to-web shapes** are zod schemas in `apps/api/src/routes/` until `apps/web` imports them. Then they move to
  `contracts/` (ADR 0004).
- **Logs** are one JSON line each with ids, counts, statuses and error codes. Never tokens, meeting URLs, stage URLs
  or request bodies.

## Consequences
- No dependency for HTTP. `@clerk/backend` comes with auth, and the database packages with the db step.
- We own routing and body parsing, so they need their own tests. If the api grows past a few dozen routes, a later
  ADR can move to Hono, which takes the same Web-style handlers.
- The api can't confirm whether a bot started when the engine doesn't answer. The person sees "check before
  retrying". Once the engine accepts a repeated `sessionId` safely (E2 in the plan), one retry with the same id
  becomes safe.
