# Prototype design system, parts 2 and 3: app frame, page templates, icons and images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every prototype a real app frame derived from its screens (sidebar, top nav or a phone with bottom tabs), lean page templates whose regions lay out what the room discussed, a bundled open-license icon set, and ~40 built-in stock photos.

**Architecture:** All new vocabulary lives in the import-free catalog (`public/renderer/catalog.js`: templates, regions, App/Screen props) and two new import-free data modules (`icons.js`, `images.js`), so the server validation, the generated build prompt and the renderer stay in lockstep as in part 1. The renderer derives the app frame from `proto.root.children` (Screens), never from model output, and gains a per-child slot hook so a templated Screen can place children into regions. Images are static WebP files served under `/renderer/images/` and inlined into the handoff export only when used.

**Tech Stack:** as part 1 (Node 24+ type-stripped TS, zod v4, `node:test`, plain browser ES modules, headless Chrome tests). New devDependency: `lucide-static` (ISC) for icon extraction only.

**Spec:** `docs/superpowers/specs/2026-10-19-prototype-design-system-design.md` (4.3 templates and app frame, 4.6 images and icons). Part 1 plan: `docs/superpowers/plans/2026-10-19-design-system-1-library-and-theme.md`. ADR: `docs/adr/0014-prototype-design-system.md` (still `proposed`; amended here).

## Global Constraints

- Everything in part 1's Global Constraints still holds (erasable TS, import-free shared renderer modules, ids/counts-only logging, no HTML/CSS/raw values from the model, 900×720 canvas, 18px body and nothing visible below 14px, transform/opacity motion only, props dropped never batches rejected, ask before anything paid, `npm run check` green after every task).
- **Start lean (spec anti-goal):** a template region with nothing in it is not drawn — no empty boxes, no placeholder sections.
- **Nothing invented:** the app frame shows only the app's name and the Screens that exist; the model never builds navigation by hand.
- **Images:** free stock photos only (Unsplash License or Pexels License), downloaded once, resized to at most 800px on the long side, WebP, each ≤ 80 KB, total ≤ 3 MB, license and source recorded per file. Avatars stay initials; no photos of people in avatars.
- **Icons:** Lucide (ISC), a curated subset, license text kept with the generated module. Unknown icon names render nothing.
- The handoff export stays a single self-contained file: it inlines only the images the prototype actually uses.

## Review Focus

1. **A Screen added, renamed or removed mid-meeting** — the frame's nav updates on the same patch, the active item follows the shown screen, and no stale nav item stays. Pinned in Task 2 (`nav follows screens`).
2. **A node whose `region` is unknown for its Screen's template, or set on a Screen with no template** — it renders in the template's main region (or normally), never disappears. Pinned in Task 3 (`unknown region falls back to main`).
3. **Changing a Screen's template after content exists** — every child is re-placed in a region of the new template without losing nodes, and motion/spotlight still find them. Pinned in Task 3 (`template change keeps every child`).
4. **Phone device with many screens** — the bottom tab bar shows at most 5 items and nothing overflows the phone frame. Pinned in Task 2 (`phone tabs cap at five`).
5. **An `image` naming a subject with one image, an unknown subject, or a specific image that doesn't exist** — deterministic pick, tinted fallback block, never an error, and the export inlines only images actually rendered. Pinned in Task 7 (`image resolution`).

---

## File map

