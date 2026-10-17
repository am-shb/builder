# Meet2Build Live Agent — feasibility test

Goal: an AI agent that joins a Google Meet, listens to everyone, and helps the
group build a prototype on the call. This repo is the **bare-minimum first
step**: prove a Recall.ai bot can join a Meet and stream a live,
speaker-labelled transcript into our backend, and that the agent can talk back
(via meeting chat).

## Stack

- **Node 24+** (runs TypeScript natively), zero npm dependencies, `node:sqlite` for state.
- **Recall.ai Meeting Bot**, workspace **Meet2Build**
  (`f8808c9f-f2a3-487d-be1a-bf8f6d58fb9b`), region **us-west-2**, API **v1.11**.
- **Recall.ai Transcription**, `recallai_streaming` in `prioritize_low_latency`
  mode with per-participant streams ("perfect diarization") for speaker names.
  No separate transcription vendor; Recall bills it at its documented rate.
- **Realtime webhook endpoint** (`POST /recall/realtime/`) receiving
  `transcript.data`, `transcript.partial_data`, `participant_events.join/leave`
  and `participant_events.chat_message`. Every request is HMAC-verified on the
  raw body with the workspace verification secret, acknowledged with 200
  immediately, then processed (deduplicated by `webhook-id`).
- Browser UI gets updates over Server-Sent Events.
- **Shared screen (Output Media).** Each bot screenshares a token-gated stage
  page, `/stage/<session>?token=…` (1280×720). It shows a prototype canvas, where
  HTML runs in a sandboxed iframe, and live captions. While it waits, it shows
  an animated "listening" robot whose rings pulse while someone speaks. The
  stage **polls** `/stage/<id>/state` every second rather than using SSE,
  because Cloudflare quick tunnels buffer `text/event-stream` and that froze
  the shared screen. New bots start sharing
  when they join; **Start screenshare** attaches it to a bot already in the
  call. Content is pushed with `POST /api/sessions/:id/stage {html}`, which is
  the hook the LLM agent will write to.
- **Public surface.** Through the tunnel, only `/recall/realtime/` (signed) and
  `/stage/*` (token) respond. The control UI and API only answer direct
  localhost requests; proxied requests get a 404.

```
Browser ──POST /api/sessions──▶ backend ──Create Bot──▶ Recall (us-west-2) ──▶ Google Meet
   ▲                              │  ▲                                          │
   └────────── SSE ───────────────┘  └──── signed realtime webhooks ◀───────────┘
```

## Run it

1. `cp .env.example .env`, then fill in `RECALL_API_KEY` and
   `RECALL_WEBHOOK_VERIFICATION_SECRET` (never commit `.env`).
2. Start a public tunnel to port 3000: `npm run tunnel`. Put the printed
   `https://….trycloudflare.com` URL in `PUBLIC_API_BASE_URL`.
   Quick-tunnel URLs change on every restart; use a reserved ngrok domain or a
   named Cloudflare tunnel for anything longer-lived.
3. `npm start`, open http://localhost:3000, paste a Meet link, click **Send bot**,
   and admit "Meet2Build Agent" in the call.

Checks: `npm test` (unit + HTTP-boundary tests with fake injected config) and
`npm run smoke` (boots the real app on a loopback socket with a fake Recall API).

## Deliberate shortcuts (feasibility only)

- **Bot lifecycle is polled** (`GET /bot/{id}` every 4 s) instead of using
  dashboard webhooks. Production: register a dashboard webhook endpoint on a
  stable URL for bot status, `transcript.done` and `transcript.failed` (the
  failure event is only delivered there, not to realtime endpoints).
- Partial transcripts are streamed to the UI but not stored; finalized
  utterances are stored in SQLite.
- The local control UI has no login. It relies on being reachable only from
  localhost, detected by the absence of proxy headers. That's fine for a
  personal test, not for a shared deployment.
- The bot runs the default `web` variant (250 millicores). If the shared screen
  gets choppy with heavier prototypes, set `variant.google_meet: "web_4_core"`,
  which costs extra per hour (see Recall's Output Media docs).

## Scheduling decision: calendar deferred

This milestone only uses explicit meeting URLs. Calendar scheduling was in the
original brief but is deferred until the live-listening loop has been proven.
**Next step:** Recall Calendar V2 (Google Calendar). Run Recall MCP
`get_calendar_integration_setup_status`, implement the customer-owned OAuth
callback on a stable public URL, create the Google Cloud OAuth client, then
schedule bots via the confirmed opt-in rule (recommended: per-event toggle,
default off). The `POST /api/sessions` path stays as the manual and admin
surface.

## Toward the real agent

- Feed stored utterances (with speaker names) into an LLM that builds the prototype.
- Have the LLM write the prototype HTML to `POST /api/sessions/:id/stage`;
  the bot's screenshare updates within a second or so.
- For spoken back-and-forth, Recall recommends output media plus a
  voice-to-voice model rather than relying on transcript events.
