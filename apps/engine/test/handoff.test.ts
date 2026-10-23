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
import { testStore } from "./helpers/store.ts";
import { createApp } from "../src/app.ts";
import { emptyDoc } from "../src/consensus/doc.ts";
import { emptyPrototype } from "../src/ui/tree.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import type { Prototype } from "../src/ui/schema.ts";
import { buildExportHtml, imagesUsed, RENDERER_MODULES } from "../src/handoff/export.ts";
import { IMAGES } from "../public/renderer/images.js";
import { HandoffToolInput, normalizeResolvedChoice } from "../src/agent/handoff.ts";

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
  const store = await testStore();
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({})) as any, sleep: async () => {} });
  const app = await createApp({ config, recall, store, log: () => {} });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  const id = randomUUID();
  await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
  await store.saveConsensus(id, doc, proto);
  const token = await store.ensureHandoffToken(id);
  const stageToken = await store.ensureStageToken(id);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  return { base, id, token, stageToken, store, close: () => { openServers.delete(server); server.closeAllConnections(); server.close(); } };
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
    // The handoff token is read-only and separate from the stage token (known issue I7).
    assert.notEqual(h.token, h.stageToken);
    assert.equal((await fetch(`${h.base}/handoff/${h.id}?token=${h.stageToken}`, { headers: tunnel })).status, 404, "the stage token does not open the handoff");
    assert.equal((await fetch(`${h.base}/stage/${h.id}/state?token=${h.token}`, { headers: tunnel })).status, 404, "the handoff token does not open the stage");
    const page = await (await fetch(`${h.base}/handoff/${h.id}?token=${h.token}`, { headers: tunnel })).text();
    assert.match(page, /Tasks live on one list/);
    assert.match(page, /Do tasks have due dates\?/);
    assert.match(page, /Kanban board/);
    // The operator session view links to the handoff.
    const view = (await (await fetch(`${h.base}/api/sessions/${h.id}`)).json()) as any;
    assert.equal(view.session.handoff_url, `https://agent.example.com/handoff/${h.id}?token=${h.token}`);
  } finally { h.close(); }
});

test("before anything is saved the handoff is empty, not missing (known issue M8)", async () => {
  const h = await start();
  try {
    const id = randomUUID();
    await h.store.createIntent(id, "https://meet.google.com/new-sess-ion");
    const token = await h.store.ensureHandoffToken(id);
    for (const path of [`/handoff/${id}`, `/handoff/${id}/export`]) {
      const res = await fetch(`${h.base}${path}?token=${token}`, { headers: tunnel });
      assert.equal(res.status, 200, path);
      const page = await res.text();
      assert.match(page, /No decisions agreed yet/);
      assert.match(page, /Untitled app/);
    }
    assert.equal((await fetch(`${h.base}/handoff/${id}?token=wrong`, { headers: tunnel })).status, 404, "still token-gated");
  } finally { h.close(); }
});

