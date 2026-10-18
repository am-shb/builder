# Plan: engine storage on SurrealDB, Render deploy

**Spec:** [ADR 0011](../../adr/0011-surrealdb.md) (SurrealDB for both apps) and [ADR 0005](../../adr/0005-hosting-on-render.md)
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
- Pin exact versions: the server image `surrealdb/surrealdb:v3.3.4`, and SDK versions whose embedded engine matches
  that server's major and minor version as closely as published packages allow. Record what you chose and why.
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
   - `SURREAL_URL` set (for example `ws://builder-surreal:8000`): connect with `SURREAL_USER` and `SURREAL_PASS`.
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

## Task 2: Render Blueprint and deploy runbook (ADR 0005, ADR 0011)
Branch `infra/render`, from `engine/surrealdb`.

1. **Take from `archive/infra-render`:** the `RENDER_EXTERNAL_URL` fallback in `loadConfig` and its test, the runbook's
   "Deploy to Render" section, and the shape of `render.yaml` (no `rootDir`, `buildFilter` with `.nvmrc`,
   `npm ci --workspace @builder/engine --include-workspace-root`, `healthCheckPath`, `sync: false` secrets). Replace
   every Postgres part.
2. **`builder-surreal`:** a private service (`type: pserv`) from the image `docker.io/surrealdb/surrealdb:v3.3.4`,
   starter plan, one instance, a 1 GB disk, started with the `surrealkv` engine on a path on that disk. Root
   credentials from the service's environment, the password generated by Render, never in the file. Check Render's
   Blueprint spec for how a start command overrides an image's entrypoint, and whether the image's user can write to
   the disk's mount path; fix either in the Blueprint, not with a custom image, if you can.
3. **`builder-engine`:** `SURREAL_URL` built from `builder-surreal`'s private host and port, `SURREAL_USER` and
   `SURREAL_PASS` from that service (`fromService`), `preDeployCommand` running the migrations. Same region as the
   database.
4. **Runbook:** creating the Blueprint, the secrets to enter, how to check the deploy, that the database has no
   backup until the export job exists (ADR 0011), and how to reach the database for debugging without a public URL.
5. Validate `render.yaml` against Render's Blueprint schema if a validator is available, and say in the report
   whether you could.

Done when: `npm run check` passes and the Blueprint, as written, would create both services with no secret in the
repo. Nothing is created on Render in this task: that needs the repo owner.
