# Plan: repo reorg, engine move, Postgres, Render deploy

**Spec:** the accepted direction in `docs/adr/0004` to `0009` (proposed, approved by Amir on 2026-10-17). Behavior of
the engine is set by `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md` and must not change.

**Branches:** stacked, one per task, each opened as its own PR later.
`adr/foundation-decisions` → `reorg/workspaces` (Task 1) → `reorg/move-engine` (Task 2) → `engine/postgres` (Task 3)
→ `infra/render` (Task 4). The controller creates each branch before dispatching its task.

## Global constraints
- Node 24 or newer, TypeScript run natively by type stripping, no build step for the engine or `contracts/`.
  Erasable syntax only (no enums, namespaces, parameter properties). `.ts` extensions in relative imports.
- `npm run check` (typecheck, all tests, smoke) must pass at the end of every task. Browser tests skip without Chrome;
  that's expected.
- Never commit `.env`. Never print, paste or log secrets. Never log transcript text, prompts or model output: log ids,
  counts and error codes only.
- Never run anything that costs money: `scripts/probe-*.ts`, `npm run replay -- --live-models`, real Recall bots,
  creating paid cloud resources.
- Engine behavior doesn't change, except what a task states.
- Accepted ADRs (`0001`, `0002`, `0003`), the spec, plans and `docs/known-issues.md` are historical. Don't rewrite their
  paths. Living docs (README, AGENTS, CONTRIBUTING, runbooks, workstreams, app READMEs) must match the new layout.