test("an agreed decision with nobody named says how it was agreed (known issue M3)", () => {
  const timed = { id: "d2", text: "Due dates on every task", status: "agreed" as const, proposedBy: "Bo", agreedBy: [], decidedAt: 1_700_000_000_000, affects: [], rejectedOptions: [] };
  const picked = { ...timed, id: "d-c1", text: "Done tasks get their own tab" };
  const pending = { ...timed, id: "d3", text: "Colour-coded labels", status: "pending" as const, decidedAt: undefined };
  const html = buildExportHtml({
    ...emptyDoc(),
    decisions: [timed, picked, pending],
    conflicts: [{ id: "c1", topic: "Done tasks", status: "resolved", openedAt: 1, winner: "B", variants: [
      { label: "A", summary: "Toggle", backers: [], batch: { label: "A", ops: [] } },
      { label: "B", summary: "Tab", backers: [], batch: { label: "B", ops: [] } },
    ] }],
  }, emptyPrototype("Team To-Do"));
  const meta = (text: string) => {
    const at = html.indexOf(`<p class="decision-text">${text}`);
    assert.ok(at > 0, text);
    return html.slice(at, html.indexOf("</li>", at));
  };
  assert.match(meta("Due dates on every task"), /<dt>Agreed by<\/dt><dd>no objection within 30 s<\/dd>/);
  assert.match(meta("Done tasks get their own tab"), /<dt>Agreed by<\/dt><dd>the room, picking between side-by-side options<\/dd>/);
  assert.match(meta("Colour-coded labels"), /<dt>Agreed by<\/dt><dd>nobody yet<\/dd>/);
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
  // The bundled font travels inside the file: a data URL, with no relative url left to miss offline.
  const font = readFileSync(new URL("../public/renderer/fonts/inter-latin-wght-normal.woff2", import.meta.url)).toString("base64");
  assert.ok(html.includes(`url("data:font/woff2;base64,${font}")`), "Inter inlined as a data URL");
  assert.doesNotMatch(html, /url\("?fonts\//);
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  try {
    const file = join(dir, "handoff.html");
    writeFileSync(file, html);
    await withChrome(t, async (page) => {
      await page.goto(`file://${file}`);
      await page.waitFor(`document.querySelector('#prototype [data-node-id="home"]')`);
      assert.ok((await page.fonts()).includes("Inter"), "Inter loads from the file");
      assert.equal(await page.eval(`document.fonts.check("16px Inter")`), true);
      assert.match(await page.eval<string>(`getComputedStyle(document.querySelector('#prototype [data-node-id="home"]')).fontFamily`), /^"?Inter"?,/);
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
      assert.ok((await page.fonts()).includes("Inter"), "the live page loads Inter from /renderer/fonts/");
      if (process.env.HANDOFF_SHOT) await page.screenshot(process.env.HANDOFF_SHOT);
      assert.deepEqual(page.logs.filter((l) => /exception|error/i.test(l)), []);
    }, { width: 1440, height: 900 });
  } finally { h.close(); }
});

test("the export shows the agreed theme and opens offline", async (t) => {
  const themed: Prototype = {
    ...proto,
    theme: {
      accent: { value: "gold", status: "draft", decisionId: "d1", previous: "blue" },
      warmth: { value: "neutral", status: "agreed", previous: "neutral" },
      radius: { value: "soft", status: "agreed", previous: "soft" },
      density: { value: "regular", status: "agreed", previous: "regular" },
    },
  };
  const html = buildExportHtml(doc, themed);
  for (const m of RENDERER_MODULES) assert.match(html, new RegExp(`"@renderer/${m.replace(/[./]/g, "\\$&")}":"data:text/javascript;base64,`), m);
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  try {
    const file = join(dir, "handoff.html");
    writeFileSync(file, html);
    await withChrome(t, async (page) => {
      await page.goto(`file://${file}`);
      await page.waitFor(`document.querySelector('#prototype [data-node-id="${proto.root.id}"]')`);
      assert.equal(await page.eval(`getComputedStyle(document.querySelector('#prototype [data-node-id="${proto.root.id}"]')).getPropertyValue("--b-accent").trim()`), "#2563eb");
      assert.deepEqual(page.logs.filter((l) => /exception|error/i.test(l)), []);
    }, { width: 1440, height: 900 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- images in the handoff ----
const withImages: Prototype = (() => {
  const p: Prototype = JSON.parse(JSON.stringify(proto));
  p.root.children.push(
    { id: "shop", type: "Screen", props: { title: "Shop" }, status: "agreed", children: [
      { id: "shop.pic", type: "Image", props: { image: "food-3", label: "Latte" }, status: "agreed", children: [] },
      { id: "shop.card", type: "ProductCard", props: { title: "Tote", image: "products-4" }, status: "agreed", children: [] },
      { id: "shop.nope", type: "Image", props: { image: "pizza" }, status: "agreed", children: [] },
      { id: "shop.same", type: "MediaCard", props: { title: "Again", image: "food-3" }, status: "agreed", children: [] },
    ] },
  );
  p.currentScreen = "shop";
  return p;
})();

test("imagesUsed mirrors what the renderer resolves, across every screen", () => {
  assert.deepEqual(imagesUsed(withImages).sort(), ["food-3.webp", "products-4.webp"]);
  assert.deepEqual(imagesUsed(proto), []);
  const subject: Prototype = JSON.parse(JSON.stringify(proto));
  subject.root.children[0].children.push({ id: "pic.x", type: "Image", props: { image: "abstract" }, status: "agreed", children: [] });
  const [file] = imagesUsed(subject);
  assert.match(file, /^abstract-\d\.webp$/);
  assert.ok(IMAGES.some((i) => i.file === file));
});

test("the inline export contains exactly the images the prototype uses and opens offline", async (t) => {
  const html = buildExportHtml(doc, withImages);
  assert.equal(html.match(/data:image\/webp;base64,/g)?.length, 2);
  for (const file of ["food-3.webp", "products-4.webp"]) {
    const b64 = readFileSync(new URL(`../public/renderer/images/${file}`, import.meta.url)).toString("base64");
    assert.ok(html.includes(b64), file);
  }
  t.diagnostic(`export with 2 images: ${html.length} bytes; without: ${buildExportHtml(doc, proto).length} bytes`);
  assert.equal(buildExportHtml(doc, proto).includes("data:image/webp"), false, "no images, none inlined");
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  try {
    const file = join(dir, "handoff.html");
    writeFileSync(file, html);
    await withChrome(t, async (page) => {
      await page.goto(`file://${file}`);
      const shown = `!!document.querySelector('#prototype [data-node-id="shop"]')`;
      await page.waitFor(shown);
      const widths = await page.eval<number[]>(`(async () => {
        const imgs = [...document.querySelectorAll('#prototype img')];
        await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
        return imgs.map((i) => i.naturalWidth);
      })()`);
      assert.equal(widths.length, 3, "two photos plus the repeat of food-3");
      assert.ok(widths.every((w) => w > 0), JSON.stringify(widths));
      assert.ok((await page.eval<string[]>(`[...document.querySelectorAll('#prototype img')].map((i) => i.src.slice(0, 22))`)).every((s) => s === "data:image/webp;base64"));
      assert.deepEqual(page.logs.filter((l) => /exception|error/i.test(l)), []);
    }, { width: 1440, height: 900 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the live handoff references images by URL and the app serves them", async () => {
  const h = await start();
  try {
    const id = randomUUID();
    await h.store.createIntent(id, "https://meet.google.com/img-sess-ion");
    await h.store.saveConsensus(id, doc, withImages);
    const token = await h.store.ensureHandoffToken(id);
    const page = await (await fetch(`${h.base}/handoff/${id}?token=${token}`, { headers: tunnel })).text();
    assert.equal(page.includes("data:image/webp"), false);
    assert.match(page, /"@renderer\/":"\/renderer\/"/);
    const img = await fetch(`${h.base}/renderer/images/food-3.webp`, { headers: tunnel });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.ok((await img.arrayBuffer()).byteLength > 1000);
    assert.equal((await fetch(`${h.base}/renderer/images/missing-1.webp`, { headers: tunnel })).status, 404);
  } finally { h.close(); }
});

test("normalizeResolvedChoice reads the shapes models write", () => {
  const star = (winner: string) => ({ conflictId: "*", winner });
  assert.deepEqual(normalizeResolvedChoice('{"conflictId":"c-top","winner":"B"}'), { conflictId: "c-top", winner: "B" });
  for (const v of ["B", "b", "option B", "Option b"]) assert.deepEqual(normalizeResolvedChoice(v), star("B"), v);
  assert.deepEqual(normalizeResolvedChoice({ conflictId: "c-top", winner: "b" }), { conflictId: "c-top", winner: "B" });
  assert.deepEqual(normalizeResolvedChoice({ conflictId: "c-top", label: "B" }), { conflictId: "c-top", winner: "B" });
  assert.deepEqual(normalizeResolvedChoice({ winner: "B" }), star("B"));
  assert.equal(normalizeResolvedChoice("D"), "D");
  assert.equal(normalizeResolvedChoice(42), 42);
});

test("HandoffToolInput accepts a resolvedChoice written as a bare label", () => {
  const topic = { title: "t", proposals: [], questionsRaised: [], resolvedChoice: "B" };
  const r = HandoffToolInput.safeParse({ topics: [topic], mood: "converging", groundingIds: [1] });
  assert.ok(r.success);
  assert.deepEqual(r.data.topics[0].resolvedChoice, { conflictId: "*", winner: "B" });
  assert.ok(!HandoffToolInput.safeParse({ topics: [{ ...topic, resolvedChoice: "D" }], mood: "converging", groundingIds: [1] }).success);
});
