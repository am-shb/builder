# Meeting Prototype Agent — Design

Date: 2026-10-16 · Status: ready for approval

## 1. Intent

Business users join a Google Meet to decide what a **brand-new app's UI**
should look like. An AI agent joins the call as a participant and listens to
everyone. It steers the group toward decisions the way a good facilitator would,
and builds a **prototype the group agreed on**, live on its shared screen. When
the call ends, engineers receive a link to the clickable prototype, the
component spec, and the decision log, and can build from there.

Why: turning a meeting's conversation into an agreed UI today takes a designer,
follow-up meetings, and a lot of lost context. The agent compresses that into
the meeting itself, while the people in the room stay the ones who decide.

This is the first of two planned uses. The second, where users and engineers
produce a full product spec that agents can implement autonomously, is out of
scope here (see §3). It is expected to reuse most of this design.

## 2. Goals

1. During the call, the shared screen shows a live prototype of the app being
   discussed. It updates as the group decides things.
2. The agent facilitates. It opens the session, then stays mostly silent, and
   speaks **out loud** only when addressed or when the group is stuck.
3. When it speaks, it acts as an expert. It offers an opinion or suggestion,
   then hands the decision back by asking the room.
4. It steers the session through phases modelled on the superpowers
   brainstorming flow (§6).
5. When participants disagree, it shows **2–3 options side by side** on the
   shared screen. The room picks one out loud, and the agent confirms and
   merges the winner into the prototype.
