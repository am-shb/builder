// Minimal Recall.ai REST client. Region-bound, retries 429 (honouring
// Retry-After) and transient 503/507. Never logs the API key or bodies.

export type FetchLike = typeof fetch;

export type CreateBotInput = {
  meetingUrl: string;
  botName: string;
  realtimeWebhookUrl: string;
  // Webpage the bot screenshares into the meeting (Output Media) as soon as it joins.
  screenshareUrl?: string;
  variant?: string | null;
  metadata: Record<string, string>;
};

export type RecallBot = {
  id: string;
  status_changes?: { code: string; sub_code: string | null; message: string | null; created_at: string }[];
  [k: string]: unknown;
};

export class RecallApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createRecallClient(opts: {
  region: string;
  apiKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}) {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 5;
  const base = `https://${opts.region}.recall.ai/api/v1`;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      // Network errors are NOT retried: for POST /bot/ an ambiguous failure
      // could mean the bot was created. The caller reconciles via its intent row.
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: opts.apiKey,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : null) as T;
      }

      const retryable = res.status === 429 || res.status === 503 || res.status === 507;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 500 * 2 ** (attempt - 1)) * (0.5 + Math.random());
        await sleep(backoff);
        continue;
      }
      const detail = (await res.text()).slice(0, 500);
      throw new RecallApiError(res.status, `Recall ${method} ${path} failed with ${res.status}: ${detail}`);
    }
  }

  return {
    createBot(input: CreateBotInput) {
      return request<RecallBot>("POST", "/bot/", {
        meeting_url: input.meetingUrl,
        bot_name: input.botName,
        metadata: input.metadata,
        ...(input.variant ? { variant: { google_meet: input.variant, zoom: input.variant, microsoft_teams: input.variant } } : {}),
        ...(input.screenshareUrl ? { output_media: { screenshare: { kind: "webpage", config: { url: input.screenshareUrl } } } } : {}),
        chat: {
          on_bot_join: {
            send_to: "everyone",
            message: `${input.botName} has joined to listen and help. It is transcribing this call.`,
            pin: true,
          },
        },
        recording_config: {
          transcript: {
            provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } },
            diarization: { use_separate_streams_when_available: true },
          },
          realtime_endpoints: [
            {
              type: "webhook",
              url: input.realtimeWebhookUrl,
              events: [
                "transcript.data",
                "transcript.partial_data",
                "participant_events.join",
                "participant_events.leave",
                "participant_events.chat_message",
              ],
            },
          ],
        },
      });
    },
    getBot(botId: string) {
      return request<RecallBot>("GET", `/bot/${encodeURIComponent(botId)}/`);
    },
    sendChatMessage(botId: string, message: string) {
      return request<unknown>("POST", `/bot/${encodeURIComponent(botId)}/send_chat_message/`, {
        to: "everyone",
        message,
      });
    },
    startScreenshare(botId: string, url: string) {
      return request<unknown>("POST", `/bot/${encodeURIComponent(botId)}/output_media/`, {
        screenshare: { kind: "webpage", config: { url } },
      });
    },
    stopScreenshare(botId: string) {
      return request<unknown>("DELETE", `/bot/${encodeURIComponent(botId)}/output_media/`, { screenshare: true });
    },
    leaveCall(botId: string) {
      return request<unknown>("POST", `/bot/${encodeURIComponent(botId)}/leave_call/`);
    },
  };
}

export type RecallClient = ReturnType<typeof createRecallClient>;