| File | Responsibility |
|---|---|
| `docs/adr/0014-prototype-design-system.md` | Amend: app frame, templates/regions, slot hook, icons, images (Tasks 1, 5, 6). |
| `public/renderer/catalog.js` | Add `TEMPLATES`, App props `nav`/`device`, Screen props `template`/`icon`, a `region` prop accepted on every non-App/Screen type. |
| `public/renderer/components/frames.js` | App builder draws the derived frame; Screen builder draws template regions; `slotFor` hook. |
| `public/renderer/render.js` | Per-child slot placement (`slotFor`), indexes counted per slot. |
| `public/renderer/interact.js` | Clicks on `[data-nav-screen]` navigate. |
| `public/stage.html` | Voice-command pointer targets the nav item when the target is a Screen. |
| `public/renderer/theme.css` | Frame, phone, region and icon styles. |
| `public/renderer/icons.js` | Generated: `ICONS` (name → SVG inner markup), `ICON_ALIASES`, `ICON_NAMES`, Lucide ISC notice. |
| `scripts/build-icons.ts` | Generates `icons.js` from `lucide-static` for the curated list. |
| `public/renderer/images/*.webp`, `public/renderer/images.js`, `public/renderer/images/LICENSES.md` | The photos, the manifest (`IMAGES`, `IMAGE_SUBJECTS`, `resolveImage`), per-file credits. |
| `scripts/check-images.ts` | Verifies manifest ↔ files, sizes and budget. |
| `src/app.ts` | Static route also serves `/renderer/images/*.webp`. |
| `src/handoff/export.ts` | Inline used images as data URLs; add `icons.js`, `images.js` to `RENDERER_MODULES`. |
| `src/agent/prompt-catalog.ts`, `src/agent/prompts/build.md` | Prompt sections for frame, templates/regions, icon names, image list. |
| `test/fixtures/gallery-proto.json`, `test/fixtures/expense-batches.new.json` | Updated for frame/templates/icons/images. |
| Tests | `test/catalog-unit.test.ts`, `test/design-browser.test.ts`, `test/renderer-unit.test.ts`, `test/prompt.test.ts`, `test/handoff.test.ts`, `test/motion-browser.test.ts`, new `test/assets-unit.test.ts`. |

## Templates and regions (decided here; Task 1 encodes it)

`TEMPLATES` entries: `{ regions: Record<region, { layout: "stack"|"row"|"grid", note }>, main: region, areas: string /* CSS grid-template-areas */, columns: string /* grid-template-columns */, suggest: string /* one line for the prompt */ }`. A Screen with no `template` lays out its children as today (one column).

| Template | Regions (layout) | Main | Areas (rows) | Columns | Suggest |
|---|---|---|---|---|---|
| dashboard | header (row), stats (grid of up to 4), main (stack), side (stack) | main | `"header header" "stats stats" "main side"` | `2fr 1fr` | PageHeader in header; StatCards in stats; ChartCard/Table in main; ActivityList in side |
| list-detail | header (row), list (stack), detail (stack) | detail | `"header header" "list detail"` | `1fr 1.6fr` | List/Table in list; Card/MediaCard in detail |
| form | header (row), main (stack), aside (stack) | main | `"header header" "main aside"` | `2fr 1fr` | Inputs/Selects/Toggles in main; help Card or Banner in aside |
| feed | header (row), main (stack), side (stack) | main | `"header header" "main side"` | `2fr 1fr` | MediaCards/Comments in main; AvatarGroup/Card in side |
| landing | hero (stack), features (stack), pricing (grid of up to 3), footer (row) | features | `"hero" "features" "pricing" "footer"` | `1fr` | Hero in hero; FeatureGrid in features; PricingTier in pricing |
| chat | list (stack), main (stack) | main | `"list main"` | `1fr 2fr` | ActivityList/List in list; ChatThread in main |
| checkout | header (row), main (stack), summary (stack) | main | `"header header" "main summary"` | `1.6fr 1fr` | Steps in header; Inputs in main; Card with totals in summary |

