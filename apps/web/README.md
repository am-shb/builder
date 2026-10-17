# apps/web: customer web app

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Purpose
This is the product customers use day to day. It replaces the v0 local operator page (`public/index.html`).

## In scope
- Sign-up, sign-in, and org and team management screens (backed by `services/auth`)
- Starting Builder for a meeting: paste a link, or connect a calendar for scheduled sessions
- A live session view: bot status, cost so far, and the handoff link
- A handoff library: past sessions with their prototypes, specs and decision logs, plus sharing and export
- Billing and plan settings (backed by `services/billing`)

## Out of scope
- The screenshared stage and its renderer. They stay in the meeting engine (`public/stage.html`, `public/renderer/`).
- Internal staff tools, which belong in `apps/admin`

## Depends on
`services/api`, `services/auth`, `services/billing`, `packages/shared`

## Open decisions (record each as an ADR in `docs/adr/`)
- Framework and hosting
- Design system, and whether it shares tokens with the stage theme (`public/renderer/theme.css`)

## First tasks
- [ ] Wireframes for sign-in, starting a meeting, and the handoff library
- [ ] An ADR choosing the framework
