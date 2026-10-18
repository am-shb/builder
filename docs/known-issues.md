# Builder v0: known issues and remaining fixes

From the final whole-branch review on 2026-10-17 (range `fafebe0..5b76f58`). The review found no Critical issues, 7
Important and 10 Minor. To claim an open item, put your name next to it.

## Fixed on 2026-10-17 (branch `infra/production-readiness`)

These were the blockers for any shared deployment. Each fix has tests.

- **I1. Model calls had no deadline.** Each call now has a deadline that covers the whole stream:
  `DEADLINE_MS` is 8 s for conversation and 90 s for build (`src/agent/llm.ts`). The deadline is raced against the
  stream, so it holds even when a body ignores the abort signal. Once events have started, the billed usage and the
  completed tool calls are kept. A call that times out before any event fails with `LlmTimeoutError`. Every timeout
  logs `llm_timeout`. `maxRetries` is 1.
- **I5. Nothing handled the end of the call.** When `pollOnce` sees a terminal status (`done`, `call_ended` or
  `fatal`), it calls:
  - `conversation.onBotEnded`, which stops speech, drops the session's state and discards a turn still in flight;
  - `buildLoop.end`, which clears timers, drops pending work, discards a run still in flight and ignores later
    hand-offs.

  Late realtime events for a terminal session are stored, but the agent doesn't act on them, and that holds after a
  restart too. Pending decisions stay pending, so the handoff is final.
- **I6. A throw while processing a realtime webhook crashed the server.** `processRealtime` is now wrapped and logs
  `realtime.process_failed` with the error name only. `getConsensus` uses `safeParse` and logs
  `store.consensus_invalid`, and the session starts from a fresh doc. `server.ts` adds a last-resort
  `uncaughtException` handler that logs the error name and stack frames, never the message.
- **I7. The handoff link exposed the live transcript.**
  - Captions reach the stage as `{partial, isAgent}` only. The snapshot and `/state` no longer carry captions.
  - `speech_start` no longer carries Builder's line.
  - The public `/stage/<id>/stream` SSE route, which the stage didn't use but which streamed every utterance to
    anyone holding the stage token, is gone. The operator's own stream stays at `/api/sessions/<id>/stream`, which
    is local only.
  - The handoff has its own read-only `handoff_token`, so a shared handoff link can no longer open the stage socket
    or send `barge_in`. **Handoff links issued before this change stop working.** Copy the new one from the
    operator page.
- **M6.** `.env.example` now says an empty `BOT_VARIANT` means `web_4_core`.
- **Also found:**
  - `npm test` (`node --test test/`) didn't run on Node 24. It now uses the glob `test/**/*.test.ts`.
  - The `http.error` log printed error messages, and V8's `JSON.parse` messages quote the request body. It now logs
    the error name only.

## Also fixed on 2026-10-17 (branch `infra/production-readiness`)

Everything below has tests, and `npm run check` passes. The visual items were checked in headless Chrome at
1280×720, not yet in a live Meet (see Manual checks).

### Agreement correctness

- **I2. Agreed nodes changed without a decision.** `sanitizeModelBatch` (`src/agent/handoff.ts`) now gets the current
  prototype and the decisions this run reopens:
  - A model `update` never sets a status. One that changes an agreed node's props or `decisionId` sends the node
    back to draft. An update that changes nothing is dropped.
  - A `remove` of an agreed node, or of anything holding one, is dropped unless the same run objects to that node's
    decision. A batch left empty is skipped and counted as `patches_empty` in `build.run`.
  - `flipNodes` also flips the nodes drawn with the decision's id, and skips nodes already in the target state.
    Reopening a decision leaves a node that another decision has agreed since. So a changed node turns solid again
    when a decision covering it is agreed.
  - Conflict variants are exempt: the room's pick is itself the decision `d-<conflictId>`.
- **I3. A resolved choice could claim a merge that never happened.** `resolveChoice` (`src/agent/build-loop.ts`)
  now returns `ignored`, `settled`, `merged` or `unmerged`.
  - The model sees `resolvedChoice` only for a pick merged just now, so the prompt's "already merged" is true.
  - A pick for a conflict resolved earlier is removed and no longer skips the 10 s floor.
  - When the winner's batch no longer applies, the topic gets a proposal that starts "Redraw option B of conflict
    …", credited to a backer heard picking it, or else to someone in the grounding lines. `prompts/build.md` tells
    the model to draw it again as drafts with the decision's id. Those nodes stay draft until a decision covering
    them is agreed.
  - A repeated `resolveComparison` for a resolved conflict now changes and sends nothing.

