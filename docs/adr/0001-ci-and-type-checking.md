# 0001: CI and type checking for the engine

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** to be confirmed in review (infra owner, meeting-engine owner)
- **Area:** infra (repo tooling)

## Context
Settles part of blocking decision 1 in [workstreams.md](../workstreams.md): repo tooling. Node strips the types
from `.ts` files and runs them, so a type error never fails at startup and only shows up as a runtime bug.
Nothing ran the tests on PRs either. The documented `npm test` (`node --test test/`) didn't run at all on Node 24,
because a directory isn't a valid `--test` pattern there. More people are about to work in parallel, and each PR
needs the same gate.

## Options considered
1. **Leave it to each contributor.** Costs nothing. But we've already seen it fail: `npm test` itself was broken.
2. **`tsc --noEmit` plus GitHub Actions.** Type checking stays separate from running, so the no-build-step model
   stays as it is. TypeScript 7 (the native compiler) checks the whole repo in under a second. It adds three dev
   dependencies.
3. **Move to a bundler or `tsx`.** Gives the same checks, but adds a build step, which the engine deliberately avoids.

## Decision
Option 2:
- `tsconfig.json` uses `noEmit`, `strict`, `erasableSyntaxOnly` (Node can't strip enums, namespaces or parameter
  properties) and `allowImportingTsExtensions`. `allowJs` is on and `checkJs` off, so the renderer's JS is inferred
  but not checked.
- Dev dependencies: `typescript@^7`, `@types/node@^24` and `@types/ws`.
- Scripts:
  - `npm run typecheck`
  - `npm test`, which now uses the glob `test/**/*.test.ts`
  - `npm run check`, which runs typecheck, test and smoke
- `.nvmrc` pins Node 24, which matches `engines`.
- `.github/workflows/ci.yml` runs on every PR and on `main`:
  - **check:** typecheck, tests and smoke. Browser tests skip here.
  - **browser:** the full suite with the runner's Chrome.
- Dependabot opens weekly update PRs and waits 7 days after each release.

Still open, and outside this ADR: workspaces (wait until a second package exists), and lint and format. Adopt lint
and format in one PR that only reformats, at a time when few branches are open, because it touches every file.

## Consequences
- Type errors now fail a PR. The existing code passes as it is.
- A maintainer needs to make **check** a required status check on `main` in branch protection. Make **browser**
  required too once it has stayed green for a while. Its timing assertions in `test/speech-browser.test.ts` may be
  flaky on shared runners.
- CI uses only fakes and needs no secrets. Live checks stay manual (see [../runbooks/](../runbooks/)).
