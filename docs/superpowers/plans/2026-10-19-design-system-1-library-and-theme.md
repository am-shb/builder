# Prototype design system, part 1: component library and live theming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage prototype's 21 primitives and fixed look with a ~50-component product-grade library, a per-prototype theme that changes live under the decision rules, and a trimmed model-facing patch format.

**Architecture:** One import-free catalog (`public/renderer/catalog.js`) defines every component's props and allowed style options; the server validates and normalizes props with it, the build prompt's component table is generated from it, and the renderer builds from it. The theme lives on `Prototype.theme` as four slots (accent, warmth, radius, density), each with value, status, decisionId and the last agreed value; a pure `themeVars()` turns values into CSS custom properties set on each rendered App element, so comparison previews theme independently. Theme ops are patch ops, so variants, streaming, validation and the handoff carry them with no new channel.

**Tech Stack:** Node 24 type-stripped TypeScript, zod v4, `node:test`, plain browser ES modules under `public/renderer/`, headless Chrome tests via `test/helpers/chrome.ts`.

**Spec:** `docs/superpowers/specs/2026-10-19-prototype-design-system-design.md` (mockup: `2026-10-19-prototype-design-system-mockup.html` next to it).

**This is part 1 of 3.** Part 2: page templates, the derived app frame and `device: phone`. Part 3: built-in images and the icon set. Until part 3, `icon` props render nothing and `Image` renders a tinted block with its subject word (no icon, no error). Op trimming (spec 4.7 item 4) is in this part because the schema is rewritten here anyway.

## Global Constraints

- Erasable TypeScript only: no enums, namespaces or parameter properties (ADR 0001). No build step.
- `public/renderer/*.js` files imported by server code (`catalog.js`, `theme.js`, `interact.js`) stay import-free.
- Never log transcript text, prompts or model output; log ids, counts and error codes only.
- The model never writes HTML or CSS, never sets a raw color or px value, and never marks anything agreed.
- Canvas is 900×720 (`#canvas` in `public/stage.html`). Body text 18px; no visible text below 14px (spec 6, until the Meet test settles it).
- Motion: transform and opacity only, 250–600 ms, ease-out, designed for 15 fps (spec §10a).
- Strict tool schemas: closed objects, no recursion; props stay `{key, value}` pairs.
- Unknown icon names, unknown prop keys, wrong-typed values and out-of-range enum values are dropped, never a batch rejection.
- Old prototypes and the old 21-type set are dropped; no migration. A stored prototype that fails to parse is ignored (existing `store.consensus_invalid` path).
- Ask Amir before anything that costs money (`--live-models` replays, probes).
- `npm run check` passes at the end of every task.

## Review Focus

1. **A theme proposal objected to after the room already agreed a different theme** — must revert to the agreed theme, not to the house default. Pinned in Task 3 (`theme revert after an agreed theme returns to that agreed value`).
2. **Two decisions touching different theme slots at once** ("gold" draft while "round corners" is agreed) — agreeing or reverting one must not touch the other. Pinned in Task 3 (`theme_status only touches slots carrying that decisionId`).
3. **The model drops an agreed theme via `drop_theme` without an objection** — must be ignored, like a `remove` of an agreed node. Pinned in Task 6 (`drop_theme on an agreed slot is dropped unless reopened`).
4. **Long or odd content in compact props** (a table row with more cells than columns, an empty `data` list, a 40-character stat value) — must render without throwing or overflowing the 900px canvas. Pinned in Task 4 (gallery fixture includes these) and Task 5 (`no horizontal overflow`).
5. **Theme change while a comparison covers the canvas** — the stage draws without motion under the comparison today; the theme fade must not play under it either, and must not throw. Pinned in Task 7 (`no theme fade while covered`).

---

## File map

