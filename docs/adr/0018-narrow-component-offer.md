# 0018: Offer the build model 15 components and no templates

- **Status:** accepted
- **Date:** 2026-10-23
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/ui`, `src/agent`, `public/renderer`)

## Context
Builder's core offering is the live resolution of opinions: the room disagrees, sees both versions side by side and
settles it by saying so. The build loop has to put the right thing in the right place for that to read. In the last
real sessions (production, Oct 21) it often did not, and most of the mistakes came from the size of what the model
chooses from: 50 component types, 7 templates with named regions, style options, icons and images.

- A request for the top 10 sellers became a 4-row `Table` in the dashboard template's `stats` region.
- In session `4421baa5` a decision named `home.item-3` and `home.item-4`, which were never drawn, while Amir asked
  "where did it go".
- The room debated clients on top versus below the sales chart; the build loop drew "A: side panel" versus "B: on top".
- One stray `Heading` in one conflict variant failed the tool schema, which dropped the whole call and lost the
  whole comparison.

The full reasoning is in the [demo-readiness design](../superpowers/specs/2026-10-23-demo-readiness-design.md)
(section 3). Narrowing what the model is offered changes the tool schema and the prompt, which are engine
interfaces, so it needs a decision before code.

## Options considered
1. **Keep the full catalog and tell the model to be careful in the prompt.** No code change, but the surface that
   causes the mistakes stays. Rejected.
2. **Remove the dropped types and templates from the catalog.** Simple, but old sessions and stored trees would stop
   validating and rendering. Rejected.
3. **Offer a narrower list; keep the full catalog for rendering and stored trees.** The model sees less, old data
   still draws. Chosen.

## Decision
Option 3.

- **Fifteen offered types**, in `OFFERED_TYPES` in `public/renderer/catalog.js`: App, Screen, PageHeader, Card, Grid,
  StatCard, Table, ChartCard, List, ListItem, Text, ProductCard, Image, Badge, Button.
- **No templates or regions for new work.** A Screen's children stack top to bottom in the order they are added, and a
  `Grid` (2 or 3 columns) is the only way to put things side by side. `OFFERED_PROPS_OMIT` hides a Screen's
  `template`; `region` is hidden on every type. The prompt table, the layout rules in `build.md` and the tool schema
  sent to the model (`patchBatchJsonSchema()` and the `update_consensus` schema, whose variants embed it) list only
  what is offered.
- **An unoffered type drops only that op.** The local zod schema still accepts every catalog type, so a stray
  `Heading` reaches `fromToolBatch`, which skips that `add` and the adds under it, removes `region` and a Screen's
  `template` from props, and counts the skips in `build.run` as `ops_unoffered`. This holds for `apply_patches`
  batches and for conflict variants, so a variant with one stray op keeps its others. A variant left with no ops
  drops the comparison, as an invalid one does today.
- **The renderer and the stored-tree schema are unchanged.** Every type and template still renders, so old sessions
  look as they did. Updates to existing nodes of an old type still apply.

## Consequences
- The model cannot draw a tab bar, a modal, a form field or a templated page. Anything the room asks for beyond the
  15 gets the nearest offered component or is left out until the list is widened.
- Prompts and the tool schema are smaller, which also helps latency and cost.
- A model that still writes an old type (it may, from the prototype it reads) loses that op, visible as
  `ops_unoffered` in the logs, and the rest of its batch applies.
- **To widen the offer:** add the type to `OFFERED_TYPES` (keeping catalog order), add layout guidance for it to
  `src/agent/prompts/build.md` if it needs any, and extend the offered-catalog tests. No schema or renderer change is
  needed. To offer templates again, remove `template` from `OFFERED_PROPS_OMIT`, stop dropping `region` in
  `fromToolBatch` and restore the template table in the prompt.
