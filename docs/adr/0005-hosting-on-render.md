# 0005: Hosting on Render

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** infra

## Context
Blocking decision 2 in [workstreams.md](../workstreams.md). Recall needs a stable public URL for webhooks and for
the stage it screenshares, and we have no URL at all today. The engine holds each live session in memory, so it
runs as one instance. The api and the web app are stateless.

## Options considered
1. **Everything on Render.** A build-week sponsor. Web services with WebSockets, static sites, managed Postgres with
   point-in-time recovery, a private network between services, and a `render.yaml` Blueprint. One platform and one
   bill.
2. **Serverless for the stateless apps (Cloud Run or Vercel), engine and Postgres on Render.** Scale to zero for the
   api and web. Saves about $7 to $14 a month at our size, because the engine and Postgres, most of the bill, can't
   scale to zero. Costs the private network: internal calls and database connections would cross the public internet,
   and Postgres would accept connections from any IP, because serverless egress IPs change. Also two platforms and
   two deploy pipelines.
3. **Google Cloud for everything.** More control, more to wire up.

## Decision
Option 1, defined in a `render.yaml` Blueprint at the repo root. Prices are from render.com/pricing on 2026-10-17.

| Service | Render type | Launch size | Notes |
|---|---|---|---|
| `engine` | Web service, 1 instance | 0.5 CPU / 512 MB, $7 | Public: Recall and the stage need it. WebSockets for the stage. Grow to 1 CPU / 2 GB ($25) with concurrent meetings |
| `api` | Web service | 0.5 CPU / 512 MB, $7 | Webhooks from Clerk and Stripe. Can scale out |
| `web` | Static site, or web service if server-rendered | $0, or $7 | Depends on the web framework ADR |
| `db` | Private service running SurrealDB, with a disk | 0.5 CPU / 512 MB, $7, plus $0.25 per GB of disk | [ADR 0011](0011-surrealdb.md) (it replaced Render Postgres, ADR 0007). One instance. No public URL |

- **Workspace: Pro ($25 a month).** Hobby allows one seat. Pro includes 25 GB of bandwidth, then $0.15 per GB.
- **Nothing runs on a free plan.** Free web services spin down after 15 idle minutes, lose their filesystem, and
  can't receive private network traffic. Free Postgres expires after 30 days and has no backups.
- **One region** for everything, because the private network only connects services in the same region. Choose
  the one nearest to Recall's region.
- The api and the engine call each other over the private network (ADR 0008). SurrealDB is reached by its private-network host name.
- **Monorepo:** don't set `rootDir`. Render doesn't make files outside it available, so `contracts/` would be missing.
  Build from the repo root with a workspace-scoped install. Use `buildFilter` so each service deploys only when its
  app or `contracts/**` changes.
- **Node version:** Render reads `.nvmrc`, so every service runs the same Node as CI.
- **Environments:** `staging` and `production` from the same Blueprint, on the smallest plans for staging (about $20 a
  month). `main` deploys to staging automatically. Production deploys by hand from a commit that passed staging.
- **Secrets:** environment groups in the Render dashboard (`sync: false` in the Blueprint). Never in `render.yaml`.

## Consequences
- About $45 a month for production at launch, plus about $20 for staging. Meetings (Recall per bot-hour, models, TTS)
  will cost far more than hosting, which is why ADR 0008 adds spend limits.
- There's a stable URL for Recall, which clears deployment blocker 3 in [workstreams.md](../workstreams.md).
- **Deploying the engine still ends live meetings.** The engine has no disk after ADR 0011, so Render starts the new
  instance before stopping the old one. The old instance's in-memory sessions end, and Recall webhooks for them reach
  the new instance, which doesn't know them. Deploy the engine outside meetings. Rebuilding a session from its stored
  events on the new instance is the fix, for the engine's scaling ADR.
- The api can move to serverless later without code changes, because it's a plain Node server.
- Follow-up (infra owner): `render.yaml`, both environments, and a runbook for deploying and rolling back.
