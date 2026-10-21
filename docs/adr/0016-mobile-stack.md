# 0016: The mobile app's stack: Expo with Expo Router, Clerk's hosted sign-in, the web's session logic shared

- **Status:** proposed
- **Date:** 2026-10-21
- **Area:** mobile (`apps/mobile`), with changes to `apps/api` (native tokens) and a new shared workspace
  (`packages/session-core`)

## Context
The web app's first slice works: sign in, choose or switch a Clerk organization, the org's sessions with live status,
start a session from a meeting link, and a session's page with its stage link ([ADR 0012](0012-web-stack.md),
[ADR 0015](0015-web-visual-design.md)). The hackathon (submission 2026-10-25) has an Expo sponsor and a "Best Use of
Expo" award, and the people who start sessions are in meetings, on their phones as often as at a desk. We want the same
five screens on Android and iOS, built on the same api and the same Clerk instance, in a day, demoable in Expo Go on a
phone and shareable as a link.

## Options considered
1. **Expo (SDK 58, Expo Router), in the monorepo as `apps/mobile`.** The sponsor's tool, file-based routes like the web,
   runs in Expo Go with no native toolchain (the team has no Mac and no Android SDK set up), publishes a shareable
   update with EAS, and Expo's Metro config handles npm workspaces on its own since SDK 52.
2. **Make the web app a PWA.** No new app, but no native sign-in, no app on the home screen on iOS without ceremony, and
   nothing for the Expo award.
3. **Bare React Native.** The same code with a native toolchain we don't have.

## Decision
Option 1, with these rules:

- **Stack.** Expo SDK 58 (React Native 0.88, React 19.3, the same React as the web), Expo Router (file-based, typed
  routes), `@clerk/expo` with its secure-store token cache, zod for parsing replies. Type checking with the root
  TypeScript (erasable syntax only, as everywhere, ADR 0001); Metro transforms. `npm run check -w @builder/mobile` is
  `tsc -p .` and `node --test` on the pure parts, needs no key and no network, and runs in CI with every other
  workspace. No renderer tests for now: they would add minutes to CI for little that can break.
- **Routes** mirror the web's: `/sign-in` (hosted sign-in and sign-up), `/choose-organization`, `/` (the sessions list
  and the New session button), `/new` (the start form, a modal) and `/sessions/[id]`. Everything under `app/(app)` needs
  an active organization, as the web's `RequireOrg` guard: no session goes to sign-in; a session without an org (a new
  account's pending step, or after leaving the last org) goes to choose one.
- **Clerk.** Sign-in and sign-up through Clerk's hosted pages (`useHostedAuth`), opened in the system browser and
  coming back to the app: the same instance, methods and organization step as the web, nothing to rebuild, and it
  works in Expo Go. In Expo Go the callback is Expo Go's development URL (`makeRedirectUri`), because the app has no
  scheme of its own there; a built app uses the callback Clerk registers for its package, which the `@clerk/expo`
  config plugin wires. Organizations have no prebuilt native components, so `/choose-organization` is Clerk's
  `useOrganizationList`: the memberships to pick from, and a name to create one. Telemetry is off.
- **The api and native tokens.** Clerk mints a native app's token with no `azp`, because it has no browser origin,
  and `@clerk/backend` refuses such a token once `authorizedParties` is set. The api now applies its authorized-parties
  rule only to tokens that name a site (`apps/api/src/auth/clerk.ts`; Clerk: "if the azp claim doesn't exist, skip
  this step"). The api takes Bearer tokens only, never cookies, so the shared-cookie case the rule guards against
  can't reach it. The Clerk dashboard needs the Native API on, and the app registered with its package name.
- **Shared logic, not shared screens.** The session logic the two apps need alike (the api client, tolerant reply
  schemas, every error in our words, the start rules, the session page's words, meeting display, times, status labels,
  the settings rules, the product's names) lives in `packages/session-core` ([ADR 0004](0004-workspaces-and-repo-layout.md),
  amended): framework-free TypeScript that runs the same in a browser, in Hermes and in Node. Two things changed on
  the way in: an abort is told by `err.name === "AbortError"` (Hermes has no `DOMException`), and URLs are parsed with
  a try/catch helper, not `URL.canParse` (Expo's URL doesn't have it). Screens, components and the hooks on top
  (`useOrgQuery`, `useAutoRefresh`, the start provider) exist once per app: they lean on each platform's lifecycle
  and visibility APIs. Moving the web's thorough tests of the shared rules into the package is a follow-up.
- **Calling the api, errors, the stage link, status updates:** the web's rules (ADR 0012) apply unchanged. Bearer token
  from `getToken()` on every call, no org id ever sent, no retries, no timeout on a start, a start never aborted. The
  same error table and the same "a bot may be in the meeting" warning with no retry. The stage link only on the
  session's screen, behind Show, with the warning, `https:` only (`http:` on a development build, for a local engine),
  Copy to the clipboard and Open in the browser, never logged or stored. Quiet refresh every 10 seconds while a
  session may still change, only while the app is in the foreground.
- **Visual design.** The Boardroom tokens from ADR 0015, light and dark following the system, in `src/theme.ts`, the
  only file with raw colors; Schibsted Grotesk loaded with the app. Native navigation (a stack, a modal for the start
  form), a sticky New session bar at the bottom, pull to refresh. Touch targets 44 or more, rows 64 or more.
- **Configuration and secrets.** Exactly two settings, both public by design, because Expo builds every `EXPO_PUBLIC_*`
  value into the JavaScript: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL`, read with the same rules as
  the web's (`session-core/settings.ts`). A missing one shows a "not configured" screen. No URL of ours in the code or
  in `app.json`. A test scans the source for these, for `console.`, for plain storage, and for raw colors.
- **Identifiers.** `scheme: builder`, `com.builder.mobile` as the iOS bundle identifier and Android package: a
  placeholder, as the product name is. Changing it later means re-registering the app in Clerk; do it before any store.
  React is excluded from Expo's version check (`expo.install.exclude`): the web pins 19.3.1 and a monorepo may hold one
  React, and React Native 0.88 accepts `^19.3.0`.
- **Distribution.** Expo Go during the build week: `npx expo start` on the same Wi-Fi, or `--tunnel`. For the
  submission, an EAS Update on the `preview` branch, which opens in Expo Go from a link, and an Android APK from EAS
  Build if time allows. Neither needs a native toolchain on the laptop. Store submission is out of scope.

## Consequences
- The engine, the api and the web are untouched except the api's native-token rule and the move of the web's session
  logic into the shared package, both covered by the existing tests.
- The mobile workspace adds React Native and Expo to the root lockfile, which is in the engine's and the api's build
  filters: merging it redeploys both, and an engine deploy ends live meetings. Merge when no meeting is running.
  CI's `npm ci` gets slower by the size of those packages.
- `EXPO_PUBLIC_*` values are fixed when the JavaScript is built or published: a new api origin or Clerk instance needs
  a new `eas update`.
- Starting a session from the app against the deployed api sends a real, paid bot, as from the web: ask first.
- Follow-ups: move the shared rules' tests into `packages/session-core`; a read-only stage viewer link (the web's X1)
  would let the app show a link that watches without controlling; push notifications on status changes once the api
  can register devices; a real icon and splash image.
