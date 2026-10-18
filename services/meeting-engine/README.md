# services/meeting-engine: the Builder core (v0)

**Status:** working v0. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Where the code is today
The v0 engine hasn't moved here yet. It lives at the repo root:

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

The authority on how it behaves is `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Known issues
See [docs/known-issues.md](../../docs/known-issues.md). The deployment blockers I1, I5, I6 and I7, the
agreement-correctness items I2 and I3, and the minor and visual items were fixed on 2026-10-17. Still open: the I4
ruling, a move of an agreed node, and the live checks.

## Open decisions
- When and how to move `src/` and `public/` here. Do it in one PR that only moves files and fixes imports.
- Scaling. Session state lives in memory and storage is SQLite, so each session is tied to one process. Choose between
  sticky routing and shared state before running more than one instance.
- Whether usage events reach billing directly or through the worker

## First tasks
- [x] Fix known issues I1, I5, I6 and I7
- [x] Fix I2 and I3 together (agreement correctness)
- [ ] An ADR on scaling and state
