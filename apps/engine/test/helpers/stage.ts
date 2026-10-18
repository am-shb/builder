// Starts the real app, opens the stage page in headless Chrome, and hands the test a script runner
// (POST /api/sessions/:id/script). Fails the test on any uncaught page exception.
import assert from "node:assert/strict";
import http from "node:http";
import { withChrome } from "./chrome.ts";
import type { Page } from "./chrome.ts";
import { loadConfig } from "../../src/config.ts";
import { createRecallClient } from "../../src/recall-client.ts";
import { testStore } from "./store.ts";
import { createApp, tokenMatches } from "../../src/app.ts";
import { createRuntime, handleStageMessage } from "../../src/session/runtime.ts";
import { createStageChannel } from "../../src/stage/channel.ts";
import type { StageSink } from "../../src/stage/channel.ts";
import type { Store } from "../../src/store.ts";

export type Stage = {
  page: Page; script(steps: unknown[]): Promise<void>; runtime: ReturnType<typeof createRuntime>; sessionId: string;
  channel: StageSink; store: Store;
  /** Session ids of the barge_in messages the stage has sent. */
  bargeIns: string[];
};

export async function withStage(t: { skip(msg?: string): void }, fn: (s: Stage) => Promise<void>) {
  await withChrome(t, async (page) => {
    const config = loadConfig({
      RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key",
      RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
      PUBLIC_API_BASE_URL: "https://agent.example.com/",
    });
    const store = await testStore();
    const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({ id: "bot-1" }, { status: 201 })) as any, sleep: async () => {} });
    const server = http.createServer();
    const bargeIns: string[] = [];
    let runtime!: ReturnType<typeof createRuntime>;
    const channel = createStageChannel(
      server,
      async (id, token) => {
        if (!tokenMatches(token, (await store.getSession(id))?.stage_token ?? null)) return false;
        await runtime.load(id);
        return true;
      },
      (id, msg) => handleStageMessage(runtime, id, msg, (sid) => bargeIns.push(sid)),
      (id) => runtime(id).snapshot(),
    );
    runtime = createRuntime({ store, channel, log: () => {} });
    const app = await createApp({ config, recall, store, runtime, log: () => {} });
    server.on("request", app.handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      const created = await fetch(`${base}/api/sessions`, { method: "POST", body: JSON.stringify({ meeting_url: "https://meet.google.com/abc-defg-hij" }) });
      const { session } = (await created.json()) as any;
      const stageUrl = new URL(((await (await fetch(`${base}/api/sessions/${session.id}`)).json()) as any).session.stage_url);
      await page.goto(`${base}${stageUrl.pathname}${stageUrl.search}`);
      await page.waitFor(`document.querySelector('[data-node-id="home"]')`);
      await page.eval(`window.__motionLog = []`);
      const script = async (steps: unknown[]) => {
        const r = await fetch(`${base}/api/sessions/${session.id}/script`, { method: "POST", body: JSON.stringify({ steps }) });
        assert.equal(r.status, 200);
        const body = (await r.json()) as any;
        for (const res of body.results ?? []) assert.equal(res.ok, true, `script step ${res.index}: ${res.error}`);
      };
      await fn({ page, script, runtime, sessionId: session.id, channel, store, bargeIns });
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
}
