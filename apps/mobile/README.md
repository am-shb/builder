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

## Open decisions
- Distribution after the hackathon: Expo Go and EAS Update only, or TestFlight and Play internal testing (needs the
  identifiers decided)
- Push notifications: the api would have to register devices and send on the engine's status events

## First tasks
- [x] ADR 0016
- [x] Sign-in, organizations, the list, the start form, the session screen
- [ ] Checked on an Android phone and an iPhone against the local setup (the web plan's manual check)
- [ ] An EAS Update on `preview`, opened cold in Expo Go
- [ ] A real icon and splash image
