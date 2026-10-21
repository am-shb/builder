# 0016: A shared meeting key for duplicate-bot checks

- **Status:** proposed
- **Date:** 2026-10-19
- **Area:** contracts (`contracts/`), api (`apps/api`), engine (`apps/engine`), web (`apps/web`)
- **Amends:** the contracts rule in [ADR 0004](0004-workspaces-and-repo-layout.md) ("schemas only"), for one function

## Context
Three checks keep an org from paying for a second Recall bot in a meeting it already has one in:

- **web:** the "Start anyway?" prompt after an unconfirmed start (`apps/web/src/sessions/start.ts`).
- **api:** reuse of the org's active session (D7 in [the api plan](../plans/api-first-slice.md)). `MeetingUrl` in
  `apps/api/src/routes/schemas.ts` stores `new URL(s).href`, and the unique index on `(org, active_meeting)` in
  `apps/api/db/0001_init.surql` compares that string (`apps/api/src/db/sessions.ts`).
- **engine:** `409 meeting_in_use` from `POST /internal/sessions` (ADR 0008, E3). `store.findActiveForMeeting` matches
  `meeting_url = $url AND org_id = $org`, and the in-process `perMeeting` queue in `apps/engine/src/app.ts` is keyed by
  the same string.

All three compare the whole URL. `href` keeps the query, the fragment, a trailing slash, the path's case and the Zoom
subdomain. So `https://meet.google.com/abc-defg-hij`, `.../ABC-DEFG-HIJ`, `.../abc-defg-hij/`, `...?authuser=0` and
`...#x` are five meetings to every check. So are `https://us02web.zoom.us/j/85712345678?pwd=x` and
`https://zoom.us/j/85712345678`, and a Teams link opened from Outlook and from the calendar. Each variant pasted by a
second person sends a second paid bot. Recall makes a new bot every time it is asked; it doesn't check whether one is
already in the meeting.

The web is adding its own normalization for the prompt only. The api and the engine need one authoritative answer to
"is this the same meeting?", and all three must give the same answer.

## Options considered
1. **Normalize the URL itself and store only that.** One column, no new concept. But the bot has to join with the link
   the person pasted: a Zoom link without `pwd` asks for a passcode, and a Teams link without `context` can lose the
   tenant. A URL that is both "what Recall gets" and "what we compare" can't do both jobs.
2. **Reject links with a query string or fragment.** Simple, but most real Zoom and Teams links have one, and it does
   nothing about case, trailing slashes or Zoom subdomains.
3. **Rely on Recall.** It doesn't deduplicate, and by the time it would, the bot is paid for.
4. **A meeting key next to the URL.** A pure function turns a link into a key that names the meeting, per platform.
   Every check compares keys; Recall still gets the original URL. Costs one function, one column per app and a
   backfill.

Where the function lives:

- **A new shared workspace** (`meeting-key/`). Keeps `contracts/` schemas-only, but adds a workspace to both Dockerfiles,
  both build filters in `render.yaml`, `CODEOWNERS` and the lockfile, for one file.
