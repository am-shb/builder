# Demo readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spoken A/B picks resolve every time, narrow what the build model can draw to 15 components with no templates, and prove a 4-person Maple Café script comes out right 3 replays in a row, then hand Amir the script.

**Architecture:** Picks get three layers: a tolerant `resolvedChoice` parser, a deterministic spoken-pick path in the conversation loop that hands off a grounded pick straight to the build loop's `resolveChoice`, and pickers recorded in `agreedBy`. The catalog gains an `OFFERED_TYPES` list that drives the prompt and the model-facing schema; `fromToolBatch` drops unoffered adds and template/region props. A local-mode replay with `waitFor` and a `demo-run` script drive live runs and screenshot each beat.

**Tech Stack:** Node 24 type stripping, TypeScript (check only), zod v4, `node:test`, headless Chrome via `test/helpers/chrome.ts`, OpenRouter models (Haiku 5.5 conversation, Sonnet 5.5 build).

**Spec:** `docs/superpowers/specs/2026-10-23-demo-readiness-design.md`

## Global Constraints

- Deadline: submission closes Oct 25, 11:59 PM ET. Video at most 2 minutes.
- Model spend on live runs: up to **$10** total; a run is about $0.40. Keep a running total; stop and ask Amir at $10.
- Never log transcript text, prompts or model output. Log ids, counts and error codes only.
- Agreement only from lines people spoke (spec §4, §9, §12). Builder's own lines never ground anything.
- No demo-only behavior: nothing café-specific in engine code or prompts.
- Erasable TypeScript only (no enums, namespaces, parameter properties). `npm run check` passes after every task.
- Offered types (exactly these 15): App, Screen, PageHeader, Card, Grid, StatCard, ChartCard, Table, List, ListItem, ProductCard, Image, Badge, Text, Button.
- Run engine commands from `apps/engine` unless a step says otherwise. Single test file: `node --test test/<file>.test.ts`.
- Commit messages end with the attribution lines from the session's system reminder.

## Review Focus

- A line that mentions a label without picking ("B pushes sales down", "show option B", "can we see B") must not resolve anything. Task 3.
- A pick spoken when no comparison is on screen, or by Builder itself, must do nothing. Task 3.
- A bare-label `resolvedChoice` ("B") while two conflicts are open is ambiguous and must be dropped, not applied to either. Task 1.
- An unoffered parent with children added under it in the same batch: parent and children are dropped, the batch's other ops still apply. Task 4.
- A stored session that already uses a template and old types must still render as before. Task 4.

---

### Task 1: Accept `resolvedChoice` in the shapes models write

**Files:**
- Modify: `src/agent/handoff.ts:22-45` (Topic schema, HandoffToolInput preprocess)
- Modify: `src/agent/build-loop.ts:302-345` (`resolveChoice`)
- Test: `test/handoff.test.ts`, `test/build-loop.test.ts`

**Interfaces:**
- Produces: `normalizeResolvedChoice(v: unknown): unknown` exported from `src/agent/handoff.ts`, applied inside `HandoffToolInput`'s preprocess to every topic's `resolvedChoice`. Output for a recognised shape is `{ conflictId: string, winner: "A"|"B"|"C" }`, where `conflictId` is `"*"` when the model gave only a label.
- Produces: `resolveChoice` treats `conflictId: "*"` (or an id that names no conflict) as "the only open conflict"; with zero or 2+ open conflicts it logs `build.resolve_ambiguous` and returns `{ kind: "ignored" }`.

- [ ] **Step 1: Write the failing tests** in `test/handoff.test.ts`, `describe("normalizeResolvedChoice")`:
  - `'{"conflictId":"c-top","winner":"B"}'` (a JSON string) → `{ conflictId: "c-top", winner: "B" }`
  - `"B"`, `"b"`, `"option B"`, `"Option b"` → `{ conflictId: "*", winner: "B" }`
  - `{ conflictId: "c-top", winner: "b" }` → winner `"B"`
  - `{ conflictId: "c-top", label: "B" }` → `{ conflictId: "c-top", winner: "B" }`
  - `"D"`, `42`, `{ winner: "B" }` without an id → `{ conflictId: "*", winner: "B" }` for the last; the first two are returned unchanged (and then fail validation)
  - `HandoffToolInput.safeParse` of a hand-off whose topic has `resolvedChoice: "B"` succeeds.
