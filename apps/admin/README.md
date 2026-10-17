# apps/admin: internal admin console

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
A console for staff only, for operating the service.

## In scope
- Looking up orgs, users, sessions and bots, including live bot status and Recall bot ids
- Cost per session and per org: model calls, bot minutes, TTS characters
- Refunds and credits, plan overrides, feature flags
- Handling abuse: suspending an org, and stopping a bot in a live meeting

## Out of scope
- Anything customers see, which belongs in `apps/web`

## Depends on
`services/auth` (staff roles), `services/api`, `services/billing`

## Open decisions
- Build it ourselves, or use an internal-tools platform
- How staff get access, and audit logging

## First tasks
- [ ] List the top five support and operations actions needed at launch
