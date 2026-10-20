# Plan: the api's first slice (Clerk auth, sessions, engine client, SurrealDB)

- **Status:** agreed on 2026-10-17, except D5 (open) and the engine and
  contracts items, which need review before merge. Steps 0, 1, 2 and 4 are merged. On 2026-10-18 the project chose
  SurrealDB on SurrealDB Cloud for both apps, one database each ([ADR 0011](../adr/0011-surrealdb.md)). Step 3 below
  is rewritten for it, and isn't started. Later on 2026-10-18 the engine's move to SurrealDB landed on `main`
  (PR #6), so step 3 now follows the engine's connection and migration code.
- **Date:** 2026-10-17, updated 2026-10-18
- **Deadline:** hackathon submission due 2026-10-25, 11:59 PM ET. Where there's a choice, take the simplest option.
  See [Timeline](#timeline).
- **Area:** `apps/api`. Changes needed in `apps/engine` and `contracts/` are listed separately in
  [Changes outside apps/api](#changes-outside-appsapi) and need review before merge.
- **Built on:** ADRs [0004](../adr/0004-workspaces-and-repo-layout.md), [0005](../adr/0005-hosting-on-render.md),
  [0006](../adr/0006-identity-and-tenancy.md), [0008](../adr/0008-api-engine-boundary.md),
  [0009](../adr/0009-pricing-model.md), [0010](../adr/0010-api-stack.md) and
  [0011](../adr/0011-surrealdb.md), which replaced [0007](../adr/0007-database.md).

## Goal
A signed-in member of an org can start a meeting session and list their org's sessions:

```
web --(Clerk session token)--> POST /v1/sessions  { meetingUrl }
api: verify token -> org + role -> limits -> store row -> POST engine /internal/sessions -> store result
web --(Clerk session token)--> GET  /v1/sessions  -> this org's sessions only
```

Out of this slice: `POST /internal/engine-events` (the next slice), Clerk webhooks and the users and memberships
mirror, billing and plans, rate limits, the web app.

## Where things stand today (read on 2026-10-17, the engine re-read on 2026-10-18)
- `apps/api` serves `GET /health` on plain `node:http`, with `createServer()` exported for tests. It has no
  dependencies except `@builder/contracts`, and no config, auth or database.
- `contracts/` already has `StartSessionRequest`, `StartSessionResponse`, `SessionLimits`, `SessionStatus`, the three
  engine events and `parseEngineEvent()`. It has no api-to-web shapes and no error shape for `/internal/sessions`.
- The engine has **no `/internal/*` routes yet.** Sessions start from the local-only `POST /api/sessions`
  (`apps/engine/src/app.ts`), which:
  - makes its own `randomUUID()` id. The stage and hand-off routes only match 36-character UUIDs.
  - writes an intent row first, then calls Recall. A Recall rejection gives 502. A network failure gives 504 and
    leaves the intent row for a person to reconcile. It never retries, because a retry can send a second bot.
  - reuses any active session for the same meeting URL, **across everyone** (`store.findActiveForMeeting`, called at
    `apps/engine/src/app.ts:132`). Once there are orgs, this would hand org A's session to org B.
  - has no `org_id` or limits on its `sessions` table.
- **The engine is on SurrealDB** (ADR 0011, `engine/surrealdb`, merged to `main` on 2026-10-18 as PR #6, from the
  [engine plan](../superpowers/plans/2026-10-18-surrealdb-render.md)'s Task 1):
  - Its store is async, in database `engine`, with the schema in `apps/engine/db/0001_init.surql`.
  - `src/db/connect.ts` and `src/db/migrate.ts` are the pattern the api's step 3 follows.
  - `npm run migrate -w @builder/engine` migrates a server.
  - It pins `surrealdb` 2.1.1, `@surrealdb/node` 3.1.0 and `@surrealdb/node-native` 3.3.2.
  - The root `package.json` has the TypeScript override (O1).
  - Its routes didn't change, so nothing above is different.
- The engine plan's Task 2 (`infra/render`: Dockerfiles, `docker-compose.yml`, `render.yaml`, the Cloud setup
  script and runbook) isn't on GitHub yet.

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

### Data (`src/db/`, SurrealDB per ADR 0011)
ADR 0011 decides SurrealDB on SurrealDB Cloud, namespace `builder` with one database per app, database-level users,
`.surql` schema files with a small migration runner, and the in-process engine for tests. This section is the api's
part of that.

- **Packages:** the same three the engine pins, at the same exact versions:
  - `surrealdb` 2.1.1, the client
  - `@surrealdb/node` 3.1.0, the in-process engine for tests and laptops
  - `@surrealdb/node-native` 3.3.2, its native part, listed directly so it's pinned. It reports itself as
    `surrealdb-3.3.2`, the version SurrealDB Cloud runs (ADR 0011).

  Same versions as the engine means one copy in the lockfile, and the in-process engine matches Cloud. The prebuilt
  native binaries cover Linux, macOS and Windows on x64 and arm64. They're already in the lockfile for the engine.
- **TypeScript 7.** `surrealdb` 2.1.1 declares a TypeScript `^5 || ^6` peer, so without the override a plain
  `npm install` fails with `ERESOLVE`. The root `package.json` on `main` already has the scoped override (O1, done),
  for `surrealdb` and `@surrealdb/sqon`, so step 3 just adds its dependencies.
- **A spike on 2026-10-18,** outside the repo, ran on Node 24 with type stripping and passed `tsc` 7 with the repo's
  `tsconfig.base.json`. It ran on `@surrealdb/node-native` 3.3.4, before the pin moved to 3.3.2. It covered:
  - the schema below, upserts, UUID record ids and bound parameters
  - org-scoped list and get. Another org's id returned nothing.
  - a find-or-create transaction
  - `DEFINE ... IF NOT EXISTS` run twice

  A fresh in-memory database with the schema took about 3 ms. A duplicate id threw `AlreadyExistsError`.
- **Where:** database `api` in namespace `builder`. The api signs in as a user defined on that database only
  (`DEFINE USER api ON DATABASE ... ROLES OWNER`), so it can't read the engine's database.
  - The user is created once, when the Cloud instance is set up (I-2). App code never creates users.
  - `PASSWORD` accepts only a literal string. A bound parameter (`PASSWORD $p`) is a parse error, checked on 2026-10-18
    on both 3.3.4 and 3.3.2. So creating users from code would mean building query text from a secret, and a setup
    script can't take the password as a parameter either (see I-2).
- **Tables** (`apps/api/db/0001_init.surql`). Plain `DEFINE`, as in the engine's `0001_init.surql`, because the
  runner applies each file only once:

  ```surql
  DEFINE TABLE org SCHEMAFULL;
  DEFINE FIELD created_at ON org TYPE datetime DEFAULT time::now() READONLY;

  DEFINE TABLE session SCHEMAFULL;
  DEFINE FIELD org         ON session TYPE record<org>;
  DEFINE FIELD created_by  ON session TYPE string;          -- Clerk user id
  DEFINE FIELD meeting_url ON session TYPE string;
  DEFINE FIELD status      ON session TYPE string
    ASSERT $value IN ["starting", "start_failed", "start_unknown", "joining", "in_meeting", "ended", "failed"];
  DEFINE FIELD error_code  ON session TYPE option<string>;
  DEFINE FIELD stage_url   ON session TYPE option<string>;
  DEFINE FIELD max_usd     ON session TYPE number;
  DEFINE FIELD max_minutes ON session TYPE number;
  DEFINE FIELD created_at  ON session TYPE datetime DEFAULT time::now() READONLY;
  DEFINE FIELD updated_at  ON session TYPE datetime VALUE time::now();
  DEFINE INDEX session_org_created ON session FIELDS org, created_at;
  DEFINE INDEX session_org_meeting ON session FIELDS org, meeting_url;
  ```

  - An org's record id is the Clerk org id (`org:⟨org_…⟩`).
  - A session's record id is the api's `randomUUID()`, the same id it sends the engine.
  - The SDK's `RecordId` builds both, so ids are never pasted into query text.
- `status` holds the contract's `SessionStatus` plus three api-only states (decision D6):
  - `starting`: row written, the engine hasn't answered yet
  - `start_failed`: the engine said no
  - `start_unknown`: no answer, so we don't know whether a bot was sent. The web app shows this one as "check before
    retrying".

  The schema's `ASSERT` rejects any other value.
- **The `Db` functions are the only way in.** Steps 5 and 6 only ever see these, so they don't care which database
  is underneath:
  - `upsertOrg(orgId)`
  - `createSessionUnlessActive(orgId, s)`: reuse (D7) and insert in one transaction
  - `setSessionStart(orgId, id, result)`
  - `getSession(orgId, id)`
  - `listSessions(orgId, limit)`
  - `close()`

  All of them:
  - take `orgId` first
  - put `WHERE org = $org` on every session query, including reads by id
  - use bound parameters only
  - return plain objects, with string ids and ISO-string times. Queries convert with `record::id(id)` and
    `<string> created_at`, so no SDK type (`RecordId`, `DateTime`) gets past `src/db/`.

  Nothing outside `src/db/` imports `surrealdb`.
- **Files: follow the engine.** Copy the engine's `src/db/connect.ts`, `src/db/migrate.ts` and `src/error-code.ts`
  into `apps/api` and change the database to `api`. ADR 0004 says not to make a shared package for code that only
  looks alike. What they do:
  - `apps/api/db/*.surql`: the schema, applied in name order
  - `src/db/connect.ts`: namespace `builder`, database `api`, as constants.
    - **`SURREAL_URL` set:** connect over `ws://` or `wss://`. Sign in with `SURREAL_USER` and `SURREAL_PASS`, as a
      database user of `builder`/`api` by default, or as root with `SURREAL_AUTH=root` (a local `surreal start` or
      docker compose only).
    - **Startup:** a 10 s connect timeout that fails with the code `SURREAL_UNREACHABLE`. After that, a dropped
      connection is retried for as long as it takes.
    - **`SURREAL_URL` unset:** the in-process engine, on `surrealkv://` at `SURREAL_PATH` (default `data/surreal`,
      under `apps/api/`, git-ignored). Tests use `mem://`.
    - **Write conflicts:** the SDK's `retry` option is on, and each query that's safe to resend is marked `.retry()`.
      The reuse transaction (`createSessionUnlessActive`) is safe to retry whole: it either commits or changes
      nothing, and a retry checks for an active session again.
  - `src/db/migrate.ts`:
    - It keeps a `migration` table whose record ids are the file names.
    - It applies each file not yet recorded in one `db.transaction([...])` together with its `migration` row, so a
      file is applied whole or not at all.
    - Running it twice does nothing.
    - In-process databases are migrated when they're opened.
    - A server is migrated by `npm run migrate -w @builder/api` (the file runs itself through `import.meta.main`),
      which is the api's pre-deploy command (I-1).
  - `src/error-code.ts`: reads a code from an error or its `cause`, never the message. Database errors are logged by
    code only, because a message can echo query values.
  - `src/db/sessions.ts`, `src/db/orgs.ts`, `src/db/types.ts`
- **Relation to the engine.** The api doesn't use the engine's database, and the engine doesn't use the api's. Each
  has its own database, user, schema files and migration table in the same Cloud instance. The engine's E4 (org and
  limits on its sessions) is a new migration file in the engine's `db/` folder and doesn't touch the api's.

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
   Otherwise the start guards below apply (429), in the same transaction that creates the session.
4. Work out the limits. There are no plans yet, so they come from config: `DEFAULT_MAX_USD` and
   `DEFAULT_MAX_MINUTES` (decision D5). Billing replaces this later (ADR 0009).
5. Insert the row with `status = starting` before calling the engine (intent first, as the engine does).
6. Call the engine:
   - `ok`: update the status and `stage_url`, answer 201 with the session.
   - `rejected`: set `start_failed` and `error_code`, answer 502 `engine_rejected`.
   - `unknown`: set `start_unknown`, answer 504 `engine_outcome_unknown`.
7. Response body: `{ session: SessionView }`, where `SessionView` is `{ id, meetingUrl, status, errorCode?, stageUrl?,
   limits, createdAt, updatedAt }`. Whether `stageUrl` is included is decision D8.

### Start guards (added 2026-10-20)
Every start can send a paid bot and sign-up is open, so one account or org can't start an unbounded number:
- **Per user:** at most `START_RATE_LIMIT_PER_MINUTE` (default 5) `POST /v1/sessions` per user in any minute,
  counted before anything else (invalid and reused requests too). Over it: 429 `rate_limited` with `Retry-After`.
  In memory: the api runs as one instance; with more, each would count on its own.
- **Per org, active at once:** at most `MAX_ACTIVE_SESSIONS_PER_ORG` (default 2). Over it: 429
  `active_limit_reached`. Reusing an active session still works at the limit.
- **Per org, per day:** at most `MAX_STARTS_PER_ORG_PER_DAY` (default 20) sessions created in any 24 hours, whatever
  became of them. Over it: 429 `daily_limit_reached`.
- Both org limits are checked in the transaction that creates the session. Every start writes the org's row
  (`last_start_at`), so two starts for one org at once conflict and one is retried after the other: they can't both
  pass a count. Nothing is saved and the engine isn't called when one is refused.
- **Stale sessions (stopgap until engine events, A2):** statuses don't move yet, so a session would stay `joining`
  and block its meeting link for good. Each session has `active_until`: its time limit plus
  `ACTIVE_MARGIN_MINUTES` (default 10). Past it, it no longer counts as active (for reuse or the active limit); its
  status is left as it was. `db/0002_start_guards.surql` adds the field and backfills existing rows with a
  10-minute margin.
- Unset variables take the defaults (`src/start-guards.ts`); a bad value stops the server with an error naming the
  variable.

### `GET /v1/sessions`
- `requireOrg`, any role. Returns `{ sessions: SessionListItem[] }` (a `SessionView` without `stageUrl`: the stage
  link is a control link, sent only by `GET /v1/sessions/:id`), the org's 50 newest. No paging for the hackathon.
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
Built in step 1:
- `PORT`
- `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` (comma-separated origins)
- `ENGINE_INTERNAL_URL`, `ENGINE_INTERNAL_TOKEN`
- `DEFAULT_MAX_USD`, `DEFAULT_MAX_MINUTES`
- Start guards, each optional with a default: `MAX_ACTIVE_SESSIONS_PER_ORG` (2), `MAX_STARTS_PER_ORG_PER_DAY` (20),
  `START_RATE_LIMIT_PER_MINUTE` (5), `ACTIVE_MARGIN_MINUTES` (10). See "Start guards".

Step 3 adds the database variables. They're the engine's five, with the same names and rules (its
`surrealSettings()` in `apps/engine/src/config.ts`):
- `SURREAL_URL`: a `ws://` or `wss://` URL; the SurrealDB Cloud URL in production.
- `SURREAL_USER`, `SURREAL_PASS`: the api's database user. Required together whenever `SURREAL_URL` is set.
- `SURREAL_AUTH`: `database` (the default) or `root`. Anything else is a config error.
- `SURREAL_PATH`: the local folder when `SURREAL_URL` is unset. Default `data/surreal` (under `apps/api/data/`,
  already git-ignored).

The namespace and database are constants in `connect.ts`, not settings, as in the engine.

One rule is stricter than the engine's: `SURREAL_URL` is required when `NODE_ENV=production`. Without it, production
would silently write to a local folder that disappears on the next deploy. The Blueprint sets `NODE_ENV=production`
on the api (I-1). The engine has the same gap, which is an open question for the engine.

`apps/api/.env.example` lists names only. `apps/api/.env` is git-ignored by the root `.env` rule. Config never logs
values.

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
- **SurrealDB:** the embedded in-memory engine (`mem://` from `@surrealdb/node`), running inside the test process.
  `test/helpers/db.ts` opens one instance per test file. Each test gets a fresh, randomly named database with the
  migrations applied, which took about 3 ms in the spike. There's no server and no network, and CI needs no secrets
  and no database service. Close every database a test opens, so the suite exits on its own, as the engine's
  `test/helpers/store.ts` does. The engine plan's Task 2 adds a CI job against the real `surrealdb/surrealdb:v3.3.2`
  image. Add the api's db tests and `npm run migrate -w @builder/api` to it.
- **Tenant isolation (ADR 0006):** two orgs, each with sessions. Check that list and get never return the other org's
  rows, that an `orgId` in the request body or query is ignored, and that `GET /v1/sessions/:id` for another org's id
  gives 404.
- All of this runs in `npm run check -w @builder/api`, which the root `npm run check` and CI already call.

## Steps
Each step is its own branch from fresh `main` (for example `api/adr-stack`), with tests, and leaves `main` working.
None of them needs the engine side to exist.

| # | Branch | What | Tests | Safe alone because |
|---|---|---|---|---|
| 0 | `api/adr-stack` | ADR 0010: the api stack. `node:http` + small router, `@clerk/backend` with `jwtKey`, uuid ids, error shape, no auto-retry to the engine. Settles D1–D2 and D5–D8. (Its data bullet is superseded by ADR 0011) | none (docs) | docs only. **Merged** |
| 1 | `api/config-router` | `src/config.ts`, `.env.example`, router and JSON/error helpers, `createServer(deps)`. `/health` unchanged | config parsing (missing and bad values, no values in errors); router 404/405; error shape | no new routes. **Merged** |
| 2 | `api/clerk-auth` | `src/auth/`: `verifyRequest`, `requireOrg`, `requireOrgRole`. Adds `@clerk/backend`. Adds `GET /v1/me` → `{ userId, orgId, role }` so auth is used and testable (D10) | the Clerk cases above | read-only route, no data. **Merged** |
| 3 | `api/db` | Per ADR 0011, following the engine's code: `apps/api/db/0001_init.surql`; in `src/db/`: `connect.ts` and `migrate.ts` (from the engine's), `orgs.ts`, `sessions.ts`, the `Db` type; `src/error-code.ts`. The five `SURREAL_*` variables in `config.ts` and `.env.example`. A `migrate` script in `apps/api/package.json`. Adds `surrealdb` 2.1.1, `@surrealdb/node` 3.1.0 and `@surrealdb/node-native` 3.3.2, pinned as in the engine. O1 is already on `main` | on embedded `mem://`: migration applies to an empty db and is safe to re-run; a failing file leaves no row; each function; unknown status rejected; duplicate id; reuse in one transaction; list and get never cross orgs; config rules for the new variables | not wired to routes yet |
| 4 | `api/engine-client` | `src/engine/client.ts` and the fake engine helper | ok, 4xx, 5xx, timeout, malformed reply, bearer sent, request parsed before sending | not called by any route yet. **Merged** |
| 5 | `api/sessions-read` | `GET /v1/sessions` and `GET /v1/sessions/:id` | newest first, capped at 50; isolation; 401 and 403 | read-only |
| 6 | `api/sessions-create` | `POST /v1/sessions` | each engine outcome → row status and HTTP code; intent row exists before the engine call; reuse of an active session; validation; 503 with no engine config; body `orgId` ignored | answers 503 until the engine URL and token are set |

Steps 1 and 2 can start right away. Steps 3 and 4 depend only on 1, so they can go in parallel. Step 6 needs 2–5.

**Next slice, not this one:** `POST /internal/engine-events` (bearer token, `parseEngineEvent`, idempotent by event
id, usage stored as the latest cumulative value). Then the Clerk webhook mirror (users, memberships, Svix signature
check). Then billing.

## Changes outside apps/api
These need approval before anyone builds them. None of them blocks a step: O1, the only one that did, is on `main`.
Until the rest land, the api is only ever tested against the fake engine.

**Engine:**
- **E1.** `POST /internal/sessions`, as ADR 0008 describes. **Built as part of this slice
  (2026-10-18).** It's still engine code, so it goes on its own `engine/` branch and needs review before merge
  (AGENTS.md). Not started; the route doesn't exist on `main` yet. It requires the bearer token (`ENGINE_INTERNAL_TOKEN`,
  compared in constant time, as `tokenMatches` already does). It refuses requests with proxy headers, using the
  existing `viaProxy`. It parses the body with `StartSessionRequest`, uses the api's `sessionId` instead of making
  its own, stores `orgId` and `limits`, and answers with `StartSessionResponse`.