| File | Responsibility |
|---|---|
| `docs/adr/0014-prototype-design-system.md` | Create. The decisions below, plus measured token numbers (Task 9). |
| `public/renderer/catalog.js` | Create. `CATALOG`, `STYLE_OPTIONS`, `normalizeProps`, `parseCells`, `pillTone`. Import-free. |
| `public/renderer/theme.js` | Create. Palette tables, `DEFAULT_THEME`, `themeValues`, `themeVars`, `contrast`, `themeChange`. Import-free. |
| `public/renderer/components/dom.js` | Create. Helpers moved out of `components.js` (`h`, `setText`, `setHidden`, `setAttr`, `withParts`, `syncTexts`, `str`, `arr`) plus `pill`, `avatar`, `cells`. |
| `public/renderer/components/{frames,data,content,input,feedback}.js` | Create. Builders per catalog group (`conversation` builders live in `feedback.js`). |
| `public/renderer/components.js` | Rewrite. Aggregates the group builders; keeps `buildElement`, `updateElement`, `slotOf`, `COMPONENT_BUILDERS`. |
| `public/renderer/theme.css` | Rewrite. Component styles from CSS custom properties only; motion/focus/comparison sections kept. |
| `public/renderer/render.js` | Modify. Apply `themeVars` to the App element each render. |
| `public/renderer/motion.js` | Modify. Add `snapshotCanvas`, `playThemeFade`, `playThemeSettled`. |
| `public/stage.html` | Modify. Theme fade/settle on `patch`. |
| `src/ui/schema.ts` | Modify. Types from catalog, `PropValue` + `number[]`, theme types, `set_theme`/`theme_status` ops, trimmed tool shapes. |
| `src/ui/tree.ts` | Modify. Theme ops in `applyBatch`, `themeStatusOp`, `withAgreedTheme`, `fromToolBatch` normalizing + decisionId inheritance. |
| `src/agent/handoff.ts` | Modify. `sanitizeModelBatch` handles theme ops; conflict variants default to `d-<conflictId>`. |
| `src/agent/build-loop.ts` | Modify. Theme in `flipNodes`; revert on `object`; prompt assembled with generated table. |
| `src/agent/prompts/build.md` | Modify. Component table replaced by `{{COMPONENTS}}`; theme and customization sections. |
| `src/agent/prompt-catalog.ts` | Create. `componentTable(): string` from `CATALOG`. |
| `src/agent/ui-command.ts` | Modify. New clickable types and text props. |
| `src/handoff/export.ts` | Modify. New renderer modules inlined; agreed theme only. |
| `test/fixtures/gallery-proto.json` | Create. Every catalog type at least once, with the Review Focus edge content. |
| `test/fixtures/expense-batches.new.json`, `expense-batches.old.json` | Create. The mockup screen as model tool input, new and old formats. |
| `scripts/measure-batches.ts` | Create. Prints chars and estimated tokens for both fixtures. |
| `test/catalog-unit.test.ts`, `test/theme-unit.test.ts`, `test/design-browser.test.ts` | Create. |
| Existing tests and fixtures naming `Stack`, `NavBar`, `ImagePlaceholder`, `ChartPlaceholder` | Modify in Task 6. |

## The catalog (decided here; Task 2 encodes it)

Prop kinds: `s` string, `n` number, `b` boolean, `ss` string list, `ns` number list, or a list of allowed strings (enum). "C" = has children. Style options any component may list: `tone` (default|accent|success|warning|danger|muted), `size` (sm|md|lg), `pad` (tight|normal|roomy), `emphasis` (plain|outlined|filled), `span` (1|2|3|4, only meaningful inside `Grid`).

| Group | Type | Props | Styles | C |
|---|---|---|---|---|
| frames | App | title s | — | C |
| frames | Screen | title s | — | C |
| frames | PageHeader | title s, subtitle s | — | C (actions) |
| frames | Section | title s, subtitle s | pad | C |
| frames | Card | title s, subtitle s | tone, pad, emphasis, span | C |
| frames | Grid | columns [2,3,4 as strings "2","3","4"] | pad | C |
| frames | Row | align [start,center,end,between] | — | C |
| frames | Split | ratio [1:1,2:1,1:2] | — | C |
| frames | Tabs | tabs ss, active n | — | C |
| frames | Drawer | title s, open b | — | C |
| frames | Modal | title s, open b | — | C |
| data | StatCard | label s, value s, delta s, trend [up,down,flat], icon s | tone, size, span | |
| data | Table | columns ss, rows ss | span | |
| data | ActivityList | title s, items ss | span | |
| data | ChartCard | title s, kind [bar,line,donut], data ns, labels ss | span | |
| data | Progress | label s, value n | tone | |
| data | Timeline | items ss | | |
| data | CalendarStrip | days ss, active n | | |
| data | Kanban | columns ss, cards ss | | |
| data | List | — | | C |
| data | ListItem | text s, subtitle s, meta s, icon s, avatar s | tone | C |
| content | Heading | text s, level n | | |
| content | Text | text s | tone, size | |
| content | Hero | title s, subtitle s, image s | tone | C |
| content | FeatureGrid | items ss | | |
| content | PricingTier | name s, price s, period s, features ss, highlighted b | span | C |
| content | ProductCard | title s, price s, image s, rating n, badge s | span | |
| content | MediaCard | title s, text s, image s, meta s | span | |
| content | Image | image s, label s, aspect [wide,square,tall] | span | |
| content | Avatar | name s, subtitle s | size | |
| content | AvatarGroup | names ss | size | |
| content | Badge | text s | tone | |
| content | Quote | text s, author s, role s | | |
| input | Button | label s, variant [primary,secondary,ghost,danger], icon s | size | |
| input | Input | label s, placeholder s, value s, icon s | | |
| input | Search | placeholder s | | |
| input | Select | label s, options ss, value s | | |
| input | Segmented | options ss, value s | | |
| input | Toggle | label s, on b | | |
| input | Checkbox | label s, checked b | | |
| input | Slider | label s, value n | | |
| input | DatePicker | label s, value s | | |
| input | Steps | steps ss, current n | | |
| input | FileUpload | label s, hint s | | |
| feedback | EmptyState | title s, text s, icon s | | C |
| feedback | Banner | title s, text s | tone | |
| feedback | Toast | text s | tone | |
| feedback | Skeleton | lines n | | |
| conversation | ChatThread | messages ss | | |
| conversation | Comment | author s, text s, time s | | |

