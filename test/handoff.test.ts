import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withChrome } from "./helpers/chrome.ts";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp } from "../src/app.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { Prototype } from "../src/ui/schema.ts";
import { buildExportHtml } from "../src/handoff/export.ts";

const proto: Prototype = JSON.parse(readFileSync(new URL("./fixtures/proto-todo.json", import.meta.url), "utf8"));
const EVIL = `Use </script><img src=x onerror=alert(1)> everywhere`;
const doc: ConsensusDoc = {
  ...emptyDoc(),
  app: { name: "Team To-Do" },
  decisions: [
    { id: "d0", text: "Tasks live on one list", status: "agreed", proposedBy: "Ada", agreedBy: ["Ada", "Bo"], decidedAt: 1_700_000_000_000, affects: ["home.list"], rejectedOptions: ["Kanban board"] },
    { id: "d1", text: EVIL, status: "pending", proposedBy: "Bo", agreedBy: [], affects: ["home.add"], rejectedOptions: [] },
  ],
  openQuestions: [{ id: "q1", text: "Do tasks have due dates?", raisedBy: "Cy", since: 1, lastEngagedAt: 1 }],
};

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

async function start() {
  const config = loadConfig({
    RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key",
    RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
    PUBLIC_API_BASE_URL: "https://agent.example.com/",
  });
  const store = openStore(":memory:");
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({})) as any, sleep: async () => {} });
  const app = createApp({ config, recall, store, log: () => {} });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const id = randomUUID();
  store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  store.saveConsensus(id, doc, proto);
  const token = store.ensureStageToken(id);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return { base, id, token, store, close: () => { openServers.delete(server); server.closeAllConnections(); server.close(); } };
}

const tunnel = { "x-forwarded-for": "1.2.3.4" };

test("handoff requires token and is reachable through the tunnel", async () => {
  const h = await start();
  try {
    for (const path of [`/handoff/${h.id}`, `/handoff/${h.id}/export`]) {
      assert.equal((await fetch(`${h.base}${path}`, { headers: tunnel })).status, 404);
      assert.equal((await fetch(`${h.base}${path}?token=wrong`, { headers: tunnel })).status, 404);
      const ok = await fetch(`${h.base}${path}?token=${h.token}`, { headers: tunnel });
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get("content-type")!, /text\/html/);
    }
    const unknown = await fetch(`${h.base}/handoff/${randomUUID()}?token=${h.token}`, { headers: tunnel });
    assert.equal(unknown.status, 404);
    const page = await (await fetch(`${h.base}/handoff/${h.id}?token=${h.token}`, { headers: tunnel })).text();
    assert.match(page, /Tasks live on one list/);
    assert.match(page, /Do tasks have due dates\?/);
    assert.match(page, /Kanban board/);
    // The operator session view links to the handoff.
    const view = (await (await fetch(`${h.base}/api/sessions/${h.id}`)).json()) as any;
    assert.match(view.session.handoff_url, new RegExp(`^https://agent.example.com/handoff/${h.id}\\?token=`));
  } finally { h.close(); }
});

test("drafts are flagged as not agreed", () => {
  const html = buildExportHtml(doc, proto);
  const start = html.indexOf('id="not-agreed"');
  assert.ok(start > 0);
  const notAgreed = html.slice(start, html.indexOf("</section>", start));
  assert.match(notAgreed, /Not agreed/);
  assert.match(notAgreed, /home\.add/);
  assert.match(notAgreed, /home\.list/);
  assert.match(notAgreed, /&lt;\/script&gt;/); // the pending decision, escaped
  assert.doesNotMatch(notAgreed, /home\.heading/);
  assert.doesNotMatch(notAgreed, /Tasks live on one list/);
  assert.match(html, /class="flag"/);
});

test("export escapes embedded data", () => {
  const html = buildExportHtml(doc, proto);
  assert.equal(html.split("</script>").length - 1, html.split("<script").length - 1, "stray </script>");
  assert.doesNotMatch(html, /<img src=x/);
});

test("export is self-contained", async (t) => {
  const html = buildExportHtml(doc, proto);
  assert.doesNotMatch(html, /src="\//);
  assert.doesNotMatch(html, /href="\//);
  assert.doesNotMatch(html, /http/);
  assert.match(html, /data:text\/javascript;base64,/);
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  try {
    const file = join(dir, "handoff.html");
    writeFileSync(file, html);
    await withChrome(t, async (page) => {
      await page.goto(`file://${file}`);
      await page.waitFor(`document.querySelector('#prototype [data-node-id="home"]')`);
      // Interactions work offline: type a task and add it.
      await page.eval(`(() => { const i = document.querySelector('[data-node-id="home.input"] input, input[data-node-id="home.input"]'); i.value = "ship it"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await page.eval(`document.querySelector('[data-node-id="home.add"]').click()`);
      await page.waitFor(`document.querySelector('#prototype [data-node-id="home.list"]').textContent.includes("ship it")`);
      assert.deepEqual(page.logs.filter((l) => /exception|error/i.test(l)), []);
    }, { width: 1440, height: 900 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("live handoff page renders the prototype and flags drafts", async (t) => {
  const h = await start();
  try {
    await withChrome(t, async (page) => {
      await page.goto(`${h.base}/handoff/${h.id}?token=${h.token}`);
      await page.waitFor(`document.querySelector('#prototype [data-node-id="home"]')`);
      assert.equal(await page.eval(`document.querySelectorAll("#not-agreed .flag").length > 0`), true);
      assert.equal(await page.eval(`!!document.querySelector('a[href*="/export?token="]')`), true);
      if (process.env.HANDOFF_SHOT) await page.screenshot(process.env.HANDOFF_SHOT);
      assert.deepEqual(page.logs.filter((l) => /exception|error/i.test(l)), []);
    }, { width: 1440, height: 900 });
  } finally { h.close(); }
});
