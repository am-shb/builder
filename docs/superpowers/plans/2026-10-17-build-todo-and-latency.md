# Builder To-Do List and Build Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changes show up on the stage sooner, and the large mood word next to the robot is replaced by a list of what Builder is doing and what's queued.

**Architecture:** The model port reports each tool call as soon as it is complete (`onToolCall`). The build loop applies patch batches as they arrive, at `effort: "low"`, with a 3 s run floor. The conversation loop forwards hand-offs and voice commands as they arrive. The build loop keeps a per-session task list built from hand-off topics, and the runtime pushes it to the stage as a `tasks` event. The stage renders it where the mood label used to be.

**Tech Stack:** Node 24 with native TypeScript (type stripping, no build), `node:test`, zod v4, `@anthropic-ai/sdk` via OpenRouter, plain ES modules on the stage, headless Chrome browser tests (`test/helpers/stage.ts`).

**Spec:** `docs/adr/0001-build-todo-and-streamed-tool-calls.md` (the decisions), with engine behaviour from `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`.

## Global Constraints

- Never log transcript text, prompts, model output or task text. Log ids, counts, error codes and milliseconds only (AGENTS.md).
- Agreement only comes from people's grounded lines. Model batches stay sanitised to draft (`sanitizeModelBatch`). Nothing here may mark a node agreed.
- The stage renders at 1280x720 at 15 fps on a small CPU. Animate only `transform` and `opacity`, through `animate()` from `@renderer/clock.js`. No blur, shadow or gradient.
- `npm test` and `npm run smoke` must both pass at the end of every task.
- Don't run anything that costs money (`scripts/probe-*.ts`, `npm run replay -- --live-models`, real bots).
- Values: `RUN_FLOOR_MS = 3_000`; build `effort: "low"`; `TASK_DONE_MS = 3_000`; stage shows at most `4` rows; task text is cut to `40` characters, ending in `…` when cut.
- Commit messages end with the attribution lines from the session's system reminder.

## Review Focus

1. **Opus refuses or gets cut off after some batches were drawn.** Those batches stay on screen. The run counts as having applied something, so its tasks tick done. The final `applyResult` must not apply those batches a second time. (Task 2 test: "a refusal after a streamed batch keeps the batch and applies it once".)
2. **Many topics at once (a hand-off with 7 topics, long texts).** The dock shows 4 rows: the "now" rows first, then queued, then done. When rows are hidden, the last visible row reads `+N more`. Long text is cut with `…` on the server and with CSS ellipsis on the stage. (Task 4 and Task 5 tests.)
3. **A hand-off arrives while a run is in flight.** Its tasks stay `queued` until the follow-up run starts, then become `now`. They don't join the current run's tasks. (Task 4 test.)
4. **The stage reconnects mid-run.** The snapshot carries the current tasks, so the list reappears. (Task 4 runtime test.)
5. **A run throws, for example the runtime is unavailable.** Its tasks never stay stuck on "now". They are removed in `finally`. (Task 4 test.)

---

### Task 1: Port reports each tool call as it completes

**Files:**
- Modify: `src/agent/llm.ts` (`RunToolsRequest`, `createOpenRouterPort`, `createFakePort`)
- Test: `test/llm-cost.test.ts`
- Also commit: `docs/adr/0001-build-todo-and-streamed-tool-calls.md`, this plan

**Interfaces:**
- Produces: `RunToolsRequest.onToolCall?: (call: ToolCall) => void`. It is called once per valid tool call, in stream order, as soon as the block closes. Unknown, incomplete, unparseable or invalid blocks are never passed to it. `createFakePort` calls `req.onToolCall?.(call)` for each scripted call, in order, before it resolves.

- [ ] **Step 1: Write the failing tests** in `test/llm-cost.test.ts`, using the existing `sse`, `toolUseStream` and `portWith` helpers. Add a two-block stream helper if you need one.
  - `"port reports each valid tool call through onToolCall as its block closes, before the stream ends"`: a stream with block 0 = `emit {"n":1}`, block 1 = `emit {"n":2}`. Use a `ReadableStream` body so the test controls when the bytes arrive. After sending block 0's `content_block_stop` but before `message_stop`, assert `seen` deep-equals `[{ name: "emit", input: { n: 1 } }]`. After the stream ends, assert `seen.length === 2` and that `r.toolCalls` deep-equals `seen`.
  - `"onToolCall never receives invalid or unknown tool calls"`: blocks `emit {"n":"x"}` and `nope {}`. Assert `seen` is `[]` and exactly two `llm_tool_dropped` logs (each block is dropped and logged once, not twice).
  - `"fake port reports scripted calls through onToolCall before resolving"`: `createFakePort([[a, b]])`. Assert the callback order is `[a, b]` and that it finished before the awaited promise resolved.
