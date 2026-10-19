# apps/web: the customer app and staff pages

**Status:** scaffold (W1 in [the plan](../../docs/plans/web-first-slice.md)). It renders a placeholder and calls
nothing. Stack and rules: [ADR 0012](../../docs/adr/0012-web-stack.md). **Owner:** TBD. Claim it in
[docs/workstreams.md](../../docs/workstreams.md).

## Purpose
The product customers use day to day. It replaces the v0 local operator page (`apps/engine/public/index.html`). It also holds the
staff-only admin pages (see [ADR 0006](../../docs/adr/0006-identity-and-tenancy.md)), which are routes in this app and
not a separate app.

## Run it
Node 24 (`.nvmrc`), from the repo root after `npm ci`:

| Command | What |
|---|---|
| `npm run dev -w @builder/web` | Vite dev server on http://localhost:5173 (fixed port: the api's `CLERK_AUTHORIZED_PARTIES` lists this origin) |
| `npm run build -w @builder/web` | Static build in `apps/web/dist/` (git-ignored), with the Content Security Policy written into `index.html` |
| `npm run preview -w @builder/web` | Serves the build on port 4173 |
| `npm run check -w @builder/web` | Type check, tests, build. Needs no key and no network. Root `npm run check` and CI run it too |

Settings go in `apps/web/.env` (git-ignored), names in [.env.example](.env.example): `VITE_CLERK_PUBLISHABLE_KEY` and
`VITE_API_URL`. Vite builds every `VITE_*` value into public JavaScript, so nothing secret ever goes here. The build
succeeds without them.

For the api and the engine next to it, with no bot and no spend, see "Local development" in the plan.

## Layout
- `src/`: the app. `brand.ts` holds `PRODUCT_NAME` and `BOT_NAME`: the product name and domain aren't decided, so
  every screen takes the names from there, and no URL of ours is written in the code.
- `build/csp.ts`: the Vite plugin that writes the CSP `<meta>` tag at build time from the two `VITE_*` variables.
- `test/`: Vitest with jsdom. `setup.ts` blocks `fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest` and
  `sendBeacon`, so no test can reach Clerk, the api, the engine or a paid service. `guards.test.ts` scans the source
  for the rules in ADR 0012.

## In scope
- Sign-up, sign-in, and org and team management screens
- Starting the bot for a meeting: paste a link, or connect a calendar for scheduled sessions
- A live session view: bot status, cost so far, and the handoff link
- A handoff library: past sessions with their prototypes, specs and decision logs, plus sharing and export
- Billing and plan settings
- Staff-only pages: looking up orgs, users, sessions and bots, cost per session and per org, credits and plan
  overrides, suspending an org, and stopping a bot in a live meeting

## Out of scope
- The screenshared stage and its renderer. They stay in the engine (`apps/engine/public/stage.html`, `apps/engine/public/renderer/`).
- Anything the api owns: accounts, billing and the list of meetings. This app calls the api.

## Depends on
`apps/api`, `@builder/contracts`

## Open decisions (record each as an ADR in `docs/adr/`)
- ~~Framework and hosting.~~ Settled in [ADR 0012](../../docs/adr/0012-web-stack.md): Vite + React, a Render static site.
- Design system, and whether it shares tokens with the stage theme (`apps/engine/public/renderer/theme.css`)
- How staff get access to the admin pages, and audit logging

## First tasks
- [ ] Wireframes for sign-in, starting a meeting, and the handoff library
- [x] An ADR choosing the framework (ADR 0012, on its own branch until merged)
- [ ] The top five support and operations actions needed at launch
