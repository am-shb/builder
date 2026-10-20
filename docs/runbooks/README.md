# Runbooks

**Status:** v0 on a laptop behind a tunnel, and production on Render with SurrealDB Cloud (being set up, ADR 0005 and
ADR 0011). **Owner:** TBD.

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
   `cost_usd`, the total. `GET /api/sessions/<id>` also returns `costs`, split into `model`, `tts` and `recall`.
   In the logs, every `llm_call` carries `cost_usd`, `loop` and `ms`, and `session.cost` gives the session's cost by
   kind when its bot ends.
2. Stop it by clicking **Remove bot** (`POST /api/sessions/<id>/leave`). Once the status is terminal, the agent stops
   for that session and makes no more model calls (I5).
3. If that doesn't stop it, stop the process. To keep transcripts flowing with no model spend, restart without
   `OPENROUTER_API_KEY` (listen-only).
4. Sessions the api starts stop on their own at their `maxMinutes` or `maxUsd` (`session.limit_reached` in the
   logs, then `session.leaving`). Sessions started from the operator routes have no limits. Per-org caps are the
   api's ([ADR 0008](../adr/0008-api-engine-boundary.md)).

## Rotating secrets

Never paste a secret into an issue, a PR, a log or a chat. On a laptop, edit `apps/engine/.env` and restart. On Render,
change the value in the service's Environment tab and save it with a deploy. Editing `render.yaml` doesn't change a
`sync: false` value.

- **`OPENROUTER_API_KEY`:** create a new key in OpenRouter, swap it in, restart, then revoke the old key.
- **`RECALL_API_KEY`:** create a new key in the Recall dashboard (Developers > API Keys) **in the same region** as
  `RECALL_REGION`. Swap it in, restart, then delete the old key. Bots that are already running aren't affected.
- **`RECALL_WEBHOOK_VERIFICATION_SECRET`:** rotate it in the Recall dashboard, set the new `whsec_...` value and
  restart. The verifier accepts any matching `v1` signature in the header. A restart restores a live meeting's
  transcript window, open comparison and no-objection timer, but it drops hand-offs waiting for a run and cuts off a
  line Builder is speaking (known issue M2), so rotate between meetings.
- **`SURREAL_PASS` (the `engine` or `api` database user):** run `node infra/surrealdb/make-user.ts <user>` for that
  one user, in your own terminal (never through an AI agent or on a shared screen). Run the SurrealQL it prints in
  Surrealist as root, then set the printed password as that service's `SURREAL_PASS` in Render right away, and deploy.
  Clear your terminal. The other user is left alone. From the moment the SurrealQL runs until the deploy, the service
  can't open a new connection.
- **`ENGINE_INTERNAL_TOKEN`:** change it in the `builder-internal` environment group (Render dashboard, Environment
  Groups). Both services redeploy with it. A start request sent between the two deploys can get 401.
- **Stage or handoff tokens:** they can't be revoked yet (see [../security/](../security/)). To cut off a leaked
  handoff link today, you'd have to change that session's `handoff_token` in the database.

## Production: Render and SurrealDB Cloud

Production only for now. Staging gets added to the same Blueprint later ([ADR 0005](../adr/0005-hosting-on-render.md)).
Everything runs in US East:

| What | Where | Defined in |
|---|---|---|
| `builder-engine` | Render web service, Docker, `starter`, region `virginia`, one instance | `render.yaml`, `apps/engine/Dockerfile` |
| `builder-api` | Render web service, Docker, `starter`, region `virginia` | `render.yaml`, `apps/api/Dockerfile` |
| `builder-web` | Render static site, on Render's CDN, free. Built from the repo root with `npm run build -w @builder/web` | `render.yaml` |
| `builder-internal` | Render environment group with the generated `ENGINE_INTERNAL_TOKEN`, linked to both services | `render.yaml` |
| SurrealDB | SurrealDB Cloud, Start plan (free), AWS `us-east-1`, SurrealDB 3.3.2. Namespace `builder`, databases `engine` and `api` | `infra/surrealdb/make-user.ts` (users), each app's `db/` (schema) |
| Recall | A workspace in `us-east-1` | Recall dashboard |

