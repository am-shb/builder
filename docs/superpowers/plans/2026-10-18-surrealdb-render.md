# Plan: engine storage on SurrealDB, Render deploy

**Spec:** [ADR 0011](../../adr/0011-surrealdb.md) (SurrealDB Cloud for both apps) and [ADR 0005](../../adr/0005-hosting-on-render.md)
(Render). Behavior of the engine is set by `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md` and
must not change.

**Branches:** stacked, one PR each. `docs/adr-surrealdb` (ADR 0011, this plan) → `engine/surrealdb` (Task 1) →
`infra/render` (Task 2).

**Earlier work to reuse.** The Postgres attempt was closed unmerged but its commits are kept on local branches:
- `archive/engine-postgres` (`459464a`): the engine's store made async, every caller awaited, a per-session serial
  queue and a per-meeting queue, `test/store.test.ts`, `test/concurrency.test.ts`, `test/helpers/store.ts`, closing
  the store on SIGINT/SIGTERM, all tests updated. 269 tests passed. Only `src/db/*`, `drizzle/`, `drizzle.config.ts`,
  the Drizzle/PGlite/pg dependencies and the `DATABASE_URL`/`PGLITE_DIR` config are Postgres-specific.
- `archive/infra-render` (`248f316`, on top of the above): `render.yaml`, the deploy runbook, the
  `RENDER_EXTERNAL_URL` fallback in `loadConfig` with its test, and `src/error-code.ts` (reads a code from an error
  or its `cause`, never its message).

`apps/engine/` on `main` is identical to the base those branches were cut from, so their engine files apply cleanly.

## Global constraints
- Node 24+, TypeScript by type stripping, no build step, erasable syntax only, `.ts` extensions in imports.
- `npm run check` (root) passes before every commit that ends a task. The suite must exit on its own, without
  `--test-force-exit`: close every database a test opens.
- Never log transcript text, prompts or model output, and never an error's message from the database (it can echo
  query values). Log ids, counts and error codes.
- Never commit `.env` or a secret. Never run anything that costs money (probes, live replays, real bots).
- Pin exact SDK versions whose embedded engine matches SurrealDB Cloud's server version (target v3.3.4) as closely
  as published packages allow. Record what you chose and why.
- Engine behavior, routes and the store's guarantees don't change.

## Task 1: Engine storage from SQLite to SurrealDB (ADR 0011)
Branch `engine/surrealdb`, from `docs/adr-surrealdb`.

Goal: `apps/engine/src/store.ts` keeps the same data in SurrealDB. Production connects to a server; tests, smoke and
local mode run SurrealDB in-process. Engine behavior is unchanged.

1. **Start from the async work.** Take every non-Postgres engine change from `archive/engine-postgres` (callers,
   tests, helpers, shutdown). Don't take `src/db/*`, `drizzle/`, `drizzle.config.ts` or the Drizzle/PGlite/pg
   dependencies. Rewrite only the storage layer under the same async `Store` interface.
2. **Dependencies (engine only):** `surrealdb` and `@surrealdb/node`. If npm rejects a peer range (the SDK's
   `typescript` peer predates TypeScript 7), fix it with a scoped `overrides` entry in the root `package.json`, not a
   global `legacy-peer-deps`. `npm ci` must work from a clean checkout.
3. **Connection** (`apps/engine/src/db/connect.ts`): namespace `builder`, database `engine`.
   - `SURREAL_URL` set (production: a SurrealDB Cloud `wss://` URL): sign in with `SURREAL_USER` and `SURREAL_PASS`
     as a database-level user of `builder`/`engine`, or as root when `SURREAL_AUTH=root` (a local server only).
   - Unset: the in-process engine, `surrealkv://` on `SURREAL_PATH` (default `data/surreal` under `apps/engine/`,
     git-ignored) for `npm start` and `npm run local`, and `mem://` for tests and smoke.
   - Connect, sign in and select the namespace and database at startup. Fail at startup with a clear error code if the
     server can't be reached. Close cleanly.
4. **Schema** in SurrealQL, `apps/engine/db/0001_init.surql`: `SCHEMAFULL` tables mirroring today's SQLite tables
   and columns, with unique indexes where SQLite had unique constraints (`bot_id`, `recall_msg_id`). State how ids and
   timestamps map, and keep the values `Store` returns the same types as today.
5. **Migrations** (`apps/engine/src/db/migrate.ts`): apply `db/*.surql` in name order, each once, recording the name
   and time in a `migration` table in the same database, each file in one transaction. Runs at startup for in-process
   databases, and as `npm run migrate -w @builder/engine` for the server (Render pre-deploy, Task 2). Running it twice
   is a no-op.
6. **Guarantees that must still hold, each with a test:** a duplicate Recall message id is stored once (unique index,
   the duplicate ignored, not an error); the scheduling intent is written before Recall is called; token issuing is a
   conditional update, so two concurrent issues can't both succeed; the per-session and per-meeting queues still
   order writes. Reuse `test/store.test.ts` and `test/concurrency.test.ts`.
7. **Error codes:** add `src/error-code.ts` (take it from `archive/infra-render`) and make it read SurrealDB SDK
   errors' code or kind as well. Database errors are logged by code only. Test it with a real SurrealDB error from
   the in-process engine.