- **E2.** Make E1 idempotent on `sessionId`. A second call with the same id returns the first result and doesn't send
  a second bot. That makes a retry from the api safe.
- **E3.** Scope "reuse the active session for this meeting" to the org (`findActiveForMeeting(orgId, url)`, today at
  `apps/engine/src/store.ts:136`). Without this, one org could get another org's session and stage URL. **This is a
  security fix and is needed before E1 goes live.**
- **E4.** Add `org_id`, `max_usd` and `max_minutes` to the engine's sessions. The engine is on SurrealDB now, so this
  is a new migration file, `apps/engine/db/0002_session_org_limits.surql`. Its `DEFINE FIELD`s are `option<...>` so
  existing rows stay valid, and it adds an index on `org_id, meeting_url` for E3. `store.ts` then writes and reads
  the fields. E1 needs E4, so they can land together.
- Later, not needed for this slice: enforce the limits, send `/internal/engine-events`, the org-deletion route, and
  turning off `/` and `/api/*` in production (all from ADR 0008).

**Contracts (additive only, both apps must agree):**
- **C1.** `StartSessionError`: `{ error: { code: string } }`, used for non-2xx replies from `/internal/sessions`, with
  known codes such as `recall_rejected`, `recall_outcome_unknown`, `meeting_in_use`, `invalid_request` and
  `unauthorized`. Without it, the api has to guess from the HTTP status alone whether a bot might exist.
