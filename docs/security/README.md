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

## Known security issues
- I7 in [../known-issues.md](../known-issues.md): the handoff link currently exposes the live transcript.
