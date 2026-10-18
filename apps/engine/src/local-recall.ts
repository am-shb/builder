// Stands in for Recall in local mode (`npm run local`): no bot, no meeting, no network. A "bot" is in
// the call as soon as it is created and leaves when asked. Chat and screenshare do nothing: the
// /local page shows the stage itself and polls the session's events.
import { randomUUID } from "node:crypto";
import type { RecallBot, RecallClient } from "./recall-client.ts";

type StatusChange = NonNullable<RecallBot["status_changes"]>[number];

export function createLocalRecall(): RecallClient {
  const bots = new Map<string, StatusChange[]>();
  const change = (code: string): StatusChange => ({ code, sub_code: null, message: null, created_at: new Date().toISOString() });

  return {
    async createBot() {
      const id = `local-${randomUUID()}`;
      bots.set(id, [change("in_call_recording")]);
      return { id, status_changes: bots.get(id) };
    },
    // A bot from before a restart is gone, so its session ends instead of polling forever.
    async getBot(botId: string) {
      return { id: botId, status_changes: bots.get(botId) ?? [change("done")] };
    },
    async sendChatMessage() {
      return null;
    },
    async startScreenshare() {
      return null;
    },
    async stopScreenshare() {
      return null;
    },
    async leaveCall(botId: string) {
      bots.get(botId)?.push(change("done"));
      return null;
    },
  };
}
