# apps/engine: the Builder core (v0)

**Status:** working v0. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Where the code is
The v0 engine moved here from the repo root in a PR that only moved files and fixed paths, per
[ADR 0004](../../docs/adr/0004-workspaces-and-repo-layout.md). Paths below are relative to this folder:

| Path | What it does |
|---|---|
| `src/server.ts`, `src/app.ts` | HTTP server and routes, plus the Recall realtime webhook (verified by HMAC signature) |
| `src/recall-client.ts`, `src/realtime.ts`, `src/verify.ts` | Recall.ai bot API, transcript events, signature checks |
| `src/agent/` | Conversation loop (Haiku), build loop (Opus), prompts, voice commands, stuck detection, cost |
| `src/consensus/` | The decision document (draft, then pending, then agreed) and conflicts |
| `src/ui/` | The prototype component tree and its atomic patches |
| `src/session/`, `src/stage/` | The per-session runtime and the stage WebSocket channel |
| `src/voice/` | ElevenLabs TTS through OpenRouter, speech, and barge-in |
| `src/handoff/` | The handoff page and its self-contained export |
| `src/store.ts` | SQLite storage |
| `public/` | The stage (the screenshared page), its renderer, the handoff page, and the v0 operator page |
| `test/`, `scripts/` | Tests, the replay harness, and live probes |

Run it from the repo root (`npm start`, `npm run check`) or from this folder. It reads `.env` and `data/` from this
folder.

The authority on how it behaves is `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Known issues
See [docs/known-issues.md](../../docs/known-issues.md). The deployment blockers I1, I5, I6 and I7, the
agreement-correctness items I2 and I3, and the minor and visual items were fixed on 2026-10-17. Still open: the I4
ruling, a move of an agreed node, and the live checks.

## Open decisions
- Scaling. Session state lives in memory and storage is SQLite, so each session is tied to one process. This is
  tracked by [ADR 0005](../../docs/adr/0005-hosting-on-render.md) (hosting) and
  [ADR 0007](../../docs/adr/0007-database.md) (database).
- Usage events reach billing through the api, not a worker. Settled in
  [ADR 0008](../../docs/adr/0008-api-engine-boundary.md).

## First tasks
- [x] Fix known issues I1, I5, I6 and I7
- [x] Fix I2 and I3 together (agreement correctness)
- [x] Move `src/`, `public/`, `test/` and `scripts/` here
- [ ] Accept `orgId` and `limits`, stop at the limits, and send events to the api (ADR 0008)