- [ ] **Step 2:** Run `node --test test/llm-cost.test.ts`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement.** In `createOpenRouterPort`, move the per-block checks (known tool, closed, JSON parse, `validateToolInput`, the repair log) into one function. Run it at `content_block_stop` and remember each block's outcome, so that it validates and logs once. Fire `onToolCall` for valid ones. The final pass builds `toolCalls` from the stored outcomes. `refusal` and `max_tokens` still return `toolCalls: []` and log `llm_tools_discarded`. Leave a comment that calls already reported have taken effect (see the ADR). Update the existing test "port drops invalid tool input…" only if its log counts change because of the dedupe.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(agent): report each tool call as soon as its block closes`.

### Task 2: Build loop applies batches as they stream, effort low, 3 s floor, timings

**Files:**
- Modify: `src/agent/build-loop.ts`, `src/agent/prompts/build.md`
- Test: `test/build-loop.test.ts`

**Interfaces:**
- Consumes: `RunToolsRequest.onToolCall` (Task 1).
- Produces: `export const RUN_FLOOR_MS = 3_000`. Build calls send `effort: "low"`. The `build.run` log gains `wait_ms` (run start minus when the oldest hand-off in the run arrived), `first_patch_ms` and `last_patch_ms` (from run start to the first and last applied streamed batch, `null` when none applied). `applyResult` no longer applies `apply_patches`. It takes the streamed counts, `{ applied: number; rejected: number }`, and merges them into its counts.

- [ ] **Step 1: Write the failing tests** in `test/build-loop.test.ts`:
  - `"a streamed batch reaches the stage before the model call finishes"`: use a held port (a `runTools` that stores `req` and a resolver). Call `req.onToolCall({ name: "apply_patches", input: <QUICK_ADD batch input> })`, flush, and assert `s.patches().length === 1` while the call is still pending. Then resolve it with the same tool call in `toolCalls` and assert there is still exactly 1 patch (no double apply).
  - `"a refusal after a streamed batch keeps the batch and applies it once"`: stream one valid batch, then resolve with `stopReason: "refusal"` and `toolCalls: []`. Assert 1 patch event and the node present in `s.proto()`.
  - `"build calls use effort low"`: `s.requests[0].effort === "low"`.
  - Rename and adjust the existing `"10s floor between runs; resolvedChoice bypasses it"` to `"3s floor between runs; resolvedChoice bypasses it"`, with the advances scaled to 3 000 ms (`1_000`, then `1_500` = no run yet, then `500` = run).
  - `"build.run logs wait_ms, first_patch_ms and last_patch_ms"`: fake timers. Hand off, run with one streamed batch, and assert the three fields are numbers and `first_patch_ms <= last_patch_ms`. A run with zero batches logs `first_patch_ms: null`.
  - Fix any existing test whose timing assumed the 10 s floor (`advance(10_000)` can stay where it only needs to be ≥ the floor).
