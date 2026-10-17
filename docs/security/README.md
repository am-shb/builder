# Security, privacy and compliance

**Status:** placeholder. **Owner:** TBD. Must be done before launch.

Builder records and transcribes other people's meetings, so this area is part of the product, not an afterthought.

## To fill in
- [ ] **Threat model.** Cover the webhook signatures, the stage, handoff and capability tokens, API keys, staff access,
  and prompt injection from meeting speech.
- [ ] **Consent.** How the bot announces itself, and recording-consent rules by region. The bot's name and opening
  line act as its notice.
- [ ] **Data handling.** What is stored (transcripts, prototypes, decisions), where, for how long, and how it's deleted.
- [ ] **Subprocessors.** Recall.ai, OpenRouter and the model and TTS providers behind it, and the hosting platform.
- [ ] **Customer documents.** GDPR, the data processing agreement, and the privacy policy.
- [ ] **Logging policy.** Never log transcript text, prompts or model output. This is already a rule in AGENTS.md.
- [ ] **Later.** Penetration testing, and SOC 2 readiness.

## Current controls (v0)
- Recall webhooks are HMAC-verified on the raw body, with a 5-minute timestamp tolerance (`src/verify.ts`).
- Each session has two random 192-bit capability tokens:
  - `stage_token` is for the bot only. It opens the stage page, `/state` and the stage WebSocket.
  - `handoff_token` is read-only and shareable. It opens the handoff page and the export.
- No transcript text or speaker names go to the stage, over the WebSocket or through `/state`. Only `{partial,
  isAgent}` flags do (I7, fixed 2026-10-17).
- Logs carry ids, counts and error names only. Tests check that no transcript or spoken text reaches the logs.

## Known security gaps
- **The operator surface has no authentication.** `/` and `/api/*` are gated only by the absence of proxy headers.
  Anyone who reaches the process directly can create bots, read transcripts and post chat messages. Don't expose the
  port.
- **Capability tokens never expire and can't be revoked.** Anyone who has a link keeps access.
- **Data has no retention or deletion.** SQLite keeps transcripts indefinitely, in `data/app.db`.
- **Prompt injection from meeting speech isn't modelled.** The agent acts only through validated tools, and agreement
  needs grounded utterances, but nothing has been tested adversarially.
