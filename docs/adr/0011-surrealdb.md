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
2. **SurrealDB for everything, self-hosted on Render** as a private service with a disk. Stays on Render's private
   network. We'd run the database ourselves, including backups: Render's docs say not to restore a disk snapshot that
   backs a database, so backups would be our own scheduled `surreal export`. A service with a disk runs as one
   instance and has an outage on each deploy. About $7.25 a month.
3. **SurrealDB for everything, on SurrealDB Cloud.** Managed by SurrealDB: daily backups, upgrades and monitoring.
   The first instance is free (0.25 vCPU, 512 MB memory, 1 GB storage), and a small instance is about $15 a month. The
   database is outside Render, so queries cross the public internet over TLS. Private networking is a paid add-on.

SurrealDB for everything means one database for business data and memory: records, graph relations and vector
indexes in one query language, so memory can relate a decision to its meeting, org and people without copying them.
It's a build-week sponsor with its own prize category.

## Decision
Option 3.
- **One SurrealDB Cloud instance** on the Start plan, in AWS `us-east-1`, next to Render's Virginia region and
  Recall's `us-east-1` (ADR 0005). SurrealDB 3.3.2, the only version Cloud offers for new instances; local, CI and
  the in-process engine pin the same version. The apps connect over `wss://` with its instance URL. The URL and
  credentials are secrets in Render's environment.
- **One namespace, `builder`, with one database per app: `engine` and `api`.** Each app owns its database and its
  schema. Neither reads the other's. **Each app signs in as a database-level user** of its own database, so the api
  can't read transcripts and a leaked engine password exposes only the engine's data. Root credentials are for
  setting up users in Surrealist (the Cloud dashboard) and are never given to an app.
- **Schemas are SurrealQL files** (`DEFINE TABLE ... SCHEMAFULL`, `DEFINE FIELD`, `DEFINE INDEX ... UNIQUE`) in each
  app's `db/` folder, applied in order by a small runner that records what it applied in a table in the same
  database. Each app runs it as its pre-deploy command. There's no shared database package (ADR 0004).
- **Clients:** the `surrealdb` JavaScript SDK in staging and production. Tests, smoke and local mode use the same SDK
  with `@surrealdb/node`, which runs SurrealDB in-process: in memory for tests, on a local folder for
  `npm run local`. CI and laptops need no database install or Cloud account.
- **The engine's store becomes async,** as ADR 0007 already required. Ordering that matters, such as writing the
  scheduling intent before calling Recall, deduplication by Recall message id (a unique index), and conditional
  token updates, needs tests with concurrent events. This lands before the first deploy, so production never holds
  SQLite data.
- **Staging** gets its own instance or its own namespace, decided when staging is set up.
- **Memory** (vectors and relations across meetings) goes in the same instance, in a design of its own later.

## Consequences
- One database for business data and memory, and nobody on the team operates it.
- **Backups are SurrealDB Cloud's daily managed backups.** The free instance keeps one day by default; the plan
  allows up to seven. Raise it, and check a restore into a new instance works, before the first customer.
- **The free instance is for development and evaluation.** It can't grow past 1 GB, and it pauses itself after seven
  days without use, after which it is unreachable until resumed. Fine for the hackathon. Move to a paid instance
  (about $15 a month) before customers depend on it.
- **The database is reachable from the internet,** protected by TLS and its credentials. Use a long generated
  password per app user, never root in an app. Look at Cloud's IP allowlisting or private networking before the
  first customer.
- **Every query crosses the internet** from Render to the Cloud region, which adds latency to each Recall event the
  engine stores. Choose regions next to each other, and measure it in the first real meeting.
- **Cost:** $0 on the free instance at launch, instead of $6 for Render Postgres. A small instance is about $15 a
  month when we outgrow it or need it to stay up. A second vendor account and bill.
- SurrealDB is less familiar to the team than Postgres, and its tooling for business data is younger. Keep each app's
  queries in its `db/` folder so a later move touches one folder.
- The in-process engine is the same SurrealDB build as the Cloud server only when their versions match. Pin the SDKs
  to the Cloud instance's version, and run each app's tests against a real server in CI.
- Deleting an org is still done by each app in its own database. The api asks the engine to delete that org's
  sessions (ADR 0008).
- Follow-up: the engine owner ports `store.ts`. The infra owner adds the Cloud connection to `render.yaml` as secrets
  and writes the runbook for creating the instance and its users. The api owner writes the api's first schema (orgs,
  users, memberships, meetings, usage) in SurrealQL instead of Drizzle (ADR 0010).
