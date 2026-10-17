# OpenRouter TTS protocol: `elevenlabs/eleven-v4-turbo`

Recorded 2026-10-17 from:

- TTS guide: https://openrouter.ai/docs/guides/overview/multimodal/tts.md
- Model page: https://openrouter.ai/elevenlabs/eleven-v4-turbo
- Public model list (no key needed): https://openrouter.ai/api/v1/models?output_modalities=speech

## Request

`POST https://openrouter.ai/api/v1/audio/speech`

Headers:

- `Authorization: Bearer <OPENROUTER_API_KEY>` (backend only, never sent to the stage)
- `Content-Type: application/json`

Body fields (guide):

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | `elevenlabs/eleven-v4-turbo` |
| `input` | string or array | yes | The text, or a list of speaker turns. We send the whole line as one string. |
| `voice` | string | depends on the provider | One of the voices below |
| `instructions` | string | no | Delivery directions (tone, pacing). Not used. |
| `response_format` | string | no | `mp3` or `pcm`; the default is `pcm`. We send `pcm` explicitly. |
| `speed` | number | no | Default 1.0. Not used. |
| `input_references` | array | no | Reference audio or images for voice cloning. Not used. |
| `provider` | object | no | Routing preferences and provider-specific `options`. Not used. |

What we send (`src/voice/openrouter-tts.ts`):

```json
{ "model": "elevenlabs/eleven-v4-turbo", "input": "<line>", "voice": "<TTS_VOICE>", "response_format": "pcm" }
```

## Response

- The body is the raw audio byte stream, not JSON. For `pcm`: `Content-Type: audio/pcm`, which the guide calls
  "suitable for real-time streaming pipelines". The client reads `response.body` chunk by chunk and forwards each
  chunk as it arrives.
- Header `X-Generation-Id`: the generation id.
- On error the status is non-2xx with a JSON error body. We throw `TtsError(status)` and never log the body.

## Voices

`supported_voices` for `elevenlabs/eleven-v4-turbo` (the same list as the model page, and the same for every
ElevenLabs model on OpenRouter):

george, sarah, adam, alice, bella, bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam,
lily, matilda, river, roger, will

`TTS_VOICE` takes one of these names. Neither page names a default voice.

## PCM format

- **Not documented for ElevenLabs.** Neither the guide nor the model page gives the sample rate, bit depth or
  channel count for `elevenlabs/eleven-v4-turbo`. The only rate in the guide is for the Azure MAI-Voice models:
  "Set `response_format` to `mp3` or `pcm` (24 kHz mono)".
- **Assumed: 24 kHz, 16-bit signed little-endian, mono.** That's the PCM format the guide states for other models.
  ElevenLabs' own API offers several PCM rates (16 to 44.1 kHz), so which one OpenRouter requests is unknown until
  measured. One named constant on each side: `PCM_SAMPLE_RATE` in
  `src/voice/tts.ts` (server: frame alignment, playback-length estimate) and `PCM_RATE` in
  `public/renderer/audio.js` (stage: AudioContext rate). Change both together.
- **Pending manual check: confirm the PCM rate live.** Run `node scripts/probe-tts.ts` (one request, a fraction of
  a cent). It prints the content type, time to first chunk, byte count and the duration each candidate rate
  implies, and saves `probe-tts.pcm` so you can listen to it at 24 kHz. Not run yet (controller ruling R2).

## Pricing

`pricing.prompt` is `0.00002` USD per input character, about $20 per 1M characters (the spec's estimate was about
$40 per 1M).