- **C2.** Document in `StartSessionRequest` that `sessionId` is a UUID, because the engine's stage and hand-off routes
  only match UUIDs. Keep the schema as `string().min(1)` (tightening it would be a breaking change), and have the api
  always send `randomUUID()`. Alternatively, tighten it to `z.uuid()` now while nothing sends it yet. Decision D11.
- **C3 (later).** Move `CreateSessionBody`, `SessionView` and `SessionList` here when `apps/web` imports them.

**Repo root:**
- **O1. Done.** The root `package.json` overrides the TypeScript peer of `surrealdb` and `@surrealdb/sqon` with
  `"$typescript"`. It landed with the engine's move to SurrealDB (PR #6). `surrealdb` 2.1.1 declares a TypeScript
  `^5 || ^6` peer, and the override is the smallest fix; `--legacy-peer-deps` would loosen peer checks for every
  package. Remove it when `surrealdb` accepts TypeScript 7.

**Infra (in the engine plan's Task 2):**
- **I-1.** The api service in `render.yaml`. The engine plan's Task 2 (`infra/render`, not on GitHub yet) covers most
  of it:
  - `builder-api`, a Docker web service with health check `/health`
  - `ENGINE_INTERNAL_URL` from the engine's private address
  - an environment group with `ENGINE_INTERNAL_TOKEN`, shared with the engine
  - the Clerk variables as secrets (`sync: false`)
  - an `api` service in `docker-compose.yml` on port 3001

  Missing from it, and needed for the api:
  - the pre-deploy command `npm run migrate -w @builder/api`. Task 2 gives one to the engine only.
  - the api's own `SURREAL_URL`, `SURREAL_USER` and `SURREAL_PASS` as secrets, `SURREAL_AUTH=database`
  - `NODE_ENV=production`
- **I-2.** The SurrealDB Cloud instance (ADR 0011). Task 2's setup script `infra/surrealdb/setup.surql` already
  defines database `api` and its user (`api`, role `OWNER` on that database only), and the runbook stores the
  credentials as Render secrets.
  - **One problem:** the script plans to take the passwords as parameters (`$api_pass`), and SurrealDB 3.3.2 rejects
    `DEFINE USER ... PASSWORD $p` with a parse error (tested 2026-10-18). The password must be a literal. So the
    script needs another way in: run in Surrealist with the password typed in, or have compose fill a template.

## Effects on the rest of the project
What ADR 0011 means for the api's neighbours, and where the api's work meets the engine plan
([2026-10-18-surrealdb-render.md](../superpowers/plans/2026-10-18-surrealdb-render.md)). Nothing here is done by
this plan's steps.

- **The engine** is on SurrealDB (engine plan, Task 1, on `main` since PR #6). It uses database `engine` with its own
  user, so the two apps never share tables. Its `connect.ts` and `migrate.ts` are the model for the api's (step 3).
- **The Postgres work** (`engine/postgres`, and the archive branches the engine plan reuses) belongs to the
  engine plan. The api never depended on it.
- **`render.yaml`, `docker-compose.yml` and the Cloud setup script** are written in the engine plan's Task 2
  (`infra/render`), with no database on Render. They already plan an api service and the api's database and user.
  I-1 and I-2 list what the api still needs from them.
- **Root `package.json` and the lockfile:**
  - The `surrealdb` override (O1) is on `main` and serves both apps.
  - Pin the same `surrealdb`, `@surrealdb/node` and `@surrealdb/node-native` versions in both apps, so the lockfile
    has one copy and both apps match the Cloud server's version (ADR 0011). Step 3 regenerates the lockfile with
    `npm install`.
- **`docs/security/`.** ADR 0011 puts customer data on SurrealDB Cloud. ADR 0007's follow-up (a retention period for
  session data) still applies.
- **`contracts/`:** no change.

## Decisions

**Made on 2026-10-17.** These go into ADR 0010 in step 0.
- **D1.** Plain `node:http` with a small router. No framework.
- **D2.** Api-to-web shapes stay in `apps/api` until web imports them.
- **D3.** A token with no active org gets 403 `no_active_org`. The Clerk project needs a dashboard setting that
  makes every user belong to an org, so ADR 0006's "personal org of one" holds. That's an open setup task in the Clerk
  project.
- **D4.** `orgs` rows are created on the org's first request. The webhook mirror comes later.
- **D6.** The api adds its own statuses `starting`, `start_failed` and `start_unknown` next to the contract's four.
- **D7.** An org's active session for the same meeting URL is reused, not started again.
- **D8.** `GET` and `POST` return the stage URL to members of the owning org. It's never logged.
- **D10.** `GET /v1/me` ships with auth in step 2.

**Answered in [ADR 0011](../adr/0011-surrealdb.md) (2026-10-18):**
- ~~Postgres or SQLite for the hackathon.~~ Neither: SurrealDB.
- **D15. The engine's database:** SurrealDB too, database `engine`. Landed on `main` (PR #6).
- **D16. Where it runs:** SurrealDB Cloud, one instance, created by the engine plan's runbook. The free instance at
  launch.
- **D17. The TypeScript peer conflict:** a scoped `overrides` entry in the root `package.json`, not
  `legacy-peer-deps` (O1). On `main`.

**Still open:**
- **D5.** Default per-session limits until billing exists: values for `DEFAULT_MAX_USD` and
  `DEFAULT_MAX_MINUTES`.
- **D18.** Memory across meetings for the prize: whether to build it before 2026-10-25,
  and with SurrealDB Agent Memory or our own tables. See
  [Later: memory across meetings](#later-memory-across-meetings-surrealdb).
- The Clerk instance: which Clerk application and environment to use for staging, and where `CLERK_JWT_KEY` is kept.
  Tests don't need it.

**Engine side (some need both apps to agree, as noted):**
- **D11.** C2: document the uuid rule only, or tighten `sessionId` to `z.uuid()` now. Both apps.
- **D12.** Approve E2–E4 and review E1, built as part of this slice (2026-10-18). The question of
  whether E4 lands before or after `engine/surrealdb` no longer applies, since that branch has landed.
- **D13.** C1's error codes, and which HTTP statuses the engine uses for "Recall rejected" versus "outcome unknown".
  Both apps.
- **D14.** The engine's timeout budget for `/internal/sessions`. Recall's create-bot call is a few seconds. The api's
  client timeout (proposed: 20 s) must be longer than the engine's own timeout.

## Timeline
The submission is due 2026-10-25, 11:59 PM ET, eight days from this plan. Steps 0, 1, 2, 4 and 5 are small, about
half a day to a day each. Two parts are at risk:

- **Step 3 (database), now on SurrealDB, is about a day.** It's two packages instead of Postgres's four. A spike on
  2026-10-18 showed everything step 3 needs working on the embedded engine, on Node 24 and TypeScript 7:
  - the schema, upserts, org-scoped reads and a transaction for reuse
  - a fresh test database in about 3 ms

  The risk is a new query language. It's smaller now: the engine's connection and migration code is on `main` to
  copy, and the TypeScript override (O1) is already there. Steps 5 and 6 only see the `Db` functions, so they aren't
  affected.
- **A demo needs the Cloud instance** with database `api` and its user (I-2). It takes minutes to set up, as part of
  the engine plan's runbook. Have it by about 2026-10-22, together with the engine items below.
- **A real end-to-end meeting depends on work outside the api:** E1–E4 in the engine, C1 in contracts, and the
  infra items for a deploy. The api can be finished and tested against the fake engine without them. But a demo where
  the web app starts a real bot needs E1 and E3 by about 2026-10-22 to leave time to test with real meetings.
  E1 is built as part of this slice (with E4, which it needs), on top of steps 3, 5 and 6.

If time runs short, the order to cut is: `GET /v1/sessions/:id`, then session reuse (D7), then `GET /v1/me`. Auth,
create and list stay.

## Later: memory across meetings (SurrealDB)
Not in this slice and not scheduled. There's a hackathon prize for agent memory, so this is a sketch of how Builder
could remember things from one meeting to the next. It needs a go-ahead first, and it's mostly engine work.
ADR 0011 already places memory in the same SurrealDB Cloud instance, in a design of its own later.

**What's worth remembering.** Each session already ends with a decision document (spec §11):
- `decisions[]`, which records who proposed and who agreed
- `open_questions[]`
- the prototype's component tree
- rejected options

Remembering these per org lets the next meeting start with "last time you agreed X, and Y was still open", and lets
the build loop reuse components the org already approved.

**Two ways to build it:**
1. **SurrealDB Agent Memory**, SurrealDB's hosted memory layer.
   - `remember` stores text with scopes. `recall` returns the top hits for a query within a "lens" of scopes. Behind
     it are a knowledge graph, hybrid search, and facts that record where they came from and when they held.
   - The TypeScript client is `@surrealdb/memory`. It's still an alpha (1.0.0-alpha.11 on 2026-10-18) and has no
     runtime dependencies.
   - It runs only on SurrealDB Cloud, reached with an endpoint and an `sp-…` API key. The docs say there's no
     in-process version, so tests would need a fake of its HTTP API, like our fake engine.
   - Least code, and the most direct fit for the prize.
2. **Our own memory tables in SurrealDB**, in the engine's database.
   - Store each agreed decision with an embedding.
   - Use an `HNSW` vector index, a `FULLTEXT ... BM25` index, and `search::rrf()` to combine the two.
   - Use `RELATE` edges such as decision → affects → component.
   - It runs on the embedded engine in tests and needs no alpha package. It's more code, and we choose the embedding
     model ourselves.

**Rules either way:**
- **Scoped to one org, always.** Every write and every recall carries `org/<orgId>` from the engine's session, never
  from the model. Test that one org's recall never returns another org's memory. This is the same rule as E3.
- **Memory is context, not agreement.** A recalled decision is shown as "from an earlier meeting". It's never marked
  agreed in the current meeting. Agreement still has to come from what people say in this meeting (spec §4, "the
  agent invents agreement").
- **Only agreed decisions and open questions are stored**, not raw transcript text. Logs record ids and counts only
  (AGENTS.md).
- **Orgs can turn it off, and deleting an org deletes its memory** (ADR 0006, ADR 0008). With option 1, meeting
  content goes to SurrealDB Cloud, so `docs/security/` has to say so.
- **The engine owns memory.** ADR 0008 keeps transcripts and decision documents out of the api. The api would only
  hold the org's on/off setting and ask the engine to delete memory when an org is deleted.

**A small version for the demo**, if the prize is worth a shot:
1. When a session ends, the engine writes its agreed decisions and open questions to memory, scoped to the org.
2. When the next session in that org starts, it recalls the top few for the meeting's first topic.
3. The conversation model gets them as "from earlier meetings". The stage can show one line for it.

This needs E1 and E3 first. Building it is D18: option 1 or option 2, and whether it's worth doing
before 2026-10-25.
