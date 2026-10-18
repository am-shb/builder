# 0003: Local mode, with your own mic standing in for the meeting

- **Status:** accepted
- **Date:** 2026-10-17
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/app.ts`, `src/config.ts`, `src/server.ts`, `public/`)

## Context
To try a change to the conversation or build loop by voice, you currently need a Recall bot in a real Google Meet, a
public tunnel and a webhook secret. Each try costs money and takes minutes to set up. Replay (`scripts/replay.ts`)
avoids Recall but plays a script, and a script isn't the same as talking to Builder.

## Options considered
1. **Speech-to-text on the server through a paid provider.** This is closer to Recall's transcript, but it costs
   money, needs audio streamed up from the browser, and adds a provider.
2. **Chrome's built-in speech recognition in a local page, posting lines to a local-only endpoint.** This is free and
   needs no new dependency, and it gives partials, which barge-in needs. It only works in Chrome, and Chrome sends the
   audio to Google's speech service. Chosen.
3. **Signed fake webhooks from the browser.** This would put the webhook secret in the page. Rejected.

## Decision
- `npm run local` (`node src/server.ts --local`) loads `loadLocalConfig`. It reads no Recall setting, serves the stage
  from `http://localhost:<port>`, stores sessions in `data/local.db`, and gives the webhook a random secret, so the
  Recall route accepts nothing.
- `src/local-recall.ts` replaces the Recall client. Its "bot" is in the call as soon as it is created and leaves
  when asked. Chat and screenshare do nothing. Everything after the transcript is the real engine, unchanged:
  conversation loop, build loop, TTS and stage.
- `/local` embeds the real stage, which plays Builder's voice. It runs the mic and posts partials, final lines, joins
  and leaves to `POST /api/sessions/<id>/speech`. That goes through the same `handleEvent` path as a Recall event, so
  partials trigger barge-in exactly as they do in a call.
- The local routes exist only when `config.local` is set, and like the rest of the control surface they are never
  served through a proxy.

## Consequences
- Testing by voice is free apart from the models (and TTS, if `TTS_VOICE` is set).
- Without headphones the mic picks up Builder's voice, so Builder barges in on itself.
- Chrome's recognizer is not Recall's transcriber. Timing, punctuation and partials differ, so a live call is still
  the final check.
- Builder's spoken lines aren't in the local event log, because spoken lines aren't stored as events. Only lines
  that fall back to chat appear.
