import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { withChrome } from "./helpers/chrome.ts";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { testStore } from "./helpers/store.ts";
import { createApp, tokenMatches } from "../src/app.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createStageChannel } from "../src/stage/channel.ts";
import type { Prototype, UiNode } from "../src/ui/schema.ts";

const proto: Prototype = JSON.parse(readFileSync(new URL("./fixtures/proto-todo.json", import.meta.url), "utf8"));
// Add a second screen and a nav button so navigation can be exercised.
proto.root.children.push({ id: "about", type: "Screen", props: { title: "About" }, status: "agreed", children: [
  { id: "about.text", type: "Text", props: { text: "About this app" }, status: "agreed", children: [] },
] });
proto.root.children[0].children.push({
  id: "home.go", type: "Button", props: { label: "About" }, status: "agreed",
  on: { click: [{ kind: "navigate", screen: "about" }] }, children: [],
});

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=/renderer/theme.css>
<script type=importmap>{"imports":{"@renderer/":"/renderer/"}}</script>
<div id=root></div>
<script type=module>
import { renderTree, initialUiState } from "@renderer/render.js";
import { bindInteractions } from "@renderer/interact.js";
const root = document.getElementById("root");
const proto = await (await fetch("/proto.json")).json();
let state = initialUiState(proto);
window.draw = (p) => { window.nodes = renderTree(root, p, state); };
window.reSnapshot = () => window.draw(JSON.parse(JSON.stringify(proto)));
bindInteractions(root, () => proto, () => state, (s) => { state = s; window.draw(proto); });
window.draw(proto);
window.ready = true;
</script>`;

async function withPageServer(fn: (url: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    if (req.url === "/proto.json") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(proto));
    const m = req.url?.match(/^\/renderer\/([\w.-]+)$/);
    if (m) {
      try {
        const body = readFileSync(new URL(`../public/renderer/${m[1]}`, import.meta.url));
        return void res.writeHead(200, { "Content-Type": m[1].endsWith(".css") ? "text/css" : "text/javascript" }).end(body);
      } catch { /* fall through */ }
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as any).port}/`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

function ids(n: UiNode): string[] { return [n.id, ...n.children.flatMap(ids)]; }

test("renders fixture proto with data-node-id for every node and draft styling", async (t) => {
  await withChrome(t, async (page) => {
    await withPageServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const found = await page.eval<string[]>(`[...document.querySelectorAll("[data-node-id]")].map(e => e.dataset.nodeId)`);
      for (const id of ids(proto.root)) assert.ok(found.includes(id), `missing ${id}`);
      const draft = await page.eval<{ dashed: string; tag: string }>(`(() => {
        const el = document.querySelector('[data-node-id="home.list"]');
        return { dashed: getComputedStyle(el).outlineStyle, tag: getComputedStyle(el, "::after").content };
      })()`);
      assert.equal(draft.dashed, "dashed");
      assert.match(draft.tag, /draft/);
      const agreed = await page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="home.heading"]')).outlineStyle`);
      assert.equal(agreed, "none");
      const fs = await page.eval<number>(`parseFloat(getComputedStyle(document.querySelector('[data-node-id="home.heading"]')).fontSize)`);
      assert.ok(fs >= 20, `font ${fs}px`);
      const base = await page.eval<number>(`parseFloat(getComputedStyle(document.querySelector('[data-node-id="app"]')).fontSize)`);
      assert.ok(base >= 20, `base font ${base}px`);
    });
  });
});

test("re-snapshot of the same proto keeps DOM nodes (no blank, no recreation)", async (t) => {
  await withChrome(t, async (page) => {
    await withPageServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const r = await page.eval<{ added: number; removed: number; same: boolean; blank: boolean }>(`(() => {
        const root = document.getElementById("root");
        const before = new Map(window.nodes);
        const mo = new MutationObserver(() => {});
        mo.observe(root, { childList: true, subtree: true });
        window.reSnapshot();
        let added = 0, removed = 0;
        for (const rec of mo.takeRecords()) { added += rec.addedNodes.length; removed += rec.removedNodes.length; }
        let same = before.size === window.nodes.size;
        for (const [id, el] of window.nodes) if (before.get(id) !== el) same = false;
        return { added, removed, same, blank: root.children.length === 0 };
      })()`);
      assert.deepEqual(r, { added: 0, removed: 0, same: true, blank: false });
    });
  });
});

