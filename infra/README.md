# infra: environments, deployment, CI and observability

**Status:** CI running, nothing deployed. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Current state
- v0 runs on a laptop behind a Cloudflare quick tunnel, and the tunnel's URL changes every time it restarts. Recall
  needs a stable public HTTPS URL for its webhooks and for the stage page.
- CI is in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), proposed in
  [ADR 0001](../docs/adr/0001-ci-and-type-checking.md). It runs typecheck, tests and smoke on every PR, plus the full
  suite with headless Chrome. Dependabot is in `.github/dependabot.yml`.
- The process logs one JSON object per line to stdout. `GET /healthz` returns `{"ok":true}` and needs no auth.

## In scope
- Dev, staging and production environments, each with a persistent public URL
- Hosting for the API, meeting engine, worker and web apps
- Secrets management: Recall keys, the webhook secret, the OpenRouter key, and the payment and auth provider keys
- CI on every PR (`npm test`, `npm run smoke`, lint, type checks), and deployment with preview environments
- Observability:
  - Structured logs that carry only ids and codes, never transcript text, prompts or model output
  - Metrics, such as latency per loop and cost per session
  - Tracing, alerts and uptime checks
- Backups and disaster recovery

## Open decisions
- Cloud and hosting platform
- Whether the meeting engine needs long-lived processes, since it holds WebSockets and in-memory state

## First tasks
- [ ] A staging environment with a persistent URL, so live meeting tests no longer depend on a tunnel
- [x] A CI workflow that runs the tests on every PR
- [ ] Branch protection on `main`: require the **check** job and one review
- [ ] Lint and format (see ADR 0001: one reformat-only PR)