6. Participants operate the prototype **by voice** ("click Add", "go to
   Settings"). The agent performs the action on the shared screen, because a
   screen share can't be clicked.
7. When the call ends, engineers get a handoff page with: a link to the
   **clickable** prototype, the **component spec**, and the **decisions**
   (plus open questions).

## 3. Non-goals (this version)

- The "full product spec for autonomous agents" session (use #2).
- Calendar scheduling. Bots are still sent by pasting a Meet link (existing UI).
- Generating production code. The output is a prototype and a spec, not an app.
- Authentication or multi-tenant accounts. This stays a single-operator tool
  run locally.
- Platforms other than Google Meet. The pipeline supports Zoom and Teams, but
  they aren't designed for or tested.
- Persisting prototype data. Prototype interactions such as adding a task are
  local and illustrative only.

## 4. Anti-goals (failure even if it "works")

- **The agent talks too much.** It interrupts, lectures, or narrates what it's
  doing. Silence is the default.
- **The agent invents agreement.** The prototype or decision log shows
  something as decided that the room didn't agree on.
- **The agent decides for the room.** Suggestions are fine; choosing between
  contested options isn't.
- **The screen breaks.** A malformed render, a blank screen, or a frozen stage
  in front of business users.
- **The screen is confusing or janky.** Things change without the room
  noticing what changed, motion stutters, or the agent looks dead while it
  works.
- **Engineers can't use the handoff.** The spec doesn't match the prototype, or
  the decisions lack the context of why.

## 5. Existing foundation (already built, in this repo)

- A Node 24+ backend in TypeScript run natively, with zero npm dependencies
  and `node:sqlite`. It holds the Recall credentials, sends bots with
  `POST /api/sessions`, writes a scheduling record before every create, and
  polls bot status.
- Recall.ai workspace **Meet2Build**
  (`f8808c9f-f2a3-487d-be1a-bf8f6d58fb9b`), region us-west-2, API v1.11.
- Live transcription: `recallai_streaming` in `prioritize_low_latency` mode
  with perfect diarization (speaker names). A signed real-time webhook
  delivers `transcript.data`, `transcript.partial_data`, participant join and
  leave, and chat events, each verified and deduplicated.
- **Stage:** a token-gated page `/stage/<session>` that the bot screen-shares
  through Output Media (1280×720). It polls `/stage/<id>/state` every second;
  it can't use SSE, because Cloudflare quick tunnels buffer it. It renders a
  sandboxed HTML prototype, captions, and an animated "listening" robot. Its
  animations run on a 15 fps clock.
- The local control UI only answers localhost. Through the tunnel, only
  `/stage/*` (token) and `/recall/realtime/` (signed) respond.

## 6. Facilitation model

The agent keeps a current **phase** and moves forward as the conversation
earns it. It can step back to an earlier phase when needed.

1. **Opening** (spoken, once): introduce itself, say what it's there to do,
   say it will mostly listen and can be asked things by name, and ask one
   opening question about what the app is for and who uses it.
2. **Understand:** purpose, users, the main jobs to be done, constraints. The
   agent stays silent while the room talks. If it's asked, or the room is
   stuck, it asks **one** question at a time, multiple choice where possible.
3. **Explore:** for each major screen or flow, the agent can propose 2–3
   approaches with a recommendation and why. Contested points become
   side-by-side options (§9).
4. **Converge:** decisions move from draft to pending to agreed as described
   below. Only conflicts get a spoken "So: B. Everyone OK?"
5. **Detail:** screen by screen. It checks each part with the room before
   moving on, and pushes back on extras the first version doesn't need.
6. **Recap** (when asked, or near the end): what was agreed, what's open, and
   that the handoff link will be shared.

**How things become agreed** (decided):
- **Draft:** a proposal someone makes appears on the prototype right away,
  drawn as a draft with a dashed outline and a "draft" tag. If it's dropped,
  the draft is removed.
- **Pending:** the agent lists it under Agreed, marked pending, without
  saying anything.
- **Agreed:** it becomes agreed when another participant backs it, or when
  nobody objects within about 30 seconds of it being marked pending. Then the
  outline turns solid and `agreed_by` and `decided_at` are recorded.
- **Spoken confirmation** happens only for conflicts resolved through
  side-by-side options (§9). Uncontested decisions are confirmed silently on
  screen.
- An objection at any point sends the item back to draft, or turns it into a
  conflict.

Behaviour rules that hold in every phase:

- **Expert stance:** bring a concrete opinion grounded in common practice,
  then ask the room. Never present a choice between contested options as
  already made.
- **One thing at a time:** spoken turns are short, 1–2 sentences, with at most
  one question.
- **Never claim agreement the room didn't give** (anti-goal).

## 7. When the agent speaks

**Speaks when:**

- **Opening:** once, after the bot is recording and at least one human is
  present.
- **Addressed:** a participant says the agent's name, **"Builder"**
  (decided; also accept "hey Builder"), or clearly asks it something
  directly. The Meet display name is "Builder".
- **Stuck** (*my guess, tunable*): any of these:
  - silence of 20 s or more after a question to the room;
  - the same conflict unresolved through about 3 back-and-forth exchanges, or
    about 3 minutes;
  - an open question nobody has engaged with for about 3 minutes.

  While "stuck" speech is in cooldown (*my call:* at most once every 2
  minutes), the agent stays silent even if stuck.
- **Voice command acknowledgement:** a very short confirmation ("Done", or a
  brief error) only when the action can't be seen or failed.
- **Conflict confirmation:** the one-line spoken confirmation when the room
  picks a side-by-side option (§9).

**Stays silent:** in every other case. Screen updates happen silently.

**Interruptions** (*my call*): if any participant starts speaking while the
agent is talking, the agent stops within about 300 ms. Signal: the
`participant_events.speech_on` real-time event, or a partial transcript from a
human.

## 8. Voice commands

- Recognised from finalized or partial transcripts. Examples: "click Add",
  "open Settings", "go back", "type *buy milk* into the task box",
  "toggle dark mode", "show option B".
- The conversation model maps the utterance to an action against the
  **current screen's** components: `click <node>`, `navigate <screen>`,
  `type <node> <text>`, `toggle <node>`, `focus option <A|B|C>`.
- The stage runs the action on the live prototype, using the same interaction
  logic as the clickable link (§10). It briefly highlights the target, so the
  room sees what was "clicked".
- Ambiguous target: the agent asks a one-line clarification out loud ("The Add
  button or Add list?").

## 9. Disagreements: options side by side

- The build loop records a **conflict** when two or more participants push
  incompatible choices for the same thing, and nobody has settled it.
- It then generates 2–3 **variants**. Each one changes the same part of the
  prototype, is built from the same components, is labelled **A / B / C**,
  and carries a one-line tradeoff and who's backing it.
- The stage switches to a **comparison view**: variants side by side as scaled
  previews, inside the same 1280×720 frame.
- **Resolution:** someone says "A", "let's go with B", and so on. The agent
  restates the choice and confirms there's no objection. Then the winning
  variant merges into the prototype, the conflict becomes a decision, and the
  rejected variants go into the log.
- The agent may recommend a variant when asked. It never resolves a conflict
  without the room.

## 10. The prototype: component tree, not free HTML

The prototype is a **tree of components from a fixed set**, rendered by the
stage and by the clickable link. The model never writes HTML for the prototype.
(The existing raw-HTML push stays as a manual or debug escape hatch.)

**Component set** (*my call*; the implementer may adjust within the spirit):
App, Screen, NavBar, Tabs, Stack (row/column), Card, Text/Heading, Button,
Input, Select, Checkbox/Toggle, List/ListItem, Table, Badge, Modal, Image
placeholder, Chart placeholder, EmptyState.

**Node shape:** `{ id, type, props, children }`. ids are stable and
human-readable, such as `today.task-list`, so patches and decisions can
reference them.

**Interactions:** a small, declarative set, enough to make the link
genuinely clickable:
- `navigate(screen)`
- `toggle(node)`
- `open/close(modal)`
- `append(listNode, fromInput)`
- `setValue(node)`

There's no arbitrary code. State is in memory and illustrative.

**Changes are patches:** `add | update | remove | move` node,
`set_current_screen`, `show_comparison`, `resolve_comparison`. Small edits keep
model output short and fast, and let the renderer animate what changed.
Patches are validated against the component schema before they're applied; an
invalid patch is rejected and logged, and never rendered. Every node carries
`status: draft | agreed` (and the decision id that agreed it). The renderer
styles draft nodes distinctly, with a dashed outline and a tag.

**Visual style** (*my call*): one clean, neutral design system with large
type, tuned to stay readable after Meet's 720p video compression.

**Bot size** (revised after "visuals are very important"): use
`BOT_VARIANT=web_4_core` (2.25 cores) by default. Smooth animation on the
shared screen is a first-class requirement, and the default bot's 0.25 core
can't deliver it. Recall lists `web_4_core` at about $0.60/hour on
pay-as-you-go. The output is still 1280×720 at 15 fps, so motion is designed
for 15 fps (§10a).

## 10a. Shared-screen experience and personality

The shared screen is the face of the product. **Visual quality is a primary
requirement, not polish.** Three things matter most: smooth motion, an
unmistakable focus on what's changing, and an agent that feels responsive and
alive. The mockup is in the brainstorm session
(`personality-and-focus.html`).

**Layout** (decided after seeing the first build, 2026-10-17): no outer stage
shell. There's no header strip, no dark margins and no frame around the
prototype; the prototype fills the left of the 1280×720 frame edge to edge at
full height. A right column holds the Agreed / Pending / Open questions panel,
with the current phase as a small line at its top, and Builder's dock below
it. **No live transcript or caption bar is shown on the stage.** Caption events
still feed the listening animation and the agent loops, but the panel is the
only text summary the room sees.

**Character.** One recognisable character named **Builder** (decided), an
evolution of the existing blue robot. "Builder" is also the bot's display name
in Meet, and the name people say to address it. It sits in a dock while the prototype is on screen, and takes
centre stage while nothing has been built yet. Its mood always shows what
it's doing:
- **listening:** rings pulse with participants' speech;
- **thinking:** a build-loop call is in flight;
- **building:** patches are streaming in;
- **speaking:** its mouth is driven by its own voice audio;
- **curious:** it's asking the room something;
- **unsure:** a voice command was ambiguous;
- **pleased:** a decision or conflict resolution has landed.

Each mood maps to a real system state, never decoration.

**Voice personality** (*guess, to tune*): warm, brief, quietly confident, a
little playful. It's an expert who enjoys the craft. It doesn't flatter,
gush, ramble, or use filler. Its spoken lines and its on-screen character
express the same persona. The TTS voice is chosen to match.

**Focus on what changed.** Every applied patch gets a focus moment:
- **Spotlight:** for about 1.5 s, everything else dims, a ring surrounds
  the changed region, and a short label says what changed and whose idea it
  was ("Added: due date · Amir").
- **Motion with meaning:** added nodes grow or fade in; removed nodes
  collapse; moved nodes glide using FLIP layout animation; prop changes
  cross-fade.
- **Several changes at once:** focus moments queue and play one by one,
  briefly, so a burst of changes reads as a sequence, not chaos.
- **Follows the conversation:** when the discussion or a change moves to
  another screen, the prototype transitions there.
- **Draft vs agreed** stays visually distinct (dashed vs solid, §6). The
  moment a draft becomes agreed gets its own small "settled" animation.

**Responsiveness:**
- **Under 1 s:** the character reacts visibly (listening, then thinking)
  when it's addressed or a likely decision is heard. This happens before any
  model response arrives.
- **While the build loop streams:** a shimmering placeholder appears where the
  element is coming, then the real element builds in progressively.
- **Voice commands:** an on-screen pointer glides to the target and shows a
  press, then the action runs.
- **Comparison view:** it opens with a split transition. On resolution, the
  winning variant expands into place and the others fold away.

**Motion at 15 fps:**
- Durations of about 250–600 ms with ease-out curves.
- No tiny fast movements and no flashing.
- Every animation runs on the existing 15 fps clock, so frames are spent
  where the viewer can see them.
- *My call:* no UI sound effects; the only audio is the agent's voice.

**Acceptance:**
- Measured in headless Chrome under the `web_4_core` budget, focus moments
  and transitions hold the 15 fps output without dropped frames.
- A reviewer watching a replayed session can name what changed after each
  update without reading the transcript.

## 11. Shared session state ("consensus document")

The build loop maintains this document; the conversation model and the stage read
it. It's persisted per session in SQLite.

- `phase`
- `app`: name, purpose, users (as understood so far)
- `decisions[]`: `{ id, text, proposed_by, agreed_by[], decided_at, affects[node ids], rejected_options[] }`
- `open_questions[]`: `{ id, text, raised_by, since }`
- `conflicts[]`: `{ id, topic, variants[{ label, summary, backers[], patch }], status }`
- `prototype`: the current component tree
- `next_up[]`: a short queue of what the agent should say if it gets the
  floor, written by the build loop. For example: "ask Sara where done tasks go",
  or "suggest quick-add at top".

The **agreed** and **open questions** lists are shown on the stage next to
the prototype (see the brainstorm mockup at
`.superpowers/brainstorm/*/content/session-and-handoff.html`).

## 12. Two models, two loops

Naming: **Builder** is the character the room sees and hears. Inside it, the
**conversation loop** (Haiku) listens and speaks, and the **build loop**
(Opus) maintains the consensus document and the prototype.

**Conversation loop — Claude Haiku 5.5 (`anthropic/claude-haiku-5.5` on OpenRouter)** (the agent's ears and voice;
latency-critical):
- **Triggers:** each finalized utterance, plus a speech pause.
- **Inputs:** a rolling window of the attributed transcript, the consensus
  document's summary fields (phase, agreed, open, conflicts, `next_up`), and
  the current screen's components.
- **Acts only through tools**, with `tool_choice: auto`. Making no tool call
  means staying silent, which is the default.
  - `speak(text)`: answer a direct question, deliver a `next_up` item phrased
    for the moment, nudge when stuck, or confirm a conflict resolution
    (rules in §7).
  - `ui_command(action, target, value?)`: perform a voice command (§8).
  - `update_build(...)` (decided): hand the build loop a **summary of the
    topics discussed** since the last hand-off. This is the only way the
    build loop is triggered by conversation.
- **When to call `update_build`:** Haiku judges it. Typical moments: a
  proposal was made, someone agreed or objected, a disagreement emerged or
  was settled, the discussion moved to a new screen or topic, or someone
  asked to see something.
- **`update_build` payload** (*my call on the shape*; it has to carry
  attribution, because agreement depends on who said what):
  - `topics[]`, each with:
    - `title`, `screen_hint`;
    - `proposals[]` `{ text, proposed_by, supporters[], objectors[] }`;
    - `questions_raised[]`;
    - `resolved_choice?` (for example "room picked B");
  - `mood` (converging / stuck / exploring);
  - `requested_view?` (for example "show settings").
- **Grounding** (*my call*, protects "never invent agreement"): the hand-off
  also carries the ids of the utterances it summarises. The build loop receives
  those raw lines alongside the summary and may only record agreement that
  those lines support.

**Build loop — Claude Opus 5.5 (`anthropic/claude-opus-5.5` on OpenRouter)** (judgment and quality):
- **Triggers:** an `update_build` call from Haiku. It can also run on its own
  when `next_up` is empty, to queue the next question.
- **One run at a time:** at most one run in flight. Hand-offs that arrive
  during a run are merged into the next run, and stale results are
  discarded.
- **Inputs:** the hand-off summary and its grounding lines, the consensus
  document, and the current component tree.
- **Does:** updates the consensus document (phase, decisions and their
  draft/pending/agreed status, open questions, conflicts, `next_up`) and
  emits prototype patches and comparison variants.
- **Output:** strict tools or structured outputs against the patch and
  document schemas, streamed so the screen builds progressively and the
  character shows "building".
- **Feedback to Haiku:** the build loop's updated `next_up` and summary fields
  are what Haiku reads on its next turn. Haiku stays informed without seeing
  the build loop's work.

**Model and API notes** (verified 2026-10-16 against the live models docs and
the bundled API reference):
- Opus 5.5 always thinks; tune it with `output_config.effort`. Its default is
  `medium`, and the build loop starts there.
- Haiku 5.5 uses adaptive thinking with default effort `medium`. For speed,
  the conversation loop starts at `low`.
- Forcing a specific tool (`tool_choice` of type `any` or `tool`) returns a
  400 on Opus 5.5. Use `auto` with `strict: true` tools, or structured outputs.
- Cache the fixed prefix in both loops: system prompt, component schema, and
  facilitation rules. Only new transcript lines vary between calls.
- **Access through OpenRouter** (decided): one `OPENROUTER_API_KEY` covers
  both models and the voice.
  - Claude calls go to OpenRouter's Anthropic-format endpoint
    (`https://openrouter.ai/api/v1/messages`) using the official Anthropic
    SDK, pointed at OpenRouter with the key as a bearer token.
  - OpenRouter model ids: `anthropic/claude-haiku-5.5` (conversation) and
    `anthropic/claude-opus-5.5` (build).
  - Refusal and outage fallback uses OpenRouter's own `fallbacks` model list
    (up to 3 models), not Anthropic's `fallbacks: "default"` beta. *My call:*
    Opus 5.5 falls back to `anthropic/claude-opus-5`.
  - The live model probe confirms that streamed tool input passes through.
    If it doesn't, patches render when complete instead of progressively.
- The key lives only in the backend, like the Recall key.
- **Dependencies** (*my call*): the "zero npm dependencies" rule from the
  feasibility test is lifted for this work. Use the official
  `@anthropic-ai/sdk`, which handles streaming, structured outputs, caching
  and fallbacks, and a small schema validator for patches (e.g. `zod`). Add
  anything else only with a reason.

**Cost** (decided: no hard cap, keep it sensible): log tokens and dollars per
model call, and show a running per-meeting total in the operator UI. Build-loop
cadence follows Haiku's `update_build` calls. *My call:* a floor of about
10 s between build-loop runs, with hand-offs merged in the meantime, except
immediately after a conflict resolves. Opus sees summaries, not the raw
transcript stream, which keeps its input small.

**Latency targets** (*my call*, to validate in testing):
- Voice-command action visible within about 2 s of the utterance finalizing.
- Spoken reply to a direct address starts within about 3 s.
- A decision reflected on screen within about 10 s.

## 13. Voice output

- Text from the conversation loop is turned into speech and **played by the
  stage page**. Output Media streams the page's audio into the call.
- **Provider** (decided: "find the best"; researched 2026-10-16):
  **ElevenLabs Eleven v4 Turbo**, accessed **through OpenRouter** (decided) as
  `elevenlabs/eleven-v4-turbo` via `POST https://openrouter.ai/api/v1/audio/speech`
  with `response_format: "pcm"`. Audio streams back as it's generated. The
  whole line is sent in one request; there's no text streaming in. That's
  acceptable because Builder's lines are at most 2 sentences. Voices are
  listed on OpenRouter's model page.
  - It ranks first on the Artificial Analysis TTS quality leaderboard
    (Elo 1330).
  - ElevenLabs states about 100 ms median inference latency, with about
    150 ms to first speech reported.
  - Directly from ElevenLabs it can also accept streamed text over its Text
    to Dialogue WebSocket. That's a possible later upgrade if latency needs
    it.
  - It's listed at about $40 per 1M characters. An agent that speaks
    sparingly uses only a few thousand characters per meeting.
  - **Alternative if it disappoints in testing:** Cartesia Sonic 3.6
    (Elo 1285, lower latency, about $49 per 1M characters). Keep the TTS
    behind a small interface so the provider can be swapped.
- The OpenRouter key stays in the backend. How audio reaches the stage
  page is left to the implementer, with these constraints: no long-lived
  provider key in the page; a WebSocket or chunked fetch through the public
  origin, since quick tunnels buffer SSE; and playback can be cut instantly.
- The bot's own voice must not come back as a participant utterance. Recall
  leaves bot audio out of the recording by default, so keep it that way.
- Speech stops immediately on interruption (§7). *Implementer note:* the bot's
  Output Media page can read live meeting audio and transcripts directly
  through Recall's bot-local WebSocket
  (`wss://meeting-data.bot.recall.ai/api/v1/transcript`). That gives the
  stage page an interruption signal without waiting for its 1 s poll, so use
  it for barge-in.
- Builder's lines are spoken only. The stage shows no captions (see §10a,
  Layout). If speech fails, the line goes to meeting chat.

## 14. Handoff

- **Where it lives** (decided): the deployed version has a **persistent
  public URL**, so the handoff is a token-gated public route
  (`/handoff/<session>?token=…`) like the stage. Locally it's reachable over
  the tunnel while it's up.
- **Download** (*my call*): the handoff page also offers one self-contained
  HTML file, with the renderer and JSON inlined, that can be attached to a
  ticket.
- **During the call:** the operator UI shows the handoff link at any time.
- **When the call ends** (bot `done`): the handoff is final.
- **What it exports:** agreed items. Any remaining drafts are included but
  clearly flagged as not agreed.
- **Handoff page** (token-gated, like the stage):
  - **Clickable prototype:** the same renderer as the stage, at full
    interactivity, with screen navigation.
  - **Component spec:** a readable tree (screens → components → props →
    interactions) plus a download of the exact JSON.
  - **Decisions:** each one with who proposed it, who agreed, when, which
    components it affects, and the rejected options.
  - **Open questions:** anything left unresolved.

## 15. Testing

- **Replay fixtures:** recorded transcript sequences fed through the real
  webhook boundary to drive both loops. Model calls are faked for unit tests;
  real calls run only in an opt-in eval mode, because they cost money.
- **Schema tests:** every patch and variant validates, and invalid ones are
  rejected without rendering.
- **Behaviour tests** for the speaking policy:
  - silent by default;
  - speaks when addressed;
  - speaks when stuck, subject to cooldown;
  - stops on interruption;
  - a voice command maps to the right action.
- **Consensus tests:**
  - a conflict produces a comparison view;
  - a resolution merges the winner and logs the losers;
  - nothing becomes a decision without agreement.
- **Renderer tests:** the stage and handoff render the same tree identically.
  The existing headless-Chrome driving checks the rendered DOM and frame cost
  against the bot's CPU budget.

## 16. Left to the implementer

- Prompt wording, effort levels, and model call cadence within the latency
  targets.
- Exact component props and schema format.
- Thresholds for "stuck" detection (start from §7).
- Stage layout details beyond the mockups (prototype plus agreed/open panel
  plus captions plus character dock; comparison view replaces the prototype
  area), within §10a.
- How large Haiku's rolling transcript window is, and the prompt guidance for
  when to call `update_build`.
- The text-to-speech voice, within the provider decided in §13.
