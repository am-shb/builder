# Plan: the web app's first slice (sign-in, orgs, sessions, start a session)

- **Status:** proposed. No web code yet.
- **Date:** 2026-10-18 (rewritten against `main` at `2c87931`)
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
  -> GET  {API}/v1/me
  -> GET  {API}/v1/sessions
  -> GET  {API}/v1/sessions/:id
  -> POST {API}/v1/sessions { meetingUrl }        every call: Authorization: Bearer <Clerk session token>
```

**Not in this slice:** live updates (the api doesn't receive engine events yet), cost so far, hand-off links and
library, billing, calendar, staff pages, invitations beyond what Clerk's components already offer, a design system.

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
  `barge_in` stops Builder's voice in the live meeting**. It can also play Builder's voice locally. It is a control
  link, not a viewing link (see [Stage link](#stage-link)). `GET /v1/sessions` returns it for every row.
- **The api has no CORS handling.** A browser on another origin can't read its replies, and `OPTIONS` answers 405.
- **No `render.yaml` on `main` yet.** Ports: engine 3000, api 3001, Vite 5173.
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

**Header** (on `/` and `/sessions/:id`): the app name, `<OrganizationSwitcher hidePersonal />`, the role from
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
  aborted, cached lists are dropped, and the list reloads. On `/sessions/:id`, a switch goes back to `/`, because the
  session belongs to the old org (and would 404 under the new one).
- **A `POST /v1/sessions` is never aborted,** by an org switch or anything else: aborting it would turn a known
  outcome into an unknown one. Its result is still shown after a switch, naming the org it was started in. The form
  is disabled while a start is in flight, and the switcher is the only way to change org, so a start can't silently
  land in an org the person didn't see on screen when they pressed Start.
- The page hides nothing by role in this slice. Admins and members can both start meetings (ADR 0006), and the api
  enforces roles.

**Session list (`/`):** newest first, up to 50 (no paging, as in the api). Each row: the meeting link as plain text,
the status label, when it was started (local time, relative), and a link to its detail page. **No stage link in the
list.** States: loading, empty (points at the form), error (by code, below). A Refresh button. No polling (WD6).

**Start form (on `/`):**
- One field (the meeting link) and a Start button.
- Before sending, the browser only checks that the link parses as an `https:` URL. Which meeting hosts are allowed
  is the api's rule (`MeetingUrl` in `apps/api/src/routes/schemas.ts`), so it lives in one place; the api's 400
  `invalid_request` covers the rest. A refused link shows "Use an https Google Meet, Zoom or Teams link." and sends
  nothing.
- The button is disabled while the request is in flight, so a double click sends one request.
- **Guard after an unknown outcome (WD8):** if the list has a `start_unknown` session for the same normalized link
  from the last 30 minutes, Start shows a confirmation first: "An earlier start for this link didn't confirm.
  Check the meeting for a Builder bot before starting another." with "Start anyway" and "Cancel".
- Outcomes are in [Errors](#errors-every-api-code).

**Session detail (`/sessions/:id`):** from `GET /v1/sessions/:id`. Shows the status label and a one-line
explanation, the meeting link as text, created and updated times, the limits (`maxUsd`, `maxMinutes`), the
`errorCode` if there is one (as a code, for support), the stage link (below), and a Refresh button. 404 shows "No
such session in this organization." with a link back.

**Status labels:**

| Status | Label | Explanation on the detail page |
|---|---|---|
| `starting` | Starting | We're asking Builder to join. |
| `joining` | Joining | Builder is joining the meeting. Admit it if the meeting asks. |
| `in_meeting` | In the meeting | Builder is in the meeting. |
| `ended` | Ended | |
| `failed` | Failed | Builder left the meeting because of an error. |
| `start_failed` | Didn't start | The meeting service refused. Check the link and try again. |
| `start_unknown` | Check the meeting | We couldn't confirm whether Builder joined. Check the meeting before starting again. |
| anything else | Unknown | Shown without crashing, so a new status from the api doesn't break the page. |

### Stage link
The api returns `stageUrl` to members of the owning org (api plan D8). It holds the stage's control token (see
[Where things stand](#where-things-stand-read-on-2026-10-18)). **Decision WD5** for this slice:
- Shown **only on the detail page**, behind a "Show stage link" button, never in the list or in any URL of the web app.
- Next to it: "This link controls the stage shown in the meeting. Anyone with it can change what's on screen and
  interrupt Builder's voice. Don't share it, and don't open it while the meeting is running unless you mean to."
- Opening it puts the token in that browser's history; the warning says so. Hiding it in the list is about not
  showing it by accident: `GET /v1/sessions` still returns it for every row, so dropping it from the list response
  is an api change for later (A3).
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
| 201 | (none) | `POST` | "Builder is joining the meeting." Session goes to the top of the list | link to its detail |
| 200 `reused: true` | (none) | `POST` | "This meeting already has a Builder session." with its status label (it may still be Starting) | link to that session |
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
| 502 | `engine_rejected`, `session.errorCode` = `recall_rejected` | `POST` | "Builder couldn't join this meeting. Check the link and that the meeting is open, then try again." | Start is allowed again |
| 502 | `engine_rejected`, `session.errorCode` = `meeting_in_use` | `POST` | "Builder already has a session in this meeting. Check the meeting." | link to the list; no retry button |
| 502 | `engine_rejected`, any other `errorCode` | `POST` | "Starting meetings isn't working right now (`<errorCode>`)." A server setup problem | none |
| 503 | `auth_unavailable` | all | "Sign-in isn't available right now." | Refresh |
| 503 | `db_unavailable` | sessions routes | "Sessions aren't available right now." | Refresh |
| 503 | `engine_unavailable` | `POST` | "Starting meetings isn't available right now." Nothing was started | none |
| 503 | `limits_unavailable` | `POST` | "Starting meetings isn't set up on this server yet." Nothing was started | none |
| 504 | `engine_outcome_unknown` | `POST` | **Warning:** "We couldn't confirm whether Builder joined. Check the meeting for a Builder bot before trying again." | link to the session; **no retry button**; list reloads; the WD8 guard applies |
| (none) | `network_error` | `POST` | **The 504 warning:** "We lost the connection while starting. Check the session list and the meeting before trying again." | list reloads; no retry button |
| (none) | `network_error` | `GET` | "Can't reach Builder. Check your connection." | Refresh |
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
- **Content Security Policy** (and other headers), sent by Render for the static site (I1). From Clerk's CSP guide,
  with `{FAPI}` the Clerk instance's Frontend API host (for a dev instance, `*.clerk.accounts.dev`) and `{API}` the
  api's origin:

  ```
  default-src 'self';
  script-src 'self' https://{FAPI} https://challenges.cloudflare.com https://*.protect.clerk.com;
  connect-src 'self' {API} https://{FAPI} https://*.protect.clerk.com:*;
  img-src 'self' https://img.clerk.com;
  style-src 'self' 'unsafe-inline';
  worker-src 'self' blob:;
  frame-src https://challenges.cloudflare.com https://*.protect.clerk.com;
  form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'
  ```

  `style-src 'unsafe-inline'` is required by Clerk's runtime styles. No `'unsafe-eval'` in production. Clerk
  telemetry is turned off (`telemetry={false}` on `ClerkProvider`), so its host isn't needed. Also:
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`. The deploy (I1) loads the site with the CSP
  and checks the browser console for CSP errors on every screen before it's merged.