- **A zod schema with a transform in `contracts/`.** Still logic, just inside a schema, and every caller (the engine's
  store, the web's prompt) would have to go through a parse to get a string.
- **A plain function in `contracts/`.** Already a dependency of all three apps, already in both Dockerfiles and build
  filters, already reviewed by both the engine and the api side. "What counts as the same meeting" is an agreement
  between apps, which is what `contracts/` is for. It has a precedent: `parseEngineEvent()`.

## Decision
Option 4, with the function in `contracts/`.

### The function
`contracts/src/meeting-key.ts`, exported from `@builder/contracts`:

```ts
/** The meeting a link points at, as an opaque string, or null if it isn't a link the engine can join. */
export function meetingKey(link: string): string | null;
```

Pure and synchronous, no dependencies (not even zod), never throws. The contracts rule becomes: schemas, the types
inferred from them, and pure functions that define a value two apps must compute the same way. No I/O, no clients.

It returns `null` unless the trimmed input parses as a URL with `https:`, no username or password, and a host in the
current list (`meet.google.com`, `zoom.us` or `*.zoom.us`, `teams.microsoft.com`, `teams.live.com`). That makes it the
one place the host list lives: the api's `MeetingUrl` and the engine's `isMeetingUrl` both become `meetingKey(s) !==
null`, and the two copies of `MEETING_HOSTS` go.

Then, per platform, the first rule that matches wins. The query string and the fragment are ignored unless a rule
says otherwise.

| Platform | Rule | Key |
|---|---|---|
| Meet | First path segment is 3-4-3 letters, any case (`abc-defg-hij`), or 10 letters without dashes | `meet:` + the code, lowercase, dashed |
| Zoom | Any `*.zoom.us` host counts as `zoom.us`. Path `/j/<id>`, `/s/<id>`, `/w/<id>`, `/wc/<id>/...` or `/wc/join/<id>`, where `<id>` is 9 to 12 digits. `pwd`, `zak`, `tk` and every other parameter ignored | `zoom:` + the digits |
| Zoom | Path `/my/<name>` (personal link) | `zoom:my:` + the name, lowercase |
| Teams | A `/l/meetup-join/<thread>/<segment>` path, looked for in the path, then in the fragment (new client links put it after `#`), then in a `url` query parameter (the `/dl/launcher/` wrapper). Percent-decoded up to twice, until `<thread>` has no `%`. `<thread>` must look like `19:<id>@thread.<kind>` | `teams:` + `<thread>/<segment>`, case kept |
| Teams | `teams.microsoft.com/meet/<digits>` | `teams:meet:` + the digits |
| Teams | `teams.live.com/meet/<digits>` | `teams-live:meet:` + the digits |
| Any | None of the above, path not empty after trailing slashes are removed | `<platform>:path:` + the path without trailing slashes. Lowercase for Meet, case kept for Zoom and Teams |
| Any | Empty path | `null` |

Why these choices:

- **Teams keeps case.** The thread id is base64-like, so lowercasing could merge two meetings. Only the
  percent-encoding (`%3a` or `%3A`) is undone.
- **Teams keeps the segment after the thread.** It's `0` for a scheduled meeting, but in a channel meeting the thread
  is the channel and the segment (a message id) is what tells one meeting from the next.
- **Unknown shapes fall back, they aren't rejected.** Rejecting would refuse links Recall can join (a Meet `lookup`
  nickname, shapes we haven't seen). Ignoring the query in the fallback can't merge two meetings on these platforms,
  because none of them puts the meeting in the query except the Teams launcher, which has its own rule. The worst case
  of a fallback is a missed match: no worse than today.
- **The key is coarser than `href`, never finer.** Two links with the same `href` always get the same key, so moving a
  check from `href` to the key can only catch more duplicates.

Examples (these become the test table):

| Link | Key |
|---|---|
| `https://meet.google.com/abc-defg-hij` | `meet:abc-defg-hij` |
| `https://meet.google.com/ABC-DEFG-HIJ/` | `meet:abc-defg-hij` |
| `https://meet.google.com/abc-defg-hij?authuser=0&hs=122#x` | `meet:abc-defg-hij` |
| `https://meet.google.com/abcdefghij` | `meet:abc-defg-hij` |
| `https://meet.google.com/lookup/Team-Standup` | `meet:path:/lookup/team-standup` |
| `https://zoom.us/j/85712345678` | `zoom:85712345678` |
| `https://us02web.zoom.us/j/85712345678?pwd=AbC123` | `zoom:85712345678` |
| `https://acme.zoom.us/wc/85712345678/join?pwd=x` | `zoom:85712345678` |
| `https://zoom.us/wc/join/85712345678` | `zoom:85712345678` |
| `https://zoom.us/s/85712345678?zak=...` | `zoom:85712345678` |
| `https://acme.zoom.us/my/Jane.Doe` | `zoom:my:jane.doe` |
| `https://teams.microsoft.com/l/meetup-join/19%3ameeting_NzQ5YjM2%40thread.v2/0?context=%7b%22Tid%22%3a%22...%22%7d` | `teams:19:meeting_NzQ5YjM2@thread.v2/0` |
| the same with uppercase `%3A` and no `context` | `teams:19:meeting_NzQ5YjM2@thread.v2/0` |
| `https://teams.microsoft.com/v2/?meetingjoin=true#/l/meetup-join/19%3ameeting_NzQ5YjM2%40thread.v2/0?context=...` | `teams:19:meeting_NzQ5YjM2@thread.v2/0` |
| `https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F_%23%2Fl%2Fmeetup-join%2F19%253ameeting_NzQ5YjM2%2540thread.v2%2F0&type=meetup-join` | `teams:19:meeting_NzQ5YjM2@thread.v2/0` |
| `https://teams.microsoft.com/l/meetup-join/19%3aAbC123%40thread.tacv2/1697712345678?context=...` | `teams:19:AbC123@thread.tacv2/1697712345678` |
| `https://teams.microsoft.com/meet/2345678901234?p=AbCdEf` | `teams:meet:2345678901234` |
| `https://teams.live.com/meet/9876543210123?p=x` | `teams-live:meet:9876543210123` |
| `http://meet.google.com/abc-defg-hij` | `null` (not https) |
| `https://meet.google.com/` | `null` (no meeting) |
| `https://user:pw@zoom.us/j/85712345678` | `null` (credentials) |
| `https://example.com/j/85712345678` | `null` (host) |

A key names a meeting, so it is treated like the URL: never logged. Logs may carry which rule matched (`meet`,
`zoom`, `teams`, `fallback`), so we can see how often the fallback is used and add rules for it.

### What each app stores and compares
- **The original URL still goes to Recall.** The api keeps storing `meeting_url` (the parsed `href`, as today), sends
  it unchanged in `StartSessionRequest.meetingUrl`, and the engine passes it unchanged to `recall.createBot`.
- **The key is not sent between apps.** Each side computes it from `meetingUrl` with the same function, so
  `StartSessionRequest` doesn't change, and the engine doesn't trust a key it was handed.
- **api:** a `meeting_key` field next to `meeting_url`. A new `active_key` field (`VALUE IF status IN ["starting",
  "joining", "in_meeting"] { meeting_key } ELSE { NONE }`) with a unique index on `(org, active_key)`, beside the
  existing `active_meeting` index. `createSessionUnlessActive` and `findActive` look up by `active_key`.
- **engine:** a `meeting_key` field on `sessions`, an index on `(org_id, meeting_key)`, `findActiveForMeeting` matching
  on the key, and the `perMeeting` queue keyed by the key. The E2 `sameStart` check for a repeated `sessionId` keeps
  comparing the exact URL: a retry from the api resends the stored URL.
- **web:** `findUnconfirmedStart` and `sameMeetingLink` compare `meetingKey()` of both links, replacing the web's own
  normalization once this ships. The web already depends on `contracts/`.

### Migration and rollout
SurrealQL can't call the TypeScript function, so the backfill is a TypeScript step. Both apps' `migrate.ts` learn to run
`NNNN_name.ts` files (a default-exported `async (db) => void`) in name order with the `.surql` files, recorded in the same
`migration` ledger. A `.ts` step is written to be safe to re-run, because it isn't one transaction with its ledger row.

The order matters because the old and the new instance overlap during a deploy, and Render runs the pre-deploy
migration while the old instance is still serving. The rule that keeps every window safe: **a check never stops
matching what it matched before**. Until every row has a key, lookups match `key OR url`.

1. **Contracts and engine, step 1, in one quiet window.** Merging `contracts/` redeploys the engine and the api
   (`render.yaml` build filters), and an engine deploy ends live meetings (ADR 0005), so this merge, and every engine
   step below, waits for a time with no meetings, the same as a lockfile change (ADR 0012). The contracts PR adds
   `meetingKey` and its tests and changes no behavior. The engine PR, merged right after in the same window, adds
   `0005_session_meeting_key.surql` (`meeting_key` as `option<string>`, the index), writes the key on every new intent,
   queues by key, and has `findActiveForMeeting` match `meeting_key = $key OR meeting_url = $url`.
2. **api, step 1.** `0002_session_meeting_key.surql` adds `meeting_key` (`option<string>`), `active_key` and its unique
   index. The api writes `meeting_key` on every new row and looks up `active_key = $key OR active_meeting = $url`.
   During this deploy the old instance doesn't write keys, so its rows are found by URL, as today.
3. **api, step 2 (a later deploy).** By now every writer writes keys. `0003_backfill_meeting_key.ts` sets `meeting_key`
   on every row that has none, which also fills `active_key` for active rows. If two active rows in one org get the
   same key, the unique index fails the step: those are two bots in one meeting today. The deploy stops, the old
   instance keeps serving, and a person reconciles the rows before running it again. The old instance, still matching
   `key OR url`, stays correct while the step runs. After it, lookups use `active_key` only. A later migration drops
   `active_meeting` and its index.
4. **engine, step 2 (the next quiet window).** The same backfill for `sessions`, then `findActiveForMeeting` matches on
   the key only. Until then the `OR` covers older rows.
5. **web.** Switch the prompt to `meetingKey()` whenever it's convenient. The web has no stored state to migrate.

The backfill writes every row, so the api's `updated_at` (`VALUE time::now()`) moves on all of them. The session list
sorts by `created_at`, so nothing visible changes.

### Changing the rules later
Stored keys must match keys computed now. A rule change that gives an existing link a different key (a new platform
rule taking links away from the fallback, for example) ships with a recompute step in both apps, in the same order as
above, with `OR old key` lookups in between. The contracts tests pin every key in the table, so a change to one fails
there first.

### Tests
- **contracts:** every row of the table above; `null` cases; the function never throws on any string (including
  malformed percent-encoding); equal `href`s give equal keys; Teams case is kept and Meet case isn't.
- **api:** on embedded `mem://`, the migrations apply to an empty database and to one with rows from `0001`; the
  backfill fills keys, is safe to run twice and fails on two active rows with one key. `POST /v1/sessions` with a Meet
  case or trailing-slash variant, `?authuser=`, a Zoom subdomain or `pwd`, and a Teams `%3A` variant returns the
  existing session with `reused: true` and no engine call. Two variants at once make one row (the unique index). An
  ended session doesn't block; another org with the same key isn't reused. `meeting_url` is stored as sent.
- **engine:** in `internal-sessions.test.ts`, a second start with a variant link in the same org gets `409
  meeting_in_use` and the fake Recall is called once; `createBot` receives the original URL, not the key; two variants
  at once send one bot (the queue is keyed by key); a row without `meeting_key` still blocks until the backfill; the
  migration test covers `0005` and the backfill.
- **web:** `findUnconfirmedStart` and `sameMeetingLink` match the variants in the table and don't match different
  meetings.

## Consequences
- Pasting the same meeting in a different form no longer sends a second paid bot, in any of the three checks.
- One host list instead of two (and a third in the web).
- `contracts/` now holds one function, so its rule changes. It stays reviewable: the function is pure and its behavior is
  a table.
- Migrations can be TypeScript, in both apps. That is a capability the next backfill can reuse.
- Two engine deploys, each in a quiet window. They can ride along with other engine changes.
- A missed match is still possible for shapes that fall back (two different-looking links to one Teams meeting where
  neither matches a rule, or a Zoom personal link and the same meeting's numeric id). That is no worse than today.
- A false match (two meetings, one key) would hand back the other session: no bot in the second meeting, and its stage
  link shown instead. It stays inside one org, so nothing leaks across orgs, but it is a real failure, which is why the
  rules keep case where it might matter and keep the Teams segment.

## Open questions
- Are `teams.microsoft.com/meet/<id>` and `teams.live.com/meet/<id>` the same id space? Kept apart until we know.
- Should a Zoom personal link (`/my/<name>`) and the personal meeting id it points at share a key? Only Zoom knows the
  mapping, so not now.
- Are there more Teams wrapper shapes in use (for example Outlook Safe Links, whose host we reject today)? The fallback
  count in the logs will tell us.
- Should the engine also refuse a second bot for one meeting across orgs? Out of scope here: E3 scopes the check to an
  org on purpose.