### Minor

- **M1.** One comparison is on screen at a time. A conflict raised while another is shown waits in the doc
  (`build.comparison_queued`). Resolving the conflict on screen shows the next open one (`nextComparison` in
  `src/session/runtime.ts`), and resolving any other conflict leaves the shown comparison alone. The stage opens the
  next comparison only after the winner's expansion has played out.
- **M2.** A restart now restores:
  - the open comparison, rebuilt from the saved doc when the runtime is created;
  - Haiku's 40-line window, plus who joined and who spoke. `createApp` calls `conversation.resume` for every call
    still recording. The reloaded lines count as handed off, so their support can't be replayed into a decision
    that was reopened since.
  - the no-objection timer, through `buildLoop.resume` for every active session.

  Still lost on restart: hand-offs waiting for a run, a run in flight, a line Builder is speaking, and the
  addressed, stuck and voice-command timers.
- **M3.** An agreed decision with nobody named shows "Agreed by: no objection within 30 s". For a side-by-side pick
  whose backers were all stripped, it shows "the room, picking between side-by-side options", because a 30 s label
  would be wrong there.
- **M4.**
  - `ADDRESS_RE` (`src/agent/stuck.ts`) ignores "builder" right after an article or a common compound word, such as
    "form builder", "page builder" or "drag-and-drop builder". The list is a heuristic; add words as they come up.
  - The first thing someone says within 15 s of Builder's line, if it's a question, opens `answer` like the name
    does (`FOLLOW_UP_MS`). It also doesn't start the room-silence timer. The prompt tells Haiku to answer only if
    the question is meant for Builder.
- **M5.** The wait for a line's first audio is 4 s plus 15 ms a character, at most 8 s (`firstChunkTimeout` in
  `src/voice/speech.ts`). The gap allowed between chunks stays 4 s.
- **M7.** `GET /api/sessions/<id>/cost` returns `{ cost_usd }`. It's local only, like the rest of `/api`. The
  operator page polls it instead of the whole session.
- **M8.** `/handoff/<id>` (and its export) shows an empty prototype and doc until the first patch or doc is saved.
  It's still token-gated.
- **M9.** A batch's `by` is removed unless that person is in the grounding lines. That covers the model's own
  batches and conflict variants, and it counts toward `grounding_dropped`.
- **M10.** A pending decision whose 30 s run out waits to be promoted until every hand-off received before then has
  been applied, so an objection already on its way lands first. Hand-offs received later don't hold it, so the wait
  is at most the run in flight plus the next one.
- **Hand-off repair.** When a topic carries `requestedView`, the hand-off's own value wins. Otherwise the last
  topic's value is used, the same rule as merging hand-offs. A topic whose view isn't kept gets it as its
  `screenHint` when it has none. `prompts/conversation.md` now says `requestedView` belongs on the hand-off.

### Visual polish

- **Spotlight label.** It goes above the change on the left, above on the right, below, or beside it, whichever
  covers the least of the other text on the canvas (`placeLabel` in `public/renderer/focus.js`).
- **DRAFT tags.** There's one tag per draft region, at 20 px. A draft inside another draft shows no tag or outline
  of its own. The spotlight and comparison rings read the tag's offset from the CSS.
- **Opening line.** The prompt asks for at most 100 characters, about five seconds out loud. A longer opening is
  blocked (`too_long`) and the fixed line is said instead: "Hi, I'm Builder. I'll listen and sketch; say my name if
  you need me."
- **`focus_option`.** "Show option B" sends a `focus_option` stage event. The pointer moves to option B, the other
  options dim and B is ringed for 3 s. Nothing is picked, and the command counts as visible, so Builder says nothing.

## Still open

- **I4. Plan versus spec §9: the conflict merges before the room confirms.** *Ruling for v0: keep the current
  behavior*, because the live test matched expectations. The merge happens when Haiku reports a pick, and "So: B.
  Everyone OK?" comes afterwards. An objection then only demotes nodes to draft; the comparison can't come back.
  - *Smallest fix:* an `object` on `d-<conflictId>` within a few seconds of `decidedAt` reopens the conflict and
    re-shows the comparison.
  - *Fix that follows the spec:* keep the comparison up with the winner highlighted, and merge after a few seconds
    with no objection.
  - Choose one of these before changing it.
