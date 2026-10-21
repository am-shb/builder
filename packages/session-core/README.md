# packages/session-core: the session screens' shared logic

**Status:** in use by `apps/web`; `apps/mobile` is its second consumer ([ADR 0016](../../docs/adr/0016-mobile-stack.md)).
**Owner:** the web and mobile owners together.

## What's here
Framework-free TypeScript that both apps need to show and start sessions: the api client (`client.ts`, Bearer token,
no retries, no timeout on a start), the tolerant reply schemas (`schemas.ts`), every api error in our own words
(`errors.ts`), the start rules (`start.ts`: link check, meeting key, the ask-first guards), the session page's words
(`detail.ts`), how a meeting link is shown (`meeting.ts`), relative times (`time.ts`), the status labels (`status.ts`)
and the product's names (`brand.ts`). Everything is exported from `src/index.ts`.

## Rules
- No React, no DOM, no React Native. It type-checks with Node's types only, so it runs the same in a browser, in Hermes
  and in Node's tests. An abort is told by `err.name === "AbortError"`, never by `DOMException`.
- Screens, hooks and components stay in each app (ADR 0004). The hooks on top of this package (`useOrgQuery`,
  `useAutoRefresh`, the start provider) exist once per app, because they lean on each platform's visibility and
  lifecycle APIs.
- The thorough tests of each rule live in `apps/web/test` (`api-client`, `errors`, `start`, `statuses`), which import
  this package; `test/` here is a smoke test in plain Node. Moving those suites here is a follow-up.
- `BOT_NAME` must match the name the engine gives the bot (`apps/web/test/brand.test.ts` checks it).