- [ ] **Step 2:** Run `node --test test/build-loop.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `run()`, pass an `onToolCall` that, for `apply_patches`, does what `applyResult` used to do per batch: `ToolPatchBatch.safeParse`, then `rt.applyBatch(sanitizeModelBatch(fromToolBatch(…), view(rt).doc))`, with the same `build.batch_rejected` logs. It counts applied and rejected, records the times, and after each applied batch clears the pending region (`live.pendingRegion(null)`, `region = false`, so the next add can show a new placeholder). Record the hand-off arrival time on `SessionState` (`pendingSince`, keep the earliest across merges). Set `effort: "low"`.
- [ ] **Step 4: Update `prompts/build.md`.** Next to the existing line about applying all batches first (line 23), add: each `apply_patches` batch appears on screen as soon as you finish writing it, so call `apply_patches` before `update_consensus`, put the most visible change first, and keep batches small. Keep line 23's guarantee that consensus ops apply after every batch.
- [ ] **Step 5:** Run `npm test && npm run smoke`. Expected: PASS.
- [ ] **Step 6:** Commit: `perf(build): apply patch batches as they stream; effort low; 3s run floor`.

### Task 3: Conversation loop forwards hand-offs and commands as they stream

**Files:**
- Modify: `src/agent/conversation-loop.ts`
- Test: `test/conversation-loop.test.ts`

**Interfaces:**
- Consumes: `RunToolsRequest.onToolCall` (Task 1).
- Produces: `update_build` and `ui_command` take effect when their call arrives. `apply()` skips calls already handled (track them per turn in a `Set<ToolCall>` by identity). `speak` still runs after the turn. `conversation.turn` gains `queued_ms` (turn start minus the arrival of the earliest utterance not yet seen by a turn, `null` for non-utterance triggers) and `handoff_ms` (turn start to the first forwarded hand-off, `null` if none).

- [ ] **Step 1: Write the failing tests** in `test/conversation-loop.test.ts`, using `heldPort()`:
  - `"a streamed update_build reaches the build loop before the turn ends"`: `s.say(...)`, then `calls[0].req.onToolCall!(updateBuild(handoff([id])))` and flush. Assert `s.handoffs.length === 1` while the call is held. Release with the same call in `toolCalls` and assert `s.handoffs.length` is still 1.
  - `"a streamed ui_command runs before the turn ends, once"`: use the `uiCommand` option counting calls. Stream one `ui_command` and assert the count is 1 before release and still 1 after.
  - `"speak still waits for the end of the turn and the gate"`: stream a `speak` call through `onToolCall` and assert `s.said` is empty until release.
  - `"conversation.turn logs queued_ms and handoff_ms"`: advance the clock 700 ms between `say` and the turn starting (hold a prior turn to queue it), and assert `queued_ms >= 700` and `handoff_ms` is a number.
- [ ] **Step 2:** Run `node --test test/conversation-loop.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `onToolCall` in `modelTurn`, reusing `forwardHandoff` and `runCommand` unchanged, plus the per-turn handled set and the two timings. Track `waitingSince: number | null` on `SessionState`: set it in `onUtterance` when null, and clear it when a turn starts.
- [ ] **Step 4:** Run `npm test && npm run smoke`. Expected: PASS.
- [ ] **Step 5:** Commit: `perf(conversation): forward hand-offs and voice commands as they stream`.

### Task 4: The task list (server side)

**Files:**
- Modify: `src/agent/handoff.ts` (`Topic`), `src/stage/channel.ts` (`StageEvent`, `BuildTask`), `src/session/runtime.ts` (`setTasks`, snapshot), `src/agent/build-loop.ts` (task lifecycle), `src/session/script.ts` (a `tasks` step), `src/agent/prompts/conversation.md`
- Test: `test/build-loop.test.ts`, `test/runtime.test.ts`

**Interfaces:**
- Consumes: Task 2's streamed counts (`applied`) to decide done versus dropped.
- Produces:
  - `Topic.task: z.string().optional()`. The wire schema is unchanged otherwise.
  - In `src/stage/channel.ts`: `export type BuildTask = { id: string; text: string; state: "now" | "queued" | "done" }`. The `StageEvent` union gains `| { type: "tasks"; tasks: BuildTask[] }`, and the snapshot gains `tasks: BuildTask[]`.
  - `SessionRuntime.setTasks(tasks: BuildTask[]): void` stores the tasks and sends `{ type: "tasks", tasks }`. `snapshot()` includes them (empty at start, not persisted).
  - In `build-loop.ts`: `export const TASK_DONE_MS = 3_000` and `export function taskText(t: Topic): string` (`(t.task?.trim() || t.title).trim()`, cut to 40 characters with a trailing `…` when longer).
  - Script step `tasks: BuildTask[]` calls `rt.setTasks`. The zod schema mirrors `BuildTask`.
- Lifecycle, all through `timers` and `clock`:
  - When a hand-off arrives, append one `queued` task per topic, with id `t<n>` (a per-session counter), and push the list.
  - When a run starts, that run's tasks (the ones merged into `st.pending`) become `now`.
  - When the run ends: if it applied any batch or any consensus op, its tasks become `done` and a `TASK_DONE_MS` timer removes them. Otherwise they are removed at once. Do this in `finally`, so a throw also removes them. Push on every change. Order is `now`, `queued`, `done`.

- [ ] **Step 1: Write the failing tests.**
  - build-loop: `"hand-off topics show as queued, then now during the run, then done and gone after 3s"`. Use a held port. Assert the latest `tasks` event goes through `queued`, then `now`, then `done`. After `advance(3_000)`, it's `[]`. Task text comes from `task` when present.
  - build-loop: `"task text falls back to the topic title and is cut to 40 characters"`, for both `taskText` cases (a 60-character title gives 40 characters ending in `…`).
  - build-loop: `"a hand-off during a run stays queued until the follow-up run"`. The first run's tasks are `now`, the second hand-off's tasks are `queued`. After release and the floor, the second's become `now`.
  - build-loop: `"a run that applies nothing removes its tasks at once, without done"`. Resolve with zero calls, and the next `tasks` event has none of them and no `done` state.
  - build-loop: `"a throwing run leaves no task stuck on now"`. Use `faults.runtime` as in the existing wedge test, and assert the last pushed list has no `now`.
  - runtime: `"setTasks pushes a tasks event and the snapshot carries the list"`.
  - Update existing snapshot equality assertions (`test/runtime.test.ts`, `test/integration.test.ts`, the e2e replay) for the new `tasks` field, only where they fail.
