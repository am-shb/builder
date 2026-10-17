# infra: environments, deployment, CI and observability

**Status:** placeholder, no code yet. **Owner:** TBD. Claim it in [docs/workstreams.md](../../docs/workstreams.md).

## Current state
v0 runs on a laptop behind a Cloudflare quick tunnel, and the tunnel's URL changes every time it restarts. Recall needs
a stable public HTTPS URL for its webhooks and for the stage page.

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
- [ ] A CI workflow that runs the tests on every PR
