# Working in this repo (for people and their coding agents)

Builder is a meeting agent. It joins a Google Meet through Recall.ai, listens, and builds a clickable prototype
on a screenshared stage while the group decides what they want. The v0 engine works. We're now turning it into a
production product with accounts, billing and the rest.

## Before you start
1. Read [docs/workstreams.md](docs/workstreams.md), then the README in the folder for your area. The repo is npm
   workspaces ([ADR 0004](docs/adr/0004-workspaces-and-repo-layout.md)): three apps and `contracts/`. Until the move
   PR lands, the engine's code is still at the root (`src/`, `public/`, `test/`, `scripts/`).
2. Work inside your app's folder: `apps/engine`, `apps/api` or `apps/web`. To change another app, `contracts/`, or the
   engine's interfaces, write an ADR (`docs/adr/`) or get that owner's review. `contracts/` needs both the engine and
   api owners.
3. Settle an area's open decisions with an ADR before writing its code.
4. Behavior of the engine is set by `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`. Open
   bugs are in `docs/known-issues.md`; claim one by putting your name next to it.

## Layout
- `apps/engine`, `apps/api`, `apps/web`: one app each, with its own `package.json`, `tsconfig.json` and tests.
- `contracts/` (`@builder/contracts`): zod schemas for what crosses an app boundary. Schemas only, changes are additive.
- Code is shared only when two apps import it. Code used by one app is a folder inside that app.

## Current stack (engine)
- Node 24 or newer, running TypeScript natively through type stripping, with no build step
- `node:sqlite`, `node:test`, zod v4, `@anthropic-ai/sdk` pointed at OpenRouter, `ws`
- TypeScript 7 for type checking only (`tsc`, no emit). Use erasable syntax only: no enums, namespaces or
  parameter properties ([ADR 0001](docs/adr/0001-ci-and-type-checking.md))
- New areas can choose differently, but record the choice in an ADR

## Commands
- Use Node 24 (`.nvmrc`). `npm run check` runs the engine's type check, tests and smoke boot against fakes, then `check` in every workspace. It must
  pass before you open a PR, and CI runs it on every PR. You can also run the parts on their own: `npm run typecheck`,
  `npm test`, `npm run smoke`.
- `npm start` runs the server. It needs `.env`; see `.env.example`.
- Ask the human before running anything that costs money: `scripts/probe-*.ts`, `npm run replay -- --live-models`,
  or sending a real bot to a meeting.

## Hard rules
- Never commit `.env`, and never print, paste or log API keys or secrets.
- Never log transcript text, prompts or model output. Log ids, counts and error codes only.
- Check model IDs against the provider's live model list before you add or dispute one.
- Make each PR small and about a single area, with tests. Use the PR template.
- Agreement on a decision must come from real things people said in the meeting (spec §4 and §12). Never let the
  model mark something as agreed by itself.
