# Workstreams

This is where everyone coordinates. Each area has a folder, and that folder's README is its brief. To claim an area,
put your name in the Owner column and open a small PR. One owner per area. Anyone can contribute, but the owner reviews.

| Area | Folder | Owner | Status | Depends on |
|---|---|---|---|---|
| Engine (Builder core) | `apps/engine/` | TBD | v0 working | none |
| Web (customer app and staff pages) | `apps/web/` | TBD | not started | api |
| Api (accounts, sessions, billing, jobs) | `apps/api/` | TBD | skeleton (`/health`) | contracts, engine |
| Contracts (schemas between apps) | `contracts/` | engine and api owners together | engine and api shapes written | none |
| Infra and quality | `render.yaml`, CI, `e2e/`, `docs/security/`, `docs/runbooks/` | TBD | CI running (ADR 0001 proposed) | none |

Code becomes its own workspace only when two or more apps import it ([ADR 0004](adr/0004-workspaces-and-repo-layout.md)).
Anything used by one app is a folder inside that app.

## Decisions that block other work

Settle these first, as ADRs in `docs/adr/`:

1. Repo tooling: workspaces, package manager, lint and format. This blocks every new package. CI and type checking
   are proposed in [ADR 0001](adr/0001-ci-and-type-checking.md); workspaces, layout and lint in
   [ADR 0004](adr/0004-workspaces-and-repo-layout.md).
2. Hosting platform and environments. This blocks staging, live tests and webhooks. Proposed in
   [ADR 0005](adr/0005-hosting-on-render.md) (Render).
3. Identity provider and tenancy model. This blocks the API, the apps and billing. Proposed in
   [ADR 0006](adr/0006-identity-and-tenancy.md) (Clerk, org as tenant).
4. Database engine. This blocks the API, billing and the worker. Proposed in [ADR 0011](adr/0011-surrealdb.md)
   (SurrealDB on Render for both apps, one database each), which replaced [ADR 0007](adr/0007-database.md) (Postgres).
5. The boundary between the API and the meeting engine. This blocks the API and the engine's move. Proposed in
   [ADR 0008](adr/0008-api-engine-boundary.md).
6. Pricing model. This blocks billing. Proposed in [ADR 0009](adr/0009-pricing-model.md) (per meeting hour).

## Before any shared deployment

The engine blockers (I1, I5, I6 and I7 in [known-issues.md](known-issues.md)) were fixed on 2026-10-17. These still
stand between v0 and a deployment other people can reach:

1. **The operator surface has no login.** `/` and `/api/*` answer only requests that carry no proxy headers. Behind a
   hosting platform's proxy that means nobody can use them; on a host reachable directly, it means anyone can,
   including sending bots, which costs money. This needs sign-in in the api ([ADR 0006](adr/0006-identity-and-tenancy.md)), or an interim operator token decided in an
   ADR.
2. **The engine runs as one process.** Session state is held in memory and storage is SQLite, so run a single
   instance with a persistent disk until scaling is settled. Proposed in [ADR 0005](adr/0005-hosting-on-render.md) and [ADR 0011](adr/0011-surrealdb.md).
3. **There's no stable public URL.** Recall needs one for webhooks and the stage (decision 2 above).
4. **Nothing caps spend.** No per-session or per-org cost cap exists yet (the api's spend limits, [ADR 0008](adr/0008-api-engine-boundary.md)).
