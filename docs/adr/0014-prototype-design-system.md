# 0014: Prototype design system

- **Status:** proposed
- **Date:** 2026-10-19
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/ui`, `src/agent`, `public/renderer`)

## Context
The 21-type component set renders as plain grey boxes in one fixed look, and nothing the model sends can change that
look: there is no theme input, so "make it gold" or "rounder corners" has nowhere to go. The prototype should look
designed, and the room should be able to agree on look-and-feel the same way it agrees on content. The full reasoning
is in the [spec](../superpowers/specs/2026-10-19-prototype-design-system-design.md) (section 1); the work is split in
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
- **Derived app frame (amendment).** The renderer draws the frame (sidebar, top bar or phone body) from the Screens
  in `proto.root.children`: the app's name plus one nav item per Screen. The model never builds navigation; the App
  takes only `nav` (sidebar, top, none) and `device` (desktop, phone), and a Screen takes `icon`.
- **Templates are frames with regions (amendment).** A Screen's `template` (dashboard, list-detail, form, feed,
  landing, chat, checkout) names a fixed set of regions. A child picks one with the `region` prop, accepted on every
  type except App and Screen. An unknown or missing region falls back to the template's main region, and a region
  with nothing in it is hidden, so no empty boxes are drawn. The catalog holds the templates as import-free data
  (`TEMPLATES`, `templateRegion`).
- **Per-child slot hook (amendment).** The renderer asks the parent's builder which slot each child belongs in, so a
  templated Screen can place children into regions while others keep a single column. Changing a template re-places
  every child and loses none.
- **`device: phone` (amendment).** The app is drawn inside a 380x700 phone body with a title bar and a bottom tab bar
  of the first five Screens; every template collapses to one column.
- **Derived colors.** The renderer derives the soft tint, accent ink, chart series and status colors from the four
  slots. Status colors stay apart from the brand: a green brand moves "approved" to teal, so it never reads as the
  accent. Text and controls meet AA contrast at 720p. The slot values and derivation rules are in the plan's
  "Theme" section.
- **Theme agreement uses the unchanged rules.** It comes only from what people said in the meeting and is never set
  by the model.
- **A draft theme is shown at once** and reverted on objection to the last agreed value for that slot, or the house
  default if none. Slots with a different `decisionId` are untouched. `drop_theme` on an agreed slot is ignored.
  The revert happens only when the decision ends the build run in draft: support in the same hand-off (pending)
  keeps the theme up.
- **A reverted slot remembers what it took off** (`reverted: { value, decisionId }`, validated like the value). If
  that decision is agreed later, `theme_status agreed` puts the value back (the value it replaces becomes
  `previous`). Any later `set_theme` on the slot forgets it. The model never re-sends a reverted look.
- **Re-theme feedback.** A draft shows a proposal label ("Proposed: gold accent · Sara"). Agreement plays a short
  settle animation. A revert animates back to the last agreed value.
- **Contested choices.** When the room is split, two variants are built, each one tiny op. The main prototype does not
  change until one is picked, and the winner applies with the re-theme animation.
- **Model-facing nodes lose `status`**; batches gain `decisionId`, set once per batch, with a per-node override.
  Nodes and theme ops inherit it. Agreement is
  still set only from what people said (spec sections 4 and 12).
- **Conflict variants always use `d-<conflictId>`** as their decision id, on the batch and its `set_theme` ops; a
  variant's own `decisionId` is ignored, because resolving the conflict agrees only `d-<conflictId>`.
- **Old data is dropped.** The old types and stored prototypes are not migrated. A stored prototype that fails to
  parse is ignored through the existing `store.consensus_invalid` path.

## Consequences
- The model writes less per node and the prototype stays on palette. New components are added in one place.
- Existing tests, fixtures and the handoff export change with the schema (plan Task 6, and Task 5 "Theme in the
  renderer, comparison previews and handoff" for the export).
- The handoff exports only the agreed theme.
- Parts 2 and 3 (page templates and device frame, built-in images and icons) build on this catalog and theme.
- Until part 3, `icon` props render nothing and `Image` renders a tinted block with its subject word.

## Measurements
The mockup's Overview screen without its sidebar nav (a search box, page header, three stat cards, a six-month bar
chart and three recent expenses; only the new fixture also has the avatar) sent as `apply_patches` batches, once in
the old format and once in the new one. Both are in `apps/engine/test/fixtures/` (`expense-batches.old.json`,
`expense-batches.new.json`); the new one is tested to apply cleanly with no dropped props. Run
`node scripts/measure-batches.ts` in `apps/engine` to reproduce. Tokens are estimated as characters / 3.5.

| format | batches | ops | JSON chars | est. tokens |
|---|---|---|---|---|
| old (21 types, per-node status) | 5 | 28 | 5174 | 1478 |
| new (composite components) | 5 | 12 | 2716 | 776 |

The new format is about 0.53 of the old, so roughly half the output for the same screen. The old fixture can only
approximate the screen (a chart placeholder, plain Badge text for status), so the real gap in what appears on
screen is larger.

The input side grew. The build prompt was about 11,952 characters (`build.md` at `fd93ec9`) and is about 20,091
assembled now (`buildSystemPrompt().length`), because it carries the component table and theme options. It is
the same on every call, so it is cached.

Not yet measured: the first-change timing (a paid `--live-models` replay, which needs Amir's go-ahead) and the
Meet text-size and hairline outcome. They are recorded here when run.
