# Security

Builder joins other people's meetings and stores what they say, so treat any leak of transcripts, tokens or keys as
a security issue.

## Reporting
Don't open a public issue. Use GitHub's private vulnerability reporting (the **Security** tab, then **Report a
vulnerability**), or contact a maintainer directly. Include the session or bot id and the steps to reproduce. Never
include transcripts, handoff links or keys.

## Rules for contributors
- Never commit `.env`. Never paste API keys, webhook secrets, stage tokens or handoff links into issues, PRs or chat.
- Never log transcript text, prompts or model output. Log ids, counts and error names.
- If a secret leaks, rotate it right away (see [docs/runbooks/](docs/runbooks/README.md#rotating-secrets)) and tell
  the maintainers.

The threat model, the current controls and the known gaps are in [docs/security/](docs/security/README.md).
