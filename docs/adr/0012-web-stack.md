# 0012: The web app's stack: a Vite + React static site, Clerk in the browser, Bearer tokens to the api

- **Status:** proposed
- **Date:** 2026-10-19
- **Area:** web (`apps/web`)

## Context
The web README leaves the framework and hosting open until an ADR records them, and AGENTS.md asks for an area's
open decisions to be settled before its code. The first slice ([plan](../plans/web-first-slice.md)) is a few screens
behind a login: sign in, choose or switch a Clerk organization, list the org's sessions, start one from a meeting
link, and open one. Every piece of data comes from the api (ADR 0008); the web app has no server data of its own and
needs no SEO. The api checks Clerk tokens offline and takes the org from the token only (ADR 0006, ADR 0010).
Production runs on Render from `render.yaml`, with deploys after CI passes (ADR 0005). The product name and domain
aren't decided yet. The hackathon submission is due 2026-10-25, so each choice here is the simplest one that holds up
after it.

## Options considered
1. **Vite + React, built to static files** and served as a Render static site. $0, no server to secure, and Clerk's
   React SDK documents Vite as its quickstart. Client-side routing needs one rewrite to `index.html`.
2. **Next.js on a Render web service.** Server rendering we don't need, $7 a month, and a second server that would
   also have to verify tokens and be kept off the private network.
3. **No framework.** Clerk's components would have to be mounted by hand, and every screen built from the DOM up.

## Decision
Option 1, with these rules:

- **Stack.** React 19, Vite, React Router in declarative mode (`BrowserRouter`), `@clerk/react`, and zod for parsing
  replies. Tests use Vitest with jsdom and Testing Library. Every version is pinned exactly in `apps/web/package.json`.
  `tsc` type-checks and Vite transforms. Erasable syntax only, as everywhere else (ADR 0001). `npm run check -w
  @builder/web` runs the type check, the tests and `vite build`, and needs no key and no network.
- **Routes.** `/sign-in/*` and `/sign-up/*` (Clerk's components, `routing="path"`), `/choose-organization`, `/` (the
  start form and the session list) and `/sessions/:id`. Anything else goes to `/`.
- **Clerk.** `ClerkProvider` with in-app URLs for sign-in, sign-up, sign-out and the `choose-organization` session
  task, `routerPush` and `routerReplace` wired to React Router so Clerk never reloads the page, and telemetry off. The
  instance requires org membership: a new user creates or joins an org before reaching the app. A pending session
  goes to `/choose-organization`, a signed-out one to `/sign-in`. The org switcher hides personal accounts. If
  `@clerk/react-router` fits declarative mode better when this is built, it may replace `@clerk/react`; nothing else
  changes.
- **Calling the api.** Every call awaits Clerk's `getToken()` and sends `Authorization: Bearer <token>`, with
  `credentials: "omit"`. The web app never sends an org id: the api takes it from the token. Requests are keyed by
  the active org, so an org switch aborts the old `GET`s and drops their results. The api origin comes from
  `VITE_API_URL`, and the api allows the web origins by CORS.
- **No automatic retries, and no client timeout on `POST /v1/sessions`.** A retried or cut-off start can send a
  second paid bot or turn a known outcome into an unknown one (ADR 0010). People retry with a button. A start is
  never aborted, even by an org switch.
- **Errors.** Replies are parsed with tolerant zod schemas: unknown fields are ignored, and an unknown status shows
  as "Unknown" instead of failing. Errors become one `ApiError` with a `code`; the UI branches on the code and shows
  its own text, never the api's message. Every `POST` outcome that might have started a bot (a 504, a 500, a network
  error, an unreadable reply, an unknown code) shows a "check the meeting before trying again" warning and offers no
  retry.
- **The stage link** holds the stage's control token: anyone with it can change what the meeting sees and interrupt
  the bot. It's shown only on the session's detail page, behind a "Show" button with that warning, only when it
  parses as an `https:` URL (`http:` in dev), opened with `noopener noreferrer`, and never logged or stored. A
  read-only viewer link is an engine change for later.
- **Status updates.** A Refresh button for now. Polling comes after the api receives engine events.
- **Names.** UI text takes the product's name and the bot's name from two constants, `PRODUCT_NAME` and `BOT_NAME`,
  in `apps/web/src/brand.ts`. `BOT_NAME` must match the name the engine gives the bot.
- **Configuration and secrets.** The web app reads exactly two variables, `VITE_CLERK_PUBLISHABLE_KEY` and
  `VITE_API_URL`, both public by design, because Vite builds every `VITE_*` value into the JavaScript. No secret of any
  kind goes in `apps/web`. No URL of ours is written in the code or in `render.yaml`; origins come only from those two
  variables. A missing variable shows a "not configured" screen at runtime; the build still succeeds.
- **Hosting.** A Render static site in the existing `render.yaml`, built from the repo root (so `contracts/` is
  there), deployed after CI passes like the other services, with one rewrite from `/*` to `/index.html`. It has no
  Dockerfile, because it runs no process; this is an exception to ADR 0005's "each app has a Dockerfile" and should be
  noted there. Until a domain is chosen, it runs on its Render host with Clerk's development instance.
- **Content Security Policy.** Render's header values are literal text, so a policy naming the api and Clerk
  origins can't live in `render.yaml` without writing URLs into the repo. The policy is split:
  - a `<meta http-equiv="Content-Security-Policy">` tag that a Vite plugin writes first into `index.html` at build
    time, with the api origin from `VITE_API_URL` and the Clerk Frontend API host decoded from the publishable key.
    With either missing or invalid, it writes the policy without them. It adds nothing in the dev server.
  - a header from Render with what a `<meta>` policy can't carry (`frame-ancestors 'none'`), plus `object-src 'none'`
    and `base-uri 'self'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a
    `Permissions-Policy` that turns off camera, microphone and location.

  No `'unsafe-eval'`. `style-src 'unsafe-inline'` stays, because Clerk's components need it.
- **Safe rendering.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. Meeting links show as text,
  not links. Tests scan the source for these, for `localStorage`, for `console.`, for any `VITE_*` name other than the
  two, and for hard-coded origins.
- **No logs, analytics or error reporting** in the browser for now. Session tokens, meeting links, stage links and
  request or response bodies are never logged anywhere. A tool added later must strip URLs and bodies first.
- **Tests never reach the network.** A setup file replaces `fetch` and `WebSocket` with stubs that fail the test.
  Clerk is mocked at the module level, and the api is a fake `fetch`. There's no "dev login" or auth bypass in the app.

## Consequences
- No web server to run, patch or secure, and no cost for hosting the site.
- `VITE_*` values are fixed at build time: changing the api origin or the Clerk instance means a new deploy of the
  site, and the site's origin has to be added to the api's `CLERK_AUTHORIZED_PARTIES` by hand.
- Choosing a domain later needs no code change: add it in Render, add the origin to the api's allowed parties, update
  `VITE_API_URL` if the api moves, and rebuild. A Clerk production instance waits for the domain.
- The web app adds dependencies to the root lockfile, which is in the engine's and the api's build filters. Merging a
  lockfile change redeploys both, and an engine deploy ends live meetings, so those merges wait for a quiet time.
- A failing web check on `main` blocks every service's deploy, because Render waits for all of a commit's checks.
- Follow-ups outside `apps/web`: CORS in the api, the api-to-web schemas moving to `contracts/`, the site in
  `render.yaml`, a note in ADR 0005 about the static site having no Dockerfile, and a note in ADR 0006 that sign-up now
  requires creating or joining an org.
