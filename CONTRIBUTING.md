# Contributing

## Setup
```
nvm use            # Node 24, from .nvmrc
npm ci
npm run check      # engine typecheck, tests and smoke, then every workspace; no keys or network needed
```
To run the real server you need `.env` (see `.env.example` and the root README). Ask before running anything that
costs money (see [AGENTS.md](AGENTS.md)).

## Workflow
1. **Pick work.** Claim an area in [docs/workstreams.md](docs/workstreams.md), or an item in
   [docs/known-issues.md](docs/known-issues.md).
2. **Decide first.** If the work makes a choice that others will build on, such as a framework, a provider or a schema,
   write an ADR in `docs/adr/` from the template and get it merged before the code.
3. **Branch.** Name it `<area>/<short-description>`, for example `billing/usage-metering`. Never push directly to
   `main`.
4. **Build.** Stay inside your area's folder, add tests, and follow [AGENTS.md](AGENTS.md).
5. **Commit.** Use Conventional Commits with the area as the scope, as the history does: `feat(agent): ...`,
   `fix(stage): ...`, `docs: ...`.
6. **Open a PR.** Fill in the template. CI runs `npm run check` and the browser tests, and **check** must be green.
   The area owner reviews. Changes to `contracts/` also need both the engine owner and the api owner.
7. **Keep docs current.** Update your area's README (status, decisions, first tasks) in the same PR.

## For maintainers
Protect `main` in the GitHub settings:
- require a PR with one approving review, from CODEOWNERS once owners are filled in;
- require the **Typecheck, tests, smoke** status check;
- block force pushes.

Turn on private vulnerability reporting (Settings > Code security), which [SECURITY.md](SECURITY.md) points to. Fill in [.github/CODEOWNERS](.github/CODEOWNERS) as people claim areas.