- [ ] **Step 2: Write the failing tests** in `test/build-loop.test.ts`: with one open conflict `c-top`, a hand-off with `resolvedChoice: { conflictId: "*", winner: "B" }` grounded in a real line merges B (doc has decision `d-c-top`, status agreed). With two open conflicts, the same hand-off merges nothing and both stay open.
- [ ] **Step 3: Run** `node --test test/handoff.test.ts test/build-loop.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 4: Implement** `normalizeResolvedChoice` and wire it into the existing `hoistRequestedView` preprocess (one preprocess function that does both). In `resolveChoice`, map `"*"`/unknown ids to the single open conflict before `rt.resolveComparison`. Log `build.resolve_ambiguous` with `{ session_id, open: <count> }` only.
- [ ] **Step 5: Run** the two test files, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `fix(engine): a pick written as a label or a JSON string still resolves`.

### Task 2: People who pick are recorded as agreeing

**Files:**
- Modify: `src/consensus/doc.ts:124-150` (`resolveConflict`)
- Modify: `src/session/runtime.ts:245-268` (`resolveComparison`)
- Modify: `src/agent/build-loop.ts` (`resolveChoice` passes speakers)
- Test: `test/consensus.test.ts`, `test/build-loop.test.ts`

**Interfaces:**
- Produces: `resolveConflict(doc, conflictId, winner, now, pickers: string[] = [])`. The decision's `agreedBy` is the winner's backers followed by pickers not already in it, in order. `proposedBy` stays `backers[0]`, else `pickers[0]`, else `"Unknown"`.
- Produces: `runtime.resolveComparison(conflictId, winner, pickers: string[] = [])` passes pickers through.
- Consumes: `groundingFor(stored, groundingIds).speakers` in `resolveChoice` (already computed) as `pickers`.

- [ ] **Step 1: Write the failing test** in `test/consensus.test.ts`: variant B backed by `["Omid Omidi"]`, `resolveConflict(doc, "c-top", "B", 1, ["Mohammad Amin Shamshiri", "Omid Omidi", "Amir Shahbandegan"])` → `agreedBy` deep-equals `["Omid Omidi", "Mohammad Amin Shamshiri", "Amir Shahbandegan"]`, `proposedBy` `"Omid Omidi"`. With no backers and pickers `["Amir Shahbandegan"]`, `proposedBy` is `"Amir Shahbandegan"`.
- [ ] **Step 2: Write the failing test** in `test/build-loop.test.ts`: a pick grounded in a line by `"Mohammad Amin Shamshiri"` (not a backer) leaves `d-<conflict>.agreedBy` containing that name.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement** the parameter in all three places.
- [ ] **Step 5: Run** both files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(engine): the people who pick an option are recorded as agreeing`.

### Task 3: A spoken pick resolves the comparison on screen

**Files:**
- Create: `src/agent/spoken-pick.ts`
- Modify: `src/agent/conversation-loop.ts:563-590` (`onUtterance`)
- Test: `test/spoken-pick.test.ts` (new), `test/conversation-loop.test.ts`

**Interfaces:**
- Produces: `matchSpokenPick(text: string, labels: readonly string[]): "A" | "B" | "C" | null` in `src/agent/spoken-pick.ts`. Pure; returns a label only if it is in `labels`.
- Consumes: `runtime(sessionId).snapshot().comparison` (`{ conflictId, variants: [{ label }] } | null`) and `buildLoop.handoff(sessionId, Handoff)`.
- Produces: on a match, `onUtterance` calls `buildLoop.handoff(sessionId, { topics: [{ title: "Pick", task: "Merging option <L>", proposals: [], questionsRaised: [], resolvedChoice: { conflictId, winner: L } }], mood: "converging", groundingIds: [u.id] })` and logs `conversation.spoken_pick` with `{ session_id, conflict_id, winner }`. Then it continues as today (the line still goes to the model turn).

