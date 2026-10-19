# apps/engine: the Builder core (v0)

**Status:** working v0. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Where the code is
The v0 engine moved here from the repo root in a PR that only moved files and fixed paths, per
[ADR 0004](../../docs/adr/0004-workspaces-and-repo-layout.md). Paths below are relative to this folder:

| Path | What it does |
|---|---|
| `src/server.ts`, `src/app.ts` | HTTP server and routes, plus the Recall realtime webhook (verified by HMAC signature) |
| `src/recall-client.ts`, `src/realtime.ts`, `src/verify.ts` | Recall.ai bot API, transcript events, signature checks |
| `src/agent/` | Conversation loop (Haiku), build loop (Sonnet), prompts, voice commands, stuck detection, cost |
| `src/consensus/` | The decision document (draft, then pending, then agreed) and conflicts |
| `src/ui/` | The prototype component tree and its atomic patches |
| `src/session/`, `src/stage/` | The per-session runtime and the stage WebSocket channel |
| `src/voice/` | ElevenLabs TTS through OpenRouter, speech, and barge-in |
| `src/handoff/` | The handoff page and its self-contained export |
| `src/store.ts`, `src/db/`, `db/` | Storage in SurrealDB ([ADR 0011](../../docs/adr/0011-surrealdb.md)): the async store, the connection, the migration runner, and the schema files. See [Storage](#storage). |
| `public/` | The stage (the screenshared page), its renderer, the handoff page, and the v0 operator page |
| `test/`, `scripts/` | Tests, the replay harness, and live probes |

Run it from the repo root (`npm start`, `npm run check`) or from this folder. It reads `.env` and `data/` from this
folder.

The authority on how it behaves is `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Storage
The engine keeps its data in SurrealDB, namespace `builder`, database `engine` ([ADR 0011](../../docs/adr/0011-surrealdb.md)).

- **With `SURREAL_URL`** (production: SurrealDB Cloud, `wss://...`) it connects to that server and signs in as
  `SURREAL_USER` with `SURREAL_PASS`. `SURREAL_AUTH` says what kind of user that is: `database` (the default) for a
  user defined on `builder`/`engine`, as SurrealDB Cloud sets it up, or `root` for a local `surreal start`. A
  database user needs the `OWNER` role on `engine`, because the schema defines sequences and an `EDITOR` may not.
  If the server can't be reached within 10 seconds, or refuses the sign-in, the engine stops at startup and logs
  `store.connect_failed` with the code (`SURREAL_UNREACHABLE`, `NotAllowed.Auth`).
- **Without it**, SurrealDB runs inside the engine's process (`@surrealdb/node`, the same version as the server):
  in a SurrealKV folder, `data/surreal` for `npm start` and `data/local-surreal` for `npm run local` (`SURREAL_PATH`
  changes it), and in memory for the tests and the smoke boot. Nothing to install.
- **Schema.** SurrealQL files in `db/`, applied in name order, each once, each in one transaction, and recorded in
  the `migration` table. An in-process database is migrated when the engine opens it. A server is migrated with
  `npm run migrate -w @builder/engine` (Render's pre-deploy command), which is safe to run again. Add a change as a
  new file; never edit one that has been applied. `db/0001_init.surql` says how the old SQLite tables, ids and
  timestamps map.

To try the migrations against a real server, run one locally with `surreal start --user root --pass <pass> memory`,
then `SURREAL_URL=ws://127.0.0.1:8000 SURREAL_AUTH=root SURREAL_USER=root SURREAL_PASS=<pass> npm run migrate -w @builder/engine`.

## Starting sessions from the api
`POST /internal/sessions` ([ADR 0008](../../docs/adr/0008-api-engine-boundary.md)) is how the api starts a session
for an org. It takes and answers the `StartSessionRequest` and `StartSessionResponse` shapes from `contracts/`.
- **It's off unless `ENGINE_INTERNAL_TOKEN` is set.** That's the same value as the api's, at least 32 characters.
- **Callers must send `Authorization: Bearer <token>`.**
- **Requests that came through the public proxy get 404,** as the operator routes do.
- **It uses the api's `sessionId`.** A repeat with the same id gets the same session back, and never sends a second bot.
- **Reuse stays within one org.** An org that already has an active session in that meeting gets 409 `meeting_in_use`.
  Another org gets its own session and bot.
- **Answers:**
  - 4xx means no bot was sent: `invalid_request`, `unauthorized`, `meeting_in_use`, `session_conflict` and
    `recall_rejected` (422).
  - 504 `recall_outcome_unknown` means a bot may exist.

The session's org and limits are stored, from `db/0002_session_org_limits.surql`, and enforced on every lifecycle
poll (every 4 s):
- **`maxMinutes`** counts bot time from the first status Recall gives for the bot being in the call, so time in the
  waiting room doesn't count (ADR 0009).
- **`maxUsd`** is the session's model spend, the sum in `model_calls` (the operator page's `cost_usd`).
- **At either one**, the agent stops, Builder says in chat that it's reached the meeting's time or spending limit,
  and the bot leaves. The reason is saved in `end_reason` (`db/0003_session_end_reason.surql`), so after a restart
  the engine only asks the bot to leave again. A model call already in flight still finishes, so the spend can end
  a little over `maxUsd`.
The operator routes (`/`, `/api/*`, local mode) work as before, and their sessions have no org.

## Known issues
See [docs/known-issues.md](../../docs/known-issues.md). The deployment blockers I1, I5, I6 and I7, the
agreement-correctness items I2 and I3, and the minor and visual items were fixed on 2026-10-17. Still open: the I4
ruling, a move of an agreed node, and the live checks.

## Open decisions
- Scaling. Session state lives in memory, so each session is tied to one process. Storage is SurrealDB now. This is
  tracked by [ADR 0005](../../docs/adr/0005-hosting-on-render.md) (hosting) and
  [ADR 0011](../../docs/adr/0011-surrealdb.md) (database).
- Usage events reach billing through the api, not a worker. Settled in
  [ADR 0008](../../docs/adr/0008-api-engine-boundary.md).

## First tasks
- [x] Fix known issues I1, I5, I6 and I7
- [x] Fix I2 and I3 together (agreement correctness)
- [x] Move `src/`, `public/`, `test/` and `scripts/` here
- [x] Accept `orgId` and `limits` on `POST /internal/sessions` (ADR 0008)
- [x] Stop at the limits (ADR 0008, known issue R1)
- [ ] Send events to the api (ADR 0008), with `end_reason` as the `session.status` error code
