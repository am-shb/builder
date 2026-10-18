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

## Database

The engine keeps its data in Postgres, in the `engine` schema ([ADR 0007](../adr/0007-database.md)). It connects
with whatever role `DATABASE_URL` carries.

- **Migrations:** `npm run migrate -w @builder/engine` applies the committed migrations in `apps/engine/drizzle/`
  to the database in `DATABASE_URL`. It is safe to run again. On Render it is the pre-deploy command. It needs only
  production dependencies. It logs `db.migrated`, or `db.migrate_failed` with a Postgres error code.
- **Without `DATABASE_URL`:** the engine runs PGlite in the process and migrates it on start. `npm start` keeps it in
  `apps/engine/data/pg`, and `npm run local` in `apps/engine/data/local-pg`. To start fresh, stop the engine and
  delete that folder.
- **Changing the schema:** edit `apps/engine/src/db/schema.ts`, run `npx drizzle-kit generate` in `apps/engine`, and
  commit the new migration with the change.
- **Logs:** database failures log an error name or Postgres code, never values. Look for `store.pool_error`,
  `runtime.persist_failed`, `realtime.process_failed` and `bot.status_save_failed`.

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

## Deploy to Render

[ADR 0005](../adr/0005-hosting-on-render.md) picks Render. The Blueprint is `render.yaml` at the repo root. It
defines the Postgres `builder-db` and the web service `builder-engine`, both in `oregon`, the region nearest
Recall's `us-west-2`. There is no api or web service yet. They go in the same file when they exist.

**Cost:** a Pro workspace ($25 a month), the engine on `starter` ($7) and `builder-db` on `basic-256mb` ($6), about
$38 a month plus bandwidth. Nothing runs on a free plan.

**Create it**
1. In the Render dashboard choose New > Blueprint. Pick the repo and the branch.
2. Render lists the database and the engine. It asks for each variable marked `sync: false`:
   `RECALL_API_KEY`, `RECALL_WEBHOOK_VERIFICATION_SECRET`, `OPENROUTER_API_KEY`, `RECALL_REGION`, `TTS_VOICE` and
   `BOT_VARIANT`. Paste the secrets here and nowhere else. `RECALL_REGION` is a value such as `us-west-2`, and it
   must match the region of the Recall key. `TTS_VOICE` and `BOT_VARIANT` can stay empty. If Render won't accept an
   empty value, you can add them later under the service's Environment tab. Render asks for these values only when
   the Blueprint is first created. Change them later in the dashboard Environment tab, because editing `render.yaml`
   won't update them.
3. Apply. `DATABASE_URL` (the internal connection string) and `NODE_ENV=production` are set by the Blueprint.
   `PUBLIC_API_BASE_URL` isn't needed. The engine uses `RENDER_EXTERNAL_URL`, which Render sets, unless you set
   `PUBLIC_API_BASE_URL` yourself (for a custom domain, for example).

**What a deploy does**
1. Build: `npm ci --workspace @builder/engine --include-workspace-root`. With `NODE_ENV=production` this installs
   production dependencies only. The engine needs no dev dependency to migrate or start.
2. Pre-deploy: `npm run migrate -w @builder/engine`. If it fails, the deploy stops and the old version keeps
   running. The log line is `db.migrate_failed` with an error code.
3. Start: `npm start -w @builder/engine`. Render waits for `GET /healthz` to return 200 before it switches traffic.
4. The Blueprint redeploys on a push to the branch, but only when a path in `buildFilter` changed.

**Check health**
- `curl https://<your-service>.onrender.com/healthz` returns `{"ok":true}`.
- In the dashboard, the Logs tab shows `db.migrated` and `Listening on`. A bad config shows as `Missing required
  environment variables` and the names only.
- Don't configure webhooks in the Recall dashboard. The engine sets the realtime webhook URL on each bot when it
  creates it, from `PUBLIC_API_BASE_URL` or else `RENDER_EXTERNAL_URL`, and the log line `Recall realtime endpoint:`
  shows it. Bot lifecycle uses polling, not dashboard webhooks.

**Roll back**
- Code: in the service's Events tab, choose Rollback on the last good deploy. It doesn't undo migrations. The
  committed migrations only add to the schema so far. If a migration must be undone, write a new migration.
- Data: `builder-db` has backups. Restoring is a dashboard action on the database. Check what the plan includes first.

**Known limits**
- **A deploy overlaps two instances on live meetings.** Render starts the new instance before it stops the old one.
  The new one resumes every active session from the database at boot while the old one still serves. For a short
  time both can run loops for the same meeting, so Builder could speak twice and the last consensus write wins.
  Before sessions run on Render the engine needs writes that drain on SIGTERM, and either a session lease with
  fencing or a drain-then-resume handover. Until then, deploy outside meetings.
- **Nobody can start a session on Render yet.** The operator page `/` and `/api/*` refuse requests that arrive
  through a proxy, and Render is one. Starting sessions needs the api and Clerk, or an interim operator token that
  an ADR decides. The Recall realtime webhook, the stage and the handoff pages work, and so does `/healthz`.
- One instance only. Don't raise `numInstances`.
- A free-tier database expires and has no backups, so keep `basic-256mb`.

**Other notes**
- The database accepts internal connections only (`ipAllowList: []`). To use `psql`, add your IP in the dashboard
  for the time you need it, or use Render's shell on the engine.
- Internal connection strings don't need SSL, and the engine doesn't set it. If you ever use the external URL, add
  `?sslmode=require` to it.
- Staging and production, from the same Blueprint, are still to do (ADR 0005).

## Environments and CI

- Secrets live in the host's secret store: the Recall keys and webhook secret, the OpenRouter key, and the auth and
  payment provider keys. Never in the repo.
- CI is in `.github/workflows/ci.yml` ([ADR 0001](../adr/0001-ci-and-type-checking.md)). Dependabot is in
  `.github/dependabot.yml`.
- The engine logs one JSON object per line to stdout, and `GET /healthz` returns `{"ok":true}` with no auth. The api
  serves `GET /health`.
- Logs carry only ids and codes, never transcript text, prompts or model output.
- Still to do: a staging environment, branch protection on `main` (require the **check** job and one review), and
  alerts and uptime checks.