- [ ] **Step 1: Write the failing tests** in `test/spoken-pick.test.ts` with labels `["A", "B"]`:
  - picks B: `"B"`, `"B."`, `"b"`, `"bee"`, `"Option B."`, `"Let's go with B"`, `"I'd go with B. Regulars pay the bills."`, `"let's do b"`, `"B it is"`, `"Agreed, B it is. But keep the special below."`, `"I pick B"`, `"option B please"`, `"B is better"`, `"I think b is actually better so let's go with b"`
  - null: `"B pushes sales down"`, `"show option B"`, `"can we see B"`, `"what does B look like"`, `"maybe"`, `"be careful"`, `"I'd go with C"` (C not in labels), `"A or B?"`, `"go with A, no wait, B"` (two labels picked → null)
- [ ] **Step 2: Run** `node --test test/spoken-pick.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `matchSpokenPick`. Approach: lowercase, strip punctuation; return null if the text has a look verb before the label (`show|see|look|view`) or ends in `?`; whole-utterance label (`a|b|c|bee` → B; `option x`) or one of the pick phrases `go with X`, `do X`, `X it is`, `pick X`, `choose X`, `option X please`, `X is better`, `vote X`; null if pick phrases name two different labels.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Write the failing tests** in `test/conversation-loop.test.ts`: with a runtime whose snapshot has comparison `{ conflictId: "c-top", variants: [A, B] }`, `onUtterance(sid, { id: 7, speaker: "Omid Omidi", text: "let's go with B" })` calls the fake `buildLoop.handoff` once with `resolvedChoice { conflictId: "c-top", winner: "B" }` and `groundingIds: [7]`. No call when comparison is null, when the speaker is the bot's name, or for `"show option B"`.
- [ ] **Step 6: Run** the file. Expected: FAIL.
- [ ] **Step 7: Implement** the hook in `onUtterance`, inside `guard`, after `pushLine`. Wrap `runtime(sessionId).snapshot()` in the existing try style so a runtime error logs and does not stop the turn.
- [ ] **Step 8: Run** `node --test test/conversation-loop.test.ts test/build-loop.test.ts` and `npm run typecheck`. Expected: PASS. Add a test to `test/build-loop.test.ts`: the spoken-pick hand-off followed by a model hand-off carrying the same pick leaves exactly one `d-<conflict>` decision and sends one `resolve` stage event.
- [ ] **Step 9: Commit** `feat(engine): a spoken pick resolves the comparison on screen`.

### Task 4: Offer the model 15 components and no templates

**Files:**
- Modify: `public/renderer/catalog.js` (add `OFFERED_TYPES`)
- Modify: `src/ui/schema.ts:200-206` (`patchBatchJsonSchema`)
- Modify: `src/ui/tree.ts:237-292` (`fromToolBatch`)
- Modify: `src/agent/build-loop.ts` (`prepareBatch`, conflict variant prep in `src/agent/handoff.ts:255`, `build.run` log)
- Modify: `src/agent/prompt-catalog.ts` (`componentTable`, `buildSystemPrompt`)
- Modify: `src/agent/prompts/build.md` (remove "Screens, templates and the app frame" template parts and `{{TEMPLATES}}`; add layout rules)
- Create: `docs/adr/0017-narrow-component-offer.md`
- Test: `test/catalog-unit.test.ts`, `test/ui-tree.test.ts`, `test/prompt.test.ts`, `test/build-loop.test.ts`

**Interfaces:**
- Produces: `export const OFFERED_TYPES` in `catalog.js`: the 15 types in the Global Constraints, in catalog order. `export const OFFERED_PROPS_OMIT = { Screen: ["template"] }`.
- Produces: `fromToolBatch(...)` returns `{ batch, dropped, unoffered }`. An `add` of a type not in `OFFERED_TYPES` is skipped and its id remembered; later `add`s whose `parentId` is a skipped id are skipped too; each skip counts 1 in `unoffered`. `region` (any type) and Screen `template` props are removed and counted in `dropped`. Updates to existing nodes of old types are unchanged.
- Produces: `patchBatchJsonSchema()` lists only `OFFERED_TYPES` in the node `type` enum. The local zod `ToolNode` still accepts every catalog type (so unoffered adds reach `fromToolBatch` instead of failing the call).
- Produces: `build.run` log gains `ops_unoffered: <n>`.

- [ ] **Step 1: Write the failing tests**:
  - `test/catalog-unit.test.ts`: `OFFERED_TYPES` deep-equals the 15 names; every one is in `COMPONENT_TYPES`.
  - `test/ui-tree.test.ts`: a tool batch adding `home.menu` (Grid), `home.h` (Heading) and `home.h.x` (Text, parent `home.h`), and a Screen update with `template: "dashboard"` and a Card with `region: "main"` → batch keeps the Grid add and the Card add without `region`; the Screen update has no `template`; `unoffered === 2`.
  - `test/ui-tree.test.ts`: `patchBatchJsonSchema()`'s node type enum deep-equals `OFFERED_TYPES`.
  - `test/prompt.test.ts`: `buildSystemPrompt()` contains `` `ProductCard` `` and not `` `Kanban` ``, `template`, or `region`.
  - `test/build-loop.test.ts`: a scripted build turn whose `add_conflict` variant B includes one `Heading` add still produces a conflict with variant B minus that op.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement** the catalog list, `fromToolBatch` filtering, schema enum, prompt table over `OFFERED_TYPES` (and App/Screen rows without omitted props), the region note line removed, `{{TEMPLATES}}` and its section removed from `build.md`.
- [ ] **Step 4: Edit `build.md`** layout guidance (replace the template paragraphs) with these rules, verbatim in substance:
  - A Screen's children stack top to bottom in the order you add them. To put things side by side, use a `Grid` with `columns` 2 or 3.
  - A phone app is `device: "phone"` on the App. On a phone, a menu or catalogue is a `Grid` with `columns: "2"` of `ProductCard`s; everything else stacks.
  - A page's title is a `PageHeader` as the Screen's first child.
  - A personal shortcut ("your usual", "continue where you left off") is a `Card` holding a `ListItem` with an image or avatar, and a `Button`.
  - Also delete guidance that mentions dropped types (e.g. "When you fill a tab, set the `Tabs` `active`", `Hero`/`MediaCard`/`Image` in the images paragraph keeps only `Image` and `ProductCard`).
- [ ] **Step 5: Write ADR 0017** from `docs/adr/0000-template.md`: context (session evidence from the spec's "Why"), decision (offered list, no templates/regions for new work, unoffered adds dropped per op, renderer unchanged for stored trees), consequences, how to widen (add a type to `OFFERED_TYPES` and its guidance).
- [ ] **Step 6: Run** `npm run check` from the repo root. Expected: PASS. Existing tests that asserted a template or an old type in the prompt or tool schema are updated to the new behavior, not deleted.
- [ ] **Step 7: Commit** `feat(engine): offer the build model 15 components and no templates (ADR 0017)`.

### Task 5: A 2-column Grid stays 2 columns on a phone

**Files:**
- Modify: `public/renderer/theme.css:157-159`
- Test: `test/design-browser.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing browser test**: render an App with `device: "phone"`, a Screen with a `Grid` `columns: "2"` holding 4 `ProductCard`s and a `Grid` `columns: "3"` holding 3 `StatCard`s. Assert the first two ProductCards have the same `offsetTop` and different `offsetLeft`, and the 3-column Grid's children each have a different `offsetTop`.
- [ ] **Step 2: Run** `node --test test/design-browser.test.ts`. Expected: FAIL on the 2-column assertion.
- [ ] **Step 3: Change the rule** so `.b-grid.is-cols-2` inside `.b-phone` keeps `repeat(2, minmax(0, 1fr))`; other grids and `.b-split` still collapse to one column.
- [ ] **Step 4: Run** the browser test file and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): a 2-column grid stays two columns on a phone`.

### Task 6: Options are the positions people took

**Files:**
- Modify: `src/agent/prompts/build.md` ("Disagreements and side-by-side variants")
- Test: `test/prompt.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**: `buildSystemPrompt()` contains `"one participant's stated position"` and `"never invent"`.
- [ ] **Step 2: Run** `node --test test/prompt.test.ts`. Expected: FAIL.
- [ ] **Step 3: Edit** the section: each variant is one participant's stated position; its `summary` starts with what that person wants, in their words, then the tradeoff ("Order again on top, with your usual: regulars reorder in one tap, the special gets less space"); `backers` are the people who argued for it; never invent a position nobody stated as an option; one stated position is a proposal, not a conflict; record the conflict in the same turn the second position is heard.
- [ ] **Step 4: Run** the test and `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(engine): side-by-side options are the positions people stated`.

