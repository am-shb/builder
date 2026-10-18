# 0006: Identity with Clerk, the organization as tenant

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** identity and access (`apps/api/src/auth`)

## Context
Blocking decision 3 in [workstreams.md](../workstreams.md). The v0 operator surface has no login. It relies on being
reachable only from localhost, so it can't be deployed. Anyone who can reach it can send bots, which costs money.
The API, the web app and billing all need to know who is calling and on whose behalf.

## Options considered
1. **Clerk.** Hosted sign-up and sign-in, social login, MFA, and organizations with roles and invitations. A
   build-week sponsor with its own prize category.
2. **Auth.js or Better Auth, self-hosted.** No vendor cost. We'd own sessions, password resets, MFA and org
   invitations, which is weeks of work that doesn't set the product apart.
3. **Auth0 or WorkOS.** Strong on enterprise SSO, more than we need now.

On tenancy: a user as tenant is simpler today, but Builder is used by groups in meetings. Moving from user-owned to
org-owned data later means a migration of every table.

## Decision
- **Clerk** handles sign-up, sign-in, sessions, MFA, social login and organizations. `apps/web` uses Clerk's
  components. `apps/api` verifies Clerk session tokens on every request in `apps/api/src/auth`.
- **The tenant is the organization.** Every request acts within one active org. Sign-up creates a personal org of one,
  so all data is org-scoped from the start, and "invite your team" is a feature, not a migration.
- **Roles:** Clerk's `org:admin` and `org:member`. Admins manage members and billing. Members run meetings.
- **Our database mirrors** users, orgs and memberships from Clerk webhooks, verified by signature, so queries can
  join on them. Clerk stays the source of truth.
- **Every business table has `org_id`**, and every query filters by the org from the verified token, never from the
  request body.
- **Staff access** (the admin pages) is a flag on our user record, not a Clerk org role, so customers can't grant it.
- **API keys** for customers' programmatic access are decided when the public API is scoped.

## Consequences
- Clears deployment blocker 1: the operator surface gets a login, through the api.
- We depend on Clerk being up for sign-in, and Clerk's pricing scales with active users.
- Follow-up (api owner): token verification and a `requireOrgRole` helper in `apps/api/src/auth`, the webhook
  handler, and tests that a request can never read another org's rows.
