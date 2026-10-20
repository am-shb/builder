# Prototype design system: real components, page templates and live theming

- **Date:** 2026-10-19
- **Area:** engine (`apps/engine`: `src/ui/`, `src/agent/prompts/build.md`, `public/renderer/`, `src/handoff/`)
- **Status:** design, awaiting approval
- **Relates to:** spec `2026-10-16-meeting-prototype-agent-design.md` §6 (prototype model), §10a (shared screen);
  ADR 0002 (streamed tool calls); ADR 0013 (build loop on Sonnet)

Marked *(my call)* = decided by Claude during the brainstorm, open to override. Everything else was decided by Amir.

## 1. Why

The prototype on the stage today is a white page of basic primitives. 21 components, props that are almost all text,
one fixed look (`public/renderer/theme.css`), and one layout primitive (`Stack`, row or column). Every app, whatever
it is, comes out looking like the same wireframe. The spec says the shared screen is the face of the product and
visual quality is a primary requirement; the prototype is the biggest part of that screen and it doesn't deliver.

The goal: when people look at the stage they should think "that's roughly a real product". Most of all in the first
minutes of the meeting, which is when they decide whether Builder is impressive.

The reference for "real product" is the mockup made in the brainstorm (an expense tracker: sidebar with icons, top
bar with search and avatar, page header with a primary button, three stat cards with delta pills, a bar chart card
drawn from data, a recent-activity list with initials avatars and status pills, 1px hairlines, a faint shadow).
It is saved next to this document as `2026-10-19-prototype-design-system-mockup.html` (an HTML fragment meant for
the brainstorm viewer; open it in a browser to see the neutral, gold and green versions). Its CSS is a fair starting
point for the new theme.

## 2. Goals, non-goals, anti-goals

**Goals**
- A larger library of finished, product-grade components that work for **any kind of app** (not tuned to one
  domain). The renderer owns how they look; the model only fills in content.
- **Page templates** as starting points: sensible frames with default components laid out.
- **Theming**, changeable mid-meeting. "Let's try a gold accent vs a green one" must work, as a normal side-by-side
  comparison.
- **Per-component customization** to a degree: color, padding, size and the like.
- A **balance of quality and speed**. Being no slower than today is preferred, not required.

**Non-goals**
- The model writing HTML or CSS.
- Pixel-level design control (arbitrary hex colors per node, arbitrary px values).
- Real photos from the internet, or any network fetch for images.
- Keeping existing prototypes working. All stored data is test data and can be dropped.
- Changing the build model (ADR 0013 stays).

**Anti-goals (a failure even if it technically works)**
- A template that fills the screen with sections nobody discussed. **Start lean: only what the room discussed is
  drawn.** The existing build-prompt rule ("do not pile on elements nobody asked for") stays.
- Screens that look great but arrive so slowly the stage feels frozen.
- Losing what already works: streamed batches, spotlight and motion, draft vs agreed, comparisons, the handoff.
- Something drawn or themed that reads as agreed when the room didn't agree it (spec §4, §12).

## 3. Constraints

- Stage canvas is **900×720** (`#canvas` in `public/stage.html`), shared at 1280×720, 15 fps, through Meet's video
  compression.
- The model never writes HTML. It emits small patch batches through `apply_patches`, validated by zod and applied
  atomically (`src/ui/schema.ts`, `src/ui/tree.ts`). Each batch streams to the stage as soon as it closes (ADR 0002).
- Model-facing schemas are strict: closed objects, no recursion. That is why props are `{key, value}` pairs today.
- Comparison variants are patch batches (`src/consensus/doc.ts`), applied to the prototype and rendered live in the
  comparison view (`public/renderer/comparison.js`).
- The handoff page and its self-contained export inline the renderer modules and `theme.css`
  (`src/handoff/export.ts`). Anything the renderer needs (icons, images, fonts) must also work inline, offline.
- Erasable TypeScript only; Node 24 type stripping; no build step (ADR 0001). The renderer is plain browser JS modules.
- AGENTS.md: the component schema is an engine interface, so an **ADR** is written and accepted before the code.
- Cost rule: ask before anything that costs money (paid replays with `--live-models`, generating images).

## 4. What was decided

### 4.1 Waves: real from the first draw, looks as a later topic
Builder doesn't start with a wireframe. From the first draw it uses the real components, in a **neutral house
theme**: slate/near-black accent, grays, no brand choices. It looks like a real product nobody has styled yet.
When the conversation turns to how it should look, theming becomes a topic like any other decision.

A wireframe skin (the same components drawn in grayscale boxes) is possible later, since it's only a renderer
skin. It is **not** in this work.

### 4.2 A larger component library
Finished, composite components, so one node is one meaningful thing (a stat card, not a Card + Text + Badge). This
is the main speed lever as well as the main quality lever.