**Compact cell markup** (Table rows, ActivityList items, Timeline items, Kanban cards, FeatureGrid items, ChatThread messages): cells split on `|` and trimmed. A cell starting `@` is a person (initials avatar + name). A cell starting `#` is a pill; its tone comes from `pillTone(word)`: approved, paid, done, active, complete, success, live → success; pending, waiting, draft, review, scheduled → warning; failed, overdue, rejected, cancelled, blocked, error → danger; anything else → default. Per component: ActivityList `"@Name | subtitle | trailing… "`; Timeline `"time | title | note"`; Kanban `"column | title | @person"`; FeatureGrid `"icon | title | text"`; ChatThread `"Name | message"` where name `me` aligns right.

## Theme (decided here; Tasks 3 and 5 encode it)

Slots and values (first is the house default): accent slate|blue|indigo|violet|pink|red|orange|gold|green|teal; warmth neutral|warm|cool; radius soft|sharp|round; density regular|compact|roomy.

Accent bases: slate `#1e293b`, blue `#2563eb`, indigo `#4f46e5`, violet `#7c3aed`, pink `#db2777`, red `#dc2626`, orange `#ea580c`, gold `#c8961e`, green `#15803d`, teal `#0f766e`. Warmth (bg / surface / line / ink / ink-2 / ink-3): neutral `#f6f7f9/#ffffff/#e2e8f0/#0f172a/#475569/#64748b`; warm `#faf8f3/#ffffff/#ece6d8/#1c1917/#57534e/#78716c`; cool `#f3f6fb/#ffffff/#dbe3ef/#0f172a/#475569/#64748b`. Radius: sharp 4px, soft 12px, round 20px. Density gap/pad: compact 10/12px, regular 14/18px, roomy 20/24px.

Derived: `--b-accent-ink` is `#ffffff` or `#111827`, whichever contrasts more with the accent; `--b-accent-soft` is the accent mixed 14% over the bg. Status pairs default to success `#166534` on `#dcfce7`, warning `#92400e` on `#fef3c7`, danger `#991b1b` on `#fee2e2`; when the accent's hue is within 35° of a status hue, that status switches to its alternate: success → teal `#115e59` on `#ccfbf1`, danger → rose `#9f1239` on `#ffe4e6`, warning → amber-brown `#78350f` on `#fde68a`. Chart series: accent, then `--b-ink-3`, then the success fg.

---

### Task 1: ADR 0014

**Files:**
- Create: `docs/adr/0014-prototype-design-system.md` (follow `docs/adr/0000-template.md`)

- [ ] **Step 1: Write the ADR.** Status `proposed`. Context: spec section 1. Decision: shared import-free catalog; props normalized (dropped, never rejected); theme on `Prototype.theme` with four slots and last-agreed value; theme ops as patch ops (`set_theme`, `drop_theme` model-facing; `theme_status` internal); draft theme shown at once and reverted on objection; model-facing nodes lose `status`, batches gain `decisionId`; conflict variants default to `d-<conflictId>`; old data dropped. Leave a "Measurements" heading with "filled in by Task 9".
- [ ] **Step 2: Stop for Amir's review.** AGENTS.md: the schema is an engine interface; do not start Task 2 until he accepts it. Then set status `accepted`.
- [ ] **Step 3: Commit** `docs(adr): 0014 prototype design system`.

### Task 2: Catalog

**Files:**
- Create: `public/renderer/catalog.js`, `test/catalog-unit.test.ts`

**Interfaces:**
- Produces:
  - `CATALOG: Record<string, { group: "frames"|"data"|"content"|"input"|"feedback"|"conversation"; props: Record<string, "s"|"n"|"b"|"ss"|"ns"|string[]>; styles: string[]; children: boolean; note: string }>` — `note` is one short line for the prompt table.
  - `COMPONENT_TYPES: string[]` (keys of `CATALOG`, App first).
  - `STYLE_OPTIONS: Record<"tone"|"size"|"pad"|"emphasis"|"span", string[]>`.
  - `normalizeProps(type: string, props: Record<string, unknown>): { props: Record<string, string|number|boolean|string[]|number[]>; dropped: string[] }`
  - `parseCells(row: string): { kind: "text"|"person"|"pill"; text: string; tone?: string }[]`
  - `pillTone(word: string): "success"|"warning"|"danger"|"default"`

