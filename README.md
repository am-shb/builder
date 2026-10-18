# Builder

[![CI](https://github.com/am-shb/builder/actions/workflows/ci.yml/badge.svg)](https://github.com/am-shb/builder/actions/workflows/ci.yml)

Builder is a Recall.ai meeting bot that joins a Google Meet, listens to everyone, steers the group
like a facilitator, and live-builds a clickable prototype of the app they are discussing on a
screenshared stage. When the call ends, engineers get a handoff page with the clickable prototype,
the component spec and the decision log.

Full design: `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Repository layout

The working v0 engine is in `src/` and `public/`, and the rest of this README describes it. The other top-level
folders are placeholders for the production product. Each one has a README with its scope, its open decisions and its
first tasks.

| Folder | Area |
|---|---|
| `src/`, `public/`, `test/`, `scripts/` | Meeting engine v0, planned to move to `services/meeting-engine/` |
| `services/` | `api`, `auth`, `billing`, `worker`, `notifications`, `meeting-engine` |
| `apps/` | `web` (the customer app) and `admin` (the internal console) |
| `packages/shared/` | Types and schemas shared across services |
| `db/`, `infra/`, `e2e/` | Database, deployment and CI, and tests that cross services |
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
   (`anthropic/claude-opus-5.5`, fallback `anthropic/claude-opus-5`). The build loop updates the consensus
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

Copy `.env.example` to `.env` and fill it in. Never commit `.env`. Names only here.

| Name | Required | Purpose |
|---|---|---|
| `RECALL_REGION` | yes | Recall region, e.g. `us-west-2`. The API key and secret must be from the same region. |
| `RECALL_API_KEY` | yes | Recall REST API key. |
| `RECALL_WEBHOOK_VERIFICATION_SECRET` | yes | Workspace verification secret (`whsec_...`) that signs realtime webhooks. |
| `PUBLIC_API_BASE_URL` | yes | Public HTTPS origin that routes to this server (the tunnel URL). No trailing slash. |
| `OPENROUTER_API_KEY` | no | One key for every model call (conversation, build, TTS). Unset means listen-only: transcript only, no agent. |
| `TTS_VOICE` | no | ElevenLabs voice for Builder. Unset means Builder's lines go to meeting chat. One of: george, sarah, adam, alice, bella, bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam, lily, matilda, river, roger, will. |
| `BOT_VARIANT` | no | `web_4_core` (default), `web_gpu`, or `web` for Recall's plain web bot. Larger variants cost more per hour. |
| `PORT` | no | Listen port, default 3000. |
| `DB_PATH` | no | SQLite path, default `data/app.db`. |

## Running

Node 24 or newer (TypeScript runs natively, no build step). `.nvmrc` pins it, so run `nvm use` (or the fnm/volta
equivalent) first.

```
npm install
npm run tunnel          # cloudflared quick tunnel to port 3000; put the printed URL in PUBLIC_API_BASE_URL
npm start               # http://localhost:3000, paste a Meet link and click Send bot
npm test                # unit, HTTP-boundary and end-to-end replay tests (no network, no ports but ephemeral ones)
npm run smoke           # boots the real app on a loopback socket with a fake Recall API; prints SMOKE OK
npm run typecheck       # tsc --noEmit over src, scripts and test
npm run check           # typecheck + test + smoke: what CI runs, and what must pass before a PR
```

Quick-tunnel URLs change on every restart. Use a reserved ngrok domain or a named Cloudflare tunnel for
anything longer-lived. Admit "Builder" in the call when it asks to join.

Browser tests (`test/*browser*.test.ts`, and parts of `test/handoff.test.ts`) need Chrome. They find it at the
macOS default path or at `CHROME_PATH`, and skip otherwise.

### Replay

`npm run replay -- test/fixtures/sessions/todo-app.json --session <session id>` sends a scripted meeting
to a running server as signed webhooks: two people propose and support, a proposal nobody objects to,
a conflict resolved by "B", a question to Builder, a voice command, and a silence that makes Builder
speak. Options: `--base-url` (default `http://localhost:3000`), `--speed` (default 1), and
`--live-models`. The script only sends; it reads `RECALL_WEBHOOK_VERIFICATION_SECRET` from the environment,
which must match the target server. Open the stage in Chrome to watch.

`--live-models` means the target server's real models answer, which costs real money. Without it, the
fixture's `fakeModel` scripts are what `test/e2e-replay.test.ts` feeds the app (through
`createRoutedFakePort`, with a virtual clock so the 30 s and 25 s waits cost nothing).

## Measured live results (2026-10-17)

- **Model probe passed.** Strict patch schema accepted, tool input streamed, fallbacks accepted. About $0.026.
- **TTS.** PCM confirmed as 24 kHz mono. First audio arrives in about 1 to 1.2 s.
- **Live meeting test.** Opening spoken (Haiku about 1.5 s plus TTS about 2.1 s), Opus build round about
  6.8 s, session model cost $0.32.
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
  are stored in SQLite.
- The local control UI has no login. It relies on being reachable only from localhost, detected by the
  absence of proxy headers. Fine for a personal test, not for a shared deployment.
- Calendar scheduling is deferred; sessions start from a pasted meeting URL.

## Known issues

The deployment blockers from the final review (I1, I5, I6, I7) are fixed, and so are agreement correctness (I2, I3)
and the minor and visual items. What's still open (the I4 ruling, a move of an agreed node, and the live checks) is
listed in [docs/known-issues.md](docs/known-issues.md). Operations: [docs/runbooks/](docs/runbooks/).