8. **Docs:** the engine README's storage section, `apps/engine/.env.example` (`SURREAL_URL`, `SURREAL_USER`,
   `SURREAL_PASS`, `SURREAL_PATH`), the stack line in `AGENTS.md` (`node:sqlite` → SurrealDB), and
   `docs/security/README.md` if it names the engine's storage.

Done when: `npm run check` passes from a clean `npm ci`, the suite exits on its own, `npm run local` starts and
survives a restart with its data, and `npm run migrate -w @builder/engine` against a local `surreal start` server is
idempotent (if the `surreal` binary isn't installed, say so in the report instead).

## Task 2: Containers, local docker-compose, Render Blueprint and CD (ADR 0005, ADR 0011)
Branch `infra/render`, from `engine/surrealdb`. Production only for now (repo owner, 2026-10-18); staging is added to
the Blueprint later. Everything in US East, next to each other and near the team in Toronto (repo owner, 2026-10-18):
Render region `virginia`, SurrealDB Cloud AWS `us-east-1`, Recall `us-east-1` (`RECALL_REGION=us-east-1`, a plain
value in the Blueprint).

1. **Images.** `apps/engine/Dockerfile` and `apps/api/Dockerfile`, both built with the repo root as context (so
   `contracts/` is there), from `node:24-slim` pinned by minor version and matching `.nvmrc`, installing only that
   app's workspace (`npm ci --workspace @builder/<app> --include-workspace-root --omit=dev`), running as the
   non-root `node` user, `CMD` the app's `start` script. A root `.dockerignore` keeps out `node_modules`, `.env*`,
   `data/`, `.git`, `.claude`, `.superpowers`. The same images run locally and on Render.
2. **SurrealDB setup script** `infra/surrealdb/setup.surql`: defines namespace `builder`, databases `engine` and
   `api`, and a database-level user for each (`engine`, `api`) with role `OWNER` on its own database only, the
   passwords taken from parameters (`$engine_pass`, `$api_pass`), never written in the file. Idempotent. The runbook
   uses it in Surrealist for Cloud, and compose uses it locally.
3. **`docker-compose.yml`** at the root, for running the whole stack on a laptop:
   - `surrealdb`: `surrealdb/surrealdb:v3.3.4`, `surrealkv` on a named volume, root user and password from compose
     variables with obvious dev-only defaults, port 8000 on localhost only, a health check.
   - `surrealdb-setup`: one-shot, runs `setup.surql` against it with dev passwords, after it's healthy.
   - `engine`: the engine image, `SURREAL_URL=ws://surrealdb:8000`, `SURREAL_AUTH=database`, the engine user, runs
     the migrations then starts. Local mode by default (no Recall), with `apps/engine/.env` loaded if present for a
     real run. Port 3000.
   - `api`: the api image, `ENGINE_INTERNAL_URL=http://engine:3000`, a dev internal token, `apps/api/.env` if
     present. Port 3001.
   - `docker compose up` works on a fresh clone with no `.env` files. Document it in the root README.
4. **`render.yaml`** (Blueprint), production only, region `virginia`, starter plans, `runtime: docker` with the
   Dockerfiles above:
   - `builder-engine`: public web service, `healthCheckPath /healthz`, `preDeployCommand` running the engine's
     migrations, `SURREAL_URL`/`SURREAL_USER`/`SURREAL_PASS` and the Recall and OpenRouter keys as `sync: false`.
   - `builder-api`: public web service, `healthCheckPath /health`, `ENGINE_INTERNAL_URL` from `builder-engine`'s
     private host and port (`fromService`), Clerk variables as `sync: false`.
   - An environment group shared by both holding the internal token, `generateValue: true`
     (`ENGINE_INTERNAL_TOKEN` on the api; the engine reads the same value when its `/internal/*` routes land).
   - Take from `archive/infra-render`: no `rootDir`, `buildFilter` per service (its app, `contracts/**`,
     `package*.json`, `.nvmrc`, its Dockerfile), and the `RENDER_EXTERNAL_URL` fallback in the engine's `loadConfig`
     with its test.
   - **CD:** `autoDeployTrigger: checksPass` on `main` for both, so Render deploys a commit only after CI passes on it.
     A failed health check keeps the old instance serving. Pre-deploy migrations run before the new instance starts.
5. **CI additions** (`.github/workflows/ci.yml`): a job that builds both images, and a job that runs the engine's store
   and concurrency tests and `npm run migrate -w @builder/engine` (twice) against a real `surrealdb/surrealdb:v3.3.4`
   service container, using the same setup script (ADR 0011: test against the real server).
6. **Runbook** (`docs/runbooks/README.md`): create the SurrealDB Cloud instance (Start plan, free, AWS `us-east-1`); create the Recall workspace in `us-east-1`
   and its webhook endpoint pointing at the engine,
   run `setup.surql` in Surrealist with generated passwords, check daily backups are on; create the Blueprint in the
   Render dashboard from `main`; the secrets to enter where; how CD works; how to roll back (Render dashboard,
   redeploy a previous deploy) and what that does not undo (migrations are forward-only); how to check a deploy.
7. Validate `render.yaml` against Render's Blueprint schema if a validator is available, and `docker compose config`.
   Say in the report what you could validate.

Done when: `npm run check` passes, `docker compose up` brings up all four services healthy on a fresh clone with no
`.env`, both images build, and the Blueprint as written would create both services with no secret in the repo.
Nothing is created on Render or SurrealDB Cloud in this task: the controller does that with the repo owner.