- [ ] **Step 1: Write failing tests** in `test/catalog-unit.test.ts`:
  - `every catalog entry is well formed`: each type has a known group; every prop kind is one of the kinds or a non-empty string list; every style is a `STYLE_OPTIONS` key; `App`, `Screen` have `children: true`; `COMPONENT_TYPES.length >= 45`.
  - `normalizeProps keeps valid props and style options`: `normalizeProps("StatCard", { label: "Spent", value: "$12,480", trend: "up", tone: "accent", span: "2" })` → props equal to the input, `dropped: []`.
  - `normalizeProps drops unknown keys, wrong kinds and enum misses`: `normalizeProps("StatCard", { label: "x", colour: "red", trend: "sideways", tone: "neon", size: 3 })` → `props: { label: "x" }`, `dropped` contains `colour`, `trend`, `tone`, `size` (any order).
  - `normalizeProps coerces numbers and numeric strings`: `normalizeProps("Progress", { value: "40" }).props.value === 40`; `normalizeProps("StatCard", { value: 12 }).props.value === "12"`; `normalizeProps("ChartCard", { data: ["4", 5, "x"] }).props.data` deep-equals `[4, 5]`.
  - `normalizeProps on __proto__ and constructor keys drops them`.
  - `parseCells`: `parseCells("@Sara K. | Figma seats | $420 | #Approved")` deep-equals `[{kind:"person",text:"Sara K."},{kind:"text",text:"Figma seats"},{kind:"text",text:"$420"},{kind:"pill",text:"Approved",tone:"success"}]`; `parseCells("")` → `[]`; `parseCells("a||b")` → two text cells (empty cells dropped).
  - `pillTone`: `Pending`→warning, `OVERDUE`→danger, `Paid`→success, `Blue`→default.
- [ ] **Step 2: Run** `node --test test/catalog-unit.test.ts` — FAIL (module not found).
- [ ] **Step 3: Implement `public/renderer/catalog.js`** from the catalog table and markup rules above. Coercion: kind `s` accepts numbers (stringified); `n` accepts finite numbers and numeric strings; `ss` accepts string lists (numbers stringified); `ns` keeps finite entries after `Number()`, drops the rest; enums compare as strings; `span` and `columns` values are strings.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `feat(engine): component catalog`.

### Task 3: Theme model and schema theme ops

**Files:**
- Create: `public/renderer/theme.js`, `test/theme-unit.test.ts`
- Modify: `src/ui/schema.ts`, `src/ui/tree.ts`, `test/ui-tree.test.ts`

**Interfaces:**
- Produces (`theme.js`):
  - `THEME_SLOTS = ["accent","warmth","radius","density"]`, `THEME_OPTIONS: Record<slot, string[]>` (first = default), `DEFAULT_THEME_VALUES`.
  - `themeValues(theme: Theme | undefined): Record<slot, string>` (absent → defaults).
  - `themeVars(values): Record<string, string>` — keys `--b-accent`, `--b-accent-soft`, `--b-accent-ink`, `--b-bg`, `--b-surface`, `--b-line`, `--b-ink`, `--b-ink-2`, `--b-ink-3`, `--b-ok`, `--b-ok-bg`, `--b-warn`, `--b-warn-bg`, `--b-bad`, `--b-bad-bg`, `--b-radius`, `--b-radius-sm` (radius/2), `--b-gap`, `--b-pad`, `--b-chart-1..3`.
  - `contrast(fg: string, bg: string): number` (WCAG ratio, hex inputs).
  - `themeChange(prev: Prototype | null, next: Prototype): "values" | "settled" | null` — `values` when any slot value differs; `settled` when values are equal and some slot went draft → agreed; else null.
- Produces (`schema.ts`):
  - `ThemeSlot = { value: string; status: "draft"|"agreed"; decisionId?: string; previous: string }`; `Theme = Record<"accent"|"warmth"|"radius"|"density", ThemeSlot>`; `Prototype = { root; currentScreen; theme?: Theme }` (absent = house theme, all agreed).
  - `PatchOp` gains `{ op: "set_theme"; values: Partial<Record<slot, string>>; decisionId?: string }` (values validated against `THEME_OPTIONS`) and `{ op: "theme_status"; decisionId: string; to: "agreed"|"revert" }`.
  - `Change.kind` gains `"theme"` (id is the root id).
- Produces (`tree.ts`): `themeStatusOp(proto: Prototype, decisionId: string, to: "agreed"|"revert"): PatchOp | null` (null when no slot carries it, or for `agreed` when none of those is draft); `withAgreedTheme(proto: Prototype): Prototype` (draft slots shown at `previous`).

