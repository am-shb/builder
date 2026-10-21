# Workstreams

This is where everyone coordinates. Each area has a folder, and that folder's README is its brief. To claim an area,
put your name in the Owner column and open a small PR. One owner per area. Anyone can contribute, but the owner reviews.

| Area | Folder | Owner | Status | Depends on |
|---|---|---|---|---|
| Engine (Builder core) | `apps/engine/` | TBD | v0 working | none |
| Web (customer app and staff pages) | `apps/web/` | TBD | not started | api |
| Api (accounts, sessions, billing, jobs) | `apps/api/` | TBD | skeleton (`/health`) | contracts, engine |
| Contracts (schemas between apps) | `contracts/` | engine and api owners together | engine and api shapes written | none |
| Session core (logic shared by the web and mobile apps) | `packages/session-core/` | web and mobile owners together | in use by web; mobile next | contracts |
| Infra and quality | `render.yaml`, CI, `e2e/`, `docs/security/`, `docs/runbooks/` | TBD | CI running (ADR 0001 proposed). Dockerfiles, `docker-compose.yml`, `render.yaml` (production, CD on checks pass) and the deploy runbook written. The SurrealDB Cloud instance exists; its users and the Render services are not set up yet | none |

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
   (SurrealDB Cloud for both apps, one database each), which replaced [ADR 0007](adr/0007-database.md) (Postgres).
5. The boundary between the API and the meeting engine. This blocks the API and the engine's move. Proposed in
   [ADR 0008](adr/0008-api-engine-boundary.md).
6. Pricing model. This blocks billing. Proposed in [ADR 0009](adr/0009-pricing-model.md) (per meeting hour).

## Production

Production has run on Render since 2026-10-18, with SurrealDB Cloud, and CD from `main` (ADR 0005, ADR 0011,
[runbook](runbooks/README.md)). People start sessions through the api with a Clerk token, and the engine's operator
surface is off behind Render's proxy. That settles the earlier blockers on login, a stable public URL and storage.

What's left before other people use it is R2 and R5 to R7 in [known-issues.md](known-issues.md#open-since-the-first-production-deploy-2026-10-18).
The most urgent are R1, nothing caps spend yet, and R2, a deploy ends live meetings.