- [ ] **Step 2:** Run `node --test test/build-loop.test.ts test/runtime.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. Log only counts (`build.tasks`, `{ session_id, now, queued, done }`), never the text.
- [ ] **Step 4: Update `prompts/conversation.md`**, in the `update_build` section: give every topic a `task`, at most 5 words in present tense, saying what Builder will do on screen, for example "Adding the buttons" or "Moving search to the top". The room sees it in Builder's to-do list.
- [ ] **Step 5:** Run `npm test && npm run smoke`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(build): per-session to-do list from hand-off topics, pushed to the stage`.

### Task 5: Stage shows the to-do list in place of the mood word

**Files:**
- Create: `public/renderer/todo.js`
- Modify: `public/renderer/character.js` (remove the label), `public/stage.html` (markup, CSS, the `tasks` and snapshot handling)
- Test: create `test/todo-browser.test.ts`, modify `test/character-browser.test.ts`

**Interfaces:**
- Consumes: the `tasks` StageEvent and `snapshot.tasks` (Task 4). Script steps `{ tasks: [...] }` drive the browser tests.
- Produces:
  - `export const MAX_ROWS = 4` and `export function renderTodo(el, tasks)` in `todo.js`. It sorts `now`, `queued`, `done`. It shows at most `MAX_ROWS` rows. When more exist, the last row becomes `+N more` (class `more`), where N is the number hidden. It reuses `li` elements keyed by task id (`data-id`). New rows fade and slide in over `ENTER_MS` and removed rows fade out over `EXIT_MS` (both from `motion.js`, opacity and transform only). Row classes are `now`, `queued` and `done`.
  - `character.js` no longer builds a `.bot-label` and has no `MOOD_LABELS`. `setPlacement` moves only the bot.
  - `stage.html`: add `<ul id="todo">` as a later sibling of `#builder`. Placement follows the `#builder[data-placement=…] ~ #todo` pattern. Dock: the old label's spot (`left 916px; top 572px; width 224px`), rows in 17px/600 weight, with `now` rows at 19px/800 in `--ink` and a ring marker in `#5ee6a8`, `queued` rows in `--muted`, and `done` rows in `--agreed` with a filled dot and a strike line, as in mockup A. Centre: under the robot (`left 240px; top 477px; width 420px; text-align center`), showing only `now` rows. Corner (comparing): hidden. Rows are one line, `white-space: nowrap; text-overflow: ellipsis`.

- [ ] **Step 1: Write the failing browser tests** in `test/todo-browser.test.ts`, using `withStage`, with sleeps no longer than 600 ms:
  - `"tasks render in the dock: now first, then queued, then done"`. Script a batch so the robot docks, then `tasks` in mixed order. Assert the `#todo li` classes are `["now", "queued", "done"]` and the texts match.
  - `"more than 4 tasks shows 3 rows and +N more"`. Use 6 tasks and assert 4 `li` elements, the last with text `+3 more`.
  - `"a removed task leaves the list"`. Send `[a, b]`, then `[b]`, and wait until `#todo li[data-id=a]` is gone.
  - `"before anything is built, only now rows show under the robot"`. Placement center, `[now, queued]`, and only the `now` row is visible (`getClientRects().length > 0`).
  - `"the snapshot restores the list on reconnect"`. `rt.setTasks([...])` before the page loads, or reload, and assert the rows are present.
  - In `character-browser.test.ts`: drop the `labels` checks from `"each mood sets data-mood and distinct computed styles"`, keep the seven-distinct-looks assertion, and add `assert.equal(await page.eval("document.querySelectorAll('.bot-label').length"), 0)`.
- [ ] **Step 2:** Run `node --test test/todo-browser.test.ts test/character-browser.test.ts`. Expected: FAIL. If Chrome is unavailable these tests skip, so make sure a local Chrome is found (`test/helpers/chrome.ts`).
- [ ] **Step 3: Implement** `todo.js`, the `character.js` removal, and the `stage.html` markup, CSS and event handling (`case "tasks"` calls `renderTodo`, and the snapshot calls it with `ev.tasks ?? []`).
- [ ] **Step 4:** Run `npm test && npm run smoke`. Expected: PASS, with the browser tests actually running rather than skipped.
- [ ] **Step 5:** Commit: `feat(stage): Builder's to-do list replaces the mood word`.
