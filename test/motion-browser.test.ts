import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { withChrome } from "./helpers/chrome.ts";
import type { Page } from "./helpers/chrome.ts";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp, tokenMatches } from "../src/app.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createStageChannel } from "../src/stage/channel.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Stage = { page: Page; script(steps: unknown[]): Promise<void> };

// Starts the real app, opens the stage page in headless Chrome, and returns a script runner.
async function withStage(t: { skip(msg?: string): void }, fn: (s: Stage) => Promise<void>) {
  await withChrome(t, async (page) => {
    const config = loadConfig({
      RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key",
      RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
      PUBLIC_API_BASE_URL: "https://agent.example.com/",
    });
    const store = openStore(":memory:");
    const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({ id: "bot-1" }, { status: 201 })) as any, sleep: async () => {} });
    const server = http.createServer();
    let runtime!: ReturnType<typeof createRuntime>;
    const channel = createStageChannel(
      server,
      (id, token) => tokenMatches(token, store.getSession(id)?.stage_token ?? null),
      () => {},
      (id) => runtime(id).snapshot(),
    );
    runtime = createRuntime({ store, channel, log: () => {} });
    const app = createApp({ config, recall, store, runtime, log: () => {} });
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
      await fn({ page, script });
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
}

const text = (id: string, t: string, status = "agreed") => ({ id, type: "Text", props: { text: t }, status, children: [] });
const add = (parentId: string, node: unknown, index?: number) => (index === undefined ? { op: "add", parentId, node } : { op: "add", parentId, index, node });

test("changes on another screen trigger screen transition before focus", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([
      { batch: { label: "Home and About", by: "Ada", ops: [
        add("home", text("home.t", "Home screen")),
        add("app", { id: "about", type: "Screen", props: { title: "About" }, status: "draft", children: [text("about.t", "About this app")] }),
      ] } },
    ]);
    await page.waitFor(`document.querySelector('[data-node-id="about.t"]')`);
    await sleep(1700); // let the first spotlight finish
    await page.eval(`window.__motionLog = []`);

    // A change lands on the About screen while Home is showing.
    await script([{ batch: { label: "Added: contact line", by: "Bo", ops: [
      { op: "set_screen", screenId: "about" },
      add("about", text("about.contact", "Contact us")),
    ] } }]);
    await page.waitFor(`(window.__motionLog || []).some((e) => e.fn === "playFocus")`, 5000);
    const log = await page.eval<{ fn: string; id?: string; from?: string; to?: string; label?: string; t: number }[]>(`window.__motionLog`);
    const tr = log.find((e) => e.fn === "transitionScreen");
    const focus = log.find((e) => e.fn === "playFocus");
    assert.ok(tr, `no transitionScreen in ${JSON.stringify(log)}`);
    assert.deepEqual([tr.from, tr.to], ["home", "about"]);
    assert.equal(focus!.id, "about.contact");
    assert.equal(focus!.label, "Added: contact line · Bo");
    assert.ok(focus!.t - tr.t >= 400, `focus started ${focus!.t - tr.t}ms after the 450ms slide began`);
    const shown = await page.eval<{ home: boolean; about: boolean }>(`({
      home: document.querySelector('[data-node-id="home"]').getClientRects().length > 0,
      about: document.querySelector('[data-node-id="about"]').getClientRects().length > 0 })`);
    assert.deepEqual(shown, { home: false, about: true });
  });
});

test("set_screen brings the stage back after it followed a change to another screen", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Screens", ops: [
      add("home", text("home.t", "Home screen")),
      add("app", { id: "about", type: "Screen", props: {}, status: "agreed", children: [] }),
    ] } }]);
    await script([{ batch: { label: "About text", ops: [add("about", text("about.t", "About"))] } }]); // follows to About
    const shown = (id: string) => page.eval<boolean>(`document.querySelector('[data-node-id="${id}"]').getClientRects().length > 0`);
    await page.waitFor(`document.querySelector('[data-node-id="about"]').getClientRects().length > 0`);
    await script([{ batch: { label: "Back", ops: [{ op: "set_screen", screenId: "home" }] } }]); // currentScreen was already home
    await page.waitFor(`document.querySelector('[data-node-id="home"]').getClientRects().length > 0`, 2000);
    assert.equal(await shown("about"), false);
  });
});

