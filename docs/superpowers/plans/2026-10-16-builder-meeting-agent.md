# Builder Meeting Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Recall.ai feasibility app into **Builder**. Builder facilitates a Google Meet prototype session, builds an agreed prototype live on its shared screen (with personality and clear focus on changes), speaks when it should, and produces an engineer handoff.

**Architecture:** The existing Node backend gains four areas:
- **Prototype engine:** a component-tree schema plus atomic patch application (`src/ui`).
- **Consensus document:** an agreement state machine (`src/consensus`).
- **Session runtime:** pushes state to the stage over a WebSocket (`src/session`, `src/stage`).
- **Two model loops:** Haiku for conversation and Opus for the build (`src/agent`), plus a TTS voice (`src/voice`).

Browser rendering lives in plain ES modules under `public/renderer/`. The stage, the handoff page and the self-contained export share them. Milestone 1 is fully demoable with scripted fixtures and no models.

**Tech Stack:** Node ≥24 running TypeScript natively (type stripping; no build step), `node:sqlite`, `node:test`. New dependencies: `@anthropic-ai/sdk`, `zod`, `ws`. Browser: vanilla ES modules plus an import map; Web Audio `AudioWorklet` for voice playback. Headless Chrome via CDP for renderer tests.

**Spec:** `docs/superpowers/specs/2026-10-16-meeting-prototype-agent-design.md`

## Global Constraints

- **Character and bot name:** "Builder". The Meet display name is `Builder`, and it's addressed as "Builder" or "hey Builder".
- **Provider:** everything goes through **OpenRouter** with one `OPENROUTER_API_KEY`.
- **Models:**
  - Conversation loop: `anthropic/claude-haiku-5.5`, starting at effort `low`.
  - Build loop: `anthropic/claude-opus-5.5`, effort `medium`, with OpenRouter `fallbacks` set to `["anthropic/claude-opus-5"]`.
  - Never use `tool_choice` `any`/`tool` (a 400 on these models); use `auto` plus `strict: true` tools.
- **SDK usage:**
  - Use the official `@anthropic-ai/sdk`, pointed at OpenRouter's Anthropic-format endpoint: `baseURL: "https://openrouter.ai/api"`, so requests go to `/api/v1/messages`, with the key as `authToken`.
  - Before writing any SDK call, load the `claude-api` skill (TypeScript) for exact signatures, and check OpenRouter's Messages reference (`https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message`) for supported fields.
  - Don't write SDK shapes from memory.
- **TTS:** `elevenlabs/eleven-v4-turbo` via OpenRouter `POST /api/v1/audio/speech` with `response_format: "pcm"`. Audio streams back; the whole line is sent per request. It sits behind a `TtsProvider` interface, swappable for direct ElevenLabs or Cartesia Sonic 3.6. The key stays in the backend only.
- **Recall:** workspace Meet2Build, region `us-west-2`, API v1.11. Bot variant default is `web_4_core`. Output Media is 1280×720 at 15 fps. Never set `recording_config.include_bot_in_recording`, so Builder's voice is never transcribed.
- **Speaking policy:** silent by default. Speak only on opening, when addressed, when stuck (cooldown 120 s), for conflict confirmation, or for command feedback that's invisible or failed. At most 2 sentences or 300 characters per turn, with at most one question.
- **Agreement:**
  - States are draft → pending → agreed.
  - A pending item is promoted when a different participant supports it, or when no one objects within 30 s.
  - Spoken confirmation only for conflicts resolved through comparison.
  - An agreement must be supported by the grounding utterances.
- **Stuck thresholds:** 20 s of silence after a question to the room; a conflict open 180 s; an open question unengaged 180 s.
- **Build loop:** at most one run in flight. Hand-offs arriving during a run merge into the next run. Floor of 10 s between runs, except immediately after a conflict resolves.
- **Latency targets:**
  - voice command visible ≤ 2 s;
  - spoken reply starts ≤ 3 s;
  - decision on screen ≤ 10 s;
  - character reacts to being addressed in < 1 s.
- **Motion:** all animation is stepped by the shared 15 fps clock. Durations 250–600 ms, ease-out. No flashing, no UI sound effects. A spotlight moment lasts 1500 ms and queues one at a time.
- **Public surface:** through the tunnel or deployed origin only these respond: `/recall/realtime/` (signed), `/stage/*` and `/handoff/*` (token-gated), and `/renderer/*` (static, no secrets). Everything else answers localhost only (existing `viaProxy` gate in `src/app.ts`).
- **Logging:** never log keys, verification secrets, transcript text, or prompt/response bodies. Log ids, event types, counts, durations, and costs.
- **Cost:** record every model call's tokens and USD. Show a per-session running total in the operator UI.

## Review Focus

Failure modes the spec implies but no feature test covers. Each one is pinned by a test in the task that owns it.

