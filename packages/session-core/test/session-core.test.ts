// Smoke tests that the package holds together in plain Node: the thorough tests of each rule live with the web app's
// suite (apps/web/test: api-client, errors, start, statuses), which imports this package.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, BOT_NAME, createApiClient, explainError, isAbort, meetingDisplay, meetingKey, SessionView, statusExplanation, statusLabel,
} from "../src/index.ts";

const view = {
  id: "11111111-1111-4111-8111-111111111111",
  meetingUrl: "https://meet.google.com/kfp-qzwd-nre",
  status: "in_meeting",
  limits: { maxUsd: 5, maxMinutes: 60 },
  createdAt: "2026-10-20T14:00:00.000Z",
  updatedAt: "2026-10-20T14:01:00.000Z",
};

test("a session view parses, with unknown fields ignored and an unknown status kept as text", () => {
  const s = SessionView.parse({ ...view, status: "paused", extra: 1 });
  assert.equal(s.status, "paused");
  assert.equal("extra" in s, false);
  assert.equal(statusLabel("paused"), "Unknown");
  assert.equal(statusLabel("in_meeting"), "In the meeting");
});

test("a meeting link reads as its code, and copies of one link share a key", () => {
  assert.equal(meetingDisplay(view.meetingUrl).code, "kfp-qzwd-nre");
  assert.equal(meetingKey("https://meet.google.com/KFP-QZWD-NRE/?authuser=0"), meetingKey(view.meetingUrl));
});

test("errors are explained in our words, naming the bot", () => {
  const x = explainError(new ApiError(502, "engine_rejected", { ...view, status: "start_failed", errorCode: "recall_rejected" }), "start");
  assert.equal(x.title, `${BOT_NAME} couldn't join this meeting.`);
  assert.equal(x.botMayExist, false);
  assert.equal(statusExplanation("start_failed", "meeting_in_use"), `${BOT_NAME} already has a session in this meeting. Check the meeting. No second bot was sent.`);
});

test("the client sends the token and reads an abort by its name, with no DOMException", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    getToken: async () => "tok",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ userId: "u", orgId: "o", role: "org:member" }), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal((await client.me()).role, "org:member");
  assert.equal((seen[0]!.init.headers as Record<string, string>).Authorization, "Bearer tok");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.listSessions(controller.signal), (err: unknown) => isAbort(err));
  const plain = new Error("x");
  plain.name = "AbortError";
  assert.equal(isAbort(plain), true);
  assert.equal(isAbort(new Error("AbortError")), false);
});
