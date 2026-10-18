# apps/web: the customer app and staff pages

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
The product customers use day to day. It replaces the v0 local operator page (`public/index.html`). It also holds the
staff-only admin pages (see [ADR 0006](../../docs/adr/0006-identity-and-tenancy.md)), which are routes in this app and
not a separate app.

## In scope
- Sign-up, sign-in, and org and team management screens
- Starting Builder for a meeting: paste a link, or connect a calendar for scheduled sessions
- A live session view: bot status, cost so far, and the handoff link
- A handoff library: past sessions with their prototypes, specs and decision logs, plus sharing and export
- Billing and plan settings
- Staff-only pages: looking up orgs, users, sessions and bots, cost per session and per org, credits and plan
  overrides, suspending an org, and stopping a bot in a live meeting

## Out of scope
- The screenshared stage and its renderer. They stay in the engine (`public/stage.html`, `public/renderer/`).
- Anything the api owns: accounts, billing and the list of meetings. This app calls the api.

## Depends on
`apps/api`, `@builder/contracts`

## Open decisions (record each as an ADR in `docs/adr/`)
- Framework and hosting. This app may use a framework with a build step ([ADR 0004](../../docs/adr/0004-workspaces-and-repo-layout.md)).
- Design system, and whether it shares tokens with the stage theme (`public/renderer/theme.css`)
- How staff get access to the admin pages, and audit logging

## First tasks
- [ ] Wireframes for sign-in, starting a meeting, and the handoff library
- [ ] An ADR choosing the framework
- [ ] The top five support and operations actions needed at launch