- [ ] **Step 1: Write failing tests** in `test/theme-unit.test.ts`:
  - `every accent and warmth gives readable pairs`: for every accent × warmth, `contrast(accent-ink, accent) >= 4.5`, `contrast(ink, bg) >= 7`, `contrast(ink-2, surface) >= 4.5`, each status fg on its bg `>= 4.5`.
  - `gold gets dark text, indigo gets white`: `themeVars({...defaults, accent:"gold"})["--b-accent-ink"] === "#111827"`; indigo → `"#ffffff"`.
  - `a green accent moves success to teal`: green → `--b-ok === "#115e59"`; blue → `"#166534"`. Red → `--b-bad === "#9f1239"`.
  - `radius and density map to px`: round → `--b-radius: "20px"`, `--b-radius-sm: "10px"`; compact → `--b-gap: "10px"`, `--b-pad: "12px"`.
  - `themeChange`: values differ → `"values"`; same values, accent slot draft→agreed → `"settled"`; identical → `null`; `prev` null → `null`.
- [ ] **Step 2: Write failing tests** in `test/ui-tree.test.ts` (new `describe("theme")` block):
  - `set_theme makes a draft and remembers the agreed value`: on `emptyPrototype`, `set_theme {accent:"gold"}, decisionId "d1"` → `theme.accent` deep-equals `{value:"gold",status:"draft",decisionId:"d1",previous:"slate"}`; other slots stay default; `changes` = `[{kind:"theme", id:"app", label}]`.
  - `set_theme rejects an unknown value`: `{accent:"neon"}` → `ok:false`.
  - `theme_status agreed then a second proposal keeps the agreed one as previous`: set gold d1 → `theme_status d1 agreed` → set green d2 → accent `{value:"green",status:"draft",decisionId:"d2",previous:"gold"}`.
  - `theme revert after an agreed theme returns to that agreed value` (Review Focus 1): continue the previous → `theme_status d2 revert` → accent `{value:"gold",status:"agreed",previous:"gold"}` with no `decisionId`.
  - `theme_status only touches slots carrying that decisionId` (Review Focus 2): radius round d3 agreed, accent gold d4 draft → `theme_status d4 revert` → radius still round/agreed/d3, accent slate/agreed.
  - `themeStatusOp returns null when nothing carries the decision`, and null for `agreed` when the slot is already agreed.
  - `withAgreedTheme shows previous for draft slots` and leaves the input unmutated.
- [ ] **Step 3: Run** `node --test test/theme-unit.test.ts test/ui-tree.test.ts` — FAIL.
- [ ] **Step 4: Implement** `theme.js`, then the schema types/ops, then `applyBatch` cases in `tree.ts` (start from `structuredClone(proto.theme ?? defaultTheme())`; `set_theme`: for each given slot, `previous = status === "agreed" ? value : previous`, then value, `status: "draft"`, decisionId set or deleted; `theme_status agreed`: matching draft slots → agreed; `revert`: matching slots → `value = previous`, agreed, decisionId deleted). Both note one `theme` change only if something changed. `emptyPrototype` keeps `theme` absent. `schema.ts` imports `THEME_OPTIONS` from `../../public/renderer/theme.js` (precedent: `runtime.ts` imports `interact.js`).
- [ ] **Step 5: Run** both tests — PASS; `npm run typecheck` — PASS.
- [ ] **Step 6: Commit** `feat(engine): theme slots and theme patch ops`.

### Task 4: Renderer components for the new catalog

Old builders stay registered until Task 6, so every existing test keeps passing.

