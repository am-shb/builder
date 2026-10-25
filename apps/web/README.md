# apps/web: the customer app and staff pages

**Status:** sign-in and organizations (W2 in [the plan](../../docs/plans/web-first-slice.md)): Clerk sign-in, sign-up,
choosing an organization, and the signed-in shell with the org switcher. It doesn't call the api yet. Stack and rules: [ADR 0012](../../docs/adr/0012-web-stack.md); visual design:
ADR 0015 ("Boardroom"). **Owner:** TBD. Claim it in
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
| `npm run check -w @builder/web` | Type check, tests, build, and a check that `/_design` isn't in the build. Needs no key and no network. Root `npm run check` and CI run it too |
| `npm run screenshots -w @builder/web` | Starts its own dev server and takes screenshots of `/_design` and the app shell at 390 and 1280px (and 360), light and dark, into `apps/web/screenshots/` (git-ignored). Runs axe in Chrome, contrast included, and fails on a violation or sideways scrolling. Blocks every request that isn't to that local server, except that sign-in shots may reach the Clerk development instance named by `apps/web/.env`. Signed-in shots need `SIGNED_IN_STATE` (and `PENDING_STATE`) from `save-session`; without them they're skipped. Needs Chrome (`CHROME_PATH` if it isn't found). Never run by `npm test` |
| `npm run save-session -w @builder/web -- <folder> <+1XXX55501XX>` | Signs in headless to the Clerk development instance as an existing test account (a fictional 555-01xx number, Clerk's test code, no SMS) and saves the browser session to `<folder>`, outside the repo. Development keys only. It never signs up: sign-up has a bot check, so create the test account by hand once |

In the dev server, **http://localhost:5173/_design** shows every component and state; `?view=shell` shows the sessions
screen built from them (`&empty=1`, `&open=sheet`, `&open=confirm`, `&toast=1`), and `?theme=light` or `?theme=dark`
forces a mode. It isn't in the production build.

Settings go in `apps/web/.env` (git-ignored), names in [.env.example](.env.example): `VITE_CLERK_PUBLISHABLE_KEY` and
`VITE_API_URL`, plus the optional `VITE_ANDROID_APP_URL` (the APK's address; set, the landing page offers the Android
app). Vite builds every `VITE_*` value into public JavaScript, so nothing secret ever goes here. The build succeeds
without them.

For the api and the engine next to it, with no bot and no spend, see "Local development" in the plan.

## Layout
- `src/`: the app's screens, hooks and components. The session logic they share with the mobile app (the api client, the
  reply schemas, the error text, the start rules, the session page's words, meeting display, times, status labels) is
  `@builder/session-core` ([packages/session-core](../../packages/session-core/README.md)), imported by name.
  `brand.ts` re-exports `PRODUCT_NAME` and `BOT_NAME` from it: the product name and domain aren't decided, so
  every screen takes the names from there, and no URL of ours is written in the code.
- `src/styles/globals.css`: the design tokens (light and dark), the type scale and the one elevation level. The only
  file with raw colors; a test fails on a raw color anywhere else in `src/`.
- `src/components/`: the design system. Screens compose these and add no one-off colors or sizes: `AppShell`
  (`PageIntro`, `SplitLayout`, `SectionHeader`), `Button`, `TextField`, `StatusPill`, `SessionRow` (with `SessionList`
  and `SessionRowSkeleton`), `Callout`, `ResponsiveModal` (bottom sheet on phones, dialog on desktop), `ConfirmModal`,
  `Toaster`, `EmptyState`, `PageState`, `Mark`.
- `src/clerk/appearance.ts`: Clerk's theme, pointing at the same tokens (used from W2).
- `src/design/`: the dev-only `/_design` page.
- `build/csp.ts`: the Vite plugin that writes the CSP `<meta>` tag at build time from the two `VITE_*` variables.
- `scripts/`: `screenshots.ts`, and `check-dist.ts` (no design page in the build).
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
- ~~Design system.~~ Settled in ADR 0015 ("Boardroom"); it doesn't share tokens with the stage theme.
- How staff get access to the admin pages, and audit logging

## First tasks
- [ ] Wireframes for sign-in, starting a meeting, and the handoff library
- [x] An ADR choosing the framework (ADR 0012, on its own branch until merged)
- [ ] The top five support and operations actions needed at launch
