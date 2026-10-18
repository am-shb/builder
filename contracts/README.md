# contracts: schemas that cross app boundaries

**Status:** the engine and api boundary from [ADR 0008](../docs/adr/0008-api-engine-boundary.md) is here. The api and
web shapes come with the api. **Owners:** the engine owner and the api owner together.

## Purpose
One source of truth for the data shapes that cross an app boundary: engine and api, and api and web. Both sides parse
with these schemas, and each side's tests use them to build fakes.

## Rules ([ADR 0004](../docs/adr/0004-workspaces-and-repo-layout.md))
- Schemas and the types inferred from them, nothing else. No logic and no clients.
- A change here changes how two apps talk, so `CODEOWNERS` requires review from the owners of both sides.
- Changes are additive. New fields are optional. Receivers ignore unknown keys and skip event types they don't know.
  Use `parseEngineEvent()` for events.
- A breaking change ships in three steps: the receiving side accepts both shapes, then the sending side switches, then
  the old shape goes.
- Only ids, statuses, counts, costs and error codes cross. Never transcript text, prompts or model output.
- Source only, no build step. `exports` points at `src/index.ts`. Erasable syntax only, and `.ts` extensions in imports.

## Candidates to move here later
Only when a second app imports them. The prototype component schema (`src/ui/schema.ts`) and the hand-off spec format
are the likely ones, once the web app renders hand-offs.

## Commands
`npm run check -w @builder/contracts` runs the type check and the tests.