### Task 7: Local replay that waits for the stage, the Maple Café fixture, and a run script

**Files:**
- Modify: `scripts/replay.ts`
- Create: `test/fixtures/sessions/maple-cafe.json`
- Create: `scripts/demo-run.ts`
- Test: `test/e2e-replay.test.ts`

**Interfaces:**
- Produces: `FixtureUtterance` gains `waitFor?: "comparison" | "no-comparison"` and `shot?: string`. `ReplayOptions` gains `local?: boolean`, `stateUrl?: string`, `onShot?: (name: string) => Promise<void>`, `waitTimeoutMs?: number` (default 45 000).
- Produces: with `local`, each event posts `{ kind, speaker, text }` to `POST /api/sessions/<id>/speech` (no signature). With `waitFor`, before posting that line, poll `stateUrl` every 500 ms until `comparison` is non-null (or null), else throw `waitFor <x> timed out`. After posting a line with `shot`, wait 8 s scripted time (divided by speed) then call `onShot(shot)`.
- Produces: `node scripts/demo-run.ts [--runs n] [--out dir]` (default 1 run, out `../../.superpowers/demo-runs/<timestamp>`): spawns `node src/server.ts --local` on a free port with `TTS_VOICE=` (empty, no TTS spend), captures its stdout JSON log lines, creates a session with `POST /api/local/sessions`, opens `stage_url` in headless Chrome at 1280×720 (`withChrome` from `test/helpers/chrome.ts`), replays `maple-cafe.json` with `local: true`, screenshots `<shot>.png` per beat and `handoff.png` from `handoff_url`, then writes `report.json`: `{ cost_usd, llm_tool_dropped, build_runs, ops_unoffered, spoken_picks, comparisons_resolved }` (counts from log lines; cost from `GET /api/sessions/<id>/cost`). Prints only counts and paths.
- Fixture (speaker names exactly as in Meet): participants `Amir Shahbandegan`, `Amin Fadaeinejad`, `Omid Omidi`, `Mohammad Amin Shamshiri`. Lines (t in ms; adjust spacing in Task 8 only):

