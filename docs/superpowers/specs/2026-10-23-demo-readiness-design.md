# Demo readiness: a narrower engine and the Maple Café script

Date: 2026-10-23. Owner: Amir. Status: draft for approval.

## Why

Builder is entered in Build North (Georgian, with Expo, Clerk and SurrealDB). Submissions close **Oct 25, 11:59 PM ET**:
a demo video of **at most 2 minutes**, a public repo and a Devpost page. The judges are investors and engineers
(Georgian's lead investor and CTO, a Google customer engineer, an AI CEO). They score innovation, real-world impact,
UI and design, tech and deployment, and security and ethics. Amir wants them to see a winning idea that can become a
real company.

Builder's core offering, as Amir put it, is **the live resolution of opinions**. Other AI builders take instructions
from one person typing. Builder listens to a group that disagrees, shows both versions side by side, and lets the room
settle the choice by saying so, with a record of who decided what. The demo has to make that moment unmistakable.

Right now the engine is not reliable enough to record. In the last real sessions (production, Oct 21):

- **Picks were lost.** In session `986df5c5`, when Amir said "b is better so let's go with b", Haiku's `update_build`
  carried the pick, but it was dropped as `invalid_input` (`topics.0.resolvedChoice: invalid_type`). The next four
  conversation turns (23:14:34 to 23:15:12) each ended with `incomplete_input` and `stop_reason: null`, so for about
  40 seconds nothing reached the build loop. The conflict is still open in the saved doc ("Earlier B was picked, now A
  is mentioned").
- **The options were not what people argued.** The room debated clients on top versus below the sales chart; the
  build loop drew "A: side panel" versus "B: on top".
- **Things landed in odd places.** The "top 10 sellers" became a 4-row `Table` in the dashboard template's `stats`
  region. In session `4421baa5` a decision named `home.item-3` and `home.item-4`, which were never drawn, while Amir
  asked "where did it go… why do you not listen to me". (#36 fixed one cause of that: props written as an object.)
- The catalog Builder chooses from is 50 component types, 7 templates with named regions, style options, icons and
  images. Most of the layout mistakes come from that surface.

## Goals

1. A spoken pick ("B", "let's go with B", "B it is") while a comparison is on screen resolves it, every time.
2. The side-by-side options are the positions people actually took, in their words.
3. The model builds from a small set of components that always look good, with no templates or regions to misuse.
4. A scripted 4-person meeting, the **Maple Café** scenario below, comes out right **3 runs in a row** when replayed
   against a local server with the live models, checked by screenshots of the stage at each beat.
5. Amir gets the final script: who says what, when, and what should be on screen after each line, ready to perform
   and record.

## Non-goals

- New components, new animation, or a new look. Only narrowing and fixing what exists.
- Sending a real bot to a meeting. Amir does the real run when recording.
- Testing speech recognition. Replay sends text, so the script is written to transcribe cleanly (plain words, no
  jargon, names said clearly), but the real transcription is only tested in Amir's live run.
- The voiceover, editing, Devpost page and README for the submission.

## Anti-goals (a failure even if it technically works)

- Builder marking something agreed by itself. Agreement still comes only from lines people spoke (spec §4, §9, §12);
  the new spoken-pick path must be grounded in the actual line.
- A demo-only engine: hard-coded café content, a "demo mode" that scripts the output, or anything that only works for
  this one script. The judges will ask, and the repo is public. The narrowing applies to every session.
- Breaking `npm run check`.

## Constraints

- Two days. Small PRs, one area each, with tests (AGENTS.md).
- Model spend on test runs: **up to $10** (Amir approved). A run costs about $0.40 in model calls.
- Changing the component catalog the model sees changes ADR 0014's decisions, so it gets an ADR.
- Never log transcript text, prompts or model output. Log ids, counts and error codes only.
- Model ids are checked against the live list before any change (none is planned).

## The demo scenario: Maple Café

Four people build the mobile ordering app for a café chain. The subject is generic on purpose: judges get it in a
second, so their attention goes to the disagreement. The arguments sound like a real business, with numbers.

Roles (Amir's team; assignments are my call and can be swapped):

| Speaker (Meet name) | Role | Wants |
|---|---|---|
| Amir Shahbandegan | Product lead | Runs the meeting, starts the build, closes the decision |
| Amin Fadaeinejad | Marketing | The seasonal special at the top: it carries the margin |
| Omid Omidi | Operations | "Order again" at the top: most orders are repeat orders |
| Mohammad Amin Shamshiri | Designer | Breaks the tie for B, with a reason |

Beats and target timings in the final video (meeting part about 80–100 s; the rest is voiceover):

1. **First glimpse (~0:00–0:25).** Amir sets it up in one or two lines. A phone app appears: Maple Café, a photo
   header, today's menu as photo cards with prices. It should look like a real app within seconds of the line.
2. **The disagreement (~0:25–0:55).** Amin: the top of home should sell the fall special (Maple latte). Omid: no,
   about two thirds of orders are repeat orders; put "Order again" with their usual on top. Builder records a
   conflict and the stage shows both options side by side, labelled with those two positions.
3. **The room decides (~0:55–1:15).** Mohammad Amin picks B with a reason. Amir agrees, B, and asks to keep the
   special as a smaller card just below. The comparison resolves to B, Builder confirms in one line ("So: B. Everyone
   OK?"), and the follow-up change appears.
4. **The record (~1:15–1:40).** The handoff page: each decision, who proposed it, who agreed, the rejected option.

The storyboard mockup from the brainstorm is in `.superpowers/brainstorm/` (not committed).

## Engine changes

### 1. Picks that land

- **Accept the pick in the shapes models actually write.** Like #36, repair `resolvedChoice` before validation: a
  JSON string of the object, a bare label ("B") when exactly one conflict is open, a lowercase label, `"option B"`.
  Anything still invalid is dropped as now. Find the actual shape from a replay or `scripts/probe-handoff.ts` rather
  than guessing, and add a test per repaired shape.
- **Find out why the conversation turns ended early** (`incomplete_input`, `stop_reason: null`, about 4 s, well under
  the 8 s deadline). Use systematic debugging: reproduce it with the replay at the same point (an open conflict, a
  pick being spoken), check whether a newer turn cancels the stream, whether the OpenRouter stream ends without
  `message_stop`, or something else. Fix the cause; if a dropped `update_build` is unavoidable, the next turn must
  still hand off the lines it missed (it should, since `handedOffThrough` did not advance; confirm).
- **A spoken pick resolves without the model.** While a comparison is on screen, an utterance from a participant
  that clearly picks one shown label resolves it directly, grounded in that utterance's event id. "Clearly picks" is a
  small, tested set of patterns: the label alone ("B."), "go with B", "let's do B", "B it is", "I pick B", "option B
  please", "B is better". A line that only mentions a label ("B pushes sales down") does not count, and neither does a
  request to look ("show option B", "see B"), which stays the `focus_option` voice command. A whole utterance of
  "bee" counts as B (speech recognition writes it that way); "be" inside a sentence does not. It goes through the
  same path as a model pick (`resolveChoice`), so grounding, the confirmation line and the stage animation are
  unchanged. When the model's hand-off also carries the pick, the second resolve is a no-op, as it is today.
  This is spec §9's own rule ("someone says 'A', 'let's go with B'") made deterministic.
- **The people who pick are recorded as agreeing.** Today `resolveConflict` (`src/consensus/doc.ts`) sets
  `proposedBy` to the first backer and `agreedBy` to the backers, so a person whose line made the pick is not named
  unless they had backed the option earlier. The pick's grounded speakers (from the spoken-pick line, or the
  hand-off's grounding lines for a model pick) are added to the winning decision's `agreedBy`, and the winner's
  backers stay in it. They are real lines people spoke, so this keeps the agreement rule. *(My call, from the builder
  check: without it beat 4 would not name the people who decided.)*

### 2. Options that match the argument

- In `build.md`, the conflict rules require each variant to be one participant's stated position: the `summary`
  starts with what they want in their words, and the `backers` are those who argued for it. Builder never invents a
  third position as one of the options. If only one position was stated, it is a proposal, not a conflict.
- The conflict's variants carry the same nodes in both options so the comparison reads like for like (already a
  rule; keep it).

### 3. A narrower catalog

The model is offered only these types (the renderer keeps the others, so old sessions still render):

- **frames:** App, Screen, PageHeader, Card, Grid
- **data:** StatCard, ChartCard, Table, List, ListItem
- **content:** ProductCard, Image, Badge, Text
- **input:** Button

That is 15. Dropped from the offer: Section, Row, Split, Tabs, Drawer, Modal, ActivityList, Progress, Timeline,
CalendarStrip, Kanban, Heading, Hero, FeatureGrid, PricingTier, MediaCard, Avatar, AvatarGroup, Quote, Input, Search,
Select, Segmented, Toggle, Checkbox, Slider, DatePicker, Steps, FileUpload, EmptyState, Banner, Toast, Skeleton,
ChatThread, Comment.

- **No templates or regions for new work.** A Screen's children stack top to bottom in the order they are added;
  `Grid` (2 or 3 columns) is the only way to put things side by side. The model is no longer offered `template` or
  `region`. The renderer keeps honoring a stored template, so old sessions look as they did. *(My call.)*
- `catalog.js` today drives the validator, the prop filter and the prompt table together. Add a separate **offered**
  list (the 15 types, and which props of App and Screen are offered) that drives the prompt table and the tool
  schema the model sees; the full catalog still drives rendering and the stored-tree schema.
- **An unoffered type drops only that op, not the whole call.** Today an unknown type fails the tool schema and the
  whole call is dropped, so one stray `Heading` in one conflict variant loses the whole comparison. Instead, an `add`
  of an unoffered type (and its children in the same batch) is removed before validation and counted in
  `build.run` as `ops_unoffered`; the rest of the batch applies. A variant left with no ops drops the conflict, as an
  invalid one does now. *(My call: a lost comparison is the worst thing that can happen in the demo.)*
- **On a phone, a 2-column Grid stays 2 columns.** `theme.css` forces every Grid on a phone into one column today.
  Change that so a `columns: "2"` Grid keeps two columns on a phone (3 still collapses), with a browser test. This is
  the one renderer look change, made so a menu of photo cards reads as an app on a phone. *(My call.)*
- `build.md` loses the template section and the guidance for dropped types, and gains short layout rules: a phone app
  is `device: phone`; on a phone, a menu is a 2-column `Grid` of `ProductCard`s; a headline is a `PageHeader`; a
  "your usual" row is a `Card` holding a `ListItem` (with an image or avatar) and a `Button`.
- An ADR (0017) records the narrowing, why (the session evidence above), and how to widen it again.

### 4. Testing it

- A replay fixture, `apps/engine/test/fixtures/sessions/maple-cafe.json`, with the four Meet names and the script's
  lines at realistic spacing (people pause 2–4 s; Builder's turns take 2–6 s).
- **The replay may wait for the stage.** A fixture line can carry `waitFor: "comparison"` (or another named stage
  condition); with it, `replay.ts` polls the session's state until that holds (with a timeout that fails the run)
  before posting the line. Beat 3's first pick waits for the comparison, as real people would. The script tells the
  speakers the same: say the pick once both options are on screen. *(My call: otherwise a pass is partly timing
  luck.)*
- Each run: start the server locally with the live models, create a session, replay the fixture with `--live-models`,
  and screenshot the stage after each beat (a small script, not a test; it can live in `apps/engine/scripts/`).
- Pass for one run: after beat 1, a phone frame with a header, photo menu cards and prices, nothing overlapping or
  misplaced; after beat 2, a comparison whose two options match Amin's and Omid's positions; after beat 3, B merged,
  the confirmation spoken, the special below it; at the end, the handoff page lists the decisions with the right
  people. No `llm_tool_dropped` in the logs.
- Iterate on the engine and the script until 3 consecutive runs pass. Keep a running total of model spend and stop at
  $10 to check in with Amir.
- Deterministic tests for every code change (repairs, the spoken-pick matcher, the narrowed catalog), so
  `npm run check` covers them without the live models.

## Deliverable

`docs/demo/maple-cafe-script.md`:

- the four roles and who plays them;
- every line in order, with the speaker, a target time, and what should be on screen after it;
- delivery notes: speak one at a time, leave a beat after each line, say "B" clearly, what to do if Builder
  misses a line (repeat it once, word for word);
- before recording: which build to deploy, how to start the session, where to open the handoff page.

Screenshots of the passing run go with it so Amir knows what "right" looks like.

## Left to the builder

- The exact repair shapes and matcher patterns (driven by what the replay shows).
- How the spoken-pick path hooks in (conversation loop on utterance, or the build loop's intake), as long as it uses
  `resolveChoice` and the grounding rule.
- Script wording, as long as the beats, roles and timings hold.
- PR split. Suggested: (a) pick repair and spoken picks, (b) catalog narrowing with ADR 0017, (c) conflict wording in
  `build.md`, (d) the fixture, screenshot script and the demo script doc.
