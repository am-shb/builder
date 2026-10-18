# 0007: Postgres for both apps, one schema each

- **Status:** superseded by [ADR 0011](0011-surrealdb.md)
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** database (`apps/api/src/db`, the engine's `store.ts`)

## Context
Blocking decision 4 in [workstreams.md](../workstreams.md). The api needs somewhere to keep orgs, members, meetings,
usage and billing state. The engine stores each session in SQLite (`node:sqlite`, `store.ts`): scheduling intents,
bot status, transcript events, the decision document, the prototype and model calls. SQLite ties the engine to one
disk, which means two backup stories, a disk that blocks zero-downtime deploys, and deletion in two kinds of store.
Nothing is deployed yet, so moving now costs a schema port and no data migration.

## Options considered
1. **Postgres for the api, SQLite stays in the engine.** No engine change now. Keeps the costs above.
2. **Postgres for both, in one instance, one schema and role per app.** One database to back up and run. Each app
   still owns its tables. Costs an async rewrite of `store.ts`.
3. **A separate Postgres instance per app.** The strongest isolation, at twice the cost and twice the operations.
4. **SurrealDB.** A sponsor, with an agent memory product. Less familiar to the team for plain business data. It's
   for cross-meeting memory, in its own ADR.

## Decision
Option 2.
- **One Render Postgres instance (ADR 0005) with two schemas, `engine` and `api`.** Each app connects as its own role,
  which has rights only on its own schema. The api can't read transcripts. That enforces ADR 0008 in the database,
  not just by convention.
- **Each app owns its schema and migrations,** in its own folder, with the same tool: Drizzle ORM and drizzle-kit.
  Schemas are plain TypeScript, so they need no build step. There's no shared database package, because the apps
  share no tables (ADR 0004).
- Migrations run as each app's pre-deploy command.
- **The engine's store becomes async.** About 36 calls in `src/` become `await`. Today a store call can't be
  interrupted. After this, two Recall events can interleave at each `await`. Ordering that matters, such as writing
  the scheduling intent before calling Recall, and deduplication by Recall message id, needs tests with concurrent
  events. This lands before the first deploy, so production never holds SQLite data.
- **Tests and local mode use PGlite,** Postgres compiled to WASM that runs in-process. Tests stay fast, and
  `npm run local` needs no database install. Staging and production use Render Postgres.

## Consequences
- One backup story: Render's point-in-time recovery.
- Deleting an org is one job in one database, but still done by each app in its own schema. The api asks the engine
  to delete that org's sessions (ADR 0008).
- Postgres doesn't make the engine scalable by itself, because session state also lives in memory. It does make it
  possible to rebuild a session from stored events on another instance (ADR 0005).
- PGlite is close to real Postgres but not identical. Run the engine's and api's tests against a real Postgres in CI
  once both exist.
- Follow-up: the engine owner ports `store.ts`. The api owner writes the first schema (orgs, users, memberships,
  meetings, usage). Record a retention period for session data in `docs/security/`.