test("click on Button with navigate switches screen", async (t) => {
  await withChrome(t, async (page) => {
    await withPageServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const visible = (id: string) => page.eval<boolean>(`document.querySelector('[data-node-id="${id}"]').offsetParent !== null`);
      assert.equal(await visible("home"), true);
      assert.equal(await visible("about"), false);
      await page.eval(`document.querySelector('[data-node-id="home.go"]').click()`);
      assert.equal(await visible("home"), false);
      assert.equal(await visible("about"), true);
    });
  });
});

test("typing then clicking Add appends a list item and clears the input", async (t) => {
  await withChrome(t, async (page) => {
    await withPageServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      await page.eval(`(() => {
        const input = document.querySelector('[data-node-id="home.input"] input');
        input.value = "buy milk";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-node-id="home.add"]').click();
      })()`);
      const r = await page.eval<{ items: string[]; value: string }>(`({
        items: [...document.querySelectorAll('[data-node-id="home.list"] [data-list-item]')].map(e => e.textContent),
        value: document.querySelector('[data-node-id="home.input"] input').value,
      })`);
      assert.deepEqual(r, { items: ["buy milk"], value: "" });
    });
  });
});

test("stage page renders the scripted to-do prototype over the websocket", async (t) => {
  await withChrome(t, async (page) => {
    const config = loadConfig({
      RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key",
      RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
      PUBLIC_API_BASE_URL: "https://agent.example.com/",
    });
    const store = await testStore();
    const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({ id: "bot-1" }, { status: 201 })) as any, sleep: async () => {} });
    const server = http.createServer();
    let runtime!: ReturnType<typeof createRuntime>;
    const channel = createStageChannel(
      server,
      async (id, token) => {
        if (!tokenMatches(token, (await store.getSession(id))?.stage_token ?? null)) return false;
        await runtime.load(id);
        return true;
      },
      () => {},
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

      const script = readFileSync(new URL("./fixtures/script-todo.json", import.meta.url), "utf8");
      const run = await fetch(`${base}/api/sessions/${session.id}/script`, { method: "POST", body: script });
      assert.equal(run.status, 200);
      await page.waitFor(`document.querySelector('[data-node-id="home.heading"]')`);

      // A snapshot (e.g. after reconnect) whose currentScreen differs switches the visible screen.
      const snap = await page.eval<{ homeShown: boolean; otherShown: boolean; blank: boolean }>(`(() => {
        const p = JSON.parse(JSON.stringify(window.stageProto()));
        p.root.children.push({ id: "other", type: "Screen", props: {}, status: "agreed", children: [
          { id: "other.t", type: "Text", props: { text: "Other" }, status: "agreed", children: [] } ] });
        p.currentScreen = "other";
        window.stageEvent({ type: "snapshot", proto: p, uiScreen: "other", doc: null, captions: [], mood: null, comparison: null });
        const shown = (id) => document.querySelector('[data-node-id="' + id + '"]').offsetParent !== null;
        return { homeShown: shown("home"), otherShown: shown("other"), blank: document.getElementById("proto").children.length === 0 };
      })()`);
      assert.deepEqual(snap, { homeShown: false, otherShown: true, blank: false });

      const draft = await page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="home.input"]')).outlineStyle`);
      assert.equal(draft, "dashed");
      assert.equal(await page.eval(`document.getElementById("placeholder").hidden`), true);
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);

      const shot = process.env.STAGE_SCREENSHOT;
      if (shot) await page.screenshot(shot);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