**Cost:** the Render Pro workspace ($25 a month) and two `starter` services ($7 each), about $39 a month plus
bandwidth. The static site is free. The SurrealDB instance is free ([ADR 0011](../adr/0011-surrealdb.md) has its limits).

### 1. SurrealDB Cloud

1. The instance: Start plan (free), AWS `us-east-1`, SurrealDB 3.3.2. Production's instance exists. Its host is
   `builder-06gktu2jmdup37o5s378tqqjq4.aws-use1.surreal.cloud`, so `SURREAL_URL` is
   `wss://builder-06gktu2jmdup37o5s378tqqjq4.aws-use1.surreal.cloud`. A new one is created from the Cloud dashboard.
2. Make the app users on your own machine, from the repo root after `npm ci` (Node 24):
   `node infra/surrealdb/make-user.ts engine api`. Run it in your own terminal, never through an AI agent or on a shared screen, because its output contains the
   passwords. It makes a random password per user, hashes it with SurrealDB's own argon2 function in the process,
   and prints two things: the SurrealQL to run, which holds only the hashes, and the passwords, once. It writes no
   file.
3. Open the instance in Surrealist and connect as its root user. Paste the SurrealQL it printed into a new query and
   run it. Every statement should say OK. It runs as one transaction, so if one fails nothing was changed. It defines
   namespace `builder`, databases `engine` and `api`, and the users `engine` and `api`, each with the OWNER role on
   its own database only (`PASSHASH`, so no password reaches Surrealist). It never touches data.
4. Paste each password into Render as that service's `SURREAL_PASS` when you create the Blueprint (section 3
   below), then clear your terminal, scrollback too. The passwords aren't kept anywhere else.
5. Backups: in the Cloud dashboard, check that the instance's daily backups are on. The free instance keeps one day.
   Raise it to seven, the plan's limit, and try a restore into a new instance before the first customer (ADR 0011).
6. The free instance pauses itself after seven days without use. While it's paused, deploys fail at the pre-deploy
   step with `SURREAL_UNREACHABLE`, and the running services can't reach their data. Resume it from the dashboard.

### 2. Recall

1. Create a workspace in the `us-east-1` region. The Blueprint sets `RECALL_REGION=us-east-1`, and the key and secret
   only work in their own region.
2. Copy its API key (Developers > API Keys) for `RECALL_API_KEY`, and its verification secret (`whsec_...`) for
   `RECALL_WEBHOOK_VERIFICATION_SECRET`.
3. The realtime webhook needs no setup in the dashboard: the engine sets it on each bot it creates, as
   `https://<engine host>/recall/realtime/`, from `RENDER_EXTERNAL_URL`. The log line `Recall realtime endpoint:`
   shows it at start.
4. A dashboard webhook endpoint (bot status, `transcript.done`, `transcript.failed`) waits for an engine route that
   receives it. Today the engine polls bot status instead (README, "Deliberate shortcuts"). When that route lands, add
   the endpoint in the workspace's Webhooks page with the engine's URL and that route's path.

### 3. The Blueprint

1. In the Render dashboard, choose New > Blueprint. Pick this repo and the branch `main`. Render reads `render.yaml`
   and lists `builder-engine`, `builder-api` and the environment group `builder-internal`.
