import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineEvent, StartSessionRequest, StartSessionResponse, parseEngineEvent } from "../src/index.ts";

const base = { id: "evt_1", sessionId: "s_1", orgId: "org_1", at: "2026-10-17T10:00:00.000Z" };

test("StartSessionRequest parses a valid request", () => {
  const req = StartSessionRequest.parse({
    sessionId: "s_1",
    orgId: "org_1",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    limits: { maxUsd: 5, maxMinutes: 60 },
  });
  assert.equal(req.limits.maxMinutes, 60);
});

test("StartSessionRequest rejects missing limits and a bad url", () => {
  assert.equal(StartSessionRequest.safeParse({ sessionId: "s", orgId: "o", meetingUrl: "https://x.test" }).success, false);
  const bad = { sessionId: "s", orgId: "o", meetingUrl: "nope", limits: { maxUsd: 1, maxMinutes: 1 } };
  assert.equal(StartSessionRequest.safeParse(bad).success, false);
});

test("StartSessionResponse parses a valid response and rejects an unknown status", () => {
  const ok = { sessionId: "s_1", status: "joining", stageUrl: "https://engine.test/stage/s_1" };
  assert.equal(StartSessionResponse.parse(ok).status, "joining");
  assert.equal(StartSessionResponse.safeParse({ ...ok, status: "paused" }).success, false);
});

test("EngineEvent parses each event type", () => {
  const status = EngineEvent.parse({ ...base, type: "session.status", status: "failed", errorCode: "bot_denied" });
  assert.equal(status.type === "session.status" && status.errorCode, "bot_denied");
  const usage = EngineEvent.parse({ ...base, type: "session.usage", botMinutes: 12.5, modelUsd: 0.32, ttsChars: 900 });
  assert.equal(usage.type === "session.usage" && usage.ttsChars, 900);
  const ready = EngineEvent.parse({ ...base, type: "handoff.ready", handoffId: "h_1", url: "https://engine.test/handoff/h_1" });
  assert.equal(ready.type === "handoff.ready" && ready.handoffId, "h_1");
});

test("EngineEvent rejects a bad shape", () => {
  assert.equal(EngineEvent.safeParse({ ...base, type: "session.usage", botMinutes: -1, modelUsd: 0, ttsChars: 0 }).success, false);
  assert.equal(EngineEvent.safeParse({ ...base, type: "session.status", status: "ended", at: "yesterday" }).success, false);
  assert.equal(EngineEvent.safeParse({ type: "session.status", status: "ended" }).success, false);
});

test("parsing ignores unknown keys", () => {
  const ev = EngineEvent.parse({ ...base, type: "session.status", status: "ended", extra: "later" });
  assert.equal("extra" in ev, false);
});

test("parseEngineEvent skips unknown event types without throwing", () => {
  const unknown = parseEngineEvent({ ...base, type: "session.something_new", foo: 1 });
  assert.deepEqual(unknown, { kind: "unknown", type: "session.something_new" });
  assert.equal(parseEngineEvent("junk").kind, "invalid");
  assert.equal(parseEngineEvent({ ...base, type: "session.usage" }).kind, "invalid");
  assert.equal(parseEngineEvent({ ...base, type: "session.status", status: "ended" }).kind, "event");
});
