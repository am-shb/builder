# Architecture

**Status:** v0 is described below; the production target is a placeholder. **Owner:** TBD.

## v0, as built
```
Google Meet ──(Recall.ai bot)──► realtime transcript webhooks ──► src/app.ts
                                                                    │
                     ┌──────────────── session runtime (in memory) ◄┘
                     │      conversation loop (Haiku 5.5)  ──hand-off──►  build loop (Opus 5.5)
                     │      speaks via ElevenLabs TTS                     patches prototype + consensus doc
                     ▼
     stage WebSocket ──► public/stage.html (screenshared by the bot: prototype, decision panel, Builder character)
                     │
     SQLite (src/store.ts) ──► handoff page and self-contained export
```
Models and TTS go through OpenRouter. Everything runs in one process.

## Production target (to fill in)
- [ ] A diagram of the apps: engine, api and web, and the contracts between them
- [ ] Where state lives, and how a meeting session is routed to the process that runs it
- [ ] Trust boundaries: what the bot, the stage, users and staff can each reach

Record decisions in `docs/adr/` and link them here.