| t | speaker | text | extra |
|---|---|---|---|
| 6000 | Amir Shahbandegan | Hey Builder, we're designing the mobile ordering app for Maple Café, our coffee chain. | |
| 11000 | Amir Shahbandegan | The home screen shows today's menu as photo cards with prices: oat latte, butter croissant, breakfast plate and a grain bowl. | |
| 18000 | Mohammad Amin Shamshiri | Make it a phone app, with the Maple Café name at the top. | shot: beat1 |
| 32000 | Amin Fadaeinejad | The top of the home screen should sell our fall special, the maple latte. It has double the margin of anything else. | |
| 39000 | Omid Omidi | I disagree. Sixty eight percent of our orders are repeat orders. The top should be Order again, with your usual and a one tap reorder button. | |
| 47000 | Amin Fadaeinejad | But nobody finds the special if it's buried. | shot: beat2 |
| 60000 | Mohammad Amin Shamshiri | Looking at both, I'd go with B. Regulars pay the bills, and one tap is faster in the morning rush. | waitFor: comparison |
| 66000 | Amir Shahbandegan | Agreed, B it is. But keep the fall special as a smaller card just below it. | |
| 73000 | Amin Fadaeinejad | Fine by me, as long as the special stays above the menu. | shot: beat3 |
| 84000 | Amir Shahbandegan | That's the plan. Thanks Builder. | |

  `tailMs: 15000`.

