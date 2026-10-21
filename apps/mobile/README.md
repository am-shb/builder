# apps/mobile: the customer app on phones

**Status:** the web's first slice on Expo ([ADR 0016](../../docs/adr/0016-mobile-stack.md)): sign-in and sign-up through
Clerk's hosted pages, choosing and switching an organization, the org's sessions with live status, starting a session
from a meeting link, and a session's screen with its stage link. **Owner:** TBD. Claim it in
[docs/workstreams.md](../../docs/workstreams.md).

## Purpose
The same product as `apps/web`, for the phone in your pocket during a meeting: send the bot in from a pasted link, see
it join, follow the session. It calls the api only, with the same Clerk instance as the web, and shares the web's
session logic through `@builder/session-core`.

## Run it
Node 24 (`.nvmrc`), from the repo root after `npm ci`. Settings go in `apps/mobile/.env` (git-ignored), names in
[.env.example](.env.example): `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL`. Expo builds every
`EXPO_PUBLIC_*` value into public JavaScript, so nothing secret ever goes here.

| Command | What |
|---|---|
| `npm start -w @builder/mobile` | Metro on port 8081; scan the QR code with Expo Go (Android: the Expo Go app; iOS: the camera). Add `-- --tunnel` when the phone can't reach the laptop over the Wi-Fi |
| `npm run check -w @builder/mobile` | Type check and the tests. Needs no key and no network. Root `npm run check` and CI run it too |
| `npm run doctor -w @builder/mobile` | `expo-doctor`: dependency versions and duplicates (needs the network) |
| `npx expo export --platform android` | Bundles the app with Metro without a device, so a module that doesn't resolve shows up before the phone does |
| `eas update --branch preview` | Publishes the JavaScript to Expo; the link opens in Expo Go anywhere (see the runbook) |

**Against the local api and engine, with no bot and no spend:** the three terminals from the web plan (engine in local
mode on 3000, the api on 3001), and `EXPO_PUBLIC_API_URL=http://<this computer's LAN address>:3001`, not localhost: the
phone must reach the laptop. The api's `CLERK_JWT_KEY` must be the same instance's as the publishable key here, and
the Clerk dashboard needs the **Native API** on (Native applications) with this app registered (`com.builder.mobile`).

**Against the deployed api:** `EXPO_PUBLIC_API_URL=<builder-api's https origin>`. Reads are free. **Starting a session
there sends a real, paid Recall bot: ask first** (AGENTS.md).

## Layout
- `app/`: the routes (Expo Router). `_layout.tsx` wires Clerk, the api client and the fonts; `(auth)/sign-in.tsx` is
  hosted sign-in and sign-up; `(app)/` needs an organization: `index.tsx` (the list), `new.tsx` (the start form, a
  modal), `sessions/[id].tsx` (a session); `choose-organization.tsx` creates or picks one.
- `src/config.ts`: the two settings. `src/theme.ts`: the Boardroom tokens (ADR 0015), light and dark, the only file
  with raw colors. `src/api/`: the api client's provider and `useOrgQuery`. `src/hooks/`, `src/sessions/`,
  `src/components/`: the hooks, the start provider and outcome, the error notice, and the small components (button,
  field, status pill, session row, callout, screen).
- `test/`: `node --test`. `config.test.ts` and the source scans in `guards.test.ts` (no `console.`, no plain storage,
  only the two `EXPO_PUBLIC_*` names, no URL of ours, no raw color outside the theme, the stage link through its check).
- The logic shared with the web is in [packages/session-core](../../packages/session-core/README.md).

## Rules that carry over from the web (ADR 0012)
Bearer token from `getToken()` on every call, no org id ever sent; no retries and no timeout on a start, and a start is
never aborted; the error table's words and the "a bot may be in the meeting" warning with no retry; the stage link only
on the session's screen, behind Show, `https:` only (`http:` on a development build), never logged or stored; meeting
links are text. `BOT_NAME` and `PRODUCT_NAME` come from `@builder/session-core`.

## In scope
- The web's first slice, on Android and iOS, in Expo Go and as an EAS Update
- Later: the handoff library, push notifications on status changes, a calendar's meetings as one-tap starts

## Out of scope
- Anything the api owns; the stage and the handoff pages (the engine's)
- Store submission (the product name, icon and identifiers aren't decided)

## Depends on
`apps/api` (with the native-token rule), `@builder/session-core`, `@builder/contracts`, the Clerk instance with the
Native API on

## Known limits (seen on the phone, 2026-10-21)
- **An abandoned hosted sign-in sticks to the device's Clerk client.** Clerk returns the same pending hosted-auth
  flow (same state and callback) for a client until it is completed, so after a callback that never reached the app
  (as happened with the wrong redirect path before #30), every later attempt showed the first attempt's callback.
  Destroying the device's Clerk client (`clerk.client.destroy()`) and reloading cleared it. With the callback on the
  sign-in screen this doesn't arise, but a person who kills the app mid-flow may hit it; a "start over" affordance
  that destroys the client is the fix if it does.
- **Hot reload doesn't reach the phone on some Wi-Fi:** the bundle and the api work, but the dev client's channel to
  Expo CLI drops ("Cannot connect to Expo CLI"), so edits need Reload from Expo Go's menu, and the device's
  `console.log` lines reach Metro only after a reload. Development-only; nothing in the app.
- **Expo Go can't be the judge-facing link.** Expo lets only accounts with access to the project open a published
  update in Expo Go, and Expo Go 57.0.9 on Android fails on every EAS Update anyway (expo/expo#50139, fixed in Expo
  Go 58; iOS works). The shareable artifact is the Android APK from `eas build --platform android --profile preview`,
  which embeds the bundle and takes later `preview` updates. iPhone needs TestFlight, so an Apple developer account.
- **Reopening the project from Expo Go's recent list reuses the last deep link** it was opened with. After a sign-in
  callback that was a bad path, that meant "Unmatched Route" on every launch until the entry was cleared.

## Open decisions
- Distribution after the hackathon: Expo Go and EAS Update only, or TestFlight and Play internal testing (needs the
  identifiers decided)
- Push notifications: the api would have to register devices and send on the engine's status events

## First tasks
- [x] ADR 0016
- [x] Sign-in, organizations, the list, the start form, the session screen
- [x] Checked on an Android phone (Samsung, Expo Go 57) against the local setup on 2026-10-21: hosted sign-in and
      Clerk's organization step, the sessions list with the org and role, a start that moves to "In the meeting" on the
      engine's event, the session screen with the stage link, the reuse guard, the organization switcher
- [ ] The same on an iPhone
- [x] An EAS Update on `preview` (group f42e387c, 2026-10-21). Opening it cold in Expo Go on Android fails on Expo Go 57's
      own bug (see Known limits); an APK build is the link to hand out
- [ ] An Android APK from EAS Build with the deployed api's origin baked in (`EXPO_PUBLIC_API_URL` in the EAS
      `preview` environment)
- [ ] A real icon and splash image