Starting catalog *(my call; the builder may merge, split or rename, and should cut what turns out to be redundant)*:

| Group | Components |
|---|---|
| Frames | app shell (sidebar / top nav / phone with bottom tab bar), page header, section, grid, split view, drawer, modal |
| Showing data | stat card, table with rich cells (avatar, pill, amount), activity list, chart card (bar, line, donut), progress, timeline, calendar strip, kanban board |
| Content | hero, feature grid, pricing tier, product card, media card, avatar, avatar group, pill/badge, quote/testimonial, text, heading |
| Input | text field, search bar, select, segmented control, toggle, checkbox, slider, date picker, stepper, file upload, button (with optional icon) |
| Feedback | empty state, banner, toast, skeleton loader |
| Conversation | chat thread, comment |

About 45 components, up from 21. List-like content goes in compact props, not child nodes, wherever a person would
never point at one row on its own: chart data as numbers (`[45, 62, 50, 78]`), table/activity rows as
`"Sara K. | Figma seats | $420 | approved"` strings, nav items as a list of labels. Things people do point at and
change one by one (a card, a field, a button) stay nodes.

The existing interactions (`navigate`, `toggle`, `open`, `close`, `append`, `setValue`) carry over and must work on
the new components wherever they make sense.

### 4.3 Page templates, lean
A template is **a page frame, not a page of content**. A Screen gets a `template` (my starting list: dashboard,
list + detail, form/settings, feed, landing, chat, checkout). The template sets the structure: the regions
(e.g. dashboard: header, stats row, main grid, side column) and how each lays out.

- A region with nothing in it is **not drawn**: no empty boxes, no placeholder sections.
- When the room discusses something, the model adds that one component into the right region, and the template
  handles its layout. The model spends no output on layout containers.
- The template's "sensible default components" are **suggestions to the model about what goes where**, not content
  drawn up front. *(Interpretation of "defaults already laid out" combined with "start lean"; worth a glance.)*

**App frame derived from what exists** *(my call)*: the app shell's sidebar or tab items come from the Screens the
room has created, and the header shows the app's name. So even the first screen sits in a real-looking app, nothing
is invented, and the model writes none of it. Clicking a nav item navigates to that screen.

**Phone apps** *(my call)*: the App gets a `device` (`desktop` | `phone`). `phone` draws the app inside a phone frame
centred on the canvas, with a bottom tab bar as the shell. A phone's shape fits the 720-high canvas well and lets
text stay large.

### 4.4 Theming
- The theme lives on the prototype and is set by a **few named inputs**, not raw colors *(my call on the inputs)*:
  an accent (from a fixed palette of named hues: slate, blue, indigo, violet, pink, red, orange, gold, green, teal…),
  plus a small number of whole-feel inputs such as warmth (neutral / warm / cool background and line tints), radius
  (sharp / soft / round) and density. The model only ever says something like `accent: gold`.
- The **renderer derives the rest**: soft tint, readable text on the accent (gold needs dark text on its buttons;
  white on gold is unreadable), chart colors, and status colors kept apart from the brand (with a green brand,
  "approved" pills move to teal). All derived pairs must pass contrast for 720p (aim for WCAG AA on text).
- **Where the theme lives** *(my call)*: its own place on the prototype, **not** props on the App node. Each input
  (accent, warmth, radius, density) carries its own value, draft/agreed status, `decisionId`, and **last agreed
  value**. So the room can agree "gold" while still arguing about corners, and a theme proposal never sends an agreed
  app name back to draft. Setting a theme input is a patch op, so it works inside conflict variants and is validated
  and applied atomically like any other op. The handoff shows the agreed theme.
- **A single, uncontested proposal shows right away** (decided). "Let's make it gold" re-themes the prototype as soon
  as it's proposed, the same way every other proposal appears immediately as a draft:
  - the re-theme animation plays at the proposal, and the spotlight label marks it as a proposal
    ("Proposed: gold accent · Sara"), because the usual dashed outline can't mark a change to the whole canvas;
  - when it's agreed, a settle animation plays, matching the existing draft-to-agreed moment;
  - when it's objected to or dropped, the prototype animates back to the input's last agreed value (the neutral house
    theme if none was ever agreed). The system does this from the stored last agreed value, not the model.
  - The agreement rules are unchanged: support from a different participant in the grounding lines, or 30 s pending
    with no objection. The model never marks a theme agreed.
- **A contested choice** ("gold vs green") is a conflict with two variants in the existing comparison view, each
  preview showing the whole prototype re-themed. Each variant is one tiny op. Nothing changes on the main prototype
  until the room picks; the winner then applies with the re-theme animation.
- **The re-theme animation** should feel like a highlight of the meeting, within §10a's motion rules (transform and
  opacity, 250–600 ms, 15 fps). A colour cross-fade (snapshot the old canvas, fade it out over the re-themed one) fits
  those rules.

