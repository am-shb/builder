# 0014: Prototype design system

- **Status:** proposed
- **Date:** 2026-10-19
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/ui`, `src/agent`, `public/renderer`)

## Context
The 21-type component set renders as plain grey boxes, and the model has no way to say "make it gold" or "rounder
corners" except by writing styles per node. The prototype should look designed, and the room should be able to agree
on look-and-feel the same way it agrees on content. The full reasoning is in the
[spec](../superpowers/specs/2026-10-19-prototype-design-system-design.md) (section 1); the work is split in
[part 1 of the plan](../superpowers/plans/2026-10-19-design-system-1-library-and-theme.md).

This changes the prototype schema, which is an engine interface, so it needs a decision before code.

## Options considered
1. **The model writes HTML and CSS.** Maximum freedom, but output is long, unsafe to render, hard to validate and
   impossible to mark agreed per element. Rejected.
2. **Per-node raw style values** (colors, px sizes). Flexible, but costs tokens on every node, produces clashing
   looks, and cannot be validated against a design. Rejected.
3. **Theme as props on the `App` node.** Simple, but ties theme agreement to the app title's status and cannot agree
   "gold" and "round corners" separately. Rejected.
4. **A fixed component library plus a small theme on the prototype.** The model picks components and a few named
   options; the renderer owns every pixel. Chosen.

## Decision
Option 4.

- **One shared catalog.** `public/renderer/catalog.js` is import-free and defines every component's props and allowed
  style options (`tone`, `size`, `pad`, `emphasis`, `span`). The server validates with it, the build prompt's
  component table is generated from it, and the renderer builds from it.
- **Props are normalized, not rejected.** Unknown keys, wrong types, out-of-range enum values and unknown icon names
  are dropped. A bad prop never rejects a batch.
- **Theme lives on `Prototype.theme`** with four slots: accent, warmth, radius, density. Each slot holds a value, a
  status, a `decisionId` and the last agreed value.
- **Theme changes are patch ops.** `set_theme` and `drop_theme` are model-facing; `theme_status` is internal.
  Variants, streaming, validation and the handoff then carry theme with no new channel.
- **A draft theme is shown at once** and reverted on objection to the last agreed value for that slot, or the house
  default if none. Slots with a different `decisionId` are untouched. `drop_theme` on an agreed slot is ignored.
- **Model-facing nodes lose `status`**; batches gain `decisionId`, which nodes and theme ops inherit. Agreement is
  still set only from what people said (spec sections 4 and 12).
- **Conflict variants default to `d-<conflictId>`** as their decision id.
- **Old data is dropped.** The old types and stored prototypes are not migrated. A stored prototype that fails to
  parse is ignored through the existing `store.consensus_invalid` path.

## Consequences
- The model writes less per node and cannot produce an off-design look. New components are added in one place.
- Existing tests, fixtures and the handoff export change with the schema (plan Task 6 and the export task).
- The handoff exports only the agreed theme.
- Parts 2 and 3 (page templates and device frame, built-in images and icons) build on this catalog and theme.
- Until part 3, `icon` props render nothing and `Image` renders a tinted block with its subject word.

## Measurements
Filled in by Task 9.
