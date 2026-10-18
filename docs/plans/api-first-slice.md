# Plan: the api's first slice (Clerk auth, sessions, engine client, Postgres)

> **2026-10-18:** the database is now SurrealDB, not Postgres ([ADR 0011](../adr/0011-surrealdb.md)). Step 3 writes
> the schema in SurrealQL, in database `api`, with `@surrealdb/node` in memory for tests. That also settles "Postgres
> or SQLite for the hackathon": neither. The Drizzle, PGlite and `engine/postgres` notes below are out of date.

- **Status:** agreed by the api owner on 2026-10-17, except D5 (open, for the repo owner) and the engine and
  contracts items, which need their owners. No code yet.
- **Date:** 2026-10-17
- **Deadline:** hackathon submission due 2026-10-25, 11:59 PM ET. Where there's a choice, take the simplest option.
  See [Timeline](#timeline).
- **Area:** `apps/api`. Changes needed in `apps/engine` and `contracts/` are listed separately in
  [Changes outside apps/api](#changes-outside-appsapi) and need their owners' approval.
- **Built on:** ADRs [0004](../adr/0004-workspaces-and-repo-layout.md), [0005](../adr/0005-hosting-on-render.md),
  [0006](../adr/0006-identity-and-tenancy.md), [0007](../adr/0007-database.md),
  [0008](../adr/0008-api-engine-boundary.md), [0009](../adr/0009-pricing-model.md).

## Goal
A signed-in member of an org can start a meeting session and list their org's sessions:

```
web --(Clerk session token)--> POST /v1/sessions  { meetingUrl }
api: verify token -> org + role -> limits -> store row -> POST engine /internal/sessions -> store result
web --(Clerk session token)--> GET  /v1/sessions  -> this org's sessions only
```

Out of this slice: `POST /internal/engine-events` (the next slice), Clerk webhooks and the users and memberships
mirror, billing and plans, rate limits, the web app.

## Where things stand today (read on 2026-10-17)
- `apps/api` serves `GET /health` on plain `node:http`, with `createServer()` exported for tests. It has no
  dependencies except `@builder/contracts`, and no config, auth or database.
- `contracts/` already has `StartSessionRequest`, `StartSessionResponse`, `SessionLimits`, `SessionStatus`, the three
  engine events and `parseEngineEvent()`. It has no api-to-web shapes and no error shape for `/internal/sessions`.
- The engine has **no `/internal/*` routes yet.** Sessions start from the local-only `POST /api/sessions`
  (`apps/engine/src/app.ts`), which:
  - makes its own `randomUUID()` id. The stage and hand-off routes only match 36-character UUIDs.
  - writes an intent row first, then calls Recall. A Recall rejection gives 502. A network failure gives 504 and
    leaves the intent row for a person to reconcile. It never retries, because a retry can send a second bot.
  - reuses any active session for the same meeting URL, **across everyone** (`store.findActiveForMeeting`). Once there
    are orgs, this would hand org A's session to org B.
  - has no `org_id` or limits on its `sessions` table.
- `origin/engine/postgres` (commit `77af421`) is a WIP port of the engine's store to Drizzle + PGlite/`pg`. Its own
  message says the test suite hangs and not to merge it. It puts the engine's tables and its migrations table in the
  `engine` schema, which leaves the `api` schema free for us.

## Design

### HTTP layer
Keep plain `node:http` with a small router in `src/routes/`, as the skeleton does (decision D1). The api has only a
few routes in this slice. A framework can come in with its own ADR when there are more. Each route parses its input
with zod and answers with one error shape: `{ error: { code, message } }`. Codes are stable strings such as
`unauthenticated`, `no_active_org`, `forbidden`, `invalid_request`, `engine_rejected`, `engine_unavailable` and
`engine_outcome_unknown`.

`createServer(deps)` takes its dependencies, the same way the engine's `createApp` does: `{ config, db, auth, engine,
log, clock }`. Tests pass fakes. `server.ts` builds the real ones.

### Auth (`src/auth/`)
- Verify the Clerk session token from `Authorization: Bearer <token>` with `verifyToken` from `@clerk/backend`. Pass
  `jwtKey` (from `CLERK_JWT_KEY`) so verification needs no network call, and pass `authorizedParties` (the web
  app's origins, from config) to reject tokens minted for other sites.
- Read the active org from the v2 token claims: `sub` is the user, `o.id` is the org, and `o.rol` is the role
  without the `org:` prefix. Clerk recommends using its SDK to read these, so we take them from what `verifyToken`
  returns and don't decode the token ourselves.
- `requireOrg(req)` returns `{ userId, orgId, role }`. It answers 401 `unauthenticated` for a missing or bad token,
  and 403 `no_active_org` when the token has no active org (decision D3). `requireOrgRole(ctx, roles)` answers 403
  `forbidden`. Both are in ADR 0006's follow-up list.
- **orgId always comes from the verified token, never from the body or the query.** Every db function takes `orgId`
  as its first argument, so a query can't be written without one.
- No Clerk webhooks in this slice. The `orgs` row is created on the org's first authenticated request (an idempotent
  upsert of the id only, decision D4). The webhook mirror from ADR 0006 comes in a later slice and fills in the rest.

### Data (`src/db/`, Postgres per ADR 0007)
- Use the same tool as the engine branch: Drizzle ORM, drizzle-kit, `pg` in staging and production, and PGlite in
  tests and on a laptop. Use the same package versions as `origin/engine/postgres`, so the lockfile has one copy of
  each.
- Everything goes in the `api` Postgres schema (`pgSchema("api")`). The migrations table is in `api` too
  (`migrationsSchema: "api"`), so it never collides with the engine's. Migrations are in `apps/api/drizzle/`. Add
  `npm run migrate -w @builder/api` for Render's pre-deploy step.
- Tables in this slice:
  - `api.orgs`: `id` (the Clerk org id, primary key) and `created_at`.
  - `api.sessions`: `id` (uuid, made by the api, primary key), `org_id` (references orgs, not null),
    `created_by` (Clerk user id), `meeting_url`, `status`, `error_code`, `stage_url`, `max_usd`, `max_minutes`,
    `created_at` and `updated_at`. Index on `(org_id, created_at desc, id)`.
- `status` holds the contract's `SessionStatus` plus three api-only states: `starting` (row written, engine not yet
  answered), `start_failed` (the engine said no) and `start_unknown` (no answer, so we don't know whether a bot was
  sent). The web app shows the last one as "check before retrying". Decision D6.
- `connect.ts` follows the engine branch's pattern but is a copy, not an import (ADR 0004: the apps share no db
  code). That pattern is: `DATABASE_URL` → `pg` pool, otherwise PGlite, plus a migrated in-memory template so each
  test opens a fresh database fast.
- **Relation to `engine/postgres`.** The two don't depend on each other. Each app has its own schema, migrations,
  migrations table and connection, and in tests its own PGlite. Neither app reads the other's tables. Two things
  touch both:
  1. `package-lock.json`. Whichever branch lands second regenerates the lockfile on top of the first. Matching
     versions keeps this to a clean regenerate.
  2. Production roles. ADR 0007 gives each app a role limited to its own schema. That's infra work (D9). Until then,
     staging can use one role. The schemas still keep the tables apart.
  This slice doesn't wait for `engine/postgres`. The engine changes it needs (E1–E3 below) can land on SQLite and be
  ported, or land after the port. The engine owner chooses which.

### Calling the engine (`src/engine/`)
- `createEngineClient({ baseUrl, token, fetch, timeoutMs })` returns `startSession(req: StartSessionRequest)`. It
  calls `POST {ENGINE_INTERNAL_URL}/internal/sessions` with `Authorization: Bearer {ENGINE_INTERNAL_TOKEN}`. That
  URL is Render's private network address (ADR 0005).
- It parses the request with `StartSessionRequest` before sending, and the reply with `StartSessionResponse`. A
  reply that doesn't parse counts as `outcome_unknown`, because the engine may have sent a bot.
- Outcomes:
  - `ok` with the parsed response
  - `rejected` with an error code: the engine answered 4xx, or 5xx with a definite rejection code (needs C1)
  - `unknown`: timeout, network error, unparseable reply, or a 5xx with no code
- **No automatic retries.** A retry can send a second bot, which costs money. That's the same rule the engine follows
  with Recall. If E2 (idempotent on `sessionId`) lands, one retry with the same `sessionId` becomes safe. We'd add it
  then.
- If `ENGINE_INTERNAL_URL` or `ENGINE_INTERNAL_TOKEN` is unset, the client isn't built, and `POST /v1/sessions`
  answers 503 `engine_unavailable`. That keeps every step safe to merge before the engine side exists.
- Only ids, statuses, limits, URLs and error codes cross. Logs record `session_id`, `org_id`, the outcome, the
  status code and the duration, never the meeting URL.

### `POST /v1/sessions`
1. `requireOrg`. Both `admin` and `member` may start a meeting (ADR 0006: "members run meetings").
2. Parse `{ meetingUrl }`. It must be https and match the same meeting hosts the engine accepts (Meet, Zoom,
   Teams). Otherwise 400 `invalid_request`.
3. If this org already has a `starting`, `joining` or `in_meeting` session for the same URL, return it with 200 and
   `reused: true`, and don't call the engine. This keeps a double-click from sending two bots. Decision D7.
4. Work out the limits. There are no plans yet, so they come from config: `DEFAULT_MAX_USD` and
   `DEFAULT_MAX_MINUTES` (decision D5). Billing replaces this later (ADR 0009).
5. Insert the row with `status = starting` before calling the engine (intent first, as the engine does).
6. Call the engine:
   - `ok`: update the status and `stage_url`, answer 201 with the session.
   - `rejected`: set `start_failed` and `error_code`, answer 502 `engine_rejected`.
   - `unknown`: set `start_unknown`, answer 504 `engine_outcome_unknown`.
7. Response body: `{ session: SessionView }`, where `SessionView` is `{ id, meetingUrl, status, errorCode?, stageUrl?,
   limits, createdAt, updatedAt }`. Whether `stageUrl` is included is decision D8.

### `GET /v1/sessions`
- `requireOrg`, any role. Returns `{ sessions: SessionView[] }`, the org's 50 newest. No paging for the hackathon.
  When it's needed, add an optional `limit` and an opaque `nextCursor` (base64 of `(created_at, id)`), which is an
  additive change.
- Also add `GET /v1/sessions/:id`. It answers 404 for an id in another org, the same as for an id that doesn't exist,
  so it doesn't reveal that the id exists.
- Until engine events arrive (the next slice), the status shown is whatever the engine said at start.

### Shapes between the api and web
`CreateSessionBody`, `SessionView` and `SessionList` are zod schemas in `apps/api/src/routes/schemas.ts` for now.
They move to `contracts/` when `apps/web` starts importing them (ADR 0004: shared only when two apps import it).
Decision D2.

### Config (`src/config.ts`)
`PORT`, `DATABASE_URL` (optional, PGlite otherwise), `PGLITE_DIR` (default `data/pg`, already git-ignored by
`data/`), `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` (comma-separated origins), `ENGINE_INTERNAL_URL`,
`ENGINE_INTERNAL_TOKEN`, `DEFAULT_MAX_USD`, `DEFAULT_MAX_MINUTES`. Add `apps/api/.env.example` with names only.
`apps/api/.env` is already git-ignored by the root `.env` rule. Config never logs values.

## Testing without real Clerk, Recall or models
- **Clerk:** each test run makes an RSA key pair with `node:crypto`, signs session tokens with it (claims `sub`,
  `sid`, `azp`, `iat`, `nbf`, `exp`, `v: 2`, `o: { id, rol }`), and passes the public key as `jwtKey`. This runs the
  real `verifyToken` with no network call. Helpers: `signToken({ userId, orgId, role, expiresIn, azp })` in
  `test/helpers/clerk.ts`. Cases: valid; expired; wrong key; wrong `azp`; no `o` claim; role `member` vs `admin`;
  missing header; `Bearer` with junk.
- **Engine and Recall:** the api never calls Recall or a model. It calls only the engine, so a fake engine covers
  both. `test/helpers/fake-engine.ts` is a `node:http` server on port 0 that checks the bearer token, parses the body
  with `StartSessionRequest` from `@builder/contracts`, records what it got, and answers with something built from
  `StartSessionResponse`. Each test can script it to answer 4xx, 5xx, hang until the timeout, or send a malformed
  body. Because both sides use the contract schemas, a contract change that breaks the api fails these tests.
- **Postgres:** PGlite in memory, one fresh database per test from a migrated template. CI needs no secrets and no
  database service. Later, add a CI job against a real Postgres (ADR 0007), together with infra.
- **Tenant isolation (ADR 0006):** two orgs, each with sessions. Check that list and get never return the other org's
  rows, that an `orgId` in the request body or query is ignored, and that `GET /v1/sessions/:id` for another org's id
  gives 404.
- All of this runs in `npm run check -w @builder/api`, which the root `npm run check` and CI already call.

## Steps
Each step is its own branch from fresh `main` (for example `api/adr-stack`), with tests, and leaves `main` working.
None of them needs the engine side to exist.

| # | Branch | What | Tests | Safe alone because |
|---|---|---|---|---|
| 0 | `api/adr-stack` | ADR 0010: the api stack. `node:http` + small router, `@clerk/backend` with `jwtKey`, Drizzle + PGlite/`pg` in schema `api`, uuid ids, error shape, no auto-retry to the engine. Settles D1–D2 and D5–D8 | none (docs) | docs only |
| 1 | `api/config-router` | `src/config.ts`, `.env.example`, router and JSON/error helpers, `createServer(deps)`. `/health` unchanged | config parsing (missing and bad values, no values in errors); router 404/405; error shape | no new routes |
| 2 | `api/clerk-auth` | `src/auth/`: `verifyRequest`, `requireOrg`, `requireOrgRole`. Adds `@clerk/backend`. Adds `GET /v1/me` → `{ userId, orgId, role }` so auth is used and testable (D10) | the Clerk cases above | read-only route, no data |
| 3 | `api/db` | `src/db/`: schema, first migration, `connect.ts`, `migrate.ts`, org upsert, session functions that all take `orgId`. Adds `drizzle-orm`, `pg`, `@electric-sql/pglite`, `drizzle-kit` | migration applies to an empty PGlite; functions; isolation at the db level | not wired to routes yet |
| 4 | `api/engine-client` | `src/engine/client.ts` and the fake engine helper | ok, 4xx, 5xx, timeout, malformed reply, bearer sent, request parsed before sending | not called by any route yet |
| 5 | `api/sessions-read` | `GET /v1/sessions` and `GET /v1/sessions/:id` | newest first, capped at 50; isolation; 401 and 403 | read-only |
| 6 | `api/sessions-create` | `POST /v1/sessions` | each engine outcome → row status and HTTP code; intent row exists before the engine call; reuse of an active session; validation; 503 with no engine config; body `orgId` ignored | answers 503 until the engine URL and token are set |

Steps 1 and 2 can start right away. Steps 3 and 4 depend only on 1, so they can go in parallel. Step 6 needs 2–5.

**Next slice, not this one:** `POST /internal/engine-events` (bearer token, `parseEngineEvent`, idempotent by event
id, usage stored as the latest cumulative value). Then the Clerk webhook mirror (users, memberships, Svix signature
check). Then billing.

## Changes outside apps/api
These need approval before anyone builds them. Nothing in steps 0–6 waits on them. Until they land, the api is only
ever tested against the fake engine.

**Engine (engine owner):**
- **E1.** `POST /internal/sessions`, as ADR 0008 describes. It requires the bearer token (`ENGINE_INTERNAL_TOKEN`,
  compared in constant time, as `tokenMatches` already does). It refuses requests with proxy headers, using the
  existing `viaProxy`. It parses the body with `StartSessionRequest`, uses the api's `sessionId` instead of making
  its own, stores `orgId` and `limits`, and answers with `StartSessionResponse`.
- **E2.** Make E1 idempotent on `sessionId`. A second call with the same id returns the first result and doesn't send
  a second bot. That makes a retry from the api safe.
- **E3.** Scope "reuse the active session for this meeting" to the org (`findActiveForMeeting(orgId, url)`). Without
  this, one org could get another org's session and stage URL. **This is a security fix and is needed before E1 goes
  live.**
- **E4.** Add `org_id`, `max_usd` and `max_minutes` columns to the engine's `sessions` table, on SQLite now or in the
  Drizzle schema on `engine/postgres`. The engine owner chooses the order.
- Later, not needed for this slice: enforce the limits, send `/internal/engine-events`, the org-deletion route, and
  turning off `/` and `/api/*` in production (all from ADR 0008).

**Contracts (engine and api owners together, additive only):**
- **C1.** `StartSessionError`: `{ error: { code: string } }`, used for non-2xx replies from `/internal/sessions`, with
  known codes such as `recall_rejected`, `recall_outcome_unknown`, `meeting_in_use`, `invalid_request` and
  `unauthorized`. Without it, the api has to guess from the HTTP status alone whether a bot might exist.
- **C2.** Document in `StartSessionRequest` that `sessionId` is a UUID, because the engine's stage and hand-off routes
  only match UUIDs. Keep the schema as `string().min(1)` (tightening it would be a breaking change), and have the api
  always send `randomUUID()`. Alternatively, tighten it to `z.uuid()` now while nothing sends it yet. Decision D11.
- **C3 (later).** Move `CreateSessionBody`, `SessionView` and `SessionList` here when `apps/web` imports them.

**Infra (infra owner):**
- **I-1.** An `api` service in `render.yaml` (pre-deploy: `npm run migrate -w @builder/api`), an environment group
  for the Clerk key and the engine token (`sync: false`), and the shared `ENGINE_INTERNAL_TOKEN` in both services.
- **I-2.** Two Postgres roles, each with rights only on its own schema (ADR 0007).

## Decisions

**Made by the api owner (2026-10-17).** These go into ADR 0010 in step 0.
- **D1.** Plain `node:http` with a small router. No framework.
- **D2.** Api-to-web shapes stay in `apps/api` until web imports them.
- **D3.** A token with no active org gets 403 `no_active_org`. The Clerk project needs a dashboard setting that
  makes every user belong to an org, so ADR 0006's "personal org of one" holds. That's for whoever owns the Clerk
  project.
- **D4.** `orgs` rows are created on the org's first request. The webhook mirror comes later.
- **D6.** The api adds its own statuses `starting`, `start_failed` and `start_unknown` next to the contract's four.
- **D7.** An org's active session for the same meeting URL is reused, not started again.
- **D8.** `GET` and `POST` return the stage URL to members of the owning org. It's never logged.
- **D10.** `GET /v1/me` ships with auth in step 2.

**Still open:**
- **D5 (repo owner).** Default per-session limits until billing exists: values for `DEFAULT_MAX_USD` and
  `DEFAULT_MAX_MINUTES`.
- **Postgres or SQLite for the hackathon (repo owner).** ADR 0007 says Postgres for both apps, but
  `engine/postgres` isn't finished. If we stay on SQLite until after the submission, step 3 uses `node:sqlite` (no
  new dependencies) behind the same db functions, and moves to Postgres afterwards. See [Timeline](#timeline).
- The Clerk instance: which Clerk application and environment to use for staging, and who holds `CLERK_JWT_KEY`.
  Tests don't need it.

**From the engine owner (with you where noted):**
- **D11.** C2: document the uuid rule only, or tighten `sessionId` to `z.uuid()` now. Both owners.
- **D12.** Approve E1–E4, and choose whether E4 lands on SQLite now or after `engine/postgres`.
- **D13.** C1's error codes, and which HTTP statuses the engine uses for "Recall rejected" versus "outcome unknown".
  Both owners.
- **D14.** The engine's timeout budget for `/internal/sessions`. Recall's create-bot call is a few seconds. The api's
  client timeout (proposed: 20 s) must be longer than the engine's own timeout.

## Timeline
The submission is due 2026-10-25, 11:59 PM ET, eight days from this plan. Steps 0, 1, 2, 4 and 5 are small, about
half a day to a day each. Two parts are at risk:

- **Step 3 (database) is the biggest step.** Drizzle, PGlite, `pg` and migrations are four new dependencies and a
  setup the engine's own attempt (`engine/postgres`) hasn't finished yet. The simplest choice for the hackathon is
  `node:sqlite` in the api, which the engine already uses and which needs no new dependency. It goes behind the same
  `orgId`-first db functions, so moving to Postgres afterwards changes only `src/db/`. This needs the repo owner's
  answer (see Decisions, still open).
- **A real end-to-end meeting depends on work outside the api:** E1–E4 in the engine, C1 in contracts, and the
  infra items for a deploy. The api can be finished and tested against the fake engine without them. But a demo where
  the web app starts a real bot needs E1 and E3 by about 2026-10-22 to leave time to test with real meetings.

If time runs short, the order to cut is: `GET /v1/sessions/:id`, then session reuse (D7), then `GET /v1/me`. Auth,
create and list stay.