1. **Diarization mislabels or unknown speakers:** an utterance with speaker `null`/"Unknown", or with the same speaker as the proposer, must never count as support. Pinned in Task 2 (`recordSupport ignores unknown and self support`).
2. **Stale or conflicting patch batches:** a batch that references a node removed by an earlier batch must be rejected whole, leaving the screen unchanged. Pinned in Task 1 (`batch referencing removed node is rejected atomically`).
3. **Builder hears itself:** any utterance whose speaker is the bot name must be ignored by both loops. Pinned in Task 11 (`own utterances are ignored`).
4. **Stage connection drops mid-meeting** (tunnel restart, Wi-Fi blip): the stage must reconnect, resync from a snapshot, and never blank. Pinned in Task 3 (`reconnect receives a full snapshot`) and Task 4 (Chrome: a re-snapshot doesn't clear the DOM).
5. **TTS provider failure or timeout:** Builder's line must still reach the room as meeting chat plus a caption, and the conversation loop must not hang. Pinned in Task 13 (`tts failure falls back to chat and caption`).

---

## Milestone 1: Prototype engine and shared-screen experience (no models)

### Task 1: Component schema and atomic patch application

**Files:**
- Modify: `package.json` (deps `zod`, `@anthropic-ai/sdk`, `ws`; script `"test": "node --test test/"` unchanged)
- Create: `src/ui/schema.ts`, `src/ui/tree.ts`, `test/ui-tree.test.ts`, `test/fixtures/proto-todo.json`

**Interfaces:**
- Produces:
  - `COMPONENT_TYPES` (readonly tuple): `App, Screen, NavBar, Tabs, Stack, Card, Text, Heading, Button, Input, Select, Toggle, Checkbox, List, ListItem, Table, Badge, Modal, ImagePlaceholder, ChartPlaceholder, EmptyState`.
  - `Interaction` zod union:
    - `{kind:"navigate", screen}`
    - `{kind:"toggle", target}`
    - `{kind:"open", target}`
    - `{kind:"close", target}`
    - `{kind:"append", list, fromInput}`
    - `{kind:"setValue", target, value}`
  - `UiNode`: `{ id: string /^[a-z0-9][a-z0-9.-]{0,63}$/, type, props: Record<string, string|number|boolean|string[]>, on?: { click?: Interaction[], change?: Interaction[] }, status: "draft"|"agreed", decisionId?: string, children: UiNode[] }`.
  - `Prototype`: `{ root: UiNode /* type "App" */, currentScreen: string }`.
  - `PatchOp`:
    - `{op:"add", parentId, index?, node}`
    - `{op:"update", id, props?, status?, decisionId?}`
    - `{op:"remove", id}`
    - `{op:"move", id, parentId, index}`
    - `{op:"set_screen", screenId}`
  - `PatchBatch`: `{ ops: PatchOp[], label: string /* ≤60 chars, e.g. "Added: due date" */, by?: string }`.
  - `Change`: `{ kind:"added"|"removed"|"moved"|"updated"|"screen", id: string, label: string, by?: string }`.
  - `emptyPrototype(appName: string): Prototype`, with one Screen `home`.
  - `applyBatch(proto: Prototype, batch: PatchBatch): { ok: true; proto: Prototype; changes: Change[] } | { ok: false; error: string }`. It's pure and atomic: it returns a new object and never mutates its input.
  - `findNode(proto, id): UiNode | undefined`.
  - `JSON schemas`: `patchBatchJsonSchema()`, which returns a JSON Schema with `additionalProperties: false` for strict tool use. Derive it via `z.toJSONSchema` (zod v4).

- [ ] **Step 0: Baseline commit**
  - Run `git status`, and confirm `.env` and `data/` are ignored (`git check-ignore .env data`).
  - Run `git add -A && git commit -m "chore: baseline Recall feasibility app and Builder spec"`.

- [ ] **Step 1: Install deps.** Run `npm install zod @anthropic-ai/sdk ws`. Expected: `package.json` has the three dependencies and `node_modules/` is git-ignored. Add it to `.gitignore` if missing.

- [ ] **Step 2: Write failing tests** in `test/ui-tree.test.ts`:

```ts
test("add/update/move/remove produce changes and a new tree", () => {
  const p0 = emptyPrototype("Team To-Do");
  const r = applyBatch(p0, { label: "Added: task input", by: "Amir", ops: [
    { op: "add", parentId: "home", node: { id: "home.add", type: "Input", props: { placeholder: "Add a task" }, status: "draft", children: [] } },
  ]});
  assert.ok(r.ok);
  assert.deepEqual(r.changes, [{ kind: "added", id: "home.add", label: "Added: task input", by: "Amir" }]);
  assert.equal(findNode(p0, "home.add"), undefined, "input not mutated");
});
test("batch referencing removed node is rejected atomically", () => {
  // ops: remove home.add, then update home.add → { ok:false }; original tree unchanged
});
test("rejects duplicate ids, Screen outside App, unknown type, depth > 12, > 400 nodes", ...);
test("set_screen requires an existing Screen id", ...);
test("patchBatchJsonSchema is strict (additionalProperties false at every object)", ...);
```

- [ ] **Step 3: Run tests.** Run `node --test test/ui-tree.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `src/ui/schema.ts` (zod schemas and exported types) and `src/ui/tree.ts`. Use `structuredClone`, then apply ops in order, and return the first error without partial results. Limits: depth 12, nodes 400.
- [ ] **Step 5: Run tests.** Run `node --test test/`. Expected: all pass, including the 15 existing tests.
- [ ] **Step 6: Commit.** `git commit -am "feat(ui): component schema and atomic patch application"` (add the new files).

### Task 2: Consensus document and agreement state machine

**Files:**
- Create: `src/consensus/doc.ts`, `test/consensus.test.ts`
- Modify: `src/store.ts`: add table `consensus(session_id TEXT PRIMARY KEY, doc_json TEXT, proto_json TEXT, updated_at TEXT)`, plus `getConsensus(sessionId): { doc: ConsensusDoc; proto: Prototype } | undefined` and `saveConsensus(sessionId, doc, proto): void`.

**Interfaces:**
- Consumes: `Prototype`, `PatchBatch` (Task 1).
- Produces:
  - Types:
    - `Phase = "opening"|"understand"|"explore"|"converge"|"detail"|"recap"`.
    - `Decision`: `{ id, text, status:"draft"|"pending"|"agreed", proposedBy: string, agreedBy: string[], pendingSince?: number, decidedAt?: number, affects: string[], rejectedOptions: string[] }`.
    - `OpenQuestion`: `{ id, text, raisedBy: string|null, since: number, lastEngagedAt: number }`.
    - `Variant`: `{ label:"A"|"B"|"C", summary: string, backers: string[], batch: PatchBatch }`.
    - `Conflict`: `{ id, topic, status:"open"|"resolved", openedAt: number, variants: Variant[] /* 2–3 */, winner?: "A"|"B"|"C" }`.
    - `ConsensusDoc`: `{ phase, app: { name?, purpose?, users? }, decisions, openQuestions, conflicts, nextUp: string[] /* ≤5 */ }`, with a zod schema `ConsensusDocSchema`.
  - Constant: `NO_OBJECTION_MS = 30_000`.
  - Functions:
    - `emptyDoc(): ConsensusDoc` (phase `"opening"`).
    - `markPending(doc, id, now)`.
    - `recordSupport(doc, id, speaker: string|null, now)`: agreed immediately if `speaker` is non-empty, not `"Unknown"`, and ≠ `proposedBy`; otherwise a no-op.
    - `recordObjection(doc, id, speaker, now)`: back to `"draft"`, clears `pendingSince`.
    - `tickAgreement(doc, now): { doc; promoted: string[] }`: promotes pending items older than `NO_OBJECTION_MS`.
    - `resolveConflict(doc, conflictId, winner, now): { doc; decision: Decision }`: adds an agreed decision; `rejectedOptions` gets the losers' summaries.
  - All functions are pure and return new docs.

- [ ] **Step 1: Write failing tests** in `test/consensus.test.ts`:

```ts
test("pending promotes after 30s with no objection", () => { /* markPending at t=0; tick at 29_999 → none; tick at 30_000 → ["d1"], status agreed, decidedAt 30_000 */ });
test("support from another participant agrees immediately", ...);
test("recordSupport ignores unknown and self support", () => { /* speaker null, "Unknown", and proposer → still pending */ });
test("objection returns to draft and stops the timer", ...);
test("resolveConflict creates agreed decision with rejected options", ...);
test("store round-trips consensus doc and prototype", () => { /* openStore(":memory:") save/get */ });
```

- [ ] **Step 2: Run tests.** Run `node --test test/consensus.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/consensus/doc.ts` and the store additions. Use additive `CREATE TABLE IF NOT EXISTS`, and validate with `ConsensusDocSchema` on read.
- [ ] **Step 4: Run tests.** Run `node --test test/`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(consensus): agreement state machine and persistence`.

### Task 3: Session runtime, stage WebSocket channel, and script driver

**Files:**
- Create: `src/session/runtime.ts`, `src/session/mood.ts`, `src/stage/channel.ts`, `test/runtime.test.ts`, `test/fixtures/script-todo.json`
- Modify:
  - `src/app.ts`: public `GET /renderer/*.js|*.css`, served from `public/renderer/` with no token and the correct content type; local-only `POST /api/sessions/:id/script`; `/stage/:id/state` returns the snapshot shape.
  - `src/server.ts`: attach the channel to the http server.
  - `src/config.ts`: `botVariant` defaults to `"web_4_core"`, and `BOT_VARIANT=web` means none.
  - `src/app.ts`: `BOT_NAME = "Builder"`.
  - `test/integration.test.ts`: update the expectations that change.

**Interfaces:**
- Consumes: Task 1 (`applyBatch`), Task 2 (`ConsensusDoc`, store `getConsensus`/`saveConsensus`).
- Produces:
  - Moods:
    - `Mood = "listening"|"thinking"|"building"|"speaking"|"curious"|"unsure"|"pleased"`.
    - `deriveMood(s: { buildInFlight: boolean; buildStreaming: boolean; speaking: boolean; lastSpeechWasQuestion: boolean; unsureUntil: number; pleasedUntil: number; addressedUntil: number }, now: number): Mood`.
    - Priority: speaking > (unsure while now<unsureUntil) > building > thinking (in flight, or addressed within its window) > (pleased while now<pleasedUntil) > curious (after a question, until the next human utterance) > listening.
  - `StageEvent` union, sent as JSON:
    - `{type:"snapshot", proto, uiScreen, doc, captions: Caption[], mood, comparison: ComparisonView|null}`
    - `{type:"patch", proto, changes: Change[]}`
    - `{type:"doc", doc}`
    - `{type:"mood", mood}`
    - `{type:"caption", caption: Caption}`
    - `{type:"pending_region", parentId: string|null}`
    - `{type:"command", nodeId, interaction}`
    - `{type:"comparison", view: ComparisonView|null}`
    - `{type:"resolve", conflictId, winner}`
    - `{type:"speech_start", utteranceId, text}`
    - `{type:"speech_end", utteranceId}`
    - `{type:"speech_stop"}`
  - Binary frames carry audio: `[36-byte utteranceId ascii][pcm16le 24 kHz mono]`.
  - `Caption = { speaker: string; text: string; partial: boolean; isAgent: boolean }`.
  - `ComparisonView = { conflictId; topic; variants: { label; summary; backers: string[]; proto: Prototype; focusIds: string[] }[] }`.
  - `createStageChannel(server: http.Server, auth: (sessionId: string, token: string) => boolean, onClientMessage: (sessionId, msg) => void)`:
    - Path `/stage/<uuid>/ws?token=…`. A wrong token closes with 4401 and accepts no upgrade.
    - Methods: `send(sessionId, ev)`, `sendAudio(sessionId, utteranceId, pcm: Uint8Array)`, `clients(sessionId): number`.
    - Server pings every 25 s.
  - `createRuntime({ store, channel, clock = Date.now, log })` → `runtime(sessionId)` returns:
    - `snapshot(): StageEvent`
    - `applyBatch(batch): { ok: boolean; error?: string }`: persists and sends a patch.
    - `setDoc(doc)`
    - `updateMoodInputs(partial)`
    - `caption(c)`: keeps the last 3 final captions plus 1 partial.
    - `pendingRegion(parentId|null)`
    - `command(nodeId, interaction)`
    - `showComparison(view|null)`
    - `resolveComparison(conflictId, winner)`: applies the winner's batch to the main proto, then sends `resolve` + `patch`.
  - On every connect the channel sends `snapshot`.
  - Script driver `POST /api/sessions/:id/script` (localhost only), body `{ steps: ({ wait?: number } & ({batch}|{doc}|{mood}|{comparison}|{resolve}|{caption}))[] }`. It runs the steps with waits and is used for all visual QA in Tasks 4–8.

- [ ] **Step 1: Write failing tests** in `test/runtime.test.ts`:

```ts
test("deriveMood priority order", ...); // table-driven: each input → expected mood
test("ws rejects bad token with 4401", ...); // real http server on :0, Node global WebSocket client
test("reconnect receives a full snapshot", async () => { /* connect, apply batch, disconnect, reconnect → first message is snapshot whose proto contains the batch's node */ });
test("applyBatch failure sends nothing and keeps persisted proto", ...);
test("renderer assets are public through the tunnel; script endpoint is not", ...); // cf-connecting-ip header: /renderer/render.js 200, /api/sessions/:id/script 404
test("createBot sends bot_name Builder and variant web_4_core by default", ...);
```

- [ ] **Step 2: Run tests.** Run `node --test test/runtime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the channel (using the `ws` package `WebSocketServer({ noServer: true })` with an upgrade handler), the runtime and mood, and the app/config/server changes.
- [ ] **Step 4: Run tests.** Run `node --test test/`. Expected: PASS.
- [ ] **Step 5: Tunnel check (manual, required).** With `npm run tunnel` and `npm start` running, from another shell run `node -e` with a global `WebSocket` to `wss://<tunnel>/stage/<id>/ws?token=<t>`. Expected: a `snapshot` message within 1 s, and a `patch` arrives within 1 s of a script step. If the tunnel blocks WebSockets, stop and report. The stage then falls back to `/state` polling, and the latency targets need revisiting.
- [ ] **Step 6: Commit.** `feat(stage): session runtime, websocket channel, script driver`.

### Task 4: Browser renderer, design system, and interactions

**Files:**
- Create:
  - `public/renderer/theme.css`: design tokens, large type, high contrast, `.is-draft` dashed outline plus "draft" tag.
  - `public/renderer/components.js`: one element builder per `COMPONENT_TYPES` entry; every element gets `data-node-id`.
  - `public/renderer/render.js`
  - `public/renderer/interact.js`
  - `public/renderer/client.js`: the stage connection, WS with automatic fallback to 1 s `/state` polling.
  - `test/renderer-unit.test.ts`, `test/helpers/chrome.ts`, `test/renderer-browser.test.ts`
- Modify: `public/stage.html` gets the import map `{"imports":{"@renderer/":"/renderer/"}}` and uses `client.js` + `render.js`. Renderer modules import each other only via `@renderer/…`.

**Interfaces:**
- Consumes: the `StageEvent` and `Prototype` shapes (Task 3, Task 1).
- Produces:
  - `renderTree(container: HTMLElement, proto, uiState): Map<string, HTMLElement>`: a keyed reconcile that reuses elements by `data-node-id`. Re-rendering the same proto creates zero new elements.
  - `initialUiState(proto)`: returns `{ screen, toggles:{}, open:{}, lists:{}, values:{} }`.
  - `reduceInteraction(uiState, interaction, proto): uiState`: pure, importable from Node (used server-side in Task 12).
  - `bindInteractions(container, getProto, getState, setState)`: clicks run `on.click` interactions.
  - `connectStage({ sessionPath, token, onEvent }): { send(msg) }`.
  - `test/helpers/chrome.ts`:
    - `withChrome(fn: (page: Page) => Promise<void>, opts?)`: launches headless Chrome with remote debugging on a free port. If Chrome isn't found at `CHROME_PATH` or the macOS default path, it calls `t.skip()`.
    - `Page` methods: `goto`, `eval<T>(expr)`, `screenshot(path)`, `setCpuThrottle(rate)`, `trace(ms): Promise<Record<string, number>>`, which returns ms/s per trace event name.
    - The scratch CDP scripts from the debugging session are the reference.

- [ ] **Step 1: Write failing tests.**

```ts
// renderer-unit.test.ts (Node)
test("reduceInteraction navigate/toggle/open/close/append/setValue", ...);
test("append moves the input value into the list and clears the input", ...);
// renderer-browser.test.ts (Chrome)
test("renders fixture proto with data-node-id for every node and draft styling", ...);
test("re-snapshot of the same proto keeps DOM nodes (no blank, no recreation)", ...); // Review Focus 4
test("click on Button with navigate switches screen", ...);
```

- [ ] **Step 2: Run tests.** Run `node --test test/renderer-unit.test.ts test/renderer-browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules above. Keep a visual style that stays readable after Meet's 720p compression: base font ≥ 20px on the stage, no thin grey text.
- [ ] **Step 4: Run tests.** Run `node --test test/`. Expected: PASS (browser tests skip only if Chrome is missing).
- [ ] **Step 5: Visual check.** POST `test/fixtures/script-todo.json` to the script endpoint and screenshot the stage at 1280×720 with `withChrome`. Expected: the to-do prototype renders, with the draft items dashed.
- [ ] **Step 6: Commit.** `feat(renderer): component renderer, design system, interactions`.

### Task 5: Motion, focus moments, responsiveness cues

**Files:**
- Create:
  - `public/renderer/clock.js`: a 15 fps stepper that generalises the existing one in `public/stage.html`. It drives CSS animations through `document.getAnimations()` and runs `onFrame` callbacks.
  - `public/renderer/motion.js`
  - `public/renderer/focus.js`
  - `test/motion-unit.test.ts`, `test/motion-browser.test.ts`
- Modify: `public/renderer/render.js` hooks motion into reconcile.

**Interfaces:**
- Produces:
  - `captureRects(map): Map<id, DOMRect>`.
  - `animateReconcile(prevRects, map, changes)`:
    - FLIP for moved/updated layout;
    - enter: scale 0.92→1 + fade, 350 ms;
    - exit: collapse + fade, 300 ms;
    - prop updates: cross-fade, 250 ms;
    - all ease-out.
  - `transitionScreen(fromEl, toEl)`: a 450 ms slide.
  - `createFocusQueue({ playMs: 1500 })`: a pure scheduler with `enqueue(change)`, `next(now) → Change|null`, `isPlaying(now)`.
  - `playFocus(el, change)`: dims siblings to 0.35, draws a ring, and shows the label `"{change.label} · {change.by}"`.
  - `showPendingRegion(parentEl|null)`: a shimmer placeholder.
  - `animatePointer(targetEl): Promise<void>`: a pointer glides 500 ms, then a 150 ms press.
  - Draft→agreed: `playSettled(el)`, a 400 ms outline morph from dashed to solid.

- [ ] **Step 1: Write failing tests.**

```ts
test("focus queue plays changes one at a time for 1500ms each", ...); // enqueue 3; next() at t=0,1500,3000
test("changes on another screen trigger screen transition before focus", ...); // Chrome: proto.currentScreen changes → transitionScreen called (spy via window.__motionLog)
test("frame budget: 10 queued focus moments hold the 15fps clock", ...);
// Chrome, setCpuThrottle(2), clock tick intervals p95 ≤ 90ms over 15s
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement**, using only transform/opacity animations and `will-change` on animated layers.
- [ ] **Step 4: Run tests.** Run `node --test test/`. Expected: PASS.
- [ ] **Step 5: Visual check.** Run a script that adds, moves, removes and promotes nodes; screenshot during a spotlight. Expected: ring and label are visible, and the rest is dimmed.
- [ ] **Step 6: Commit.** `feat(renderer): motion, focus moments, pointer, placeholders`.

### Task 6: Builder character, stage layout, panels, captions

**Files:**
- Create: `public/renderer/character.js`, `test/character-browser.test.ts`
- Modify: `public/stage.html` is rewritten for the full layout:
  - header "Builder · {phase}";
  - prototype area;
  - right panel: Agreed (solid) / Pending (with countdown ring) / Open questions;
  - caption bar, with agent lines labelled "Builder";
  - character dock.

**Interfaces:**
- Consumes: `Mood` (Task 3), the `doc` and `caption` events.
- Produces:
  - `createCharacter(el)` with `setMood(mood: Mood)`, `setMouth(level: number /* 0..1 */)`, `setPlacement("center"|"dock")`.
    - It's centred while the prototype has no nodes under the screens, docked bottom-right otherwise. The placement change animates over 500 ms.
    - Mood visuals follow the mockup `.superpowers/brainstorm/*/content/personality-and-focus.html`:
      - listening: rings pulse with human captions;
      - thinking: eyes up, antenna blink;
      - building: blocks hop;
      - speaking: mouth driven by `setMouth`;
      - curious: one raised eye;
      - unsure: tilted mouth;
      - pleased: happy eyes plus a small bounce.

- [ ] **Step 1: Write failing tests** in Chrome:
  - `each mood sets data-mood and distinct computed styles`;
  - `placement switches to dock when first node is added`;
  - `pending decision shows in Pending and moves to Agreed on doc update with settled animation`.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the existing robot art from `public/stage.html`.
- [ ] **Step 4: Run tests.** Expected: PASS. The frame-budget test from Task 5 still passes with the character animating.
- [ ] **Step 5: Visual check.** Screenshot each mood via script steps. Expected: seven distinguishable moods.
- [ ] **Step 6: Commit.** `feat(stage): Builder character, panels, captions layout`.

### Task 7: Comparison view

**Files:**
- Create: `public/renderer/comparison.js`, `test/comparison.test.ts`
- Modify: `src/session/runtime.ts` adds `buildComparisonView(proto, conflict): ComparisonView`, which applies each variant batch with `applyBatch` and collects `focusIds` from the changes. Variants that fail to apply are dropped, and the view needs at least 2.

**Interfaces:**
- Produces:
  - `showComparison(container, view)`: a 450 ms split transition. It shows 2–3 scaled live previews with a large `A/B/C` label, a one-line summary, backer names, and focus rings on `focusIds`.
  - `resolveComparison(container, winnerLabel): Promise<void>`: the winner expands into the prototype area via FLIP over 500 ms; the others fold away.

- [ ] **Step 1: Write failing tests.**
  - Node: `buildComparisonView drops invalid variants and requires ≥2`; `resolveComparison applies winner batch to main proto and records decision`.
  - Chrome: `comparison renders 3 labelled previews within 1280×720`.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(stage): side-by-side comparison view`.

### Task 8: Handoff page and self-contained export

**Files:**
- Create: `public/handoff.html`, `src/handoff/export.ts`, `test/handoff.test.ts`
- Modify:
  - `src/app.ts`: public token-gated `GET /handoff/:id?token=` and `GET /handoff/:id/export?token=`.
  - `public/index.html`: the operator UI shows the handoff link and the running cost (cost is wired in Task 9; show `$0.00` until then).

**Interfaces:**
- Consumes: store `getConsensus`, the renderer modules.
- Produces:
  - The handoff page has four sections:
    - an interactive prototype (full `bindInteractions`);
    - the component spec as a readable tree (screen → component → props → interactions), plus a JSON download;
    - decisions (text, proposedBy, agreedBy, decidedAt, affects, rejectedOptions);
    - open questions.
  - Nodes and decisions with `status !== "agreed"` are listed under "Not agreed" and visually flagged.
  - `buildExportHtml(doc, proto): string`: a single HTML file whose import map points `@renderer/*` at `data:text/javascript;base64,…` copies of each renderer module, with `theme.css` and the JSON inlined.

- [ ] **Step 1: Write failing tests.**
  - `handoff requires token and is reachable through the tunnel`.
  - `export is self-contained`: there are no `src="/`, `href="/` or `http` references in the output, and when the HTML is written to a temp file and opened via `file://` in Chrome, the prototype renders.
  - `drafts are flagged as not agreed`.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(handoff): handoff page and self-contained export`.

**Milestone 1 check:**
- Run `npm test` (all pass), then `npm run smoke`.
- Run the full `script-todo.json` against a real bot in a test Meet via **Start screenshare**. The motion should look smooth in Meet on `web_4_core`.

---

## Milestone 2: Agent brains

### Task 9: LLM port, cost accounting, configuration

**Files:**
- Create: `src/agent/llm.ts`, `src/agent/cost.ts`, `scripts/probe-models.ts`, `test/llm-cost.test.ts`
- Modify:
  - `src/config.ts`: optional `OPENROUTER_API_KEY` and `TTS_VOICE` (a voice id from the `elevenlabs/eleven-v4-turbo` model page). `agentEnabled = !!OPENROUTER_API_KEY`; when it's false the app runs listen-only with a startup warning.
  - `src/store.ts`: table `model_calls(id INTEGER PK, session_id, loop TEXT, model TEXT, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd REAL, ms INTEGER, created_at)`, plus `addModelCall(row)` and `sessionCost(sessionId): number`.
  - `src/app.ts` and `public/index.html`: `GET /api/sessions/:id` includes `cost_usd`, and the operator UI shows it next to the handoff link, refreshed every 5 s.
  - `.env.example`.

**Interfaces:**
- Produces:
  - `MODELS = { conversation: "anthropic/claude-haiku-5.5", build: "anthropic/claude-opus-5.5" } as const`, plus `BUILD_FALLBACKS = ["anthropic/claude-opus-5"]`.
  - `type ToolCall = { name: string; input: unknown }`.
  - `type ModelPort = { runTools(req: { loop: "conversation"|"build"; system: string; messages: unknown[]; tools: unknown[]; effort: "low"|"medium"; onToolInputDelta?: (toolName: string, partialJson: string) => void }): Promise<{ toolCalls: ToolCall[]; usage: Usage; ms: number }> }`.
  - `createOpenRouterPort(config): ModelPort`, using `new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: config.openrouterApiKey })`:
    - Streams with `eager_input_streaming: true` on tools.
    - Caches the system prompt and tools with `cache_control`.
    - Adds OpenRouter's `fallbacks: BUILD_FALLBACKS` on build-loop calls (an extra body field; check the exact field shape in OpenRouter's Messages reference).
    - Checks `stop_reason` (`refusal`, `max_tokens`) before using tool calls.
    - Validates every tool input against its zod schema, and drops invalid calls with a log line.
  - `createFakePort(script: ToolCall[][]): ModelPort` for tests.
  - `PRICES: Record<model, { input; output; cacheRead; cacheWrite }>` (USD per MTok): copy each model's current rates from its OpenRouter model page at implementation time, with a comment naming the page and date. Anthropic list prices for reference: Opus 5.5 input 4, output 20, cacheRead 0.20. If the response carries OpenRouter's own cost in usage, prefer that over the computed value.
  - `costOf(model, usage): number`.

- [ ] **Step 1: Write failing tests.** `costOf computes cache-aware cost`; `fake port records calls and costs into model_calls`; `sessionCost sums per session`; `session view includes cost_usd`; `config without OPENROUTER_API_KEY disables agent without throwing`; `port sends baseURL openrouter, model slugs, and fallbacks only on build calls` (inject a fake `fetch` into the SDK client).
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Load the `claude-api` skill first for the exact TypeScript SDK streaming and tool syntax.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Live probe (manual, costs about a cent).** Run `node scripts/probe-models.ts`, which makes one tiny `runTools` call per model through OpenRouter with a trivial strict tool. Expected:
  - both models return a tool call;
  - each `model_calls` row has a USD value;
  - the probe prints whether `onToolInputDelta` fired more than once, which confirms streamed tool input passes through.

  Record the result in `README.md`. If it didn't fire, Task 10 shows the shimmer until the complete batch arrives.
- [ ] **Step 6: Commit.** `feat(agent): model port and cost accounting`.

### Task 10: Build loop (Opus)

**Files:**
- Create: `src/agent/handoff.ts`, `src/agent/build-loop.ts`, `src/agent/prompts/build.md`, `test/build-loop.test.ts`

**Interfaces:**
- Consumes: `ModelPort` (Task 9); `runtime` (Task 3); consensus functions (Task 2); `applyBatch`, `patchBatchJsonSchema` (Task 1).
- Produces:
  - `HandoffSchema` (zod) and `Handoff`:
    - `{ topics: { title; screenHint?: string; proposals: { text; proposedBy: string; supporters: string[]; objectors: string[] }[]; questionsRaised: string[]; resolvedChoice?: { conflictId; winner: "A"|"B"|"C" } }[]; mood: "converging"|"stuck"|"exploring"; requestedView?: string; groundingIds: number[] }`.
    - `groundingIds` are `events.id` values of utterances.
  - `ConsensusUpdate` ops (zod, strict):
    - `add_decision {id, text, proposedBy, affects}`
    - `support {decisionId, speaker}`
    - `object {decisionId, speaker}`
    - `mark_pending {decisionId}`
    - `add_open_question {text, raisedBy}`
    - `engage_question {id}`
    - `close_question {id}`
    - `add_conflict {id, topic, variants}`
    - `set_phase {phase}`
    - `set_next_up {items}`
    - `set_app {name?, purpose?, users?}`
  - Opus tools: `apply_patches(PatchBatch)` and `update_consensus({ ops: ConsensusUpdate[] })`.
  - `enforceGrounding(ops, groundingSpeakers: Set<string>): { ops; dropped: number }`: drops `support`/`object` ops (and `add_decision` `proposedBy`) whose speaker isn't in the grounding utterances.
  - `createBuildLoop({ port, runtime, store, clock, log }) → { handoff(sessionId, h: Handoff): void; idle(sessionId): boolean }`:
    - single-flight per session, with pending hand-offs merged (concatenate `topics`, union `groundingIds`);
    - floor of 10 000 ms between runs, bypassed when any topic has `resolvedChoice`;
    - on `resolvedChoice`, calls `runtime.resolveComparison` before the model call;
    - mood inputs: `buildInFlight` during the call, `buildStreaming` once tool input deltas arrive (and `pendingRegion(parentId)` from the first parsed `add.parentId`);
    - on `add_conflict`, calls `runtime.showComparison(buildComparisonView(...))`;
    - runs `tickAgreement` every second via the runtime clock, with `pleasedUntil = now + 2000` on any promotion.
    - **Promotion flips nodes:** whenever a decision becomes agreed (by support, timeout or conflict resolution), call `runtime.applyBatch({ label: "Agreed: " + text /* truncated to 60 */, ops: affects.map(id => ({ op: "update", id, status: "agreed", decisionId })) })`. Skip ids that no longer exist. The stage plays `playSettled` for `updated` changes whose status turned agreed.
  - Prompt `build.md` must state:
    - the facilitation phases (spec §6);
    - the agreement states and "never record agreement not supported by the grounding lines";
    - the component catalog with props conventions and stable readable ids;
    - small patch batches with a ≤60-char `label`;
    - conflicts get 2–3 variants that change the same region;
    - `nextUp` holds at most 5 short, speakable items, each ending in a question to a named person where possible;
    - the visual-clarity priority from spec §10a;
    - emit `set_screen` when the discussion moves to another screen (`screenHint` or `requestedView`), so the stage follows the conversation.
  - The wording is left to the implementer.

- [ ] **Step 1: Write failing tests** with the fake port:

```ts
test("handoff → patches applied, decision added as draft→pending, doc and proto persisted", ...);
test("support by a speaker not in grounding lines is dropped", ...);
test("handoffs during a run are merged into exactly one follow-up run", ...);
test("10s floor between runs; resolvedChoice bypasses it", ...);
test("invalid patch batch from model is rejected; screen unchanged; run still updates doc", ...);
test("add_conflict shows comparison with ≥2 valid variants", ...);
test("pending item auto-agrees after 30s and sets pleased mood", ...);
test("agreed decision flips its affected nodes to status agreed via one batch", ...);
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(agent): Opus build loop with grounding and merge`.

### Task 11: Conversation loop (Haiku) and stuck detection

**Files:**
- Create: `src/agent/conversation-loop.ts`, `src/agent/stuck.ts`, `src/agent/prompts/conversation.md`, `test/conversation-loop.test.ts`, `test/stuck.test.ts`
- Modify: `src/app.ts`, so that `processRealtime` forwards finalized utterances, partials, and join/leave to the loop when `agentEnabled`. The bot status `in_call_recording` (from `pollOnce`) triggers `onBotRecording`.

**Interfaces:**
- Consumes: `ModelPort`, `runtime`, `buildLoop.handoff`, `HandoffSchema` (Task 10).
- Produces:
  - Haiku tools:
    - `speak({ text: string /* ≤300 chars */, reason: "opening"|"answer"|"stuck"|"confirm_conflict"|"command_feedback" })`
    - `ui_command({ action: "click"|"navigate"|"type"|"toggle"|"focus_option"|"back", target: string, value?: string })`
    - `update_build(Handoff)`
  - `createStuckDetector({ clock })` → `{ onHumanUtterance(text, speaker), onAgentQuestion(), onDoc(doc), poll(now): null | { reason: "silence"|"conflict"|"open_question" } }`:
    - thresholds 20 000 / 180 000 / 180 000 ms;
    - cooldown 120 000 ms after any stuck-triggered speech.
  - `type Speech = { say(sessionId: string, text: string): Promise<string>; stop(sessionId: string): void; speaking(sessionId: string): boolean }`, defined in `src/agent/conversation-loop.ts`.
  - `createChatSpeech({ recall, runtime }): Speech`: a Milestone 2 stand-in that posts the text as meeting chat (≤500 chars) plus an agent caption; `speaking` is always false. Task 13 replaces it with TTS speech that implements the same type.
  - `createConversationLoop({ port, runtime, buildLoop, speech, store, clock, botName = "Builder" }) → { onUtterance(sessionId, u: { id: number; speaker: string|null; text: string }), onPartial(sessionId, p), onBotRecording(sessionId), poll(now) }`:
    - **Own utterances:** ignored when `speaker === botName`.
    - **Fast react:** the regex `/\b(hey\s+)?builder\b/i` on partials or finals sets `addressedUntil = now + 8000` immediately, before any model call, so the character reacts in < 1 s.
    - **Single-flight:** one model call at a time, with the latest context.
    - **Opening:** once per session, on the first `onBotRecording` with ≥1 human present.
    - **Speech gate in code:** `speak` is executed only if its `reason` holds:
      - `answer` needs addressed within 8 s;
      - `stuck` needs a pending stuck event;
      - `opening` needs not yet opened;
      - `confirm_conflict` needs a conflict resolved in the last 10 s;
      - `command_feedback` needs a failed or invisible command in the last 5 s.
      - Otherwise it's dropped with log `speak.blocked`.
    - **Window:** the context window is the last 40 utterances.
  - Prompt `conversation.md` must state:
    - silent by default;
    - when to call `update_build` (spec §12);
    - expert stance with exactly one question per turn;
    - the persona (warm, brief, quietly confident, a little playful, never flattering);
    - deliver `nextUp` items phrased for the moment.

- [ ] **Step 1: Write failing tests:**

```ts
test("own utterances are ignored", ...); // Review Focus 3
test("addressing 'hey Builder' sets thinking mood before the model responds", ...);
test("speak without valid reason is blocked (silent by default)", ...);
test("opening speaks once after bot records with a human present", ...);
test("update_build forwards a schema-valid handoff with grounding ids to the build loop", ...);
test("stuck: 20s silence after agent question triggers one stuck turn; cooldown 120s", ...); // stuck.test.ts
test("context window is capped at 40 utterances", ...);
```

- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(agent): Haiku conversation loop with speech gate and stuck detection`.

