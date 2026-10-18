# Workstreams

This is where everyone coordinates. Each area has a folder, and that folder's README is its brief. To claim an area,
put your name in the Owner column and open a small PR. One owner per area. Anyone can contribute, but the owner reviews.

| Area | Folder | Owner | Status | Depends on |
|---|---|---|---|---|
| Meeting engine (Builder core) | `src/`, `public/` (moving to `services/meeting-engine/`) | TBD | v0 working | none |
| Public API | `services/api/` | TBD | not started | auth, db, shared |
| Identity and access | `services/auth/` | TBD | not started | db |
| Billing and metering | `services/billing/` | TBD | not started | auth, db, engine usage events |
| Background jobs and calendar | `services/worker/` | TBD | not started | db, engine |
| Notifications | `services/notifications/` | TBD | not started | auth |
| Customer web app | `apps/web/` | TBD | not started | api, auth, billing |
| Admin console | `apps/admin/` | TBD | not started | api, auth, billing |
| Shared types and schemas | `packages/shared/` | TBD | not started | none |
| Database | `db/` | TBD | not started | none |
| Infrastructure, CI, observability | `infra/` | TBD | CI running (ADR 0001 proposed) | none |
| End-to-end tests | `e2e/` | TBD | not started | all |
| Security, privacy, compliance | `docs/security/` | TBD | not started | none |

## Decisions that block other work

Settle these first, as ADRs in `docs/adr/`:

1. Repo tooling: workspaces, package manager, lint and format. This blocks every new package. CI and type checking
   are proposed in [ADR 0001](adr/0001-ci-and-type-checking.md); workspaces and lint/format are still open.
2. Hosting platform and environments. This blocks staging, live tests and webhooks.
3. Identity provider and tenancy model. This blocks the API, the apps and billing.
4. Database engine. This blocks the API, billing and the worker.
5. The boundary between the API and the meeting engine. This blocks the API and the engine's move.
6. Pricing model. This blocks billing.

## Before any shared deployment

The engine blockers (I1, I5, I6 and I7 in [known-issues.md](known-issues.md)) were fixed on 2026-10-17. These still
stand between v0 and a deployment other people can reach:

1. **The operator surface has no login.** `/` and `/api/*` answer only requests that carry no proxy headers. Behind a
   hosting platform's proxy that means nobody can use them; on a host reachable directly, it means anyone can,
   including sending bots, which costs money. This needs `services/auth`, or an interim operator token decided in an
   ADR.
2. **The engine runs as one process.** Session state is held in memory and storage is SQLite, so run a single
   instance with a persistent disk until the scaling ADR in `services/meeting-engine/` is settled.
3. **There's no stable public URL.** Recall needs one for webhooks and the stage (decision 2 above).
4. **Nothing caps spend.** No per-session or per-org cost cap exists yet (`services/billing/`).