2. Render asks for each `sync: false` value. Paste secrets here and nowhere else:

   | Variable | Service | Value |
   |---|---|---|
   | `SURREAL_URL` | both | `wss://builder-06gktu2jmdup37o5s378tqqjq4.aws-use1.surreal.cloud` |
   | `SURREAL_USER` | engine | `engine` |
   | `SURREAL_PASS` | engine | the `engine` password that `make-user.ts` printed |
   | `SURREAL_USER` | api | `api` |
   | `SURREAL_PASS` | api | the `api` password that `make-user.ts` printed |
   | `RECALL_API_KEY`, `RECALL_WEBHOOK_VERIFICATION_SECRET` | engine | from step 2 |
   | `OPENROUTER_API_KEY` | engine | the OpenRouter key. Empty means listen-only |
   | `TTS_VOICE`, `BOT_VARIANT` | engine | optional, can stay empty (`apps/engine/.env.example`) |
   | `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES` | api | both or neither. Neither: the `/v1` routes answer 503 |
   | `DEFAULT_MAX_USD`, `DEFAULT_MAX_MINUTES` | api | both or neither, still to be decided (D5 in `docs/plans/api-first-slice.md`). Neither: starting a session answers 503 |

   Render asks only when the Blueprint is first created. Change a value later in the service's Environment tab. If the
   dashboard won't take an empty value for an optional variable, add it there later instead.