Rules: a region with no rendered children is hidden and its grid area collapses (use `grid-template-areas` rebuilt from the non-empty regions, or hide and let rows auto-size to 0 — implementer's choice, tested by screenshots); a child's `region` prop picks its region; a missing or unknown region → the template's `main`. On `device: phone` every template collapses to one column in region order.

## App frame (decided here; Task 2 encodes it)

App props: `title` s, `nav` [sidebar, top, none] (default sidebar), `device` [desktop, phone] (default desktop). Screen props: `title` s, `template` [dashboard, list-detail, form, feed, landing, chat, checkout], `icon` s.

- **desktop + sidebar**: 200px left column (surface, hairline right border): logo square (accent) + app title, then one item per Screen in tree order (icon + title), active item = `ui.screen` (accent-soft background, accent icon); content area to the right scrolls.
- **desktop + top**: 64px top bar: logo + title, then screen items horizontally (active underlined in accent).
- **none**: no frame (a landing page, say); title not shown.
- **phone**: a phone body 380×700 centred on the canvas (radius 44px, 10px bezel in `--b-ink`, inner screen `--b-bg`), a 56px title bar with the shown Screen's title, content scrolls inside the phone, a bottom tab bar with the first 5 Screens (icon over label, 14px). `nav` is ignored on phone.
- With one Screen and no title the frame still shows (logo only); with one Screen the nav shows that one item.
- Nav items carry `data-nav-screen="<screenId>"`; they are not prototype nodes (no `data-node-id`), so focus, motion and voice-command node lookup never treat them as nodes. Clicks navigate via interact.js.

## Icons (decided here; Task 5 encodes it)

Curated Lucide names (~90): activity, alert-triangle, archive, arrow-down, arrow-left, arrow-right, arrow-up, award, bar-chart-3, bell, book, bookmark, briefcase, building-2, calendar, camera, check, check-circle, chevron-down, chevron-left, chevron-right, chevron-up, clipboard, clock, cloud, coffee, credit-card, dollar-sign, download, dumbbell, edit-3, eye, file-text, filter, flag, folder, gift, globe, graduation-cap, grid, heart, help-circle, home, image, inbox, info, key, layers, layout-dashboard, link, list, lock, log-out, mail, map-pin, menu, message-circle, mic, moon, music, package, paperclip, pause, phone, pie-chart, play, plus, receipt, refresh-cw, search, send, settings, share-2, shield, shopping-bag, shopping-cart, smile, sparkles, star, sun, tag, target, thumbs-up, trash-2, trending-down, trending-up, truck, upload, user, users, utensils, video, wallet, x, zap. Aliases: chart→bar-chart-3, money→dollar-sign, cart→shopping-cart, team→users, profile→user, dashboard→layout-dashboard, delete→trash-2, edit→edit-3, close→x, add→plus, chat→message-circle, food→utensils, gym→dumbbell, school→graduation-cap, money-bag→wallet. Rendered as inline `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` built with `createElementNS` from the stored element list (never `innerHTML`), sized by the component (20px default, 24px in nav and stat cards).

## Images (decided here; Tasks 6–7 encode it)

Subjects and counts: food 7, places 7, people 7, products 7, workspaces 7, abstract 5 (40). File names `<subject>-<n>.webp`. Manifest entry: `{ file, subject, caption /* ≤ 5 words, for the prompt */, source /* photo page URL */, author, license: "Unsplash License" | "Pexels License", width, height }`. `resolveImage(value, nodeId)`: exact name (`food-3`) → that image; a subject (`food`) → `IMAGES` of that subject at index `hash(nodeId) % count` (FNV-1a over the id); anything else → null (tinted block with the word, as today).

---

### Task 1: Catalog for frames and templates (+ ADR amendment)

**Files:** Modify `public/renderer/catalog.js`, `test/catalog-unit.test.ts`, `docs/adr/0014-prototype-design-system.md`

**Interfaces — Produces:** `TEMPLATES` (shape above); `CATALOG.App.props` gains `nav`, `device`; `CATALOG.Screen.props` gains `template`, `icon`; `normalizeProps(type, props)` accepts `region` (kind `s`) on every type except App and Screen; `templateRegion(template: string | undefined, region: unknown): string | null` — null when no template, else the region or the template's `main`.

- [ ] **Step 1: Failing tests**: `TEMPLATES` has exactly the seven names with the regions, `main`, `areas` and `columns` from the table; every `areas` string names only that template's regions; `normalizeProps("StatCard", {region:"stats"})` keeps it, `normalizeProps("Screen", {region:"x"})` drops it; `normalizeProps("App", {nav:"sidebar", device:"phone"})` keeps both, `{nav:"bottom"}` drops; `templateRegion("dashboard","stats")==="stats"`, `templateRegion("dashboard","nope")==="main"`, `templateRegion(undefined,"stats")===null`.
- [ ] **Step 2: Run** `node --test test/catalog-unit.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Amend ADR 0014 Decision with: derived app frame (nav from Screens, never model-built), templates as frames with hidden empty regions and the `region` prop, the per-child slot hook, `device: phone`.
- [ ] **Step 4: Run** — PASS; `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): catalog for app frame and page templates`.

### Task 2: App frame in the renderer

**Files:** Modify `public/renderer/components/frames.js` (App), `public/renderer/interact.js`, `public/renderer/theme.css`, `public/stage.html`, `test/design-browser.test.ts`, `test/renderer-unit.test.ts`, `test/motion-browser.test.ts`, `test/fixtures/gallery-proto.json`

**Interfaces — Consumes:** `CATALOG.App` props (Task 1). **Produces:** App element parts `nav` (container of `[data-nav-screen]` items), `screenTitle` (phone title bar), `body` (slot, unchanged); `bindInteractions` handles `[data-nav-screen]` clicks with `{kind:"navigate", screen}`.

- [ ] **Step 1: Failing tests** (`design-browser`, gallery App with `nav: sidebar` and 5 Screens with icons):
  - `sidebar lists every screen in order and marks the shown one` — item texts equal the Screen titles; `.is-active` on the shown one; no item has `data-node-id`.
  - `nav follows screens` (Review Focus 1) — re-render after adding a Screen, renaming one and removing one: items match exactly; active follows `ui.screen`.
  - `clicking a nav item navigates` — click item 3 → `ui.screen` is Screen 3 and it is visible.
  - `top nav and none` — `nav: top` gives a horizontal bar; `nav: none` renders no `[data-nav-screen]` and no title.
  - `phone frame` — `device: phone`: a `.b-phone` of 380×700 centred in 900×720 (±1px); title bar shows the shown Screen's title; content does not overflow the phone horizontally.
  - `phone tabs cap at five` (Review Focus 4) — 7 Screens → 5 tab items.
  - Re-run the part 1 checks (no overflow, no text < 14px, render idempotent via MutationObserver) on sidebar, top and phone. Save screenshots `frame-sidebar.png`, `frame-top.png`, `frame-phone.png`.
  - `renderer-unit`: `reduceInteraction` unchanged; a new unit for the nav-click helper if one is extracted.
  - `motion-browser`: `a voice navigate points at the nav item` — a `command` event whose node is a Screen animates the pointer to that Screen's `[data-nav-screen]` element when one exists (else to the Screen, as today).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per "App frame" above. The App builder reads `node.children.filter(type === "Screen")` in `update`; keep `update` idempotent (rebuild nav items only when the screen list or titles/icons change). Icons render nothing until Task 5 (leave a span the icon will fill).
- [ ] **Step 4: Run** focused tests, look at the screenshots, `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): derived app frame with sidebar, top nav and phone`.

### Task 3: Page templates in the renderer

**Files:** Modify `public/renderer/render.js`, `public/renderer/components/frames.js` (Screen), `public/renderer/components.js` (`slotOf` → also export `slotFor`), `public/renderer/theme.css`, `test/design-browser.test.ts`, `test/fixtures/gallery-proto.json`

**Interfaces — Consumes:** `TEMPLATES`, `templateRegion` (Task 1). **Produces:** builder contract gains optional `slotFor(el, node, child) → Element`; `render.js` uses `slotFor` when present (else `slot`) and computes each child's insertion index among the children placed in the same container; Screen builder creates one container per region (`[data-region]`) when `node.props.template` is set and hides empty ones.

- [ ] **Step 1: Failing tests** (`design-browser`, one gallery Screen per template, each filling some regions only):
  - `each template places children in their regions` — every child element's closest `[data-region]` equals its `region` prop.
  - `empty regions are not drawn` — regions without children are hidden (`hidden` or `display: none`) and take no height.
  - `unknown region falls back to main` (Review Focus 2) — `region: "nope"` lands in the template's main region; a `region` on a Screen with no template renders in the Screen normally.
  - `template change keeps every child` (Review Focus 3) — re-render the same Screen with another template: every child id is still in the DOM exactly once, in a region of the new template.
  - `reconcile order within a region` — inserting a child at index 0 of a region puts it first in that region, not first in the Screen.
  - Part 1 checks (overflow, small text, idempotence) on every template; screenshots `template-<name>.png`, plus `template-dashboard-phone.png`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `render.js`: when the parent builder has `slotFor`, group the parent's children by their container and place each with its index within the group; everything else (registry, motion, removal) unchanged. Screen: grid with the template's `areas`/`columns` built from non-empty regions; region layouts stack/row/grid per the table; on phone one column in region order.
- [ ] **Step 4: Run** focused tests, the full motion and renderer browser tests (the slot change touches reconcile), look at screenshots, `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): lean page templates with regions`.

### Task 4: Prompt and fixtures for frame and templates

**Files:** Modify `src/agent/prompt-catalog.ts`, `src/agent/prompts/build.md`, `test/prompt.test.ts`, `test/fixtures/expense-batches.new.json`, `docs/adr/0014-prototype-design-system.md` (Measurements)

**Interfaces — Consumes:** `TEMPLATES` (Task 1). **Produces:** `templatesTable(): string` (one row per template: name, regions, suggest) inserted at `{{TEMPLATES}}`.

- [ ] **Step 1: Failing tests** (`prompt.test.ts`): every template name and region appears; the prompt says the frame/nav is automatic (contains "never build navigation"); no leftover `{{`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** `build.md`: when adding a Screen, give it a `title`, an `icon` and the `template` that fits what the room described; place each node with `region`; add only what was discussed (empty regions stay hidden); set the App `nav`/`device` only when the room talks about it (phone app → `device: phone`); never build navigation, a sidebar or a top bar from components. Rewrite `expense-batches.new.json` to use the dashboard template and regions and drop its hand-built Tabs nav/Search/Avatar row; rerun `node scripts/measure-batches.ts` and update the ADR Measurements table (note the new fixture no longer builds nav).
- [ ] **Step 4: Run** `node --test test/prompt.test.ts test/ui-tree.test.ts`, `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): prompt teaches templates and the automatic app frame`.

### Task 5: Icons

**Files:** Create `scripts/build-icons.ts`, `public/renderer/icons.js` (generated, committed); Modify `apps/engine/package.json` (devDependency `lucide-static`, script `"icons": "node scripts/build-icons.ts"`), `public/renderer/components/dom.js` (`icon(name, size)`), the builders with `icon` props and FeatureGrid, the App frame nav/tabs, `src/handoff/export.ts` (`RENDERER_MODULES` + `icons.js`), `src/agent/prompt-catalog.ts` / `build.md` (`{{ICONS}}`), `docs/adr/0014-prototype-design-system.md`, tests: new `test/assets-unit.test.ts`, `test/design-browser.test.ts`, `test/prompt.test.ts`

**Interfaces — Produces:** `icons.js` exports `ICONS: Record<string, [tag: string, attrs: Record<string,string>][]>`, `ICON_ALIASES: Record<string,string>`, `ICON_NAMES: string[]`, `iconData(name: string): ... | null` (alias-aware, case-insensitive); `dom.js` `icon(name, size): SVGElement | null` built with `createElementNS`.

- [ ] **Step 1: Failing tests**: `assets-unit` — every curated name and alias resolves; `iconData("nope") === null`; every element tag is one of path/circle/rect/line/polyline/polygon/ellipse and every attr key is a plain SVG geometry attribute (no `on*`, no `href`); `icons.js` contains the ISC notice. `design-browser` — gallery icons render an `<svg>` (StatCard, Button, ListItem, EmptyState, FeatureGrid, nav items); an unknown name renders none and no error. `prompt.test` — every curated name appears in the prompt.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `npm i -D lucide-static -w @builder/engine`; the script reads each curated icon's SVG from `lucide-static`, parses its child elements into the tuple form, and writes `icons.js` (sorted, with the license header); run it and commit the output. Add `{{ICONS}}` to the prompt as one comma-separated line. Amend the ADR (icon set, license, generation).
- [ ] **Step 4: Run** focused tests, look at screenshots, `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): bundled Lucide icon subset`.

### Task 6: Source and bundle the stock images

**Files:** Create `public/renderer/images/*.webp` (40), `public/renderer/images/LICENSES.md`, `public/renderer/images.js`, `scripts/check-images.ts`; Modify `docs/adr/0014-prototype-design-system.md`; Test `test/assets-unit.test.ts`

**Interfaces — Produces:** `images.js` exports `IMAGES: { file, subject, caption, source, author, license, width, height }[]`, `IMAGE_SUBJECTS: string[]`, `resolveImage(value: unknown, nodeId: string): { file, caption } | null`.

- [ ] **Step 1: Failing tests** (`assets-unit`): `IMAGES` has 40 entries with the subject counts above; every `file` exists, is WebP, ≤ 80 KB, long side ≤ 800px (read the header with `sharp`-free parsing or the dimensions recorded in the manifest checked against the file via a minimal RIFF/VP8 header read); total ≤ 3 MB; every entry has `source` (https URL on unsplash.com or pexels.com), `author`, `license` in the two allowed values; `LICENSES.md` lists every file; `resolveImage("food-3","x").file === "food-3.webp"`; `resolveImage("food","a")` is deterministic and of subject food; `resolveImage("pizza","a") === null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Source the photos.** For each subject, find free-license photos on unsplash.com or pexels.com (WebFetch/WebSearch the photo pages; use only photos whose page states the Unsplash License or Pexels License), download at ~1200px, convert to WebP ≤ 800px long side at a quality that meets 80 KB (use `cwebp` or `sips`+`cwebp` if installed; if neither, report BLOCKED with what's needed), and **look at every image** (Read the file) to confirm it matches its subject and caption, is not explicit, shows no readable brand logos front and centre, and works as generic product imagery. People photos: groups or people at work, not portraits meant for avatars. Write the manifest and `LICENSES.md` (file, caption, author, source URL, license). Write `scripts/check-images.ts` (the same checks as the test, for humans). Amend the ADR (sources, licenses, budget).
- [ ] **Step 4: Run** `node --test test/assets-unit.test.ts`, `node scripts/check-images.ts`, `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): 40 built-in stock images`.

### Task 7: Images in the renderer, handoff and prompt

**Files:** Modify `public/renderer/components/dom.js` (`imageBlock`), `public/renderer/components/content.js` (Image, Hero, ProductCard, MediaCard), `src/app.ts` (route), `src/handoff/export.ts`, `src/agent/prompt-catalog.ts`, `src/agent/prompts/build.md`, `test/design-browser.test.ts`, `test/handoff.test.ts`, `test/prompt.test.ts`, `test/fixtures/gallery-proto.json`

**Interfaces — Consumes:** `resolveImage` (Task 6). **Produces:** image elements `<img src="/renderer/images/<file>" alt="<caption>">` (`object-fit: cover`, aspect from the component), the URL prefix configurable by the page (`window.__builderImageBase` default `/renderer/images/`) so the export can map it; export: `imagesUsed(proto): string[]` and a data-URL map injected for the inline export.

- [ ] **Step 1: Failing tests:**
  - `design-browser` `image resolution` (Review Focus 5): `image: "food-3"` → `img[src$="food-3.webp"]`; `image: "food"` → a food image, the same on re-render and on a second page load; `image: "pizza"` → the tinted block with "pizza"; every `<img>` in the gallery loads (`naturalWidth > 0`).
  - `handoff.test` — the inline export of a prototype using two images contains exactly those two as `data:image/webp;base64,` and no others; it opens offline (`file://`) with both `naturalWidth > 0`; the live handoff serves them by URL.
  - `app.ts` route: `/renderer/images/food-1.webp` → 200 `image/webp`; `/renderer/images/../app.ts` and `/renderer/images/x.js` → 404.
  - `prompt.test` — every subject and every image name with its caption appears.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: route regex allows `images/<name>.webp` with content type `image/webp`; `imageBlock` uses `resolveImage` and falls back to today's tinted block; export collects used image files by walking the prototype with the same `resolveImage`, base64-inlines them, and sets the image base to a map lookup; prompt `{{IMAGES}}` lists `subject: name caption, …` compactly and tells the model to prefer a subject when no specific photo matters. Add `images.js` to `RENDERER_MODULES`.
- [ ] **Step 4: Run** focused tests, look at screenshots (gallery content screen with photos), `npm run check` — PASS.
- [ ] **Step 5: Commit** `feat(engine): built-in images in prototypes and the handoff`.

---

## After this plan
- Look at the frame, template and image screenshots together with Amir.
- Still open from part 1: the Meet text-size test and a paid `--live-models` replay (both need Amir's go-ahead).