- Commits end with these two lines, after a blank line:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01V1mTyUYAxtHNmf8f1nNQFh`
- Writing style for docs: plain, short sentences, no em dashes, match the existing docs' voice.

## Task 1: Reorg to the ADR 0004 layout (engine stays at the root)
Goal: the repo has the final top-level shape around the engine, which still lives at the root until Task 2.

1. Delete the placeholder areas: `services/` (all six), `apps/admin/`, `packages/`, `db/`, `infra/`. Before deleting,
   fold anything useful from their READMEs into the new homes:
   - `services/meeting-engine/README.md` → `apps/engine/README.md` (update its "Where the code is today" to say the
     code moves here in the next PR; keep open decisions; mark the scaling question as tracked by ADR 0005/0007).
   - `services/api`, `services/auth`, `services/billing`, `services/worker`, `services/notifications`, `db` →
     one `apps/api/README.md` brief: purpose, folders `src/{routes,auth,db,billing,notifications,jobs}`, in/out of
     scope, links to ADRs 0006 to 0009, first tasks.
   - `apps/web/README.md` + `apps/admin/README.md` → one `apps/web/README.md` (admin = staff-only pages, ADR 0006).
     The framework is still open: its owner records it in an ADR.
   - `packages/shared/README.md` → `contracts/README.md`, rewritten for ADR 0004's rules (schemas only, both owners
     review, additive changes, the three-step breaking change).
   - `infra/README.md` → fold into `docs/runbooks/README.md` (deploy and environments section, pointing at ADR 0005).
   - `e2e/README.md` stays.
2. npm workspaces: root `package.json` gains `"workspaces": ["apps/*", "contracts"]`. The root is still the engine
   package for now (its name, deps and scripts stay). Root `check` becomes: the engine's typecheck, test and smoke,
   then `npm run check --workspaces --if-present`.
3. `tsconfig.base.json` at the root with the shared strict compiler options from `tsconfig.json` (ADR 0001). The
   root `tsconfig.json` extends it and keeps its `include`. Each new workspace's `tsconfig.json` extends it too.
4. `contracts/` workspace, `@builder/contracts`, `"type": "module"`, `exports` → `./src/index.ts`, dependency `zod`
   (same major as the engine). Content: the ADR 0008 shapes as zod schemas with inferred types:
   `StartSessionRequest` (`sessionId`, `orgId`, `meetingUrl`, `limits: { maxUsd, maxMinutes }`),
   `StartSessionResponse` (`sessionId`, `status`, `stageUrl`), and an `EngineEvent` discriminated union on `type`:
   `session.status` (status: joining, in_meeting, ended, failed; optional `errorCode`), `session.usage` (cumulative
   `botMinutes`, `modelUsd`, `ttsChars`), `handoff.ready` (`handoffId`, `url`). Every event has `id`, `sessionId`,
   `orgId`, `at` (ISO string). Parsing must ignore unknown keys (zod default), and a helper or documented pattern
   must let a receiver skip unknown event types without throwing. Tests with `node:test` cover a valid parse of each
   shape, a rejection, and the unknown-type case. Scripts: `typecheck`, `test`, `check`.
5. `apps/api` workspace, `@builder/api`, private, `"type": "module"`. `src/server.ts`: a plain `node:http` server
   with `GET /health` → 200 `{ "ok": true }`, port from `PORT` (default 3001), exported `createServer()` so a test can
   start it on an ephemeral port. Empty folders aren't committed: create only what has code, and list the planned
   folders in the README. Depends on `@builder/contracts` (import one type somewhere real, e.g. re-exported in a
   `src/contracts.ts`, so the workspace link is exercised by the type check). Test for `/health`. Scripts: `start`,
   `typecheck`, `test`, `check`.
6. `apps/web` workspace: `package.json` (`@builder/web`, private) with no dependencies and a `check` script that
   exits 0 with a short message, plus the README. No framework yet.
7. Update living docs: `docs/workstreams.md` area table becomes the four lanes (engine `apps/engine/`, web
   `apps/web/`, api `apps/api/`, infra and quality `render.yaml`, CI, `e2e/`, `docs/security/`, `docs/runbooks/`),
   plus `contracts/` (engine and api owners together). Keep the decisions list and the "Before any shared deployment"
   section. `.github/CODEOWNERS`: commented template lines for the new paths, with `/contracts/` listing both owners.
   `AGENTS.md`: the "Before you start" and "Current stack" sections describe apps + contracts and the "shared only when
   two apps import it" rule. `README.md` repo-layout table. `CONTRIBUTING.md` if it names old paths.
8. `npm install` to update `package-lock.json`. `npm run check` passes. Commit.

## Task 2: Move the engine to `apps/engine`
Goal: one PR that only moves files and fixes paths. Behavior identical.

1. `git mv` `src/`, `public/`, `test/`, `scripts/` and `.env.example` into `apps/engine/` (history must follow).
2. `apps/engine/package.json`: name `@builder/engine`, private, `"type": "module"`, `engines` node >=24, the engine's
   runtime dependencies (`@anthropic-ai/sdk`, `ws`, `zod`) and `@types/ws` dev dependency, and the engine scripts
   (`start`, `local`, `smoke`, `replay`, `test`, `typecheck`, `check`, `tunnel`) with the same commands as today
   relative to the workspace. `apps/engine/tsconfig.json` extends `../../tsconfig.base.json`, includes
   `src`, `scripts`, `test`.
3. Root `package.json` becomes the workspace root only: name `builder`, private, workspaces, `engines`, dev
   dependencies shared by all (`typescript`, `@types/node`). Scripts: `check` = `npm run check --workspaces
   --if-present`; `typecheck` and `test` likewise across workspaces; aliases `start`, `local`, `smoke`, `replay`,
   `tunnel` that forward to `@builder/engine` (`npm run <x> -w @builder/engine --`). Remove the root `tsconfig.json`
   if nothing needs it (keep `tsconfig.base.json`).
4. Working directory: npm runs workspace scripts with the workspace as cwd, so `.env` and `data/` are now read from
   `apps/engine/`. Keep that (ADR 0004: each app has its own `.env`). If the developer's root `.env` or `data/` exists
   locally, don't touch or move it (it's git-ignored); document the move in the README. `.gitignore` patterns must
   still cover `apps/engine/.env` and `apps/engine/data/`.
5. CI (`.github/workflows/ci.yml`): both jobs keep working from the repo root (`npm ci`, `npm run typecheck`,
   `npm test`, `npm run smoke` via the root aliases or `npm run check`). Browser job still points tests at Chrome.
6. Fix every living-doc path (README commands and layout, AGENTS, CONTRIBUTING, runbooks, `apps/engine/README.md`
   "Where the code is", workstreams, CODEOWNERS) to `apps/engine/...`. Root commands in docs keep working thanks to
   the aliases.
7. `npm install`, `npm run check` passes, and `node apps/engine/src/server.ts --smoke` prints SMOKE OK. Commit.

## Task 3: Engine storage from SQLite to Postgres (ADR 0007)
Goal: `apps/engine/src/store.ts` keeps the same data in Postgres. Production uses `DATABASE_URL`; tests, smoke and
local mode use PGlite in-process. Engine behavior is unchanged.

1. Dependencies (engine only): `drizzle-orm`, `pg`, `@electric-sql/pglite`; dev: `drizzle-kit`, `@types/pg`. Check
   each package's current version on npm before adding; all must load under Node type stripping as ESM.
2. Schema in Drizzle (`apps/engine/src/db/schema.ts`) inside `pgSchema("engine")`, mirroring today's SQLite tables
   and columns, types and constraints (unique `bot_id`, unique `recall_msg_id`, foreign keys). Use Postgres-native
   types where it's a straight mapping (identity ids, `text`, `timestamptz` or keep ISO text if the code relies on
   string timestamps: choose and state it). Migrations generated by drizzle-kit into `apps/engine/drizzle/`, committed,
   plus `apps/engine/drizzle.config.ts`. A `migrate` function applies them at startup for PGlite and as an
   `npm run migrate -w @builder/engine` script for Postgres (Render pre-deploy, Task 4).
3. `openStore` becomes async and returns a store whose methods are async. Today's API names and return shapes stay,
   so the change at call sites is `await`. Driver selection: `DATABASE_URL` set → `pg` Pool through Drizzle;
   otherwise PGlite (in-memory for tests and smoke, a data directory such as `data/local-pg` for `--local` and for
   `npm start` without `DATABASE_URL`). `config.dbPath` is replaced or reinterpreted accordingly: update
   `loadConfig`, `loadLocalConfig` and their tests. `.env.example` documents `DATABASE_URL`.
4. Every caller in `src/` and `test/` awaits the store. Watch for:
   - Ordering that today relies on synchronous calls: the scheduling intent is written before calling Recall
     (`store.ts` header); dedupe of realtime events by Recall message id; anything that reads then writes. Keep the
     guarantees: use a unique constraint plus `ON CONFLICT DO NOTHING`, or a transaction, not read-then-write.
   - Callbacks that were synchronous (event handlers, WebSocket handlers, timers): an un-awaited promise must not
     swallow errors. Every fire-and-forget call gets a `.catch` that logs an error code, never content.
5. New tests: concurrent delivery of the same Recall event twice stores it once; two different events delivered
   concurrently both store in order of arrival per session where the code relies on order; the intent row exists
   before the Recall client is called (use the fake Recall). Existing tests all pass on PGlite.
6. Smoke still boots on PGlite and prints SMOKE OK. `npm run check` passes. No `node:sqlite` import remains.
   Update `apps/engine/README.md` (storage row) and add a short "Database" section to `docs/runbooks/README.md`.
   Commit.

## Task 4: Render Blueprint and deploy runbook (ADR 0005)
Goal: everything needed so a human can create the Render services from the repo, with no secrets in git. The actual
creation of paid resources is done by the human, not by this task.

1. `render.yaml` at the repo root (Render Blueprint spec; check field names against Render's docs at
   https://render.com/docs/blueprint-spec before writing): 
   - Postgres `builder-db`, plan `basic-256mb`, one region shared by all services (`oregon`, nearest Recall's
     `us-west-2` region in `.env.example`).
   - Web service `builder-engine`, runtime node, plan `starter`, no disk, `numInstances: 1`, no `rootDir`. Build:
     `npm ci --workspace @builder/engine --include-workspace-root`. Pre-deploy: the engine's migrate script. Start:
     the engine's start script. Health check path: an existing cheap route, or add `GET /healthz` returning 200 with
     no data (add a test). `buildFilter.paths`: `apps/engine/**`, `contracts/**`, `package.json`,
     `package-lock.json`, `render.yaml`. Env vars: `DATABASE_URL` from the database's internal connection string;
     `NODE_ENV=production`; secrets `RECALL_API_KEY`, `RECALL_WEBHOOK_VERIFICATION_SECRET`, `OPENROUTER_API_KEY`
     as `sync: false`; `RECALL_REGION`, `TTS_VOICE`, `BOT_VARIANT` as `sync: false` too.
   - `PUBLIC_API_BASE_URL`: Render sets `RENDER_EXTERNAL_URL` on web services. Make `loadConfig` fall back to
     `RENDER_EXTERNAL_URL` when `PUBLIC_API_BASE_URL` is empty, with a test, so no manual URL step is needed.
   - No api or web service yet (nothing to run); a comment says where they go.
2. Confirm the engine binds to `PORT` from the environment (Render sets it) on `0.0.0.0`.
3. `docs/runbooks/README.md`: "Deploy to Render" section: create the Blueprint from the dashboard (New → Blueprint,
   pick the repo and branch), fill the `sync: false` secrets in the dashboard, what the first deploy does (migrate,
   start), how to check health, how to roll back, and the known limits from ADR 0005 (an engine deploy ends live
   meetings; the operator page `/` and `/api/*` refuse proxied requests, so on Render nobody can start a session until
   the api and Clerk exist or an interim operator token is decided). Costs: Pro workspace + starter + basic-256mb.
4. `npm run check` passes. Commit.