3. The Blueprint sets the rest: `NODE_ENV=production`, `PORT=10000`, `RECALL_REGION=us-east-1`, the api's
   `ENGINE_INTERNAL_URL` (the engine's private host and port, such as `builder-engine:10000`), and
   `ENGINE_INTERNAL_TOKEN` (generated). `PUBLIC_API_BASE_URL` isn't needed: the engine uses `RENDER_EXTERNAL_URL`.
   Set it only for a custom domain.
4. Apply. Render builds both images and deploys them as below.

### 4. The web app (`builder-web`)

The Blueprint already exists, so syncing it adds the site, but Render doesn't ask for the site's `sync: false`
values: it asks only when a Blueprint is first created.
1. Sync the Blueprint (Blueprints > the Blueprint > Manual Sync, if it hasn't synced on its own since `render.yaml`
   gained `builder-web`). Render creates `builder-web`. Its first build may finish before its settings exist; the
   site then shows "not set up yet", which is fine.
2. On `builder-web`'s Environment tab, set:

   | Variable | Value |
   |---|---|
   | `VITE_CLERK_PUBLISHABLE_KEY` | the publishable key of the **same** Clerk instance as `builder-api`'s `CLERK_JWT_KEY` (otherwise every call gets 401) |
   | `VITE_API_URL` | `builder-api`'s public origin, `https://...onrender.com`, from its page. No path, no trailing slash |

   Both are read at build time: after changing either, deploy the site again (Manual Deploy > Deploy latest commit).
3. On `builder-api`'s Environment tab, set `CLERK_AUTHORIZED_PARTIES` to the site's origin (`https://...onrender.com`,
   from its page). It's also the api's CORS list. Leave `http://localhost:5173` out of the deployed api: any local Vite
   page would be trusted. Saving redeploys only the api, which doesn't end meetings.
4. Check the site:
   - `curl -sI https://<site>/sessions/x` answers 200 with `content-security-policy: frame-ancestors 'none'; ...`,
     `x-frame-options: DENY`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `permissions-policy`
     and `cross-origin-opener-policy` (a deep link, so the rewrite to `index.html` carries the headers too).
   - In a browser with the console open: sign-in, choosing an organization, the list and a session's page load with
     no CSP errors and no 401s.
   - Starting a session from the site sends a real, paid Recall bot. Ask first, use a meeting you control, and end the
     bot afterwards.

The headers and the rewrite live only in `render.yaml`: Render keeps rules made in the dashboard that aren't in the
file, so don't add any there.

### How a deploy works (CD)

1. A commit lands on `main`, and GitHub Actions runs CI on it.
2. Render waits for the commit's checks (`autoDeployTrigger: checksPass`). It deploys only when every check passes.
   A failed check, or none at all, means no deploy.
3. Each service deploys only when a path in its `buildFilter` changed: its app, `contracts/`, the root
   `package.json` and `package-lock.json`, `.nvmrc` or `.dockerignore`.
   CI cancels a run on `main` when a newer commit lands before it finishes (`concurrency` in `ci.yml`). The cancelled
   commit has failed checks, so Render skips it; if the newer commit doesn't touch the same service's paths, that
   service isn't deployed at all. After quick pushes to `main`, check each service's latest deploy and deploy it by
   hand if it's behind (Manual Deploy > Deploy latest commit).
4. Build: Render builds the image from the app's Dockerfile, with the repo root as the context. The static site runs
   its `buildCommand` instead and publishes `apps/web/dist`; it has no pre-deploy step or health check.
5. Pre-deploy: `npm --prefix /app/apps/<app> run migrate`, on a separate instance from the same image. It applies the
   new `db/*.surql` files as the app's own database user and logs `db.migrated`. If it fails, the deploy stops, the
   old version keeps serving, and the log shows `db.migrate_failed` with an error code.
6. Start: the new instance starts, and Render waits for its health check (`/healthz` for the engine, `/health` for the
   api). Once it passes, traffic moves to the new instance and the old one stops. If it doesn't pass within 15
   minutes, the deploy is cancelled and the old instance keeps serving.

**A deploy of the engine ends live meetings** (ADR 0005), and merging to `main` deploys it. Merge engine changes
outside meetings, or turn off auto-deploy for the engine (Settings > Auto-Deploy) while one runs.

### Check a deploy

- In the dashboard, the service's Events tab shows the deploy as live.
- Its Logs tab shows `db.migrated` from the pre-deploy step. The engine then logs `Listening on` and
  `Recall realtime endpoint: https://.../recall/realtime/ (region us-east-1)`. The api logs `api.listening` with
  `"db":"server"`, and `"engine":true` when it has the engine's address and token.
- `curl https://<engine host>/healthz` and `curl https://<api host>/health` both return `{"ok":true}`. The hosts are on
  each service's page.
- A bad setting stops the start with a message that names the variable, never its value, such as `Missing required
  environment variables: RECALL_API_KEY`. A database that refuses the sign-in shows `NotAllowed.Auth`.

### Roll back

- In the service's Deploys page, pick the last good deploy and choose Rollback. Render redeploys that build with
  that deploy's environment variables. It keeps only a limited number of recent builds.
- A rollback from the dashboard turns off auto-deploy for that service. Turn it back on in Settings > Auto-Deploy
  ("After CI checks pass") once `main` is fixed. Otherwise nothing deploys after that. Reverting the commit on `main`
  instead keeps auto-deploy on, and CD deploys the revert.
- A rollback doesn't undo migrations. They only go forward: the older code runs on the newer schema, and its own
  pre-deploy step finds nothing to apply. So far every migration only adds. To undo one, write a new migration that
  reverses it, and deploy that.
- Data comes back only from SurrealDB Cloud's daily backup, restored into a new instance. It loses everything since
  the backup, so it's the last resort.

### Known limits

- One engine instance. Don't raise `numInstances`: live sessions are in its memory.
- The engine's operator page `/` and `/api/*` refuse requests that come through Render's proxy. Requests over the
  private network carry no proxy headers, so other services in the workspace can reach them. Only our own services
  run there.
- Bots are created only through the api (`POST /v1/sessions`), which needs Clerk and the session limits set.
- No staging yet, no alerts and no uptime checks.

## Environments and CI

- Secrets live in Render's environment (production) or in git-ignored `.env` files (laptops). Never in the repo.
- CI is in `.github/workflows/ci.yml` ([ADR 0001](../adr/0001-ci-and-type-checking.md)). Besides typecheck, tests and
  smoke, it builds both images and runs the store tests and both apps' migrations against SurrealDB 3.3.2. Dependabot
  is in `.github/dependabot.yml`.
- `docker compose up` runs the same images on a laptop (README, "Run the stack with Docker").
- The engine logs one JSON object per line to stdout, and `GET /healthz` returns `{"ok":true}` with no auth. The api
  serves `GET /health`.
- Logs carry only ids and codes, never transcript text, prompts or model output.
- Still to do: a staging environment, and branch protection on `main` (require the CI checks and one review).