**Files:**
- Create: `public/renderer/components/dom.js`, `frames.js`, `data.js`, `content.js`, `input.js`, `feedback.js`, `test/fixtures/gallery-proto.json`
- Modify: `public/renderer/components.js`, `public/renderer/theme.css`, `src/handoff/export.ts` (add the new modules to `RENDERER_MODULES`)
- Test: `test/design-browser.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `parseCells` (Task 2); CSS variable names from `themeVars` (Task 3).
- Produces: a builder (`create`/`update`/`slot`, same contract as today) for every `COMPONENT_TYPES` entry; every element still carries `data-node-id`, `data-type`, `b-node`. Style options render as classes: `is-tone-<v>`, `is-size-<v>`, `is-pad-<v>`, `is-emphasis-<v>`, and `span` as `grid-column: span <v>`.

- [ ] **Step 1: Write the gallery fixture.** One `App` with screens `gallery-a` … `gallery-e` (one per group, conversation with feedback), each using every type of its group at least once, with realistic short content from the expense-tracker mockup. Include the Review Focus 4 edge content: a Table row with more cells than columns, a `ChartCard` with `data: []`, a `StatCard` value of 40 characters, a `ListItem` with an unknown `icon`.
- [ ] **Step 2: Write the failing browser test** `test/design-browser.test.ts` (pattern from `renderer-browser.test.ts`; viewport 900×720): for each gallery screen, navigate to it and assert
  - `every catalog type renders`: the set of `data-type` values across all screens equals `COMPONENT_TYPES`;
  - `no horizontal overflow`: the root's `scrollWidth <= 900`;
  - `no text below 14px`: every visible element with direct text has computed `font-size >= 14`;
  - `no page errors`: `page.logs` has no uncaught exception;
  - save `screens/gallery-<screen>-neutral.png` under the test's temp dir and log the path (for human review; not asserted).
- [ ] **Step 3: Run** `node --test test/design-browser.test.ts` — FAIL (unknown component type).
- [ ] **Step 4: Implement** the builders by group, moving shared helpers to `dom.js`, and rewrite the component section of `theme.css` against the CSS variables only (no hex values in component rules; the house values come from Task 5's `themeVars` defaults, so until Task 5 put the neutral defaults on `.b-app` in CSS). Visual reference: the mockup's `.p-*` rules (1px hairlines, `0 1px 2px` shadow, 18px body, 30px page title, 32px stat values). Keep the draft rules (`.b-node.is-draft`) and everything from the "Motion and focus layers" comment down unchanged. `components.js` registers new and old builders; where a name exists in both (`Card`, `Text`, `Button`, …), the new builder wins and must still accept the old props used by existing fixtures (`ListItem.text`, `Button.variant: "secondary"`, `Heading.level`).
- [ ] **Step 5: Run** the browser test and `npm test` — PASS. Look at the screenshots; fix anything that doesn't look like the mockup.
- [ ] **Step 6: Commit** `feat(engine): product-grade component library in the renderer`.

### Task 5: Theme in the renderer, comparison previews and handoff

**Files:**
- Modify: `public/renderer/render.js`, `public/renderer/theme.css`, `src/handoff/export.ts`, `test/design-browser.test.ts`, `test/handoff.test.ts`, `test/comparison.test.ts`

**Interfaces:**
- Consumes: `themeValues`, `themeVars` (Task 3).
- Produces: after each `renderTree`, the App element's inline style holds exactly the `themeVars(themeValues(proto.theme))` properties (set only when changed).

- [ ] **Step 1: Write failing tests:**
  - `design-browser`: `each theme sets its variables on the App element` — render the gallery with `theme.accent` gold, read `getComputedStyle(appEl).getPropertyValue("--b-accent")` → `#c8961e`; a primary `Button`'s computed `color` equals gold's `--b-accent-ink`. Also save `gallery-*-gold.png` and `gallery-*-green-warm.png`.
  - `comparison.test.ts`: `variant previews carry their own theme` — a conflict with variants `set_theme {accent:"gold"}` and `{accent:"green"}`; `buildComparisonView` previews' `proto.theme.accent.value` are gold and green. Then `themed previews render side by side` (browser, following `comparison renders 3 labelled previews within 1280×720`): the two preview App elements' computed `--b-accent` are `#c8961e` and `#15803d`.
  - `handoff.test.ts`: `the export shows the agreed theme and opens offline` — a proto with accent gold draft (previous blue) exports with `--b-accent` set to blue's base on the App element, and the exported HTML contains every module from `RENDERER_MODULES` as a data URL.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement**: `render.js` sets the vars on the App element after `visit`; remove the CSS neutral fallbacks from Task 4 except a `.b-app` default identical to `themeVars(DEFAULT_THEME_VALUES)` for pages that render without a theme; `export.ts` renders `withAgreedTheme(proto)` and adds `catalog.js`, `theme.js` and `components/*.js` to `RENDERER_MODULES`.
- [ ] **Step 4: Run** the tests — PASS.
- [ ] **Step 5: Commit** `feat(engine): per-prototype theme in renderer, previews and handoff`.

### Task 6: Switch the server to the new catalog and trimmed tool format

**Files:**
- Modify: `src/ui/schema.ts`, `src/ui/tree.ts`, `src/agent/handoff.ts`, `src/agent/ui-command.ts`, `public/renderer/components.js` (delete old-only builders: `NavBar`, `Stack`, `ImagePlaceholder`, `ChartPlaceholder`), all tests and fixtures that use those four types, `test/fixtures/sessions/todo-app.json` `fakeModel` scripts.

**Interfaces:**
- Consumes: `COMPONENT_TYPES`, `normalizeProps` (Task 2); theme ops and `themeStatusOp` (Task 3).
- Produces:
  - `ToolNode = { id; type; props: ToolProp[]; on?; decisionId? }` (no `status`).
  - `ToolPatchOp` = `add` | `update {id, props?, decisionId?}` (no `status`) | `remove` | `move` | `set_screen` | `set_theme { accent?, warmth?, radius?, density? }` | `drop_theme { decisionId }`.
  - `ToolPatchBatch = { ops; label; by?; decisionId? }`.
  - `fromToolBatch(t: ToolPatchBatch, defaults?: { decisionId?: string }): { batch: PatchBatch; dropped: number }` — normalizes props with `normalizeProps` (count = dropped keys); `add` nodes get `status: "draft"` and `decisionId = node.decisionId ?? t.decisionId ?? defaults.decisionId`; `update` and `set_theme` inherit the same way; `drop_theme` → `{ op: "theme_status", to: "revert", decisionId }`.
  - Callers log the dropped count as `props_dropped` (id/count only).

