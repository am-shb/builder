# Builder v0: known issues and remaining fixes

From the final whole-branch review on 2026-10-17 (range `fafebe0..5b76f58`). The review found no Critical issues, 7
Important and 10 Minor. None of these were fixed before v0 was frozen. File references are at commit `5b76f58`.

## Fix before the next live session

**I1. Model calls have no deadline.**
`src/agent/llm.ts:62-66, 103-130`. The SDK timeout stops counting once response headers arrive, so a stalled stream
can hang for minutes. Both loops run one call at a time per session. A hung Haiku call leaves Builder silent and ignoring
voice commands; a hung Opus call freezes the prototype.
- *Fix:*
  - Give each loop's call a deadline through an `AbortController` passed as `signal`: about 8 s for conversation and
    60–90 s for build.
  - Set `maxRetries` to 0 or 1.
  - On abort, keep the usage already seen and log `llm_timeout`.
  - Test with a fake body that never ends: the loop recovers, and the next utterance runs a turn.

**I6. A throw while processing a realtime webhook crashes the server.**
`src/app.ts:138-173`, which runs from `setImmediate` at `:275`. It also reaches `runtime.ts:76` and `store.ts:174-181`.
Nothing catches a strict-schema parse failure on the stored consensus row (likely after a restart onto changed code) or
a SQLite error. The process dies, and it dies again on every later utterance.
- *Fix:*
  - Wrap `processRealtime` in try/catch and log the error name only.
  - Make `getConsensus` use `safeParse` and fall back to a fresh doc.

**I5. Nothing handles the end of the call.**
`src/app.ts:120-135` forwards only `in_call_recording`. Also `conversation-loop.ts:468-482`, `stuck.ts:32-51` and
`build-loop.ts:179-207`.
- *Effects:*
  - After the bot leaves, a Builder question followed by silence re-fires the stuck turn every 120 s, costing one Haiku
    call plus one TTS call each time, indefinitely.
  - Pending decisions keep auto-agreeing 30 s after the meeting, so the handoff is never final (spec §14).
- *Fix:*
  - When `pollOnce` sees a terminal status (`done`, `call_ended` or `fatal`), call `conversation.onBotEnded(id)`: stop
    speech and drop the session's state.
  - Call `buildLoop.end(id)`: clear timers, drop pending work and ignore later hand-offs.
  - Freeze consensus.
  - Test that after a terminal status there are no model calls and no promotions.

**I7. The handoff link exposes the live transcript.**
`src/app.ts:155, 168, 224-235`; `runtime.ts:110-116, 142-149`. The handoff reuses the stage token. The runtime still
pushes full caption text to the stage WebSocket, the snapshot and `/state`, though the stage no longer shows captions.
The same token can also stop Builder's voice through `barge_in`.
- *Fix:*
  - Send captions with no text: `{partial, isAgent}` is all `character.hear()` needs.
  - Drop captions from the snapshot and `/state`.
  - Preferably, also give the handoff its own read-only token.

## Agreement correctness (fix together)

**I2. Agreed nodes can change without a decision.**
`src/agent/handoff.ts:118-133`, `src/ui/tree.ts:89-97`.
- *What happens:*
  - A model `update` to an agreed node's props keeps it solid "agreed", both on screen and in the handoff.
  - A `remove` leaves its decision agreed while the node is gone.
- *Fix:*
  - Pass the current proto into `sanitizeModelBatch`. A props or `decisionId` update on an agreed node sets it back to
    `draft`, and `flipNodes` restores it if the room agrees again.
  - Drop a `remove` of an agreed node unless its decision is reopened in the same run.

**I3. A resolved choice can claim a merge that never happened.**
`src/agent/build-loop.ts:226-237, 400-409`; `runtime.ts:186-200`; `prompts/build.md:65`.
- *What happens:*
  - `resolvedChoice` stays in the hand-off when the winning batch was rejected, or when the conflict was already
    resolved.
  - The build prompt then tells Opus the winner "has already merged". The decision log says agreed, but the prototype
    never shows the winner.
- *Fix:*
  - `resolveChoice` returns `{ acted, applied }`.
  - When the batch didn't apply, rewrite the topic as a proposal to redraw the variant.
  - When the conflict was already resolved, drop the choice.
  - Update the prompt line to match.

**I4. Plan versus spec §9: the conflict merges before the room confirms.** *Ruling for v0: keep the current behavior*,
because the live test matched expectations. The merge happens when Haiku reports a pick, and "So: B. Everyone OK?"
comes afterwards. An objection then only demotes nodes to draft; the comparison can't come back.
- *Smallest fix:* an `object` on `d-<conflictId>` within a few seconds of `decidedAt` reopens the conflict and re-shows
  the comparison.
- *Fix that follows the spec:* keep the comparison up with the winner highlighted, and merge after a few seconds with no
  objection.
- Choose one of these before changing it.

## Minor

- **M1.** `runtime.resolveComparison` clears the visible comparison even when it resolves a different conflict
  (`runtime.ts:195`). Two `add_conflict` ops in one run show only the last one (`build-loop.ts:306-315`).
- **M2.** A restart loses some state:
  - the open comparison;
  - Haiku's 40-line window (it is not reloaded from `store.recentUtterances`);
  - the build tick, which doesn't run until the next hand-off.
- **M3.** The handoff says "Agreed by: nobody yet" for decisions promoted by the 30 s timer and for conflicts whose
  backers were stripped (`export.ts:71`). Label these "no objection within 30 s".
- **M4.** `ADDRESS_RE` matches "form builder" and "page builder" (`stuck.ts:13`). Direct follow-ups without the name,
  such as "why?", aren't answered.
- **M5.** `TTS_TIMEOUT_MS = 4000` to the first chunk (`speech.ts:15`), but provider audio isn't streamed progressively.
  Long lines can fall back to chat. Scale the timeout with text length, or raise it to 6–8 s.
- **M6.** `.env.example:10` says an empty `BOT_VARIANT` means `web`; the code defaults to `web_4_core`.
- **M7.** The operator UI's cost refresh refetches every stored event every 5 s (`public/index.html:119-126`). Add a
  small cost endpoint instead.
- **M8.** `/handoff/<id>` returns 404 until the first patch or doc is saved. Render an empty handoff instead.
- **M9.** A patch's `by` (the on-screen credit) isn't checked against the grounding speakers (`build-loop.ts:273`).
- **M10.** Results that went stale during a run are checked only by validation, which can cause brief
  agreed-then-reopened flips (`build-loop.ts:290-305`).
- The hand-off repair keeps the first topic's `requestedView` and silently drops differing ones (`handoff.ts:49`). The
  conversation prompt doesn't say `requestedView` belongs at the hand-off level (`prompts/conversation.md:47`).
- A misspelled optional key on a patch op is stripped, so that op does nothing (`llm.ts:378`). This was accepted as the
  cost of tolerating OpenRouter's non-strict tool inputs.

## Visual polish (from the live test)

- The spotlight label overlaps the content above its target.
- The DRAFT tags are visually busy, and their 15 px font is under the 20 px stage minimum.
- The opening line runs about 10 s; shorten it.
- `focus_option` ("show option B") has no visual effect.

## Manual checks still pending

- **Live replay eval:**
  - Start the server, open a stage in Chrome, and run `npm run replay -- test/fixtures/sessions/todo-app.json
    --live-models`.
  - Record latencies and per-session cost in the README.
  - This costs money.
- **Full live Meet checklist with 2+ people** (see the README):
  - silence while people talk;
  - A/B options resolved by voice;
  - "click Add";
  - barge-in;
  - the handoff link after the call.