### Task 12: Voice commands

**Files:**
- Create: `src/agent/ui-command.ts`, `test/ui-command.test.ts`
- Modify: `src/session/runtime.ts` mirrors `uiState` using `reduceInteraction` imported from `public/renderer/interact.js`. `public/renderer/client.js` handles `command` by calling `animatePointer` and then the interaction.

**Interfaces:**
- Consumes: `ui_command` tool input (Task 11), `reduceInteraction` (Task 4), `animatePointer` (Task 5).
- Produces:
  - `resolveCommand(proto, uiState, cmd): { ok: true; nodeId: string; interaction: Interaction } | { ok: false; reason: "ambiguous"; candidates: string[] } | { ok: false; reason: "not_found" }`:
    - matches `target` against `props.label|text|placeholder|title` of nodes on the **current screen**, case-insensitive;
    - exact match first, then contains;
    - `focus_option` maps to the open comparison label.
  - Ambiguous or not-found results set `unsureUntil = now + 3000`, and the conversation loop may `speak` with `command_feedback`.

- [ ] **Step 1: Write failing tests.** `click by label on current screen`; `ambiguous 'Add' with Add button and Add list → candidates`; `navigate updates server uiState screen and stage receives command`; `type sets value then click Add appends`.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(agent): voice commands with pointer animation`.

**Milestone 2 check:**
- Run `npm test`.
- Run `node scripts/replay.ts test/fixtures/sessions/todo-app.json --live-models` (Task 15 builds the replay harness; until then, test by talking in a real Meet).
- Expected: Builder opens, stays quiet, the prototype builds with focus moments, a conflict shows options, and the chat or caption shows Builder's lines.

---

## Milestone 3: Voice

### Task 13: TTS provider and audio playback on the stage

**Files:**
- Create:
  - `src/voice/tts.ts`, `src/voice/openrouter-tts.ts`, `src/voice/speech.ts`
  - `public/renderer/audio.js` and `public/renderer/pcm-worklet.js`
  - `test/speech.test.ts`, `test/fixtures/openrouter-tts.md`
- Modify:
  - The conversation loop calls `speech.say` instead of chat.
  - The stage `client.js` routes binary frames to `audio.js`.

**Interfaces:**
- Produces:
  - `interface TtsProvider { stream(text: string, signal: AbortSignal): AsyncIterable<Uint8Array> /* pcm16le 24 kHz mono */ }`.
  - `createOpenRouterTts({ apiKey, voice, model: "elevenlabs/eleven-v4-turbo" }): TtsProvider`:
    - makes a `fetch` POST to `https://openrouter.ai/api/v1/audio/speech` with `{ model, input: text, voice, response_format: "pcm" }`;
    - yields `response.body` chunks as they arrive;
    - passes `signal` to `fetch`, so `stop` aborts the request.
  - `createFakeTts(chunks)` for tests.
  - `createSpeech({ tts, runtime, recall, channel, timeoutMs = 4000 }): Speech` (the `Speech` type from Task 11; `say` resolves to the utteranceId):
    - sends `speech_start`, then binary audio frames, then `speech_end`;
    - adds an agent caption;
    - `speaking` mood inputs are true while active.
  - `createAudioPlayer()` returns `{ push(pcm), stop(), level(): number /* RMS 0..1 for setMouth */ }`.

