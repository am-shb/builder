# 0011: SurrealDB for both apps, one database each

- **Status:** proposed
- **Date:** 2026-10-18
- **Deciders:** Amir Shahbandegan
- **Area:** database (`apps/api/src/db`, the engine's `store.ts`), infra
- **Supersedes:** [ADR 0007](0007-database.md)

## Context
ADR 0007 chose Postgres for both apps and kept SurrealDB for cross-meeting memory, in its own ADR later. That means
two databases to run, back up and learn, and the memory feature would need its own copy of the orgs, sessions and
decisions that already live in Postgres. The engine's port to Postgres was finished but not merged, so nothing has
been deployed and no data needs moving. The engine still stores each session in SQLite (`node:sqlite`, `store.ts`).

## Options considered
1. **Postgres for both apps, SurrealDB later for memory (ADR 0007).** Familiar, managed by Render with backups and
   point-in-time recovery. Two databases once memory lands.
2. **SurrealDB for everything.** One database for business data and memory. Records, graph relations and vector
   indexes in one query language, so memory can relate a decision to its meeting, org and people without copying
   them. A build-week sponsor with its own prize category. Render doesn't offer it managed, so we run it ourselves.
3. **SurrealDB Cloud.** Managed, but the database leaves Render's private network, so every query crosses the
   public internet and the server accepts connections from anywhere.

## Decision
Option 2.
- **One SurrealDB server on Render** (ADR 0005): a private service from the official `surrealdb/surrealdb` image,
  pinned to an exact version, with a persistent disk and the `surrealkv` storage engine. It has no public URL. The
  apps reach it on the private network at `ws://<service>:8000`.
- **One namespace, `builder`, with one database per app: `engine` and `api`.** Each app owns its database and its
  schema. Neither reads the other's. Per-app database users, each with rights only on its own database, come with the
  api; until then the engine connects with the root user from Render's environment.
- **Schemas are SurrealQL files** (`DEFINE TABLE ... SCHEMAFULL`, `DEFINE FIELD`, `DEFINE INDEX ... UNIQUE`) in each
  app's `db/` folder, applied in order by a small runner that records what it applied in a table in the same
  database. Each app runs it as its pre-deploy command. There's no shared database package (ADR 0004).
- **Clients:** the `surrealdb` JavaScript SDK in staging and production. Tests, smoke and local mode use the same SDK
  with `@surrealdb/node`, which runs SurrealDB in-process: in memory for tests, on a local folder for
  `npm run local`. CI and laptops need no database install.
- **The engine's store becomes async,** as ADR 0007 already required. Ordering that matters, such as writing the
  scheduling intent before calling Recall, deduplication by Recall message id (a unique index), and conditional
  token updates, needs tests with concurrent events. This lands before the first deploy, so production never holds
  SQLite data.
- **Memory** (vectors and relations across meetings) goes in the same server, in a design of its own later.

## Consequences
- One database to run, for business data and memory.
- **We operate the database, including backups.** Render snapshots disks daily, but its docs say not to restore a
  snapshot of a disk that backs a database, because it can come back corrupted. Backups have to be `surreal export`
  on a schedule (a Render cron job, under $1 a month) to storage outside the service. Until that exists, losing the
  disk loses the data, which is acceptable only while it holds no customer data. Add it before the first customer.
- A service with a disk runs as one instance and has a short outage on each of its deploys. Pin the image and
  upgrade it on purpose, outside meetings.
- **Cost:** a starter private service ($7) and a 1 GB disk ($0.25 a month) replace Render Postgres ($6).
- SurrealDB is less familiar to the team than Postgres, and its tooling for business data is younger. Keep each app's
  queries in its `db/` folder so a later move touches one folder.
- The in-process engine is the same SurrealDB build as the server only when their versions match. Pin both, and run
  each app's tests against the real server in CI once both apps use it.
- Deleting an org is still done by each app in its own database. The api asks the engine to delete that org's
  sessions (ADR 0008).
- Follow-up: the engine owner ports `store.ts`. The infra owner adds the SurrealDB service to `render.yaml`. The api
  owner writes the api's first schema (orgs, users, memberships, meetings, usage) in SurrealQL instead of Drizzle
  (ADR 0010).
