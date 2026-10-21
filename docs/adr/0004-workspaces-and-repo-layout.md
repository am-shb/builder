# 0004: npm workspaces, repo layout and lint

- **Status:** proposed
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** infra (repo tooling)

## Context
Settles the rest of blocking decision 1 in [workstreams.md](../workstreams.md). [ADR 0001](0001-ci-and-type-checking.md)
covers CI and type checking and left workspaces and lint open. Several people are about to start new areas at once,
and none of them can until a new area has its own place, dependencies and tests. The scaffold splits the product
into five services (`services/api`, `auth`, `billing`, `worker`, `notifications`) and several shared packages. Most
of those would be used by one app only. A package used by one app is a second place to change and a second owner
to coordinate with, and it shares nothing.

## Options considered
1. **npm workspaces.** We already use npm and `package-lock.json`. No new tool.
2. **pnpm workspaces, or Turborepo or Nx on top.** Faster installs and task caching. Another tool to learn and to set
   up on Render and in CI, for a repo that type checks in under a second.
3. **No workspaces, one package.** Simplest. But every app shares one dependency list, and the web app's framework
   would leak into the engine.

## Decision
Option 1, with three apps and one shared workspace:

```
apps/
  engine/      today's src/, public/, test/ and scripts/. Recall, both loops, the stage, the hand-off
  api/         src/{routes,auth,db,billing,notifications,jobs}/. Accounts, sessions, webhooks, jobs
  web/         the customer app, including staff-only admin pages
contracts/     zod schemas for everything that crosses an app boundary: engine↔api and api↔web
docs/  e2e/
```

- **Code becomes a shared workspace only when two or more apps import it.** Today that's only `contracts/`. Code used
  by one app is a folder inside that app, owned through `CODEOWNERS` by folder.
- **`contracts/` holds schemas and the types inferred from them, nothing else.** No logic, no clients. A change there
  is a change to how two apps talk, so `CODEOWNERS` requires review from the owners of both sides. Contract changes
  are additive: new fields are optional, and both sides ignore event types they don't know. A breaking change ships
  in three steps: the receiving side accepts both shapes, then the sending side switches, then the old shape goes.
- Workspaces are named `@builder/engine`, `@builder/api`, `@builder/web` and `@builder/contracts`.
- `contracts/` ships TypeScript source with `exports` pointing at its `.ts` entry and no build step. Node strips
  types from it because npm links it into `node_modules`, but Node resolves the link to the real path. We checked this
  on 2026-10-17. The ADR 0001 rules apply in every workspace: erasable syntax only, `.ts` extensions in imports.
- Each workspace has its own `package.json`, `tsconfig.json` (extending a root `tsconfig.base.json`) and tests. The
  root `npm run check` runs `check` in every workspace, and CI runs the root `check`. The root keeps `start`, `local`
  and `replay` as aliases for the engine.
- `apps/web` may use a framework with a build step. Its owner records that in an ADR.
- Lint and format: Biome, one dependency for both. Adopt it in a single PR that only reformats, right after the move.
- The engine moves to `apps/engine` in one PR that only moves files and fixes paths, before other branches start.
  `services/`, `apps/admin/`, `packages/`, `db/` and `infra/` go away. Their briefs fold into the app READMEs.

**Amendment 2026-10-21.** The mobile app (ADR 0016) is the second app to need the web's session logic (the api
client, reply schemas, error text, start rules, status labels), so that logic moved to `packages/session-core`
(`@builder/session-core`), under a `packages/*` workspace glob for shared code that isn't a contract. Same rules as
`contracts/`: TypeScript source, no build step, no framework dependency, owned by both consumers.

## Consequences
- Each app owner works mostly in their own folder, with their own dependencies, tests and deploy.
- A disagreement between two apps fails the type check in the PR that causes it, not in production.
- One PR can change a contract and both sides of it. The deploys still happen one at a time, which is why contract
  changes must be additive.
- A dependency that ships only CommonJS or needs a build step can't be used from `contracts/` or the engine. Keep
  such dependencies inside `apps/web`.
- Follow-up: `CODEOWNERS`, `docs/workstreams.md`, `AGENTS.md` and `.env` locations change in the move PR.