- [ ] **Step 1: Record the protocol.**
  - Read OpenRouter's TTS guide (`https://openrouter.ai/docs/guides/overview/multimodal/tts.md`) and the `elevenlabs/eleven-v4-turbo` model page (`https://openrouter.ai/elevenlabs/eleven-v4-turbo`).
  - Write the auth header, request fields, the available voice ids, and the PCM sample rate, channels and bit depth that model returns into `test/fixtures/openrouter-tts.md`, with URLs and date.
  - If the PCM format isn't 24 kHz 16-bit mono, use the documented format consistently in the worklet and the binary frame header comment (Task 3).
  - Confirm the format with one live request (fractions of a cent) by checking the byte rate against the audio duration.
- [ ] **Step 2: Write failing tests.**
  - `say streams start→audio→end to stage and adds agent caption` (fake TTS plus a ws client);
  - `stop aborts the provider stream and sends speech_stop`;
  - `tts failure falls back to chat and caption` (Review Focus 5): the provider throws or exceeds `timeoutMs`, which leads to `recall.sendChatMessage` with the text (≤500 chars) and an agent caption, and the loop is not blocked;
  - `createBot never sets include_bot_in_recording`.
- [ ] **Step 3: Run tests.** Expected: FAIL.
- [ ] **Step 4: Implement**, testing the OpenRouter client against a local fake HTTP server in `test/speech.test.ts` that streams PCM in chunks, following the recorded format. Also test that aborting mid-stream stops iteration.
- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Live check (manual).** In a test Meet, say "hey Builder, what do you think about a sidebar?". Expected:
  - Builder replies out loud within about 3 s;
  - its mouth moves with the audio;
  - its line appears as a "Builder" caption;
  - it isn't echoed back as a participant utterance.
