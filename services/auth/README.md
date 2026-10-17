# services/auth: identity, orgs and access

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
Who someone is, which org they belong to, and what they're allowed to do.

## Current state
v0 has no user accounts. Each session has one random `stage_token`: the bot uses it to open the stage, and the handoff
link reuses it. Known issue I7 in [docs/known-issues.md](../../docs/known-issues.md) is that this token also exposes
the live transcript, so separate capability tokens are needed.

## In scope
- Sign-up and sign-in. Google OAuth is the obvious first choice for Meet users.
- Orgs or workspaces, members, roles, invitations
- API keys for programmatic access
- Scoped capability tokens: one for the stage (bot only), one for the handoff (read-only, shareable), and a way to
  revoke them
- SSO/SAML and SCIM later, for enterprise customers

## Provides
Identity and role checks for `services/api`, `apps/web` and `apps/admin`

## Open decisions
- Build our own identity provider, or buy one
- Tenancy model: one org per customer, personal workspaces, or both
- Whether meeting participants who aren't users can view handoffs

## First tasks
- [ ] An ADR choosing the identity provider
- [ ] A matrix of roles and permissions
