# 0002: Builder's to-do list, streamed tool calls, and a faster build loop

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/agent`, `src/session`, `src/stage`, `public/`)

## Context
In the live test the spoken replies were fine, but changes took too long to show up on the stage. Reading the code
showed where the time goes, between a person's final transcript line and the change on screen:

- The model port waits for the whole model response before it returns any tool call (`src/agent/llm.ts`). So Haiku's
  hand-off waits for the rest of its turn, and Opus's patch batches all land at once at the end of a run, even
  though the build prompt asks for "a burst of small batches".
- Build runs start at least 10 s apart (`RUN_FLOOR_MS`, spec §12).
- Opus runs at `effort: "medium"`.

The room also can't see what Builder is working on. Next to the robot, the stage shows one large mood word
("Thinking", "Building"…), which says nothing about what is coming.

## Options considered
1. **Speech-to-speech (OpenAI Realtime) for the voice.** Rejected for this problem. It only speeds up speech, which
   was already fine, and it can't attribute speakers, which grounding requires (spec §4, §12).
2. **A faster build model (Sonnet) in place of Opus.** Deferred. Comparing quality needs a paid replay. We lower
   Opus's effort first and measure.
3. **Stream tool calls out of the port, apply them as they arrive, shorten the run floor, lower effort, and show a
   to-do list.** Chosen.

## Decision
- **Streamed tool calls.** `RunToolsRequest` gets an optional `onToolCall(call: ToolCall)`. The port calls it as soon
  as a tool block closes and its input has passed validation, with the same checks as before. `RunToolsResult.toolCalls`
  still lists every valid call. The stop reason only arrives at the end of the stream, so when a turn ends in
  `refusal` or `max_tokens`, calls already sent through `onToolCall` have taken effect. The result still holds no tool
  calls, as before. We accept this: every batch is validated and atomic on its own, and the build loop never marks
  model batches as agreed.
- **Build loop.** It applies each `apply_patches` batch as it arrives. Consensus ops still apply after the run, so
  patches still land before the ops that reference them. Effort is `low`, the lowest the Messages API accepts.
  `RUN_FLOOR_MS` goes from 10 000 to 3 000, which differs from spec §12's 10 s.
- **Conversation loop.** It forwards `update_build` and runs `ui_command` as each arrives. `speak` still runs after
  the turn and goes through the speech gate as before.
- **To-do list.** Each hand-off topic gets an optional `task`: a short line saying what Builder will do, such as
  "Adding the buttons". When it's missing, the topic's `title` is used. The build loop owns a per-session list of
  `BuildTask { id, text, state: "now" | "queued" | "done" }`, and the runtime pushes it to the stage as a new
  `tasks` StageEvent. The list is also part of the snapshot. When a run applies anything, its tasks turn `done` and
  are removed 3 s later. When a run applies nothing or fails, its tasks are removed at once, so the list never claims
  work that didn't happen.
- **Stage.** The mood word is removed and the list takes its place, showing at most 4 rows. Before anything is built,
  only the "now" rows show, under the robot. While options are compared, the list hides with the dock. The robot
  keeps all its mood poses and colours.
- **Timing logs.** These record ids and milliseconds only: `conversation.turn` gains `queued_ms` and `handoff_ms`, and
  `build.run` gains `wait_ms`, `first_patch_ms` and `last_patch_ms`.

## Consequences
- The first change appears when Opus finishes its first small batch, not its last, and hand-offs reach the build
  loop sooner.
- More Opus calls per meeting, because runs can start every 3 s. Each call is cheaper at low effort. Watch
  `sessionCost`.
- The prototype may look rougher at low effort. If it does, the next step is the Sonnet comparison, which needs a paid
  replay.
- This ADR supersedes spec §12's 10 s run floor. The §10a moods stay, and from now on only the robot's pose and
  colour show them.