- [ ] **Step 1: Write the failing test** in `test/e2e-replay.test.ts`: replay with `local: true` against the app in local mode with the routed fake port posts to `/speech` (event count matches); a line with `waitFor: "comparison"` and a `stateUrl` that returns `comparison: null` twice then a comparison posts after the third poll (fake fetch or a tiny test server); timeout throws.
- [ ] **Step 2: Run** `node --test test/e2e-replay.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the replay options and CLI flags `--local` and `--state-url`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Add** `maple-cafe.json` and `scripts/demo-run.ts`. Smoke it without models: run `OPENROUTER_API_KEY= node scripts/demo-run.ts` and confirm it boots, replays, writes screenshots of an empty stage and a `report.json` with `cost_usd: 0`, then exits and kills the server.
- [ ] **Step 6: Run** `npm run check` from the repo root. Expected: PASS.
- [ ] **Step 7: Commit** `test(engine): Maple Café replay fixture and a demo run script`.

### Task 8: Live runs until three in a row pass

**Files:**
- Modify as the evidence requires: `test/fixtures/sessions/maple-cafe.json`, `src/agent/prompts/*.md`, engine code (each code fix gets its own failing test first, per superpowers:systematic-debugging)
- Output (not committed): `.superpowers/demo-runs/<timestamp>/`

**Interfaces:** consumes `scripts/demo-run.ts` from Task 7.

- [ ] **Step 1: Ask Amir before the first live run** (AGENTS.md: anything that costs money). Approved budget is $10; state the running total each time.
- [ ] **Step 2: Run** `node scripts/demo-run.ts`. Read `report.json` and the four screenshots.
- [ ] **Step 3: Judge the run** against the pass criteria:
  - `beat1.png`: phone frame, header with Maple Café, a 2-column grid of photo ProductCards with prices; nothing overlapping, cut off or empty.
  - `beat2.png`: comparison with two options; one is the fall special on top, the other is Order again on top; backers are Amin and Omid respectively.
  - `beat3.png`: B merged into the prototype, a smaller fall-special card below it, menu below that.
  - `handoff.png`: decisions listed; the B decision names Omid as proposer and Mohammad Amin and Amir as agreeing; the rejected option is the special-first one.
  - `report.json`: `llm_tool_dropped: 0`, `comparisons_resolved: 1`.
- [ ] **Step 4: If a run fails**, find the cause before changing anything (superpowers:systematic-debugging). The known open cause: conversation turns ending in `incomplete_input` with `stop_reason: null` (production session `986df5c5`, 23:14:34–23:15:12). Check, in this order, whether a newer turn aborts the stream, whether the OpenRouter stream ends without `message_stop`, and whether the 2048 `max_tokens` for the conversation loop is hit by a long `update_build`. Write a failing test that reproduces the cause with a fake port, fix it, commit `fix(engine): <cause>`.
- [ ] **Step 5: Script wording** may change (clearer lines, spacing), but not the beats, roles or the pick line's form. A change to the fixture is committed with the run's evidence summarised in the message (counts only).
- [ ] **Step 6: Repeat** Steps 2–5 until 3 consecutive runs pass, or the spend reaches $10 (then stop and report to Amir with the screenshots and what still fails).
- [ ] **Step 7: Run** `npm run check` from the repo root. Expected: PASS.

### Task 9: The script Amir records from

**Files:**
- Create: `docs/demo/maple-cafe-script.md`
- Create: `docs/demo/screens/beat1.png`, `beat2.png`, `beat3.png`, `handoff.png` (from the last passing run)

**Interfaces:** consumes the final `maple-cafe.json` (the script's lines must match it word for word).

- [ ] **Step 1: Write** the script doc with these sections: who plays whom (table from the spec); the lines in order with speaker, target time and "on screen after this" (with the screenshot beside each beat); delivery notes (one speaker at a time; leave a beat after each line; say the pick only once both options are on screen; say "B" clearly, as its own word; if Builder misses a line, repeat it once word for word; Builder's "So: B. Everyone OK?" is answered by Amin's line); before recording (deploy `main` after merge, start a session from the web app or `POST /v1/sessions`, open the handoff link from the session page for the last shot); the 2-minute cut (which seconds of the meeting to keep, ~20 s for voiceover).
- [ ] **Step 2: Verify** every line in the doc equals the fixture's text: `node -e` one-liner or a quick grep per line. Expected: all match.
- [ ] **Step 3: Commit** `docs(demo): the Maple Café script and what each beat should look like`.
- [ ] **Step 4: Open the PRs** (use the PR template), split as: (a) Tasks 1–3, (b) Tasks 4–5 with ADR 0017, (c) Task 6, (d) Tasks 7–9. Base each on `main`, not on each other (memory: stacked PRs miss main); if one depends on another, say so in the description and merge in order.