- **CORS** is on the api side (A1): exact allowed origins, no credentials.
- **Never logged, anywhere:** session tokens, meeting links, stage links, request or response bodies, api error
  messages. The web app has no logger and no analytics or error-reporting script in this slice (WD9). If one is
  added later, it must strip URLs and bodies first.
- **Tenancy** is enforced by the api from the token. The web app never sends an org id, and the tests prove it.

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
    `console.` in `src/`.
- **Not in this slice:** browser end-to-end tests (Clerk's testing helpers need a real instance and its secret key).
  Instead, the [manual check](#manual-check-before-the-demo).

### Manual check before the demo
Against the Clerk dev instance and the three local apps above. The engine is in local mode, so no bot is sent:
1. Sign up; the choose-organization step appears; create org A; the list is empty.
2. Start a Meet link; it appears at the top as Joining; its detail page shows the stage link only after "Show".
3. Start the same link again: "This meeting already has a Builder session."
4. Stop the engine and start a different link: the 504 warning, no retry button, the session shows "Check the
   meeting". Start that link again: the guard asks first.
5. Create org B, switch to it: empty list. Switch back: A's sessions.
6. Sign out, sign back in: back on `/` in the last org.

**On the deployed site** (after I1), first check without a bot: sign-in, org choice, the list, and no CSP errors in
the browser console on every screen; no 401 loop (a 401 right after sign-in means the api's
`CLERK_AUTHORIZED_PARTIES` lacks the site's origin). With the deployed engine unreachable or not configured, the
start form shows the 503 or 504 messages. **Starting a session on the deployed site sends a real, paid Recall bot:
ask first** (AGENTS.md), use a meeting you control, and end the bot afterwards.

## Deployment on Render
Per ADR 0005, in the root `render.yaml` Blueprint. This is I1, an infra-area change (see
[Changes outside apps/web](#changes-outside-appsweb)). There's no `render.yaml` on `main` yet; I1 adds the web site
to the Blueprint the api and engine services go in, so it comes after that Blueprint exists.
- **Service:** `web`, `type: web`, `runtime: static`, $0, served from Render's CDN (static sites take no `region`).
- **No Dockerfile (WD10).** ADR 0005 says each app has a Dockerfile; that fits services that run a process, and a
  static site runs none. Recording this exception is D-INFRA below.
- **Build from the repo root, no `rootDir`** (ADR 0005), so `contracts/` is there:
  `npm ci --workspace @builder/web --include-workspace-root && npm run build -w @builder/web`.
  `staticPublishPath: apps/web/dist`.
- **`buildFilter.paths`:** `apps/web/**`, `contracts/**`, `package.json`, `package-lock.json`.
- **`autoDeployTrigger: checksPass`**, as for the other services.
- **Routes:** rewrite `/*` → `/index.html`.
- **Headers:** for `/*`, the CSP and the other headers from [Security](#security). The CSP names the api's origin
  and the Clerk Frontend API host, so it's written per environment.
- **Env:** `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL`, `sync: false`. Render asks for `sync: false` values only
  when the Blueprint is first created; later changes are made in the dashboard. They're read at build time, so
  changing either needs a rebuild.
- **The api's env** gets the site's URL (`https://<web>.onrender.com`) in `CLERK_AUTHORIZED_PARTIES`, which A1 also
  uses for CORS. That's a change to the api service's settings, made with I1.
- **Clerk for the demo (WD7):** the development instance. Clerk's production instances need a domain we own with DNS
  records; a dev instance works on the Render URL, with a "development mode" badge and dev limits, which is fine for
  the demo. A production instance and domain come later.
- Check the exact `render.yaml` keys (`headers`, `routes`, `buildFilter`) against Render's Blueprint reference when
  writing I1.
- **Fallback if the deploy isn't ready by 2026-10-24:** demo from a laptop with the local setup (engine in local mode,
  or a real engine only with approval), which needs none of I1.

## Steps
Each step is its own branch from fresh `main`, with tests, squash-merged, and leaves `main` working. Sizes: S = up
to 2 hours, M = about half a day, L = about a day.

| # | Branch | What | Size | Safe alone because |
|---|---|---|---|---|
| W0 | `web/adr-stack` | ADR 0012: Vite + React static app, React Router, the Clerk wiring and org flow, Bearer tokens to the api, no retries, the error mapping rule, stage-link handling, Render static site with CSP. Settles WD1, WD2, WD5–WD10 for the web app | S | docs only |
| W1 | `web/scaffold` | Vite + React + TS in `apps/web`: `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`, `tsconfig.json`, `.env.example`, `.gitignore`, scripts `dev`, `build`, `test`, `typecheck`, `check`; network-blocking test setup; the source-scan guard tests; README update. Lockfile changes | M | renders a placeholder; calls nothing |
| W2 | `web/clerk-auth` | `ClerkProvider` with the wiring above, the routes and guard, sign-in/up, `/choose-organization` with its fallback, header with `<OrganizationSwitcher hidePersonal />` and `<UserButton />`, "not configured" screen, `test/helpers/clerk.tsx`. Org flow checked by hand on the dev instance | M–L | no api calls yet |
| W3 | `web/api-client` | `src/api/client.ts`, `src/api/schemas.ts` (tolerant), `ApiError`, the error mapping, `test/helpers/fake-api.ts`; `GET /v1/me` shows the role in the header | M | `/v1/me` exists; reads only. Needs A1 to work in a real browser |
| W4 | `web/sessions-list` | The list, labels, states, Refresh, reload on org change | M | reads only |
| W5 | `web/start-session` | The form, every `POST` outcome, the warnings, the WD8 guard | M–L | the api reuses active sessions and the engine refuses a second bot per org and meeting; no retries |
| W6 | `web/session-detail` | `/sessions/:id`, status explanation, limits, error code, the stage link behind "Show" | M | reads only |

- **Order:** W0 and the outside items A1, WC1 and K1 first (they're small and others wait on them). W1–W3 can start
  at once. W4–W6 need WC1 (or the temporary copy below). I1 after W5, once the Blueprint exists.
- **What to cut first if time runs short**, in this order:
  1. The WD8 guard's confirmation step (the 504 warning itself is never cut; the engine already refuses a second
     bot for the same org and meeting in nearly every case).
  2. The role in the header (`GET /v1/me`).
  3. The session detail page: show the status in the list and drop the stage link from the web app for the demo.
  4. The deploy (I1): demo locally instead.
  5. Styling beyond Clerk's defaults and one CSS file.

  Never cut: sign-in, org choice and switching, the list, the start form, the `POST` warnings, and (when deployed)
  the CSP.

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
- **A2 (later). `POST /internal/engine-events`,** the api's next slice. Statuses only move after it, and then the web
  app adds polling on the detail page (WD6).
- **A3 (later). Leave `stageUrl` out of `GET /v1/sessions`,** keeping it on `GET /v1/sessions/:id` and the `POST`
  reply, so the list never carries control tokens.

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
- **I1.** The `web` static site in `render.yaml` (see [Deployment](#deployment-on-render)), and the web URL in the
  api service's `CLERK_AUTHORIZED_PARTIES`. Needs the Blueprint with the api and engine services first.
- **D-INFRA.** Amend ADR 0005 for WD10: a static site has no Dockerfile.

**Identity (Clerk dashboard and ADR 0006, shared with the api plan):**
- **K1.** A development instance with Organizations on, membership required, and the dev instance's PEM key in the
  api's `CLERK_JWT_KEY`. Its publishable key goes in `apps/web/.env` and on Render.
- **D-ID.** Amend ADR 0006's "sign-up creates a personal org of one" to "sign-up requires creating or joining an org"
  (membership required, the api plan's D3).

**Root:**
- **R1 (optional).** A root `npm run dev` that starts the engine in local mode, the api and the web app together.

## Decisions
Each has a recommendation. W0 records the web ones in ADR 0012; D-INFRA and D-ID need their areas' agreement.

- **WD1. Framework.** *Recommended:* Vite + React static site. Alternative: Next.js on a $7 web service.
- **WD2. Routing.** *Recommended:* React Router with five routes, Clerk on `routing="path"`. Alternative: one page
  with hash routing; it can't give each session its own URL.
- **WD3. When the shapes move to `contracts/`.** *Recommended:* WC1 now, before W4. Alternative: a temporary copy in
  the web app until after the demo.
- **WD4. CORS allowlist source.** *Recommended:* reuse `CLERK_AUTHORIZED_PARTIES`. Alternatives: a separate
  `CORS_ORIGINS` variable, or a Vite dev proxy plus a Render rewrite (no CORS, but local and production then differ).
- **WD5. The stage link.** *Recommended:* detail page only, behind "Show", with the warning, until X1 gives a
  read-only link. Alternative: don't show it at all in the web app for now.
- **WD6. Status updates.** *Recommended:* a Refresh button now; polling on the detail page after A2. Polling now
  would show nothing new.
- **WD7. Clerk instance for the demo.** *Recommended:* the development instance on the Render URL. Alternative: buy
  a domain and set up a production instance before 2026-10-25 (DNS can take up to 48 hours).
- **WD8. Starting again after an unknown outcome.** *Recommended:* the web app asks first (above), as a second line
  of defense behind the engine's per-org, per-meeting check. Alternative: the api also reuses `start_unknown`
  sessions, which also blocks starting again after a start that really failed; that's an api decision.
- **WD9. Analytics and error reporting.** *Recommended:* none in this slice. Alternative: a tool that strips URLs and
  bodies, after its own review.
- **WD10. Dockerfile for the web app.** *Recommended:* none; it's a static site (D-INFRA). Alternative: an nginx image
  on a $7 web service.
- **Styling.** One plain CSS file with a few variables; Clerk's components bring their own look. Sharing tokens with
  the stage theme is the design-system decision in the web README, later.

## Timeline
- **Effort:** W0 + W1 about a day, W2–W6 about three and a half days. That fits before 2026-10-25 if W0, A1, WC1 and
  K1 land by 2026-10-20.
- **Outside items the demo needs:** A1, WC1 and K1 by about 2026-10-20. For a deployed demo, the Blueprint with the
  api and engine, then I1, by about 2026-10-23, leaving time for the deployed check. Otherwise, the local fallback.
- **The biggest risk** is the deploy, which depends on the api and engine being on Render first; the local demo is
  the fallback. The next is Clerk's org flow, checked by hand in W2.