test("reconcile motion: enter, exit, move, cross-fade, settle use transform/opacity only", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [
      add("home", text("a", "Alpha")), add("home", text("b", "Bravo", "draft")), add("home", text("c", "Charlie")),
    ] } }]);
    await page.waitFor(`document.querySelector('[data-node-id="c"]')`);
    // Snapshot the animations started by each patch, synchronously, as the patch is drawn.
    await page.eval(`(() => {
      window.__anims = [];
      const orig = window.stageEvent;
      window.stageEvent = (ev) => {
        const before = new Set(document.getAnimations());
        orig(ev);
        if (ev.type !== "patch") return;
        for (const a of document.getAnimations()) {
          if (before.has(a)) continue;
          const kf = a.effect.getKeyframes();
          const el = a.effect.target;
          window.__anims.push({
            props: [...new Set(kf.flatMap((k) => Object.keys(k)))].filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p)),
            duration: a.effect.getTiming().duration,
            easing: [...new Set(kf.map((k) => k.easing))].concat(a.effect.getTiming().easing),
            cls: el.className, id: el.dataset ? el.dataset.nodeId || "" : "",
          });
        }
      };
    })()`);
    await sleep(200);
    // The stage socket handler calls the module-scoped onEvent, so drive patches through the hook.
    const patch = (proto: unknown, changes: unknown[]) => page.eval(`window.stageEvent({ type: "patch", proto: ${JSON.stringify(proto)}, changes: ${JSON.stringify(changes)} })`);
    const base = await page.eval<any>(`JSON.parse(JSON.stringify(window.stageProto()))`);
    const home = () => base.root.children.find((s: any) => s.id === "home");

    home().children.push(text("d", "Delta"));
    await patch(base, [{ kind: "added", id: "d", label: "Add", by: "Ada" }]);
    const [a0] = home().children.splice(0, 1);
    home().children.push(a0); // move Alpha to the end
    await patch(base, [{ kind: "moved", id: "a", label: "Move", by: "Ada" }]);
    home().children.find((n: any) => n.id === "c").props.text = "Charlie!";
    await patch(base, [{ kind: "updated", id: "c", label: "Edit", by: "Ada" }]);
    home().children.find((n: any) => n.id === "b").status = "agreed";
    await patch(base, [{ kind: "updated", id: "b", label: "Agreed", by: "Ada" }]);
    home().children = home().children.filter((n: any) => n.id !== "d");
    await patch(base, [{ kind: "removed", id: "d", label: "Remove", by: "Ada" }]);

    const anims = await page.eval<{ props: string[]; duration: number; easing: string[]; cls: string; id: string }[]>(`window.__anims`);
    assert.ok(anims.length >= 5, JSON.stringify(anims));
    for (const a of anims) {
      for (const p of a.props) assert.ok(p === "transform" || p === "opacity", `animates ${p}: ${JSON.stringify(a)}`);
      assert.ok(a.duration >= 250 && a.duration <= 1500, `duration ${a.duration}`);
      for (const e of a.easing) assert.ok(e === "ease-out" || e === "linear", `easing ${e}`);
    }
    const has = (pred: (a: (typeof anims)[number]) => boolean, what: string) => assert.ok(anims.some(pred), `${what}: ${JSON.stringify(anims)}`);
    has((a) => a.id === "d" && a.duration === 350 && a.props.includes("opacity"), "enter 350ms on added node");
    has((a) => a.id === "b" && a.duration === 350 && a.props.includes("transform"), "FLIP glide on a node shifted by the move");
    has((a) => /m-ghost/.test(a.cls) && a.duration === 250, "cross-fade 250ms for the prop update");
    has((a) => /m-settle/.test(a.cls) && a.duration === 400, "settled outline morph 400ms");
    has((a) => /m-ghost/.test(a.cls) && a.duration === 300, "exit collapse 300ms");

    await sleep(700);
    const left = await page.eval<{ ghosts: number; d: boolean; dashed: string }>(`({
      ghosts: document.querySelectorAll(".m-ghost").length,
      d: !!document.querySelector('[data-node-id="d"]'),
      dashed: getComputedStyle(document.querySelector('[data-node-id="b"]')).outlineStyle })`);
    assert.deepEqual(left, { ghosts: 0, d: false, dashed: "none" });
  });
});

test("a removal is spotlit on the parent it left, with its label", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Start", ops: [add("home", text("a", "Alpha")), add("home", text("b", "Bravo"))] } }]);
    await sleep(1700);
    await page.eval(`window.__motionLog = []`);
    await script([{ batch: { label: "Removed: Alpha", by: "Ada", ops: [{ op: "remove", id: "a" }] } }]);
    await page.waitFor(`window.__motionLog.some((e) => e.fn === "playFocus")`, 3000);
    const focus = await page.eval<{ id: string; label: string }>(`window.__motionLog.find((e) => e.fn === "playFocus")`);
    assert.deepEqual({ id: focus.id, label: focus.label }, { id: "home", label: "Removed: Alpha · Ada" });
  });
});