### 4.5 Per-component customization
Through **named options, not raw values** *(my call)*: e.g. `tone` (default / accent / success / warning / danger /
muted), `size` (sm / md / lg), `pad` (tight / normal / roomy), `emphasis` (plain / outlined / filled), width or span
inside a grid. All optional; when nothing is set the defaults already look right, so most nodes set nothing. Each
component accepts only the options that make sense for it. This keeps output short and designs on-palette.

### 4.6 Images and icons
- **A limited set of built-in images**, about 40, shipped with the engine and grouped by subject (food, places,
  people, products, workspaces, abstract). The model names one (`image: "food-3"`) or only a subject
  (`image: "food"`); with a subject the renderer picks one deterministically from the node id, so it never changes
  between renders. Compressed (WebP or AVIF) and small enough for the handoff export to inline them.
  *Sourcing (my call, needs a yes at the time):* openly licensed stock (license recorded per file) or generated
  images. Generating costs money, so ask Amir first.
- **Avatars are initials on colored circles**, color derived from the name. No photos of people in avatars.
- **Icons:** a small bundled open-license icon set (e.g. a subset of Lucide, ISC license), referenced by name
  (`icon: "wallet"`). Unknown names fall back to no icon, never an error that rejects the batch.

### 4.7 Speed
Already in place: per-batch streaming, prompt caching, low effort. What's left is output length per visible change.
The levers, all part of this work:
1. Composite components (4.2) and compact list props.
2. Templates own layout (4.3), and the app frame is derived (4.3).
3. Theme is one small op; customization is optional short tokens (4.4, 4.5).
4. **Trim per-op boilerplate** in the model-facing schema: drop `status` from model-facing nodes (the system ignores
   it already, per `build.md`), and set `decisionId` once per batch with a per-node override if needed. The internal
   tree keeps both.
5. The prompt keeps "most visible change first, small batches", so the first change lands early.

**Bar:** balance quality and speed. Prefer that, on the same meeting, the first change after a proposal appears no
later than today and a full screen costs fewer output tokens than today's version of it. Not a hard gate; a big
regression is a failure (anti-goals).

### 4.8 Old data and old components
All stored prototypes are test data. The old 21 component types are **replaced**, not kept alongside. Old sessions
may be deleted or simply fail to render; no migration code. Test fixtures (`test/fixtures/proto-todo.json`,
`script-todo.json`, the session fixtures' `fakeModel` scripts) are rewritten for the new library.

## 5. Things that must keep working
- Streamed batches, the spotlight with its label, motion (enter, collapse, FLIP glide, cross-fade), the streaming
  shimmer placeholder, screen transitions, the voice-command pointer. Composite components must give the spotlight
  sensible rects (the whole card, not one inner text).
- Draft vs agreed: dashed outline and one DRAFT tag per draft region; the settle animation. It must still read
  clearly on the new, softer look (hairlines and a faint shadow next to a dashed outline).
- Comparisons: like-for-like variants, live scaled previews, the resolve animation, `focus_option`.
- The handoff page and its export, offline: the new theme, icons and images all inline.
- All existing node validation: ids, max depth, max nodes, Screen under App, atomic batches.

## 6. How we'll know it worked
- **Token count per screen**, free: write the brainstorm's expense-tracker screen (and a couple of others, e.g. a
  phone app and a settings page) as patch batches in the old and new formats, and count output tokens. Expect a
  clear drop; record the numbers in the ADR.
- **Look:** headless-Chrome screenshots of each template and the components at 900×720 (the renderer browser tests
  already run headless Chrome), in the neutral theme and at least two accents, including gold.
- **The 22px question (open):** the mockup uses 17px body text, 1px lines and a faint shadow; today's theme bans
  shadows and uses 22px for Meet compression. Settle it by sharing the mockup or the first build into a real Meet
  call and reading it from another device. Smallest acceptable text size and whether hairlines survive go in the
  ADR. Until then, assume 17–18px body and nothing below 14px.
- **End to end:** the free replay (scripted model) passes with the new fixtures; then one paid replay with
  `--live-models`, **only after asking Amir**, for real timings against today's.
- `npm run check` passes.

## 7. Left to the builder
- Exact component list, names and props within the groups above; which interactions each supports.
- Template list and each template's regions and region layout; how a node names its region.
- The exact theme inputs and palette, and the theme's storage shape (within 4.4).
- The model-facing schema shape for the trimmed ops, within the strict-schema constraint.
- Icon set choice and subset; image sourcing (asking before anything paid); image format and size budget.
- How the build prompt teaches the library to the model compactly (the component table in `build.md` will grow; keep
  it cache-friendly and short).
- The order of work. Suggested: (1) library + theme, (2) templates + app frame, (3) images + icons, (4) op trimming.
  Step 1 is the first one a meeting would notice.
- The ADR (`docs/adr/0014-...`), written and accepted before code.