- A model `move` of an agreed node keeps it agreed. I2 covered props, `decisionId` and removals, which was the
  fix the review asked for. Decide whether a move should also send the node back to draft.
- *Accepted:* a misspelled optional key on a patch op is stripped (`validateToolInput` in `src/agent/llm.ts`), the
  cost of tolerating OpenRouter's non-strict tool inputs. An update left with nothing to change is now dropped
  instead of spotlighting a node that didn't change.

## Open since the first production deploy (2026-10-18)

From the reviews of the SurrealDB port and the Render setup (ADR 0011, ADR 0005). Production runs on Render with
SurrealDB Cloud, and the first real meeting worked end to end. These are what's left. R1 to R4 come before anyone
outside the team gets an api token, or before meetings run on Render often.

### Before other people start sessions

- **R1. Spend limits aren't enforced.** The api sends `limits: { maxUsd, maxMinutes }` and the engine stores them
  with the session (`createIntent` in `apps/engine/src/store.ts`), but nothing ends a session when it reaches either
  one. A bot runs, and costs Recall and model money, until the call ends or someone removes it. ADR 0008 says the
  engine enforces them and ends the session with a clear message.
- **R2. A deploy ends live meetings, and two engines can run the same meeting.** Session state lives in memory, so
  the new instance doesn't know the old one's sessions. During Render's overlap, both instances also resume active
  sessions from the database, with no fence to stop the old one. Until this is fixed, merge engine changes outside
  meetings, or pause auto-deploy on `builder-engine` first (runbook).
- **R3. Shutdown doesn't wait for pending writes.** On SIGTERM, every deploy, the store closes without waiting
  for in-flight Recall events and consensus writes, so the last few can be lost.
- **R4. Store queries have no timeout.** A hung connection to SurrealDB Cloud stalls that session's write queue.
  Reconnects over the internet haven't been tested under load.

### Security

- **R5. Stage and hand-off links are the only access check.** Anyone holding a stage or hand-off link can open it.
  ADR 0008 leaves the rule open: signed, expiring links, or an org check through the api.
- **R6. The engine's operator routes can be reached from inside the Render workspace.** `/` and `/api/*` refuse
  requests that carry proxy headers, so the public internet can't reach them. Requests over the private network
  carry none, so any service in the workspace could send a bot. Only `builder-engine` and `builder-api` are there
  today. The fix is to turn the operator routes off when `RENDER` is set, or to require a token.

### Operations

- **R7. The database is on SurrealDB Cloud's free tier.** It holds at most 1 GB, keeps one day of backups by
  default, and pauses itself after seven days without use, after which nothing can reach it until it's resumed.
  Before customers: move to a paid instance, set backups to 7 days, and try restoring a backup into a new instance
  (ADR 0011).

### Minor

- **R8.** If the store read in `conversation.resume` fails after a restart, Builder says its opening line again in
  the middle of the call.
- **R9.** The engine's `/api/sessions/<id>/chat`, `/leave` and `/screenshare` routes return the error's message in
  their 502 reply (`apps/engine/src/app.ts`). These routes are local only and the message isn't logged, but a
  database error message can quote values. Return the error code instead.
- **R10.** A bad setting stops the api with a raw stack trace (`loadConfig` in `apps/api/src/server.ts` runs outside
  any `catch`). It names the variable, never its value, but should be one `config.invalid` log line and exit 1, the
  way the engine does it.
- **R11.** Builder's own chat lines are stored outside the per-session queue, so their order against other events
  can be off by milliseconds.

## Manual checks still pending

- **Live replay eval:**
  - Start the server, open a stage in Chrome, and run `npm run replay -- test/fixtures/sessions/todo-app.json
    --live-models`.
  - Record latencies and per-session cost in the README.
  - This costs money.
- **Full live Meet checklist with 2+ people** (see the README):
  - silence while people talk;
  - A/B options resolved by voice, including two conflicts raised together and "show option B";
  - "click Add";
  - barge-in;
  - a follow-up question to Builder without its name ("why?");
  - the length of the opening line, the spotlight labels and the DRAFT tags as Meet shows them;
  - the handoff link after the call.