- [ ] **Step 1: Write failing tests:**
  - `ui-tree.test.ts`: `fromToolBatch fills status and the batch decisionId` (node without decisionId in a batch with `decisionId: "d7"` → node `{status:"draft", decisionId:"d7"}`; a node's own `decisionId` wins); `fromToolBatch drops bad props and counts them`; `drop_theme becomes a theme_status revert`; `the tool schema has no status field` (`JSON.stringify(patchBatchJsonSchema())` does not contain `"status"`); `an unknown component type is rejected` (type `"Stack"` fails `ToolPatchBatch` parse).
  - `build-loop.test.ts` (sanitize): `drop_theme on an agreed slot is dropped unless reopened` (Review Focus 3) — accent agreed with d1: a model batch `drop_theme d1` is removed by `sanitizeModelBatch` with `current`; with `reopened` containing d1 it is kept. `a model batch cannot send theme_status agreed` — a `theme_status` agreed op in a model batch is removed.
  - `build-loop.test.ts`: `conflict variants default to d-<conflictId>` — an `add_conflict` whose variant batch has `set_theme {accent:"gold"}` and no decisionId stores the op with `decisionId: "d-c1"`.
- [ ] **Step 2: Run** `npm test` — the new tests FAIL.
- [ ] **Step 3: Implement**: `COMPONENT_TYPES` in `schema.ts` comes from the catalog (`z.enum(COMPONENT_TYPES as [string, ...string[]])`); `PropValue` adds `z.array(z.number())`; tool shapes as above; `fromToolBatch` as above, and update its callers in `handoff.ts`/`build-loop.ts` for the new return shape; in `applyConsensusOps` pass `{ decisionId: \`d-${op.id}\` }` for variant batches; `sanitizeModelBatch` keeps `set_theme`, removes any `theme_status` with `to: "agreed"`, and for `theme_status revert` with `current` drops it when a slot carrying that id is agreed and the id is not in `current.reopened`. `ui-command.ts`: `TEXT_PROPS` adds `name`; `CLICKABLE` = Button, ListItem, Tabs, Segmented, Card, MediaCard, ProductCard, PricingTier.
- [ ] **Step 4: Migrate tests and fixtures**: `Stack` → `Section` (column) or `Row` (`direction: "row"`); `NavBar` → `PageHeader`; `ImagePlaceholder` → `Image`; `ChartPlaceholder` → `ChartCard` (`title` from `label`). Remove `status` from every model-facing fixture node (`fakeModel` scripts, tool-input fixtures); internal `Prototype` fixtures keep it.
- [ ] **Step 5: Run** `npm run check` — PASS.
- [ ] **Step 6: Commit** `feat(engine)!: new component catalog and trimmed patch format`.

### Task 7: Theme decisions in the build loop and on the stage

**Files:**
- Modify: `src/agent/build-loop.ts`, `public/renderer/motion.js`, `public/stage.html`, `test/build-loop.test.ts`, `test/motion-browser.test.ts`

**Interfaces:**
- Consumes: `themeStatusOp` (Task 3), `themeChange` (Task 3).
- Produces (`motion.js`): `snapshotCanvas(container: Element): Element | null` (static clone of the canvas content; null above 3000 elements); `playThemeFade(container: Element, snapshot: Element): void` (snapshot laid over the canvas, opacity 1 → 0 over 450 ms, then removed); `playThemeSettled(container: Element): void` (a solid `--b-agreed` inset frame around the canvas, same timing as `playSettled`).

- [ ] **Step 1: Write failing tests** in `build-loop.test.ts` (scripted port, as the existing promotion tests do):
  - `agreeing a theme decision flips its slots`: a run with `apply_patches {decisionId:"d1", ops:[set_theme accent gold]}` and `add_decision d1`, then a grounded `support` from another speaker → `proto.theme.accent.status === "agreed"`.
  - `the 30 s timeout agrees a pending theme` (same, via `mark_pending` and the fake clock).
  - `an objection reverts a draft theme`: gold draft d1 → grounded `object d1` → accent back to `slate`, agreed, no decisionId; the stage got a `patch` whose changes include `{kind:"theme"}`.
  - `an objection to an agreed theme reverts to the theme before it`: blue agreed (d0) → gold agreed (d1) → `object d1` → accent `blue`.
  - `an ungrounded objection does not revert` (speaker not in grounding lines).
- [ ] **Step 2: Write failing browser tests** in `motion-browser.test.ts`:
  - `a theme value change fades the old canvas out`: render, patch with a theme change → one element with class `m-theme-fade` exists right after, gone after 600 ms; the spotlight queue got one target with id `app`.
  - `a settled theme plays the agreed frame`: a patch that only flips accent to agreed → one `.m-theme-settle` element appears.
  - `no theme fade while covered` (Review Focus 5): with a comparison shown, a theme patch creates no `.m-theme-fade` and logs no error.
- [ ] **Step 3: Run** them — FAIL.
- [ ] **Step 4: Implement**: in `flipNodes`, when `status === "agreed"` append `themeStatusOp(proto, d.id, "agreed")` to the same batch if non-null (and apply it even when no node ids flip); in `applyResult`, after the consensus ops, for each grounded `object` op apply `themeStatusOp(proto, decisionId, "revert")` in its own batch labelled `batchLabel("Reverted", decision.text)`; log `build.theme_reverted` with session and decision ids. In `stage.html`'s `patch` case, compute `themeChange(prevProto, proto)` before `draw`; for `"values"` and not `covered`, take `snapshotCanvas(protoEl)` before `draw` and `playThemeFade` after; for `"settled"` and not `covered`, `playThemeSettled(protoEl)`. Add `.m-theme-fade` and `.m-theme-settle` rules to `theme.css` under the motion section.
- [ ] **Step 5: Run** `npm run check` — PASS.
- [ ] **Step 6: Commit** `feat(engine): theme proposals follow the decision rules on stage`.

### Task 8: Build prompt

**Files:**
- Create: `src/agent/prompt-catalog.ts`
- Modify: `src/agent/prompts/build.md`, `src/agent/build-loop.ts` (`SYSTEM`), `test/build-loop.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `STYLE_OPTIONS`, `THEME_OPTIONS`.
- Produces: `componentTable(): string` — a markdown table, one row per type: `| Type | props (key: kind or a|b|c) | styles | note |`, grouped by catalog group, then one line listing `STYLE_OPTIONS`. `buildSystemPrompt(): string` = `build.md` with `{{COMPONENTS}}` replaced; `SYSTEM` uses it once at module load (stable text, so the prompt cache still hits).

- [ ] **Step 1: Write failing tests**: `the system prompt lists every component` (every `COMPONENT_TYPES` entry appears as `` `Type` `` in `buildSystemPrompt()`); `the prompt has no leftover placeholder`; `the prompt never mentions status on nodes` (no `status: "draft"` text in the patch section).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Rewrite `build.md`'s "The prototype" section**: replace the component table with `{{COMPONENTS}}`; teach compact cell markup (`@person`, `#pill`, `|`); "prefer one composite component over building it from parts" with the StatCard example; style options are optional and usually omitted; batch-level `decisionId`; no `status`. Add a "Looks and theme" section: `set_theme` only when the room talks about looks; label `Proposed: gold accent`; a contested look is an `add_conflict` whose variants are each one `set_theme` op; `drop_theme` when the room drops a draft theme; never raw colors. Update the "Nodes" paragraph that says new nodes get `status: "draft"`.
- [ ] **Step 4: Run** `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): build prompt teaches the new library and theming`.

### Task 9: Measure and record

**Files:**
- Create: `test/fixtures/expense-batches.new.json`, `test/fixtures/expense-batches.old.json`, `scripts/measure-batches.ts`
- Modify: `docs/adr/0014-prototype-design-system.md`, `test/ui-tree.test.ts`

- [ ] **Step 1: Write the fixtures**: the mockup's Overview screen as the `apply_patches` inputs a model would send, small batches in the order the prompt asks for, in the new format (`.new.json`, array of `ToolPatchBatch`) and the pre-Task-6 format with the old 21 types and per-node `status` (`.old.json`, not validated).
- [ ] **Step 2: Write a failing test** `the new expense fixture applies cleanly`: every batch in `.new.json` parses as `ToolPatchBatch` and applies in order to `emptyPrototype("Ledger")`.
- [ ] **Step 3: Run** — FAIL until the fixture is right; fix the fixture, not the code.
- [ ] **Step 4: Write `scripts/measure-batches.ts`**: prints, per file, batches, ops, JSON characters, and estimated tokens (`Math.round(chars / 3.5)`), and the ratio new/old. No network.
- [ ] **Step 5: Run** `node scripts/measure-batches.ts` and paste the table into the ADR's Measurements section, with the note that a `--live-models` replay for real timings needs Amir's go-ahead.
- [ ] **Step 6: Run** `npm run check` — PASS. **Commit** `docs(adr): measured batch size for the design system`.

---

## After this plan
- Ask Amir about one paid `--live-models` replay of `todo-app.json` for real timings, and about sharing the gallery screenshots into a real Meet call for the 14/18px and hairline check (spec 6).
- Then part 2 (templates, derived app frame, phone) and part 3 (images, icons) get their own plans.
