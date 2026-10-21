# Builder

[![CI](https://github.com/am-shb/builder/actions/workflows/ci.yml/badge.svg)](https://github.com/am-shb/builder/actions/workflows/ci.yml)

Builder is a Recall.ai meeting bot that joins a Google Meet, listens to everyone, steers the group
like a facilitator, and live-builds a clickable prototype of the app they are discussing on a
screenshared stage. When the call ends, engineers get a handoff page with the clickable prototype,
the component spec and the decision log.

Full design: `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Repository layout

The repo is npm workspaces ([ADR 0004](docs/adr/0004-workspaces-and-repo-layout.md)). The working v0 engine is in
`apps/engine/`, and the rest of this README describes it. Each app has a README with its scope, its open decisions and
its first tasks.

| Folder | Area |
|---|---|
| `apps/engine/` | The engine (Builder core): `src/`, `public/`, `test/`, `scripts/` |
| `apps/api/` | Accounts, sessions, billing and jobs. Today only `GET /health` |
| `apps/web/` | The customer app and staff pages. No code yet |
| `contracts/` | zod schemas for what crosses an app boundary (engine and api, api and web) |
| `packages/session-core/` | The session screens' framework-free logic, shared by the web and mobile apps |
| `e2e/` | Tests that cross apps |
| `docs/` | Workstreams, ADRs, architecture, product, security, runbooks, known issues |

New contributors should read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/workstreams.md](docs/workstreams.md) first.

## How a session flows

1. **Join.** You paste a Meet link into the local control UI (http://localhost:3000). The backend creates
   a Recall bot named `Builder` (workspace Meet2Build, region `us-west-2`) that screenshares a
   token-gated stage page (`/stage/<session>?token=...`, 1280x720 at 15 fps) and streams per-speaker
   transcripts to `POST /recall/realtime/`. Every webhook is HMAC-verified on the raw body.
2. **Opening.** Once the bot is recording and someone is present, Builder says one short opening line.
3. **Listening.** A fast conversation model (`anthropic/claude-haiku-5.5`) reads the attributed transcript
   and acts through three tools: `speak`, `ui_command` and `update_build`. Silence is the default.
   Builder speaks only on opening, when addressed ("Builder", "hey Builder"), when the room is stuck
   (cooldown 120 s), to confirm a conflict resolved through comparison, and for command feedback that
   is invisible or failed. At most 2 sentences or 300 characters, with at most one question.
4. **Building.** The conversation loop hands what it heard to the build loop
   (`anthropic/claude-sonnet-5.5`, fallback `anthropic/claude-sonnet-5`; [ADR 0013](docs/adr/0013-build-loop-on-sonnet.md)). The build loop updates the consensus
   document and the prototype with small atomic patch batches. One run at a time, at least 10 s apart.
5. **Agreement.** A decision goes draft, then pending, then agreed. It is promoted when a different
   participant supports it, or when nobody objects for 30 s. An agreement must be backed by the
   utterances it cites. Prototype nodes are marked draft until their decision is agreed.
6. **Disagreement.** The build loop shows 2 or 3 options side by side. The room picks one out loud
   ("B"), Builder applies it, marks it agreed and confirms out loud.
7. **Voice commands.** "Click Add" or "go to Settings" is resolved against what is on screen and run on the
   stage, because a screenshare can't be clicked.
8. **Stuck.** 20 s of silence after a question to the room, a conflict open 180 s, or an open question
   nobody engaged with for 180 s makes Builder speak once.
9. **Handoff.** `/handoff/<session>?token=...` lists the decisions, open questions, the component spec
   and a clickable prototype, with a self-contained HTML export. It has its own read-only token, separate from
   the stage token. When the bot leaves the call, the agent stops for that session and the handoff is final.

Voice is `elevenlabs/eleven-v4-turbo` through OpenRouter's speech endpoint (PCM, streamed to the stage,
which plays it into the call). If TTS fails or no voice is set, the line goes to meeting chat instead.
Interrupting Builder stops it.

```
Browser --POST /api/sessions--> backend --Create Bot--> Recall (us-west-2) --> Google Meet
                                  ^   |                                          |
          stage page (screenshare)+---+<-------- signed realtime webhooks <-------+
                                  |
                       OpenRouter (conversation model, build model, TTS)
```

Through the public tunnel only these respond:
- `/recall/realtime/`, which is signed;
- `/stage/*`, gated by the stage token, which only the bot holds; it never carries transcript text;
- `/handoff/*`, gated by the read-only handoff token;
- `/renderer/*` (static files) and `/healthz`.

Everything else answers localhost only.

## Environment variables

Copy `apps/engine/.env.example` to `apps/engine/.env` and fill it in. Never commit `.env`. Names only here.

The engine runs with `apps/engine/` as its working directory, so it reads `.env` and `data/` from there. If you
have an older `.env` or `data/` at the repo root, move them into `apps/engine/` yourself. Both are git-ignored.

| Name | Required | Purpose |
|---|---|---|
| `RECALL_REGION` | yes | Recall region, e.g. `us-west-2`. The API key and secret must be from the same region. |
| `RECALL_API_KEY` | yes | Recall REST API key. |
| `RECALL_WEBHOOK_VERIFICATION_SECRET` | yes | Workspace verification secret (`whsec_...`) that signs realtime webhooks. |
| `PUBLIC_API_BASE_URL` | yes | Public HTTPS origin that routes to this server (the tunnel URL). No trailing slash. On Render it can stay unset: the engine uses `RENDER_EXTERNAL_URL`, which Render sets. |
| `OPENROUTER_API_KEY` | no | One key for every model call (conversation, build, TTS). Unset means listen-only: transcript only, no agent. |
| `TTS_VOICE` | no | ElevenLabs voice for Builder. Unset means Builder's lines go to meeting chat. One of: george, sarah, adam, alice, bella, bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam, lily, matilda, river, roger, will. |
| `BOT_VARIANT` | no | `web_4_core` (default), `web_gpu`, or `web` for Recall's plain web bot. Larger variants cost more per hour. |
| `PORT` | no | Listen port, default 3000. |
| `SURREAL_URL` | no | SurrealDB server, `ws://` or `wss://` (production: SurrealDB Cloud). Unset means SurrealDB runs in the engine's process, in `SURREAL_PATH`. Run `npm run migrate -w @builder/engine` before starting against a new or updated server. |
| `SURREAL_USER`, `SURREAL_PASS` | with `SURREAL_URL` | The user to sign in as, and its password. |
| `SURREAL_AUTH` | no | `database` (default): a user on namespace `builder`, database `engine`, with the `OWNER` role there. `root`: a root user, as on a local `surreal start`. |
| `SURREAL_PATH` | no | Folder of the in-process database when `SURREAL_URL` is unset, default `data/surreal` (`data/local-surreal` for `npm run local`), inside `apps/engine/`. |

## Running

Node 24 or newer (TypeScript runs natively, no build step). `.nvmrc` pins it, so run `nvm use` (or the fnm/volta
equivalent) first.

```
npm install
npm run tunnel          # cloudflared quick tunnel to port 3000; put the printed URL in PUBLIC_API_BASE_URL
npm start               # http://localhost:3000, paste a Meet link and click Send bot
npm run local           # no Recall: talk to Builder through your own mic at http://localhost:3000/local
npm test                # unit, HTTP-boundary and end-to-end replay tests (no network, no ports but ephemeral ones)
npm run smoke           # boots the real app on a loopback socket with a fake Recall API; prints SMOKE OK
npm run typecheck       # tsc --noEmit in every workspace (the engine checks src, scripts and test)
npm run check           # typecheck + test (+ smoke for the engine) in every workspace: what must pass before a PR
```

These commands run from the repo root. The root `start`, `local`, `smoke`, `replay` and `tunnel` scripts forward to
`@builder/engine`.

Quick-tunnel URLs change on every restart. Use a reserved ngrok domain or a named Cloudflare tunnel for
anything longer-lived. Admit "Builder" in the call when it asks to join.

Browser tests (`apps/engine/test/*browser*.test.ts`, and parts of `apps/engine/test/handoff.test.ts`) need Chrome. They find it at the
macOS default path or at `CHROME_PATH`, and skip otherwise.

### Local mode: talk to Builder without Recall

`npm run local` runs the engine with no Recall, no meeting and no tunnel. Open `http://localhost:3000/local` in
Chrome, type your name and click **Start session**. Your mic is the meeting: Chrome's speech recognition turns what
you say into transcript lines, and the real stage, shown in the page, plays Builder's voice. Only `OPENROUTER_API_KEY`
(and `TTS_VOICE` for voice) are read from `.env`. The Recall settings are ignored, and sessions go to an in-process SurrealDB in `apps/engine/data/local-surreal`, even when `SURREAL_URL` is set.
Use headphones, or Builder hears itself and stops talking. [ADR 0003](docs/adr/0003-local-mode.md) has the details.

### Replay

`npm run replay -- test/fixtures/sessions/todo-app.json --session <session id>` sends a scripted meeting
to a running server as signed webhooks: two people propose and support, a proposal nobody objects to,
a conflict resolved by "B", a question to Builder, a voice command, and a silence that makes Builder
speak. Options: `--base-url` (default `http://localhost:3000`), `--speed` (default 1), and
`--live-models`. The script only sends; it reads `RECALL_WEBHOOK_VERIFICATION_SECRET` from the environment,
which must match the target server. Open the stage in Chrome to watch.

`--live-models` means the target server's real models answer, which costs real money. Without it, the
fixture's `fakeModel` scripts are what `apps/engine/test/e2e-replay.test.ts` feeds the app (through
`createRoutedFakePort`, with a virtual clock so the 30 s and 25 s waits cost nothing).

### Run the stack with Docker

`docker compose up --build` runs SurrealDB, the engine and the api in containers, from the same images Render runs
([ADR 0005](docs/adr/0005-hosting-on-render.md)). It needs Docker with Compose 2.24 or newer, and works on a fresh
clone with no `.env` file.

- `surrealdb`: SurrealDB 3.3.2, the version SurrealDB Cloud runs, on `localhost:8000`. Its data is in a Docker volume.
- `surrealdb-setup`: runs `infra/surrealdb/setup.surql` once SurrealDB is up, then exits. It creates the namespace
  `builder`, the databases `engine` and `api`, and a database user for each app.
- `engine`: on http://localhost:3000. It runs its migrations, then starts in local mode (no Recall). Local mode keeps
  its sessions in its own in-process database, as `npm run local` does.
- `api`: on http://localhost:3001. It runs its migrations, then starts. It reaches the engine's `/internal/*` routes
  with a shared dev token.

The passwords and the token in `docker-compose.yml` are public dev defaults. Never use them anywhere else.

For a real run, put your Recall and OpenRouter settings in `apps/engine/.env` and start with
`ENGINE_MODE=start docker compose up`. The engine then stores sessions in the compose SurrealDB. Compose always uses
its own SurrealDB and token, whatever the `.env` files say. Put Clerk settings and session limits in `apps/api/.env`
to try the api's `/v1` routes. To start over, `docker compose down -v` deletes the volumes.

## Measured live results

- **Model probe passed (2026-10-17).** Strict patch schema accepted, tool input streamed, fallbacks accepted.
  About $0.026.
- **TTS.** PCM confirmed as 24 kHz mono. First audio arrives in about 1 to 1.2 s.
- **Live meeting test (2026-10-17, laptop).** Opening spoken (Haiku about 1.5 s plus TTS about 2.1 s), Opus build
  round about 6.8 s, session model cost $0.32.
- **Production meeting (2026-10-19, Render, session `df84cdfa`).** Bot alive 6 min 46 s (2 min in the waiting
  room, 4 min 44 s in the call). Opening line's first audio after 2.1 s. Haiku calls 1.2 to 6.9 s, median 2.2 s.
  Opus build calls 3.0 to 9.7 s, median 4.6 s. Model cost $0.369 (Opus $0.355 over 19 calls, Haiku $0.014 over
  36), TTS about $0.011 (542 characters), Recall about $0.07 (bot time at the `web_4_core` rate). Led to
  [ADR 0013](docs/adr/0013-build-loop-on-sonnet.md).
- **OpenRouter does not enforce strict tool schemas**, so tool inputs are stripped of undeclared keys and
  re-validated.

Latency targets: voice command visible within 2 s, spoken reply starts within 3 s, decision on screen
within 10 s, character reacts to being addressed in under 1 s.

## Manual live checklist

Run in a real Google Meet with 2 or more people. Not yet done.

- [ ] Builder opens.
- [ ] It stays silent while people talk.
- [ ] Drafts appear and agree.
- [ ] A disagreement produces A/B options and resolves by voice.
- [ ] "Click Add" works.
- [ ] Interrupting Builder stops it.
- [ ] The handoff link works after the call.
- [ ] Optional, costs money: `npm run replay -- test/fixtures/sessions/todo-app.json --session <id> --live-models`
      against a running server with a stage open in Chrome. Record the latencies against the targets above
      and the per-session cost.

## Deliberate shortcuts

- Bot lifecycle is polled (`GET /bot/{id}` every 4 s) instead of using dashboard webhooks. Production:
  register a dashboard webhook endpoint on a stable URL for bot status, `transcript.done` and
  `transcript.failed` (the failure event is only delivered there, not to realtime endpoints).
- Partial transcripts drive the character and the live captions but are not stored; finalized utterances
  are stored in SurrealDB.
- The local control UI has no login. It relies on being reachable only from localhost, detected by the
  absence of proxy headers. Fine for a personal test, not for a shared deployment.
- Calendar scheduling is deferred; sessions start from a pasted meeting URL.

## Known issues

The deployment blockers from the final review (I1, I5, I6, I7) are fixed, and so are agreement correctness (I2, I3)
and the minor and visual items. What's still open (the I4 ruling, a move of an agreed node, and the live checks) is
listed in [docs/known-issues.md](docs/known-issues.md). Operations: [docs/runbooks/](docs/runbooks/).