test("voice command: pointer glides and presses before the action runs", async (t) => {
  await withStage(t, async ({ page, script }) => {
    await script([{ batch: { label: "Nav", ops: [
      add("home", { id: "home.go", type: "Button", props: { label: "About" }, status: "agreed", on: { click: [{ kind: "navigate", screen: "about" }] }, children: [] }),
      add("app", { id: "about", type: "Screen", props: {}, status: "agreed", children: [text("about.t", "About")] }),
    ] } }]);
    await page.waitFor(`document.querySelector('[data-node-id="home.go"]')`);
    const t0 = await page.eval<number>(`(() => {
      window.stageEvent({ type: "command", nodeId: "home.go", interaction: { kind: "navigate", screen: "about" } });
      return performance.now();
    })()`);
    const early = await page.eval<{ about: boolean; pointer: boolean }>(`({
      about: document.querySelector('[data-node-id="about"]').getClientRects().length > 0,
      pointer: !!document.querySelector(".m-pointer") })`);
    assert.deepEqual(early, { about: false, pointer: true }, "the action waits for the pointer");
    await page.waitFor(`document.querySelector('[data-node-id="about"]').getClientRects().length > 0`, 3000);
    const log = await page.eval<{ fn: string; t: number; phase?: string }[]>(`window.__motionLog`);
    const press = log.find((e) => e.fn === "animatePointer" && e.phase === "press");
    assert.ok(press && press.t - t0 >= 450, `press at ${press && press.t - t0}ms`);
  });
});

test("pending region shows a shimmer placeholder and clears it", async (t) => {
  await withStage(t, async ({ page }) => {
    await page.eval(`window.stageEvent({ type: "pending_region", parentId: "home" })`);
    const shown = await page.eval<{ inHome: boolean; shimmer: number }>(`(() => {
      const ph = document.querySelector(".m-pending");
      return { inHome: !!ph && document.querySelector('[data-node-id="home"]').contains(ph),
               shimmer: document.getAnimations().filter((a) => a.effect.target.classList.contains("m-shimmer")).length };
    })()`);
    assert.deepEqual(shown, { inHome: true, shimmer: 1 });
    await page.eval(`window.stageEvent({ type: "pending_region", parentId: null })`);
    await page.waitFor(`!document.querySelector(".m-pending")`, 2000);
  });
});

test("frame budget: a burst of 10 focus moments (capped queue) holds the 15fps clock", { timeout: 60_000 }, async (t) => {
  await withStage(t, async ({ page, script }) => {
    await page.setCpuThrottle(2);
    await page.eval(`import("@renderer/clock.js").then((m) => { window.__ticks = []; m.onFrame((now) => window.__ticks.push(now)); })`);
    const steps = Array.from({ length: 10 }, (_, i) => ({ wait: 30, batch: { label: `Added: item ${i + 1}`, by: i % 2 ? "Bo" : "Ada", ops: [
      add("home", text(`item-${i}`, `Item number ${i + 1}`, i % 3 ? "agreed" : "draft")),
    ] } }));
    await script(steps);
    await sleep(15_000);
    const r = await page.eval<{ ticks: number[]; focus: number; played: string[] }>(`(() => {
      const played = window.__motionLog.filter((e) => e.fn === "playFocus").map((e) => e.id);
      return { ticks: window.__ticks.slice(), focus: played.length, played };
    })()`);
    const gaps = r.ticks.slice(1).map((v, i) => v - r.ticks[i]).sort((a, b) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    const max = gaps[gaps.length - 1];
    console.log(`frame budget: ${gaps.length} ticks, p95 ${p95.toFixed(1)}ms, max ${max.toFixed(1)}ms, ${r.focus} focus moments`);
    assert.ok(gaps.length >= 200, `only ${gaps.length} ticks in 15s`);
    assert.ok(p95 <= 90, `tick interval p95 ${p95}ms`);
    // The burst is capped: the one playing plus at most 3 pending, the newest kept.
    assert.equal(r.focus, 4, `played ${JSON.stringify(r.played)}`);
    assert.deepEqual(r.played.slice(1), ["item-7", "item-8", "item-9"]);
  });
});
