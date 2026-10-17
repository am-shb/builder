# packages/shared: shared types and schemas

**Status:** placeholder, no code yet. **Owner:** TBD. It needs a single owner, because every area depends on it.

## Purpose
One source of truth for the data shapes that cross service boundaries.

## Candidates to move here
- The prototype component schema: `src/ui/schema.ts`
- The consensus document: `src/consensus/doc.ts` (types and zod schemas only)
- The handoff spec format: the schemas in `src/handoff/export.ts` and `src/agent/handoff.ts`
- API request and response types, once `services/api` publishes its contract

## Rules
Changing a shape here breaks everything that uses it. Do it through an ADR or with the owner's review.

## Open decisions
- Workspace tooling (npm workspaces or another) and versioning
