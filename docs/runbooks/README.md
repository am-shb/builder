# Runbooks

**Status:** first draft for v0 (one process on a laptop or VM, behind a tunnel). **Owner:** TBD. Update this page when
hosting is decided.

Logs are one JSON object per line on stdout, shaped like `{"t": ..., "msg": "<event>", ...ids and counts}`. They never
contain transcript text, prompts or model output, so you can paste them into an issue. Filter by `session_id`.

## Live meeting test

Live tests cost money (Recall bot minutes, models, TTS). Run one only when the meeting-engine owner has approved it.

1. Fill in `apps/engine/.env` from `apps/engine/.env.example`. Run `npm run tunnel` and copy the printed URL into `PUBLIC_API_BASE_URL`, then
   run `npm start`.
2. Open http://localhost:3000, paste a Meet link and click **Send bot**. Admit "Builder" in Meet.
3. Work through the "Manual live checklist" in the root [README](../../README.md).
4. When you're done, click **Remove bot**. The log should show `bot.status` with `done` or `call_ended`, and then
   `session.ended`.
5. Write the per-session cost (shown on the operator page) and the latencies you saw in the README.

## Incident: the bot can't join, or the stage is blank

| What you see | Look for | Likely cause |
|---|---|---|
| **Send bot** fails with 502 | `bot.create_failed` with `status` | Recall rejected the request. The API key and `RECALL_REGION` don't match, or the meeting URL is wrong. |
| **Send bot** returns 504 or 409 | `bot.create_ambiguous` | Network failure, so the outcome is unknown. Check the Recall dashboard before retrying. The 409 holds until it's resolved. |
| The bot never shows up in Meet | `bot.status` sub-codes | The bot is waiting in the lobby (admit it), or the meeting rejected it. |
| No transcript arrives | `realtime.rejected` | The webhook secret doesn't match the workspace, or the clock is skewed more than 5 minutes. |
| No transcript arrives, and no rejections either | nothing at all | The tunnel URL changed. Quick tunnels change on every restart, and bots that already exist keep the old URL, so send a new bot. |
| The stage is blank or frozen | `channel.snapshot_failed`, `http.error` | The stage can't reach `/stage/<id>/ws`. It falls back to polling `/state` every second. Check that the tunnel is up. |
| Builder is silent | `llm_timeout`, `conversation.turn_failed`, `speech.fallback` | Model or TTS trouble. Builder's lines fall back to meeting chat when TTS fails. |

## Incident: cost spike

1. Find the session. The operator page shows the cost per session, and `GET /api/sessions/<id>/cost` returns
   `cost_usd` (so does `GET /api/sessions/<id>`).
   In the logs, every `llm_call` carries `cost_usd`, `loop` and `ms`.
2. Stop it by clicking **Remove bot** (`POST /api/sessions/<id>/leave`). Once the status is terminal, the agent stops
   for that session and makes no more model calls (I5).
3. If that doesn't stop it, stop the process. To keep transcripts flowing with no model spend, restart without
   `OPENROUTER_API_KEY` (listen-only).
4. Nothing caps spend automatically yet. The api will enforce limits per session and per org ([ADR 0008](../adr/0008-api-engine-boundary.md)).

## Rotating secrets

Never paste a secret into an issue, a PR, a log or a chat. Edit `apps/engine/.env` (or the host's secret store) and restart.

- **`OPENROUTER_API_KEY`:** create a new key in OpenRouter, swap it in, restart, then revoke the old key.
- **`RECALL_API_KEY`:** create a new key in the Recall dashboard (Developers > API Keys) **in the same region** as
  `RECALL_REGION`. Swap it in, restart, then delete the old key. Bots that are already running aren't affected.
- **`RECALL_WEBHOOK_VERIFICATION_SECRET`:** rotate it in the Recall dashboard, set the new `whsec_...` value and
  restart. The verifier accepts any matching `v1` signature in the header. A restart restores a live meeting's
  transcript window, open comparison and no-objection timer, but it drops hand-offs waiting for a run and cuts off a
  line Builder is speaking (known issue M2), so rotate between meetings.
- **Stage or handoff tokens:** they can't be revoked yet (see [../security/](../security/)). To cut off a leaked
  handoff link today, you'd have to change that session's `handoff_token` in the database.

## Deploy and environments

Nothing is deployed yet. The plan is in [ADR 0005](../adr/0005-hosting-on-render.md): Render, with a persistent public
URL per environment (dev, staging and production) so Recall webhooks and the stage no longer depend on a tunnel.

- Secrets live in the host's secret store: the Recall keys and webhook secret, the OpenRouter key, and the auth and
  payment provider keys. Never in the repo.
- CI is in `.github/workflows/ci.yml` ([ADR 0001](../adr/0001-ci-and-type-checking.md)). Dependabot is in
  `.github/dependabot.yml`.
- The engine logs one JSON object per line to stdout, and `GET /healthz` returns `{"ok":true}` with no auth. The api
  serves `GET /health`.
- Logs carry only ids and codes, never transcript text, prompts or model output.
- Still to do: a staging environment, branch protection on `main` (require the **check** job and one review), and
  alerts and uptime checks.