- [ ] **Step 7: Commit.** `feat(voice): Eleven v4 Turbo speech via OpenRouter with stage playback`.

### Task 14: Interruption (barge-in)

**Files:**
- Modify:
  - `public/renderer/client.js`: when running inside the bot, connect to `wss://meeting-data.bot.recall.ai/api/v1/transcript`. Tests can override the URL with `?meetingData=ws://127.0.0.1:<port>`.
  - `src/agent/conversation-loop.ts`: server fallback, where a human partial transcript while `speech.speaking` calls `speech.stop`.
- Create: `test/barge-in.test.ts`

**Interfaces:**
- Produces: the stage's barge-in on any meeting-data message with non-empty words from a speaker other than `Builder`:
  - `audio.stop()` immediately;
  - send `{type:"barge_in"}` up the stage WS;
  - the server calls `speech.stop(sessionId)`.

- [ ] **Step 1: Write failing tests.**
  - Node: `human partial during speech stops speech (server fallback)`.
  - Chrome with a local fake meeting-data WebSocket: `stage stops audio within 300ms of a human transcript message and notifies server`, measured as the time from the fake message to `audio.stop` and the `barge_in` receipt.
- [ ] **Step 2: Run tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(voice): barge-in via bot-local meeting data and server fallback`.

### Task 15: Replay harness, end-to-end test, docs

**Files:**
- Create: `scripts/replay.ts`, `test/fixtures/sessions/todo-app.json`, `test/e2e-replay.test.ts`
- Modify: `README.md` (Builder overview, env vars, run and replay instructions, manual live checklist), `package.json` (`"replay": "node scripts/replay.ts"`)

**Interfaces:**
- Produces:
  - Fixture format: `{ participants: string[], utterances: { t: number /* ms */, speaker: string, text: string, partial?: boolean }[], fakeModel?: { conversation: ToolCall[][], build: ToolCall[][] } }`.
  - `replay(fixture, { baseUrl, sessionId, secret, speed = 1, liveModels = false })`: posts signed `transcript.data`/`transcript.partial_data` webhooks to `/recall/realtime/` on schedule.
  - With `fakeModel` (the default for tests), the app is constructed with `createFakePort` and `createFakeTts`.
  - `todo-app.json` covers:
    - opening;
    - two proposals with support;
    - one proposal with no objection (30 s promotion);
    - a conflict and its resolution by "B";
    - "hey Builder" with a question;
    - the voice command "click Add";
    - 25 s of silence after Builder's question, which triggers a stuck turn.

- [ ] **Step 1: Write failing test** `e2e-replay.test.ts`:
  - the final doc has the expected agreed decisions, and the conflict is resolved with B;
  - the final proto contains the merged variant;
  - `speak` happened exactly for opening, answer, stuck and confirm_conflict;
  - `model_calls` has rows, and `sessionCost > 0` (fake usage);
  - the handoff page lists the decisions, and the export is self-contained.
- [ ] **Step 2: Run tests.** Run `node --test test/e2e-replay.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the replay script and fixture, and fix any integration gaps it exposes.
- [ ] **Step 4: Run tests.** Run `npm test && npm run smoke`. Expected: all pass, and `SMOKE OK`.
- [ ] **Step 5: Live eval (manual, costs money; ask the user first).** Run `npm run replay -- test/fixtures/sessions/todo-app.json --live-models` against a running server with a stage open in Chrome. Record observed latencies against the targets and the per-session cost in the README.
- [ ] **Step 6: Live meeting checklist (manual, with the user).** In a real Google Meet with 2+ people:
  - Builder opens;
  - it stays silent while people talk;
  - drafts appear and agree;
  - a disagreement produces A/B options and resolves by voice;
  - "click Add" works;
  - interrupting Builder stops it;
  - the handoff link works after the call.
- [ ] **Step 7: Commit.** `feat: replay harness, end-to-end test, Builder docs`.
