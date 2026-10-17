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
| Infrastructure, CI, observability | `infra/` | TBD | not started | none |
| End-to-end tests | `e2e/` | TBD | not started | all |
| Security, privacy, compliance | `docs/security/` | TBD | not started | none |

## Decisions that block other work

Settle these first, as ADRs in `docs/adr/`:

1. Repo tooling: workspaces, package manager, lint and format. This blocks every new package.
2. Hosting platform and environments. This blocks staging, live tests and webhooks.
3. Identity provider and tenancy model. This blocks the API, the apps and billing.
4. Database engine. This blocks the API, billing and the worker.
5. The boundary between the API and the meeting engine. This blocks the API and the engine's move.
6. Pricing model. This blocks billing.

## Engine fixes needed before any shared deployment

These are known issues I1, I5, I6 and I7 in [known-issues.md](known-issues.md).
