# Plan: the web app's first slice (sign-in, orgs, sessions, start a session)

- **Status:** proposed. No web code yet.
- **Date:** 2026-10-18 (rewritten against `main` at `2c87931`). Updated 2026-10-19 against `main` at `e9b01b5`,
  after the Render Blueprint for the engine and the api landed: see [What changed on 2026-10-19](#what-changed-on-2026-10-19).
- **Deadline:** hackathon submission due 2026-10-25, 11:59 PM ET. Where there's a choice, take the simplest option.
- **Area:** `apps/web`. Work needed elsewhere is listed in [Changes outside apps/web](#changes-outside-appsweb) and
  needs that area's review first.
- **Built on:** ADRs [0004](../adr/0004-workspaces-and-repo-layout.md) (workspaces),
  [0005](../adr/0005-hosting-on-render.md) (Render), [0006](../adr/0006-identity-and-tenancy.md) (Clerk, org as
  tenant), [0008](../adr/0008-api-engine-boundary.md) (web talks only to the api),
  [0009](../adr/0009-pricing-model.md) (no billing screens yet), [0010](../adr/0010-api-stack.md) (api errors, no
  auto-retry) and [0011](../adr/0011-surrealdb.md) (database, nothing for the web app to do). The api's plan is
  [api-first-slice.md](api-first-slice.md).

## Goal
A person signs up or signs in, works inside their company's Clerk organization, sees that org's sessions, starts a
new one by pasting a meeting link, and opens a session to see its status and stage link.

```
browser (Clerk, active org)
  -> GET  {API_ORIGIN}/v1/me
  -> GET  {API_ORIGIN}/v1/sessions
  -> GET  {API_ORIGIN}/v1/sessions/:id
  -> POST {API_ORIGIN}/v1/sessions { meetingUrl }        every call: Authorization: Bearer <Clerk session token>
```

**Not in this slice:** live updates (the api doesn't receive engine events yet), cost so far, hand-off links and
library, billing, calendar, staff pages, invitations beyond what Clerk's components already offer, a full design
system (this slice has the foundation in [Visual design](#visual-design), not a component library for every future page).

## What changed on 2026-10-19
Read against `main` at `e9b01b5`. `apps/web`, `contracts/` and the api's routes are unchanged since this plan was
written. What changed around them:
- **Production runs on Render** (root `render.yaml`, [runbook](../runbooks/README.md#production-render-and-surrealdb-cloud)):
  `builder-engine` and `builder-api`, both Docker web services in `virginia`, plus the environment group
  `builder-internal` (the generated `ENGINE_INTERNAL_TOKEN`). **There is no web service yet.** The api reaches the
  engine over Render's private network (`ENGINE_INTERNAL_URL` from `fromService ... hostport`, which the api now
  accepts as a bare `host:port`).
- **How deploys work:** a commit on `main` deploys a service only after every CI check on that commit passes
  (`autoDeployTrigger: checksPass`), and only if a path in that service's `buildFilter` changed. Both services' filters
  include `contracts/**`, the root `package.json`, `package-lock.json`, `.nvmrc` and `.dockerignore`. A pre-deploy
  step runs migrations; the health check gates traffic. **An engine deploy ends live meetings** (known issue R2).
- **Clerk on Render:** `CLERK_JWT_KEY` and `CLERK_AUTHORIZED_PARTIES` are `sync: false` on `builder-api`, set in the
  dashboard, not in `render.yaml`. Editing `render.yaml` never changes them.
- **Session limits:** `DEFAULT_MAX_USD` and `DEFAULT_MAX_MINUTES` are `sync: false` and still undecided (D5 in the api
  plan). Without them, `POST /v1/sessions` on Render answers 503 `limits_unavailable`. The engine now enforces the
  limits it's given (known issue R1), so a session ends on its own at `maxMinutes` or `maxUsd`, but the api isn't told why yet.
- **Still true:** no CORS in the api (`OPTIONS` answers 405), no `POST /internal/engine-events`, so statuses don't
  move, and the api-to-web shapes still live in `apps/api/src/routes/schemas.ts`.
- **New locally:** `docker compose up --build` runs SurrealDB, the engine (local mode, no Recall) and the api from the
  same images Render runs. CI also builds both images and tests against a real SurrealDB 3.3.2.

What this changes in the plan:
1. **I1 no longer waits on the Blueprint.** It adds a static site to the existing `render.yaml`, and it moves up to
   right after W1, so the deployed origin exists early (for the api's `CLERK_AUTHORIZED_PARTIES` and CORS) and the
   CSP is tested from the first screen, not the last. The deploy stops being the biggest risk.
2. **Merging web work can redeploy the engine.** W1 and any PR that adds a dependency change `package-lock.json`, and
   WC1 changes `contracts/**`. Both are in the engine's and the api's build filters, so merging them redeploys both,
   which ends any live meeting. Merge those outside meetings, or pause the engine's auto-deploy first (runbook).
   Changes only under `apps/web/` deploy only the web site.
3. **A failing web check blocks every deploy.** Render waits for all checks on the commit, and CI runs every
   workspace's `check`. A broken `vite build` on `main` stops engine and api deploys too, so `main` must stay green.
4. **No URL is written into the repo** (product name and domain aren't decided). See [Names, URLs and
   placeholders](#names-urls-and-placeholders). Because Render header values are literal text, the CSP origins move
   out of `render.yaml` into the build (WD11).
5. **The deployed start form needs D5.** Without the limits set on `builder-api`, a deployed start answers 503
   `limits_unavailable`, which the error table already covers.

## Names, URLs and placeholders
The product name and the domain aren't decided. Until they are:
- **UI text** uses two constants from `apps/web/src/brand.ts`: `PRODUCT_NAME` (header, page title, "Can't reach
  {PRODUCT}") and `BOT_NAME` (the bot in the meeting, "{BOT} is joining"). Both hold the repo's working name for now.
  `BOT_NAME` must match the name the engine gives the bot (`BOT_NAME` in `apps/engine/src/app.ts`), or people will look
  for the wrong name in the meeting; renaming means changing both. In this plan, `{PRODUCT}` and `{BOT}` in quoted
  text stand for these.
- **Origins** are placeholders in this plan and come from configuration, never from code or `render.yaml`:

  | Placeholder | What | Where it's set |
  |---|---|---|
  | `{WEB_ORIGIN}` | the web site's origin | Render shows it on the site's page (an `onrender.com` host until a domain exists) |
  | `{API_ORIGIN}` | `builder-api`'s public origin | `VITE_API_URL` on the web site (build time) |
  | `{FAPI}` | the Clerk instance's Frontend API host | derived at build time from `VITE_CLERK_PUBLISHABLE_KEY`, which encodes it |

- **When a domain is chosen** (later, outside this slice): add it to the site in Render, add the new origin to the
  api's `CLERK_AUTHORIZED_PARTIES`, set `VITE_API_URL` if the api moves too, rebuild the site, and only then consider a
  Clerk production instance (it needs DNS records on that domain). No code changes.

## Where things stand (read on 2026-10-18)
- **`apps/web`** is a placeholder: a README and a `package.json` whose `check` only prints a line.
- **The api is done for this slice** (`apps/api`, plain `node:http`, ADR 0010):

  | Route | Success | Body |
  |---|---|---|
  | `GET /health` | 200 | `{ ok: true }` |
  | `GET /v1/me` | 200 | `{ userId, orgId, role }`, role like `org:admin` |
  | `GET /v1/sessions` | 200 | `{ sessions: SessionView[] }`, the org's 50 newest, newest first |
  | `GET /v1/sessions/:id` | 200 | `{ session: SessionView }`. Another org's id answers 404, like a missing one |
  | `POST /v1/sessions` | 201 started, 200 reused | `{ session: SessionView, reused: boolean }` |
  | `POST /v1/sessions` | 502, 504 | `{ error: { code, message }, session: SessionView }` |

  `SessionView` is `{ id, meetingUrl, status, errorCode?, stageUrl?, limits: { maxUsd, maxMinutes }, createdAt,
  updatedAt }` (`apps/api/src/routes/schemas.ts`). `status` is one of `starting`, `start_failed`, `start_unknown`,
  `joining`, `in_meeting`, `ended`, `failed`. Every other error is `{ error: { code, message } }`.
- **The org always comes from the token.** The api ignores any org id in a body, query or header. A token with no
  active org gets 403 `no_active_org`. A Clerk session that is still "pending" (for example, it hasn't chosen an org
  yet) gets 401 `unauthenticated`. Tokens are checked offline, and their `azp` must be in `CLERK_AUTHORIZED_PARTIES`.
- **Meeting links:** the api accepts https Google Meet, Zoom and Teams links, normalized by URL parsing. A second
  start for the same link while the org's session is `starting`, `joining` or `in_meeting` returns that session with
  `reused: true`, and no second bot. `start_unknown` is not in that set, so the api calls the engine again after an
  unknown outcome. The engine then usually refuses with 409 `meeting_in_use` (the api answers 502 `engine_rejected`
  with that `errorCode`), because it still holds the first attempt for that org and meeting. A second bot is
  possible only if the engine never recorded the first attempt or lost its row, so the web app still warns first.
- **What 502 `engine_rejected` means** depends on `session.errorCode`, the engine's code:
  - `recall_rejected`: Recall refused; no bot. Usually a bad or closed meeting link.
  - `meeting_in_use`: the engine already has a session for this org and meeting, so a bot is (or may be) there.
  - anything else (`session_conflict`, `unauthorized`, `http_404`, `invalid_request`): a server setup problem.
- **Statuses don't move yet.** The api records the engine's first answer (usually `joining`). There's no
  `POST /internal/engine-events` route yet, so `in_meeting`, `ended` and `failed` don't arrive in this slice.
- **The engine** has `POST /internal/sessions` (E1–E4, idempotent per `sessionId`, org-scoped). Its local mode
  (`npm run local`) uses a stand-in for Recall, so it answers without sending a bot.
- **The stage link** is `{engine}/stage/{sessionId}?token={stage_token}`. The stage token is the bot's capability:
  it opens the stage page, `/state` and the stage WebSocket. The stage page sends `ui_screen` and `barge_in` messages
  over that socket, so **a second browser that opens the stage link can change what the live stage reports, and its
  `barge_in` stops the bot's voice in the live meeting**. It can also play the bot's voice locally. It is a control
  link, not a viewing link (see [Stage link](#stage-link)). `GET /v1/sessions` returns it for every row.
- **The api has no CORS handling.** A browser on another origin can't read its replies, and `OPTIONS` answers 405.
- ~~No `render.yaml` on `main` yet.~~ It exists now, with the engine and the api only (see
  [What changed on 2026-10-19](#what-changed-on-2026-10-19)). Ports: engine 3000, api 3001, Vite 5173 locally; both
  services use 10000 on Render.
- **Shapes:** the api-to-web schemas are in `apps/api/src/routes/schemas.ts`. ADR 0010 says they move to `contracts/`
  once the web app imports them (WC1 below).

## Design

### Framework: Vite + React, a static single-page app
**Decision WD1** (no ADR picks the web framework; ADR 0004 allows a build step, ADR 0005 leaves static site or web
service to this choice). Step W0 records it as ADR 0012.

- **Why:** a few screens behind a login, no SEO, no server data of our own. Every byte of data comes from the api.
  A static build is a $0 Render static site (ADR 0005) with no server to secure, and Clerk's React SDK documents
  Vite as its quickstart.
- **Not chosen:** Next.js (a $7 web service and a second server that would also have to verify tokens);
  no framework (Clerk's components would need mounting by hand).
- **Versions** (latest on npm on 2026-10-18, pinned exactly when installed): `react` and `react-dom` 19.3.1,
  `@clerk/react` 6.17.8 (the current React SDK; `@clerk/clerk-react` is the old name), `react-router` 8.4.0,
  `vite` 8.3.4, `@vitejs/plugin-react` 6.1.2, `vitest` 5.0.5, `jsdom` 30.1.3, `@testing-library/react` 16.3.3,
  `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.8, `@types/react` and `@types/react-dom` 19.3.0,
  and `zod` 4.6.7 (the api's version; the web app parses replies with it).
  `@clerk/react` accepts React `~19.3.0-0`. None has a TypeScript peer, so no `overrides` entry is needed (unlike
  `surrealdb`). Check again at install: if a peer conflict shows up, use a scoped override, as the root does.
- **Design packages** ([ADR 0015](../adr/0015-web-visual-design.md); checked on npm on 2026-10-19 and 2026-10-20,
  every peer range accepts React 19.3 and Vite 8), also installed in W1 so the lockfile changes once:
  `radix-ui` 1.8.1, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `lucide-react` 1.56.0
  (not 1.59.0, which is two days old), `sonner` 2.0.8, `@fontsource-variable/schibsted-grotesk` 5.3.0; dev only:
  `tailwindcss` and `@tailwindcss/vite` 4.3.3, `tw-animate-css` 1.4.0, `axe-core` 4.14.0 and `playwright-core` 1.64.1.
  Not added: the `shadcn` CLI package, `vaul`, an animation library and `@clerk/themes` (reasons in ADR 0015).
- **TypeScript:** `apps/web/tsconfig.json` extends the root base and changes only what a browser bundle needs:
  `module: "esnext"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `lib: ["esnext", "dom"]` (add
  `"dom.iterable"` only if TypeScript 7 still needs it), and `types: ["vite/client", "node"]`. Keeping `node` matters:
  `vite.config.ts` and the source-scan tests use `node:fs` and `node:path`, and `tsc -p .` checks them too.
  `vite.config.ts` imports `defineConfig` from `vitest/config` so its `test` block type-checks. Erasable syntax only
  and `.ts`/`.tsx` import extensions stay on. `tsc` type-checks; Vite transforms.
- **`npm run check -w @builder/web`** = `tsc -p .` then `vitest run` then `vite build`. Root `npm run check` and CI
  already run every workspace's `check`. None of the three needs a key or the network. `vite build` must succeed with
  no `VITE_*` variables set; a missing key shows a "not configured" screen at runtime instead of failing the build.

### Screens and routes
**Decision WD2:** React Router (declarative mode, `BrowserRouter`) with five routes. Clerk's `<SignIn>` and `<SignUp>`
use `routing="path"`. On Render, one rewrite (`/*` → `/index.html`) makes every route load.

| Route | Who | Shows |
|---|---|---|
| `/sign-in/*` | signed out | Clerk's `<SignIn />`, with a link to sign up |
| `/sign-up/*` | signed out | Clerk's `<SignUp />` |
| `/choose-organization` | signed in, no org yet | Clerk's `<TaskChooseOrganization />`: create the company's org or join one |
| `/` | signed in with an org | Header, the start form, the session list |
| `/sessions/:id` | signed in with an org | The session's detail |

Anything else redirects to `/`. Signed-out visitors to `/` or `/sessions/:id` go to `/sign-in`, and come back after.

**Clerk wiring** (`src/main.tsx`): `ClerkProvider` reads `VITE_CLERK_PUBLISHABLE_KEY` and gets `signInUrl="/sign-in"`,
`signUpUrl="/sign-up"`, `signInFallbackRedirectUrl="/"`, `signUpFallbackRedirectUrl="/"`, `afterSignOutUrl="/sign-in"`,
`taskUrls={{ "choose-organization": "/choose-organization" }}`, `telemetry={false}`, and `routerPush`/`routerReplace`
wired to React Router's `navigate`, so Clerk's own redirects stay inside the app instead of going to Clerk's hosted
pages or reloading the page. W0 also checks whether `@clerk/react-router` fits declarative mode better than
`@clerk/react` with these props, and picks one.

**Header** (on `/` and `/sessions/:id`): `PRODUCT_NAME` (see [Names](#names-urls-and-placeholders)), `<OrganizationSwitcher hidePersonal />`, the role from
`GET /v1/me` (`org:admin` → "Admin", `org:member` → "Member", any other role shown as its key), and `<UserButton />`.

**Organizations (each company is a tenant):**
- The Clerk instance has Organizations on and **membership required** (K1, the api plan's D3). Personal accounts
  are then off, and a new user must create or join an org before their session is fully signed in. Clerk models
  that as a pending "choose-organization" session task, and `/choose-organization` renders
  `<TaskChooseOrganization redirectUrlComplete="/" />`.
- **Pending sessions.** By default Clerk's `useAuth()` reports a pending session as signed out (`isSignedIn: false`,
  no `userId` or `orgId`), and the api refuses its token with 401, so no api call is made for it. But a plain
  "signed out → `/sign-in`" guard would send a returning user with a pending task back to sign-in. So the route
  guard reads `useAuth({ treatPendingAsSignedOut: false })`: signed in with no `orgId` goes to `/choose-organization`;
  truly signed out goes to `/sign-in`. W2 checks this against the dev instance by hand, and uses Clerk's
  `<RedirectToTasks />` instead if it's simpler.
- `<TaskChooseOrganization />` renders nothing when there's no pending task. So for a 403 `no_active_org` with no
  pending task (rare, such as after leaving the last org elsewhere), `/choose-organization` falls back to
  `<OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />`.
- ADR 0006 says "sign-up creates a personal org of one". With membership required it becomes "the first org the user
  creates at sign-up". Same result (every session belongs to an org), but it's a change to ADR 0006's text, so it is
  listed under [Changes outside apps/web](#changes-outside-appsweb) (D-ID).
- **Switching org.** `<OrganizationSwitcher>` changes the active org, so the next token carries the new org. The web
  app never sends an org id. Every query is keyed by `orgId` from `useAuth()`: on a change, in-flight requests are
  aborted, cached lists are dropped, and the list reloads. On `/sessions/:id`, a switch while a session is on screen
  goes back to `/`, because the session belongs to the old org. On "No such session" (or while it's still loading) the
  page stays and reads the session again for the new org, as the 404's message suggests.
- **A `POST /v1/sessions` is never aborted,** by an org switch or anything else: aborting it would turn a known
  outcome into an unknown one. Its result is still shown after a switch, naming the org it was started in. The form
  is disabled while a start is in flight, and the switcher is the only way to change org, so a start can't silently
  land in an org the person didn't see on screen when they pressed Start.
- The page hides nothing by role in this slice. Admins and members can both start meetings (ADR 0006), and the api
  enforces roles.

**Session list (`/`):** newest first, up to 50 (no paging, as in the api). Each row: the meeting link as plain text,
the status label, when it was started (local time, relative), and a link to its detail page. **No stage link in the
list.** States: loading, empty (points at the form), error (by code, below). A Refresh button, and a quiet refresh every 10 seconds while a session may still change (WD6).

**Start form (on `/`):**
- One field (the meeting link) and a Start button.
- Before sending, the browser only checks that the link parses as an `https:` URL. Which meeting hosts are allowed
  is the api's rule (`MeetingUrl` in `apps/api/src/routes/schemas.ts`), so it lives in one place; the api's 400
  `invalid_request` covers the rest. A refused link shows "Use an https Google Meet, Zoom or Teams link." and sends
  nothing.
- The button is disabled while the request is in flight, so a double click sends one request.
- **Guard after an unknown outcome (WD8):** if the list has a `start_unknown` session for the same normalized link
  from the last 30 minutes, Start shows a confirmation first: "An earlier start for this link didn't confirm.
  Check the meeting for a {BOT} bot before starting another." with "Start anyway" and "Cancel".
- **Guard for another copy of the link:** the api and engine match exact links, so `…/abc-defg-hij?authuser=0` would
  send a second bot to a meeting that already has one. If the list has a `starting`, `joining` or `in_meeting` session
  for the same normalized meeting under a different link, still within its time limit plus 30 minutes, Start asks
  first: "This meeting already has a {BOT} session ({status}), started from another copy of the link. Starting again
  sends a second {BOT} bot." The exact same link doesn't ask: the api reuses that session. The api-side fix is the
  meeting-key ADR draft (0014, in review).
- Outcomes are in [Errors](#errors-every-api-code).

**Session detail (`/sessions/:id`):** from `GET /v1/sessions/:id`. Shows the status label and a one-line
explanation, the meeting link as text, created and updated times, the limits (`maxUsd`, `maxMinutes`), the
`errorCode` if there is one (as a code, for support), the stage link (below), and a Refresh button. 404 shows "No
such session in this organization" with "Back to sessions" (the same words as the back link above the title).
A Refresh that works says "Updated." to screen readers; one that fails says "Couldn't refresh".

**Moving between pages** starts the new page at its top, with focus on its `h1` (and on the loaded page's `h1` once
it has loaded, until the person does anything), as a full page load would. The first load and its redirects are
left to the browser, and so are the steps inside Clerk's sign-in and sign-up, which focus their own fields. A page that throws while rendering
shows "Something went wrong" with Reload instead of a blank page.

**Status labels:**

| Status | Label | Explanation on the detail page |
|---|---|---|
| `starting` | Starting | We're asking {BOT} to join. |
| `joining` | Joining | {BOT} is joining the meeting. Admit it if the meeting asks. |
| `in_meeting` | In the meeting | {BOT} is in the meeting. |
| `ended` | Ended | |
| `failed` | Failed | {BOT} left the meeting because of an error. |
| `start_failed` | Didn't start | From `errorCode`, worded as the start's reply: `recall_rejected` "{BOT} couldn't join this meeting. Check the link and that the meeting is open, then try again."; `meeting_in_use` "{BOT} already has a session in this meeting. Check the meeting. No second bot was sent."; any other "Starting meetings isn't working right now ({code})."; no code: "The meeting service refused. Check the link and try again." |
| `start_unknown` | Check the meeting | We couldn't confirm whether {BOT} joined. Check the meeting before starting again. |
| anything else | Unknown | Shown without crashing, so a new status from the api doesn't break the page. |

### Stage link
The api returns `stageUrl` to members of the owning org (api plan D8). It holds the stage's control token (see
[Where things stand](#where-things-stand-read-on-2026-10-18)). **Decision WD5** for this slice:
- Shown **only on the detail page**, behind a "Show stage link" button, never in the list or in any URL of the web app.
- Next to it: "This link controls the stage shown in the meeting. Anyone with it can change what's on screen and
  interrupt {BOT}'s voice. Don't share it, and don't open it while the meeting is running unless you mean to."
- Opening it puts the token in that browser's history; the warning says so. `GET /v1/sessions` no longer returns it
  (the api's start-guards change); only `GET /v1/sessions/:id` does.
- Rendered only if it parses as a URL with protocol `https:` (or `http:` when `import.meta.env.DEV`, for the local
  engine). Anything else isn't shown, so a bad value can never become a `javascript:` link.
- A "Copy" button, and an "Open" link with `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`.
- Never logged, never sent anywhere but the clipboard and that link, never stored in `localStorage`.
- **Later (outside this slice):** a separate read-only viewer token in the engine, like the hand-off token, so the
  web app can show a link that watches without controlling (X1 below).

### Talking to the api (`src/api/`)
- `createApiClient({ baseUrl, getToken, fetch })` returns `me()`, `listSessions(signal)`, `getSession(id, signal)`
  and `createSession(meetingUrl)`. `baseUrl` is `VITE_API_URL`. `fetch` is passed in so tests use a fake.
- **Token:** each call awaits `getToken()` from `useAuth()` and sends `Authorization: Bearer <token>`. That's Clerk's
  documented way to call a backend on another origin. No cookies are sent (`credentials: "omit"`). The token is never
  stored by our code, logged, or put in a URL. If `getToken()` returns null, the call isn't made and the page shows
  the sign-in state.
- **Requests:** `Accept: application/json`; `POST` adds `Content-Type: application/json` and the body
  `{ meetingUrl }` only.
- **Replies are parsed with zod, using tolerant web-side schemas** in `src/api/schemas.ts`, built from the shared
  ones in `@builder/contracts` after WC1: plain objects (unknown fields ignored), and `status` read with
  `z.string()` then mapped to a label (unknown → "Unknown"). A plain object with the contract's status enum would
  still reject a new status, which is why the web overrides that one field. Contract changes are additive (ADR 0004),
  so a new field or status from the api never breaks the page.
- **Errors** become one `ApiError { status, code, message, session? }`:
  - an api error body → its `code` (and the `session` that 502 and 504 carry)
  - a fetch that throws (offline, DNS, CORS refused) → `network_error`
  - a reply that isn't JSON or doesn't match the schema → `bad_response`
  - an aborted request (org switch, page left) → ignored, nothing shown

  The UI branches on `code` and shows our own text. The api's `message` is not shown.
- **No automatic retries,** for any call. A retried `POST /v1/sessions` can send a second paid bot (ADR 0010).
  The person retries with the Refresh or Start button.
- **No client-side timeout on `POST`.** The api waits up to 20 s for the engine; cutting the request short would turn
  a known answer into an unknown one.

### Errors (every api code)
The same mapping is used on every screen. "Network" codes are made by the web app, not the api.

| HTTP | `code` | Where it can happen | Shown | Action offered |
|---|---|---|---|---|
| 201 | (none) | `POST` | "{BOT} is joining the meeting." Session goes to the top of the list | link to its detail |
| 200 `reused: true` | (none) | `POST` | "This meeting already has a {BOT} session." with its status label (it may still be Starting) | link to that session |
| 400 | `invalid_request` | `POST` | "Use an https Google Meet, Zoom or Teams link." | fix the field |
| 400 | `invalid_json` | `POST` | "Something went wrong (invalid_json)." It's a bug in our app | none |
| 401 | `unauthenticated` | all | "Your sign-in has expired or isn't accepted here." | a "Sign in again" button (never automatic). If it keeps happening right after signing in, the api's `CLERK_AUTHORIZED_PARTIES` is missing this site's origin; the message says to contact support |
| 403 | `no_active_org` | all | "Choose an organization to continue." | go to `/choose-organization` |
| 403 | `forbidden` | none yet (helper exists) | "Your role in this organization can't do that." | none |
| 404 | `not_found` | `GET /v1/sessions/:id` | "No such session in this organization." | back to the list |
| 404 | `not_found` | any other route (means a wrong `VITE_API_URL`) | "Something went wrong (not_found)." | none |
| 405 | `method_not_allowed` | none expected | "Something went wrong (method_not_allowed)." | none |
| 413 | `payload_too_large` | none expected | generic, with the code | none |
| 415 | `unsupported_media_type` | none expected | generic, with the code | none |
| 500 | `internal_error` | `GET` | "Something went wrong on our side. Try again in a moment." | Refresh |
| 500 | `internal_error` | `POST` | **The 504 warning.** The api calls the engine before saving its answer, so a 500 can come after a bot was sent | list reloads; no retry button |
| 502 | `engine_rejected`, `session.errorCode` = `recall_rejected` | `POST` | "{BOT} couldn't join this meeting. Check the link and that the meeting is open, then try again." | Start is allowed again |
| 502 | `engine_rejected`, `session.errorCode` = `meeting_in_use` | `POST` | "{BOT} already has a session in this meeting. Check the meeting." | link to the list; no retry button |
| 502 | `engine_rejected`, any other `errorCode` | `POST` | "Starting meetings isn't working right now (`<errorCode>`)." A server setup problem | none |
| 503 | `auth_unavailable` | all | "Sign-in isn't available right now." | Refresh |
| 503 | `db_unavailable` | sessions routes | "Sessions aren't available right now." | Refresh |
| 503 | `engine_unavailable` | `POST` | "Starting meetings isn't available right now." Nothing was started | none |
| 503 | `limits_unavailable` | `POST` | "Starting meetings isn't set up on this server yet." Nothing was started | none |
| 429 | `rate_limited` | `POST` | "Too many starts in a short time. Wait a minute, then try again. Nothing was started." | none |
| 429 | `active_limit_reached` | `POST` | "This organization has as many sessions running as it's allowed. A session counts until its time limit has passed. Try again later. Nothing was started." | none |
| 429 | `daily_limit_reached` | `POST` | "This organization has started as many sessions as it's allowed in 24 hours. Try again later. Nothing was started." | none |
| 429 | `user_active_limit_reached` | `POST` | "You have as many sessions running as you're allowed. A session counts until its time limit has passed. Try again later. Nothing was started." | none |
| 429 | `user_daily_limit_reached` | `POST` | "You've started as many sessions as you're allowed in 24 hours. Try again later. Nothing was started." | none |
| 504 | `engine_outcome_unknown` | `POST` | **Warning:** "We couldn't confirm whether {BOT} joined. Check the meeting for a {BOT} bot before trying again." | link to the session; **no retry button**; list reloads; the WD8 guard applies |
| (none) | `network_error` | `POST` | **The 504 warning:** "We lost the connection while starting. Check the session list and the meeting before trying again." | list reloads; no retry button |
| (none) | `network_error` | `GET` | "Can't reach {PRODUCT}. Check your connection." | Refresh |
| (none) | `bad_response` | `GET` | "Something went wrong (bad_response)." | Refresh |
| (none) | `bad_response` | `POST` | **The 504 warning** | list reloads; no retry button |
| any other | any other | `GET` | "Something went wrong (`<code>`)." | Refresh |
| any other | any other | `POST` | **The 504 warning** | list reloads; no retry button |

On `POST`, only these replies mean no new bot was started: 200 `reused`, 400, 401, 403, 404, 405, 413, 415, 502 and
503 (a 502 `meeting_in_use` means an earlier bot may be there, but this call sent none). **Every other `POST`
outcome (201 aside) shows the 504 warning**, because a bot may exist.

### Security
- **No secrets in the browser.** Vite builds every `VITE_*` variable into public JavaScript, so the web app has
  exactly two: `VITE_CLERK_PUBLISHABLE_KEY` (public by design) and `VITE_API_URL`. No Clerk secret key, engine token,
  SurrealDB credential or Recall key ever goes in `apps/web`. A test fails if the code reads any other
  `import.meta.env.VITE_*` name, and `vite.config.ts` keeps Vite's default `envPrefix` (`VITE_`).
- **No auth bypass.** There's no "dev login" or fake-auth switch in the app or the api. Local work uses a free Clerk
  development instance; tests mock Clerk at the module level only.
- **Tokens** live in Clerk's SDK only. Our code doesn't put them in `localStorage`, `sessionStorage`, URLs or logs.
- **Safe rendering.** React escapes text. No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval` or `new Function`.
  Meeting links are shown as text, not links. The only `href` built from api data is the stage link, after the
  protocol check above. A test scans `src/` for `dangerouslySetInnerHTML`, `innerHTML`, `localStorage` and
  `console.`.
- **Content Security Policy (WD11).** From Clerk's CSP guide, with `{FAPI}` the Clerk instance's Frontend API host
  (for a dev instance, under `clerk.accounts.dev`) and `{API_ORIGIN}` the api's origin. Render's `headers` values in
  `render.yaml` are literal text, so a policy that names those origins can't live there without writing a URL into
  the repo. It's split in two:
  - **Built into `index.html`** as `<meta http-equiv="Content-Security-Policy">`, by a small Vite plugin
    (`transformIndexHtml`) at build time. It takes `{API_ORIGIN}` from `VITE_API_URL` and `{FAPI}` from
    `VITE_CLERK_PUBLISHABLE_KEY` (the part after `pk_test_` or `pk_live_` is the base64 of the host plus `$`). With
    either variable missing or not parsing, the build still succeeds and writes the strict policy below without those
    origins, so the page shows "not configured" instead of loading anything. A unit test covers the derivation. In
    `vite dev` the plugin adds nothing (Vite's dev client needs `'unsafe-eval'` and websockets).
  - **Sent as a header by Render** (`render.yaml`, no URLs): `Content-Security-Policy: frame-ancestors 'none';
    object-src 'none'; base-uri 'self'`, because a `<meta>` policy ignores `frame-ancestors`. A browser enforces both
    policies.

  The `<meta>` policy:

  ```
  default-src 'self';
  script-src 'self' https://{FAPI} https://challenges.cloudflare.com https://*.protect.clerk.com;
  connect-src 'self' {API_ORIGIN} https://{FAPI} https://*.protect.clerk.com:*;
  img-src 'self' https://img.clerk.com;
  style-src 'self' 'unsafe-inline';
  worker-src 'self' blob:;
  frame-src https://challenges.cloudflare.com https://*.protect.clerk.com;
  form-action 'self'; base-uri 'self'; object-src 'none'
  ```

  `style-src 'unsafe-inline'` is required by Clerk's runtime styles. No `'unsafe-eval'` in production. Clerk
  telemetry is turned off (`telemetry={false}` on `ClerkProvider`), so its host isn't needed. The `<meta>` tag goes
  first in `<head>`, before any script. Also as Render headers (no URLs): `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. I1 checks the
  deployed placeholder for CSP errors in the browser console, and every later step that adds a screen checks that
  screen on the deployed site after it merges.
- **No URLs in the code.** A test scans `src/`, `index.html` and `vite.config.ts` for `onrender.com` and any
  `https://` origin other than the Clerk and Cloudflare hosts the CSP names. Origins come only from `VITE_*`.
- **CORS** is on the api side (A1): exact allowed origins, no credentials.
- **Never logged, anywhere:** session tokens, meeting links, stage links, request or response bodies, api error
  messages. The web app has no logger and no analytics or error-reporting script in this slice (WD9). If one is
  added later, it must strip URLs and bodies first.
- **Tenancy** is enforced by the api from the token. The web app never sends an org id, and the tests prove it.

## Visual design
Settled in [ADR 0015](../adr/0015-web-visual-design.md): the **Boardroom** direction, chosen from three previewed
directions and refined after two separate reviews. UI and design are a judging criterion and the app will be shown to
investors, so the look is part of "done" for every screen step, not polish for later. In short:

- **Character:** calm, premium, minimal. The boldness is in one place: each session is identified by its meeting
  code, set large (`kfp-qzwd-nre`). No borders on surfaces, no grey card stacks, no default shadcn/ui styling.
- **Stack:** Tailwind CSS 4 for layout and tokens, Radix primitives for behavior and accessibility only, our own
  components in `src/components/`, `lucide-react` icons, `sonner` toasts, Schibsted Grotesk (one family, self-hosted).
- **Tokens:** semantic CSS variables in `src/styles/globals.css`, light and dark, following the system setting. All
  text is AA or better (measured; the full table, including the status pills, is in ADR 0015):

  | | Light | Dark |
  |---|---|---|
  | page / surface | `#f4f6f5` / `#ffffff` | `#0f1513` / `#1b2421` |
  | text / secondary / tertiary | `#1a2220` / `#56605d` / `#616b68` | `#eef3f1` / `#a3aeaa` / `#8f9b97` |
  | primary (evergreen) | `#0d5c4c` | `#4fcfa6` |
  | live dot | `#19a67a` | `#4fcfa6` |

- **Brand:** `PRODUCT_NAME` beside the mark: an evergreen tile with a dashed frame behind a solid one, the product's own
  "still being decided, then agreed" rule. The favicon is the mark. `BOT_NAME` in every line that names the bot. Both
  names from `src/brand.ts`.
- **Signature details:** the mark; a dashed underline under the code of sessions still on their way; a faint dot grid
  in the top-left corner that fades out.
- **Sessions list:** one tappable row per session (the whole row is the link), inset hairlines, a soft plate on hover
  and press, a chevron. The code first and largest, then the status pill, then platform and time. Ended and failed
  codes fade. On phones the pill and "Google Meet, 12 min ago" share a line; on desktop the pill aligns to the right
  edge, the list is at most 720px wide, and "Recent" shares a baseline with the page title.
- **Status pills:** 30px, 14px semibold, a tint and a dot per status: In the meeting (mint, a breathing dot), Starting
  and Joining (a dashed, slowly turning ring), Check the meeting (amber), Didn't start (red tint), Failed (solid red,
  a diamond), Ended (quiet grey), Unknown (grey, a "?"). Never color alone.
- **Navigation:** the slice has one top-level page (Sessions), so no bottom tab bar yet: a one- or two-tab bar would
  look empty and add a tap for nothing. Instead:

  | | Phone (below 768px) | Desktop (768px and up) |
  |---|---|---|
  | Top bar | the mark, org switcher, account button (wordmark hidden under 400px) | the same, with the wordmark |
  | New session | full-width pill in a sticky bottom bar (thumb reach, above the safe area), opens a bottom sheet | 768-1023px: the same bar, opening a centered dialog; 1024px and up: the start panel, sticky in the left column |
  | Session detail | a pushed screen with a back button | a page with a back link |
  | Confirmations | bottom sheet | centered dialog |

  When the library, billing and settings pages arrive (three to five top-level pages), phones get a bottom tab bar
  and desktop a sidebar.
- **Each screen's states:** skeletons shaped like the rows (after 150 ms); busy buttons with a spinner; the empty state
  (a small dashed-to-solid illustration, "Start your first session", the three real steps, and on phones one button);
  error callouts with the error table's text and action; centered page states (not configured, no such session);
  toasts only for non-critical confirmations. The unknown-outcome warning is always a persistent amber callout.
- **Motion:** 150–250 ms, ease-out: sheets slide up, dialogs fade and scale, rows and buttons press, the live dot
  breathes, the joining ring turns. Nothing moves under reduced motion.
- **Responsive:** 360px phones to large desktops, no sideways scrolling, content at most 1180px wide, gutters 20 and
  40px. Touch targets 44px or more (rows 64px or more), inputs at 16px (no iOS zoom), safe-area insets, `theme-color`.
- **Accessibility (WCAG 2.2 AA):** contrast as measured, a visible focus ring everywhere, labels with linked hints and
  errors, landmarks and headings in order, start results in `role="status"`, the warning in `role="alert"`, Radix
  dialogs and sheets (focus trapped and restored, Escape closes), nothing that depends on hover.
- **Clerk** is themed through `appearance.variables` pointing at the same CSS variables, so sign-in, sign-up, the org
  switcher and the user menu match in light and dark.
- **The previews** the direction was chosen from are outside the repo; `/_design` (W1b) becomes the reference.

### How the look is checked
- **`/_design`** (dev server only, not in the production build): every component and state, light and dark
  (`?theme=light|dark`), with a reduced-motion switch.
- **Screenshots** by `apps/web/scripts/screenshots.ts` (`npm run screenshots -w @builder/web`): `playwright-core`
  drives the installed Chrome against the local dev server only, at 360×780, 390×844, 768×1024, 1280×800 and
  1536×960, light and dark, full page, into `apps/web/screenshots/` (git-ignored). It also runs `axe-core` in the page,
  contrast included, and fails on any violation and on any page wider than the viewport. It never runs in
  `npm test` or CI. `/_design` loads no Clerk script and calls nothing. Screens from W2 on are captured against the
  local setup (engine in local mode, so no bot and no model spend) and the free Clerk development instance.
- **While building:** each screen and state is opened in a real browser at those widths, in both modes, and fixed
  until it looks right.
- **Approval gate:** after W1b, the `/_design` screenshots (phone and desktop, light and dark) are shown for approval
  before W2 starts. Changes asked for there are made in W1b.
- **Review per screen step (W2–W6):** a separate review agent, which didn't build the step, judges that step's
  screenshots for polish, consistency with `/_design` and responsiveness. Its findings are fixed, or listed with a
  reason, before the step is reported done.
- **In the tests:** `axe-core` on each rendered screen and state in jsdom (names, roles, structure; jsdom can't
  compute contrast), and a guard that fails on a raw color outside `globals.css` and the favicon.

## Local development
Three terminals, all on Node 24 (`.nvmrc`). This setup sends **no bot and spends nothing**: the engine runs in local
mode, which uses a stand-in for Recall, and with no model key set.

| # | What | Command | Port |
|---|---|---|---|
| 1 | engine, local mode | `npm run local` | 3000 |
| 2 | api | `npm start -w @builder/api` | 3001 |
| 3 | web | `npm run dev -w @builder/web` (Vite with `strictPort`, so the origin stays `http://localhost:5173`) | 5173 |

**Env variables, names only** (each app reads its own `.env`, which git ignores):

| App | File | Variables |
|---|---|---|
| web | `apps/web/.env` | `VITE_CLERK_PUBLISHABLE_KEY` (Clerk dev instance), `VITE_API_URL` (`http://localhost:3001`) |
| api | `apps/api/.env` | `CLERK_JWT_KEY` (dev instance's PEM public key), `CLERK_AUTHORIZED_PARTIES` (`http://localhost:5173`), `ENGINE_INTERNAL_URL` (`http://localhost:3000`), `ENGINE_INTERNAL_TOKEN`, `DEFAULT_MAX_USD`, `DEFAULT_MAX_MINUTES`. Leave `SURREAL_*` empty: SurrealDB runs in the api's process. `PORT` optional |
| engine | `apps/engine/.env` | `ENGINE_INTERNAL_TOKEN` (the same value as the api's, 32+ characters). Leave `OPENROUTER_API_KEY` and `TTS_VOICE` empty, so no model is called. `PORT` and `SURREAL_PATH` optional |

- Without the engine running, `POST` answers 504 `engine_outcome_unknown` (network error to the engine); without
  `ENGINE_INTERNAL_*` in the api, 503 `engine_unavailable`. Both are useful for checking the warnings by hand.
- **Never run the engine with `npm start` and a Recall key for web work.** That sends a real, paid bot. Ask first.
- Step W1 adds `apps/web/.env.example` (names only) and `dist/` to `apps/web/.gitignore`.
- A root `npm run dev` that starts all three is optional (R1).
- **Or with Docker:** `docker compose up --build` runs SurrealDB, the engine in local mode and the api on the same
  ports, from the images Render runs, then `npm run dev -w @builder/web` on the host. The api needs `CLERK_JWT_KEY`
  and `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` in `apps/api/.env`, and the session limits, as above. Compose
  sets its own engine token and database. Compose has no web service, and this plan doesn't add one.

## Testing (no real Clerk, api, engine or paid service)
- **Vitest + jsdom + Testing Library**, in `apps/web/test/`, run by `npm run check` and CI, offline.
- **The network is blocked.** A setup file replaces `globalThis.fetch` and `WebSocket` with stubs that fail the test,
  so nothing can reach Clerk, the api or the engine by accident.
- **Clerk is mocked** with `vi.mock("@clerk/react")` in `test/helpers/clerk.tsx`: signed out, pending (no org), and
  signed in with org A or org B as `org:admin` or `org:member`. It provides `useAuth()` (with a fake `getToken()`
  that returns a per-org fake string), `useOrganization()`, and stub components that render a test id. Clerk's script
  is never loaded.
- **The api is a fake `fetch`** in `test/helpers/fake-api.ts`. It records each request and answers with bodies built
  through the `@builder/contracts` schemas, so a shape change in the api breaks the web's tests.
- **Cases:**
  - Each auth state goes to the right route: signed out on `/sessions/:id` lands on `/sign-in`; pending (no org)
    lands on `/choose-organization`; `/choose-organization` with no pending task shows the org list.
  - Every call sends `Authorization: Bearer <token>` and no org id in the URL, body or headers; `credentials` is
    `omit`.
  - Switching org aborts the old `GET`s, reloads the list, and never shows org A's rows under org B, even if A's
    reply arrives late. On the detail page, a switch goes back to `/`. A `POST` in flight is not aborted, and its
    result is still shown.
  - The list: loading, empty, error, an unknown status, and no stage link in any row.
  - Every row of the [error table](#errors-every-api-code), for the routes where it applies, including the three 502
    variants by `errorCode` and 404 outside the detail route.
  - Every `POST` outcome not in the "no new bot" list (504, 500, `network_error`, `bad_response`, an unknown code)
    shows the warning, reloads the list, and has no retry button.
  - The WD8 guard: a recent `start_unknown` for the same link asks before sending.
  - The button is disabled while submitting; a double click sends one request; nothing is retried automatically.
  - A link that isn't an `https:` URL sends nothing.
  - The stage link: hidden until asked; a `javascript:` or `http:` (outside dev) value is never rendered as a link;
    the link has `rel="noopener noreferrer"`.
  - A reply that doesn't match the schema shows an error instead of crashing; a new status or extra field doesn't.
  - Guards: no `VITE_*` name other than the two; no `dangerouslySetInnerHTML`, `innerHTML`, `localStorage` or
    `console.` in `src/`; no raw colors outside `globals.css` and the favicon.
  - `axe-core` finds no violations on each screen and state (see [How the look is checked](#how-the-look-is-checked)).
- **Not in this slice:** browser end-to-end tests (Clerk's testing helpers need a real instance and its secret key).
  Instead, the [manual check](#manual-check-before-the-demo).

### Manual check before the demo
Against the Clerk dev instance and the three local apps above. The engine is in local mode, so no bot is sent:
1. Sign up; the choose-organization step appears; create org A; the list is empty.
2. Start a Meet link; it appears at the top as Joining; its detail page shows the stage link only after "Show".
3. Start the same link again: "This meeting already has a {BOT} session."
4. Stop the engine and start a different link: the 504 warning, no retry button, the session shows "Check the
   meeting". Start that link again: the guard asks first.
5. Create org B, switch to it: empty list. Switch back: A's sessions.
6. Sign out, sign back in: back on `/` in the last org.

**On the deployed site** (from I1 on, each screen as its step merges), first check without a bot: sign-in, org
choice, the list, and no CSP errors in the browser console on every screen; no 401 loop (a 401 right after sign-in means the api's
`CLERK_AUTHORIZED_PARTIES` lacks the site's origin). With the deployed engine unreachable or not configured, the
start form shows the 503 or 504 messages; with D5's limits unset, 503 `limits_unavailable`. **Starting a session on the deployed site sends a real, paid Recall bot:
ask first** (AGENTS.md), use a meeting you control, and end the bot afterwards.

## Deployment on Render
Per ADR 0005, in the root `render.yaml` Blueprint, next to `builder-engine` and `builder-api`. This is I1, an
infra-area change (see [Changes outside apps/web](#changes-outside-appsweb)). The Blueprint exists, so I1 only adds a
service, and it comes right after W1 (a placeholder page that calls nothing).
- **Service:** `builder-web` (the same internal prefix as the other two; it isn't the product name and appears only
  in Render and in the default `onrender.com` host), `type: web`, `runtime: static`, $0, served from Render's CDN.
  Static sites take no `region`, `plan`, `numInstances`, `preDeployCommand` or health check.
- **No Dockerfile (WD10).** ADR 0005 says each app has a Dockerfile; that fits services that run a process, and a
  static site runs none. Recording this exception is D-INFRA below. CI's image job is unchanged.
- **Build from the repo root, no `rootDir`** (as for the other two, so `contracts/` is there):
  `buildCommand: npm ci --workspace @builder/web --include-workspace-root && npm run build -w @builder/web`,
  `staticPublishPath: ./apps/web/dist`. Render's docs list `NODE_VERSION`, `.node-version` and `engines`, not
  `.nvmrc`, so the service sets `NODE_VERSION` to the same Node 24 minor as the Dockerfiles (`node:24.22`). Its
  default is also a Node 24, but pinning keeps the site and the images in step.
- **`buildFilter`,** matching the other services: `paths` `apps/web/**`, `contracts/**`, `package.json`,
  `package-lock.json`, `.nvmrc`; `ignoredPaths` `apps/web/test/**`, `apps/web/README.md`, `contracts/README.md`.
- **`autoDeployTrigger: checksPass`** and `branch: main`, as for the other services.
- **Routes:** one `rewrite`, source `/*`, destination `/index.html`. Render doesn't apply a rewrite to a path where a
  file exists, so `/assets/*` still load.
- **Headers** for `/*`, all URL-free: the `frame-ancestors` CSP and the other headers from [Security](#security), plus
  `Cross-Origin-Opener-Policy: same-origin-allow-popups` (no other site's window can script the app; the stage still
  opens in a new tab). The
  origin-bearing CSP is in the built `index.html` (WD11). Render keeps header and route rules made in the dashboard
  that aren't in the Blueprint, so set them only in `render.yaml`.
- **Env:** `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` (`{API_ORIGIN}`, from `builder-api`'s page), both
  `sync: false`. Neither is secret, but `sync: false` keeps origins out of the repo. Render asks for `sync: false`
  values only when a Blueprint is first created, so on this existing Blueprint they're set by hand on `builder-web`'s
  page (runbook, "The web app"). They're read at build time, so changing either needs a new deploy of the site.
- **Not from `fromService`:** Render's `fromService` gives a service's private `host`, `port` or `hostport`, not its
  public URL, so it can't fill `VITE_API_URL`.
- **The api's settings** (dashboard, on `builder-api`, since both are `sync: false`): add `{WEB_ORIGIN}` to
  `CLERK_AUTHORIZED_PARTIES`, comma-separated next to `http://localhost:5173` if the dev instance is shared. A1 also
  uses that list for CORS. Saving redeploys only the api, which doesn't end meetings.
- **Same Clerk instance on both sides.** The publishable key on the site and `CLERK_JWT_KEY` on `builder-api` must be
  from the same instance, or every call gets 401. If `builder-api` already has a key from another instance, I1 checks
  which one before setting the site's key.
- **Clerk for the demo (WD7):** the development instance, on the site's `onrender.com` origin. A production instance
  needs a domain we own with DNS records, and the domain isn't chosen. A dev instance shows a "development mode"
  badge and has dev limits, which is fine for the demo.
- **The runbook** gets the site: a row in the production table, the two variables in the Blueprint step, the
  `CLERK_AUTHORIZED_PARTIES` step, and the cost (unchanged, the site is free). Same PR as I1.
- **Starting a session from the deployed site** needs D5's limits set on `builder-api` (otherwise 503
  `limits_unavailable`), and it sends a real, paid Recall bot: ask first.
- **Known issue R6 doesn't change:** a static site runs no process on the private network, so it can't reach the engine's
  operator routes.
- **Fallback if the deploy isn't working by 2026-10-24:** demo from a laptop with the local setup (engine in local
  mode, or a real engine only with approval), which needs none of I1.

## Steps
Each step is its own branch from fresh `main`, with tests, squash-merged, and leaves `main` working. Sizes: S = up
to 2 hours, M = about half a day, L = about a day.

| # | Branch | What | Size | Safe alone because |
|---|---|---|---|---|
| W0 | `web/adr-stack` | ADR 0012: Vite + React static app, React Router, the Clerk wiring and org flow, Bearer tokens to the api, no retries, the error mapping rule, stage-link handling, Render static site with the split CSP, names and origins from configuration. Settles WD1, WD2, WD5–WD11 for the web app | S | docs only |
| W1 | `web/scaffold` | Vite + React + TS in `apps/web`: `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`, `tsconfig.json`, `.env.example`, `.gitignore`, scripts `dev`, `build`, `test`, `typecheck`, `check`; `src/brand.ts`; the build-time CSP plugin and its test; network-blocking test setup; the source-scan guard tests (including no URLs); README update. Installs every package in the version list, Clerk and the design packages included, so later steps don't touch the lockfile. **Lockfile change: redeploys the engine and the api, so merge outside meetings** | M | renders a placeholder; calls nothing |
| W1b | `web/design-foundation` | ADR 0015 (Boardroom) in code: Tailwind via `@tailwindcss/vite`, `src/styles/globals.css` (tokens, light and dark, base styles, focus ring, the dot texture, Clerk's layer), Schibsted Grotesk, `src/lib/cn.ts`, the components in `src/components/` (button, input and field, status pill, session row, skeleton, callout, dialog, bottom sheet, responsive modal, toaster, empty state, page state, the mark), the app shell (top bar, sticky action bar, content container) with the mark and wordmark, `src/clerk/appearance.ts`, `index.html` (`viewport-fit`, `theme-color`, favicon), `public/favicon.svg`, the dev-only `/_design` page, `scripts/screenshots.ts` and `npm run screenshots`, `screenshots/` in `.gitignore`, axe and raw-color tests. **Ends at the approval gate** | M | only `apps/web/`; no lockfile change; the placeholder home uses the shell and calls nothing; `/_design` isn't in the production build |
| I1 | `infra/render-web` | `builder-web` static site in `render.yaml`, the runbook's production section; then, in the dashboard, its two variables and `{WEB_ORIGIN}` in the api's `CLERK_AUTHORIZED_PARTIES`. Placeholder checked live: loads, routes rewrite, headers present, no CSP errors | S | the site calls nothing yet; the Blueprint change adds a service and touches no other |
| W2 | `web/clerk-auth` | `ClerkProvider` with the wiring above, the routes and guard, sign-in/up, `/choose-organization` with its fallback, header with `<OrganizationSwitcher hidePersonal />` and `<UserButton />`, "not configured" screen, `test/helpers/clerk.tsx`. Org flow checked by hand on the dev instance | M–L | no api calls yet |
| W3 | `web/api-client` | `src/api/client.ts`, `src/api/schemas.ts` (tolerant), `ApiError`, the error mapping, `test/helpers/fake-api.ts`; `GET /v1/me` shows the role in the header | M | `/v1/me` exists; reads only. Needs A1 to work in a real browser |
| W4 | `web/sessions-list` | The list, labels, states, Refresh, reload on org change | M | reads only |
| W5 | `web/start-session` | The form, every `POST` outcome, the warnings, the WD8 guard | M–L | the api reuses active sessions and the engine refuses a second bot per org and meeting; no retries |
| W6 | `web/session-detail` | `/sessions/:id`, status explanation, limits, error code, the stage link behind "Show" | M | reads only |

- **Order:** W0 and the outside items A1, WC1 and K1 first (they're small and others wait on them). Then W1, W1b and
  I1. **W2 starts only after the W1b screenshots are approved.** W2–W3 can then start at once; W4–W6 need WC1 (or the
  temporary copy below). After each step from W2 on merges, its screens are checked on the deployed site too.
- **Done for a screen step** means, besides its tests: every state styled from the shared components; checked in a
  real browser at 360, 390, 768, 1280 and 1536px, light and dark, reduced motion on and off; no sideways scrolling;
  `npm run screenshots` passes (axe included); and the separate visual review's findings fixed or listed with a reason.
- **Merges that redeploy the engine** (and so end live meetings): W1 (lockfile) and WC1 (`contracts/`). Merge them
  when no meeting is running, or pause the engine's auto-deploy first (runbook). The other web steps change only
  `apps/web/` and deploy only the site.
- **What to cut first if time runs short**, in this order:
  1. The WD8 guard's confirmation step (the 504 warning itself is never cut; the engine already refuses a second
     bot for the same org and meeting in nearly every case).
  2. The role in the header (`GET /v1/me`).
  3. Route transitions and the pulsing status dots (the rest of the motion stays).
  4. The two-column detail layout on large screens (one column everywhere).
  5. Checking every screen on the deployed site: if the deployed site misbehaves late, demo locally instead.
  6. The session detail page: show the status in the list and drop the stage link from the web app for the demo.

  Never cut: sign-in, org choice and switching, the list, the start form, the `POST` warnings, the design foundation
  (tokens, components, light and dark), responsive layout down to 360px, WCAG 2.2 AA, the per-step visual review, and
  (when deployed) the CSP.

## Changes outside apps/web
Each needs review from that area. None of them changes how another area behaves except as written.

**api (`apps/api`):**
- **A1. CORS (blocks a real browser from talking to the api).** A small step in `createHandler`, before route
  matching, so it covers every reply including 404, 405 and 500:
  - If `Origin` is in the allowed list, add `Access-Control-Allow-Origin: <that origin>` and `Vary: Origin`.
    Otherwise add nothing (the browser then blocks it). No wildcard, no `Access-Control-Allow-Credentials`.
  - `OPTIONS` on any `/v1/*` path answers 204 with `Access-Control-Allow-Methods: GET, POST`,
    `Access-Control-Allow-Headers: Authorization, Content-Type` and `Access-Control-Max-Age: 600`, without auth. Today
    it answers 405.
  - The allowed list is `CLERK_AUTHORIZED_PARTIES` (WD4): the same web origins that may hold tokens. With Clerk off,
    CORS is off.
  - Tests: allowed origin on 200 and on an error, other origin, preflight, no credentials header.
- **A2. `POST /internal/engine-events`.** Built on 2026-10-20: statuses move with the engine's events, and the list
  and the session page refresh quietly while a session may still change (WD6).
- **A3 (later). Leave `stageUrl` out of `GET /v1/sessions`,** keeping it on `GET /v1/sessions/:id` and the `POST`
  reply, so the list never carries control tokens.
- **D5 (the api plan's open decision).** `DEFAULT_MAX_USD` and `DEFAULT_MAX_MINUTES` on `builder-api`. Not needed
  for the web app's code or the local demo, but a deployed start answers 503 `limits_unavailable` until they're set.

**contracts (`contracts/`, additive, reviewed for both the engine and the api):**
- **WC1. Move the api-to-web shapes** from `apps/api/src/routes/schemas.ts`: `ApiSessionStatus`, `SessionView`,
  `SessionList`, `SessionResponse`, `CreateSessionResponse`, `StartFailedResponse`, a `MeResponse`
  (`{ userId, orgId, role }`) and the error shape `{ error: { code, message } }`. (Named WC1 so it doesn't clash with
  the api plan's C1; it is the api plan's "C3", and ADR 0010's rule "move when apps/web imports them".)
  - Exported as plain `z.object`, like the other contracts, so a reader ignores new fields. The api uses these as
    types for the replies it builds, as it does today.
  - `MeetingUrl`, `CreateSessionBody` and `toSessionView` stay in the api: the host allowlist and URL normalization
    are logic, which ADR 0004 keeps out of `contracts/`. The web app only checks for an `https:` URL.
  - Until WC1 lands, W4–W6 may use a temporary copy in `apps/web/src/api/schemas.ts`, replaced in the PR that switches
    to `@builder/contracts`.

**engine (`apps/engine`):**
- **X1 (later). A read-only stage viewer token,** so the web app can link to a stage that watches without sending
  `ui_screen` or `barge_in`. Until then, the stage link is handled as in [Stage link](#stage-link).

**infra:**
- **I1.** The `builder-web` static site in the existing `render.yaml` (see [Deployment](#deployment-on-render)), the
  runbook update, and, in the dashboard, `{WEB_ORIGIN}` in `builder-api`'s `CLERK_AUTHORIZED_PARTIES`. Right after
  W1. The Blueprint with the engine and the api is on `main` already.
- **D-INFRA.** Amend ADR 0005 for WD10: a static site has no Dockerfile.

**Identity (Clerk dashboard and ADR 0006, shared with the api plan):**
- **K1.** A development instance with Organizations on, membership required, and the dev instance's PEM key in the
  api's `CLERK_JWT_KEY`. Its publishable key goes in `apps/web/.env` and on Render.
- **D-ID.** Amend ADR 0006's "sign-up creates a personal org of one" to "sign-up requires creating or joining an org"
  (membership required, the api plan's D3).

**Root:**
- **R1 (optional).** A root `npm run dev` that starts the engine in local mode, the api and the web app together.

## Decisions
Each has a recommendation. W0 records the web ones in ADR 0012 and ADR 0015 records WD12; D-INFRA and D-ID need their areas' agreement.

- **WD1. Framework.** *Recommended:* Vite + React static site. Alternative: Next.js on a $7 web service.
- **WD2. Routing.** *Recommended:* React Router with five routes, Clerk on `routing="path"`. Alternative: one page
  with hash routing; it can't give each session its own URL.
- **WD3. When the shapes move to `contracts/`.** *Recommended:* WC1 now, before W4. Alternative: a temporary copy in
  the web app until after the demo.
- **WD4. CORS allowlist source.** *Recommended:* reuse `CLERK_AUTHORIZED_PARTIES`. Alternatives: a separate
  `CORS_ORIGINS` variable, or a Vite dev proxy plus a Render rewrite (no CORS, but local and production then differ).
- **WD5. The stage link.** *Recommended:* detail page only, behind "Show", with the warning, until X1 gives a
  read-only link. Alternative: don't show it at all in the web app for now.
- **WD6. Status updates.** *Done with A2 (2026-10-20):* a Refresh button, and the list and a session's page
  refresh themselves quietly every 10 seconds while a session may still change (starting, joining, in the meeting
  or unconfirmed, within its time limit plus 30 minutes), only while the tab is visible. A background refresh
  that fails changes nothing on screen and announces nothing.
- **WD7. Clerk instance for the demo.** *Recommended:* the development instance on the site's `onrender.com` origin.
  The domain isn't chosen, so a production instance (which needs DNS on our own domain) waits for that decision.
- **WD8. Starting again after an unknown outcome.** *Recommended:* the web app asks first (above), as a second line
  of defense behind the engine's per-org, per-meeting check. Alternative: the api also reuses `start_unknown`
  sessions, which also blocks starting again after a start that really failed; that's an api decision.
- **WD9. Analytics and error reporting.** *Recommended:* none in this slice. Alternative: a tool that strips URLs and
  bodies, after its own review.
- **WD10. Dockerfile for the web app.** *Recommended:* none; it's a static site (D-INFRA). Alternative: an nginx image
  on a $7 web service.
- **WD11. Where the CSP's origins come from.** *Recommended:* a `<meta>` policy built into `index.html` from the two
  `VITE_*` variables, plus a URL-free header policy in `render.yaml` for `frame-ancestors`. Alternatives: the whole
  policy as a `render.yaml` header (writes the api and Clerk origins into the repo, and needs editing when the domain
  changes), or a looser `connect-src https:` (allows any host).
- **WD12. Visual design.** *Decided:* the Boardroom direction ([ADR 0015](../adr/0015-web-visual-design.md)):
  Tailwind CSS for layout and tokens, Radix for behavior only, our own components, one token set for light and dark,
  mobile-first with a sticky action bar and bottom sheets on phones, and an approval gate before the screens. Chosen
  over "Blueprint" (bold ultramarine) and "Huddle" (warm tiles) from previews, and over plain CSS (accessible dialogs
  and sheets by hand) and a full component library (a recognizable look). The engine's `theme.css` isn't reused: it's
  the prototype kit sized for the screenshare.
- **Effort:** W0 and W1 done (W1 gets the design packages before it merges). W1b about a day, I1 about two hours,
  W2–W6 about four days with the visual review in each. That fits before 2026-10-25 if W1b is approved by about
  2026-10-21, and A1, WC1 and K1 land by then too.
- **Outside items the demo needs:** A1, WC1 and K1 by about 2026-10-20; I1 by about 2026-10-21 (the engine and api
  are on Render already). For a start from the deployed site, D5's limits set by about 2026-10-23. Otherwise, the
  local fallback.
- **The biggest risks** are now the time the visual work takes (W1b's approval gate keeps it from spreading into
  every screen step) and Clerk's org flow, checked by hand in W2, and on the deployed site from W2 on. The
  deploy is smaller than before: the Blueprint and CD exist, and I1 lands early with a page that calls nothing. The
  other risk is a merge that redeploys the engine during someone's meeting (W1, WC1).
