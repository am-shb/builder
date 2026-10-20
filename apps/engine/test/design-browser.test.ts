// The component library in headless Chrome at the stage's 900x720 canvas: every catalog type renders, nothing
// overflows sideways, no text is below 14px, and nothing throws. Screenshots are saved for human review.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withChrome } from "./helpers/chrome.ts";
import type { Page } from "./helpers/chrome.ts";
import { COMPONENT_TYPES } from "../public/renderer/catalog.js";

const proto: any = JSON.parse(readFileSync(new URL("./fixtures/gallery-proto.json", import.meta.url), "utf8"));
const SCREENS: string[] = proto.root.children.map((s: { id: string }) => s.id);
const WIDTH = 900;
const HEIGHT = 720;

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=/renderer/theme.css>
<style>html { scrollbar-width: none; } body { margin: 0; } #root { display: grid; width: ${WIDTH}px; min-height: ${HEIGHT}px; }</style>
<script type=importmap>{"imports":{"@renderer/":"/renderer/"}}</script>
<div id=root></div>
<script type=module>
import { renderTree, initialUiState } from "@renderer/render.js";
import { bindInteractions } from "@renderer/interact.js";
const root = document.getElementById("root");
const proto = await (await fetch("/proto.json")).json();
window.proto = proto;
let state = initialUiState(proto);
window.draw = () => { window.nodes = renderTree(root, proto, state); };
window.show = (screen, open = {}) => { state = { ...state, screen, open }; window.draw(); window.scrollTo(0, 0); };
bindInteractions(root, () => proto, () => state, (s) => { state = s; window.draw(); });
window.draw();
window.ready = true;
</script>`;

async function withGalleryServer(fn: (url: string) => Promise<void>) {
  const server = http.createServer((req, res) => {
    if (req.url === "/") return void res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
    if (req.url === "/proto.json") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(proto));
    const m = req.url?.match(/^\/renderer\/((?:components\/)?[\w.-]+\.(js|css))$/);
    if (m) {
      try {
        const body = readFileSync(new URL(`../public/renderer/${m[1]}`, import.meta.url));
        return void res.writeHead(200, { "Content-Type": m[2] === "css" ? "text/css" : "text/javascript" }).end(body);
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

// Saves the screen in viewport-high slices (the gallery screens are taller than the canvas).
async function shoot(page: Page, dir: string, name: string, variant = "neutral"): Promise<string[]> {
  const height = await page.eval<number>(`document.documentElement.scrollHeight`);
  const files: string[] = [];
  for (let y = 0, i = 1; y < height; y += HEIGHT, i++) {
    await page.eval(`window.scrollTo(0, ${y})`);
    const file = path.join(dir, `${name}${i > 1 ? `-${i}` : ""}-${variant}.png`);
    await page.screenshot(file);
    files.push(file);
  }
  await page.eval(`window.scrollTo(0, 0)`);
  return files;
}

const SMALL_TEXT = `(() => {
  const small = [];
  for (const el of document.querySelectorAll("#root *")) {
    if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const field = el.matches("input:not([type=range]):not([type=radio]), select");
    if (!own && !field) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 14) small.push((el.closest("[data-node-id]")?.dataset.nodeId ?? "?") + " " + el.tagName + " " + px + "px");
  }
  return small;
})()`;

test("gallery: every catalog type renders without overflow, small text or errors", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");

      // every catalog type renders
      const types = await page.eval<string[]>(`[...new Set([...document.querySelectorAll("[data-type]")].map((e) => e.dataset.type))]`);
      assert.deepEqual([...types].sort(), [...COMPONENT_TYPES].sort());

      // A node that clips its overflow would clip its own DRAFT tag (drawn above it).
      const clipping = await page.eval<string[]>(`[...document.querySelectorAll(".b-node")].filter((e) => getComputedStyle(e).overflow !== "visible").map((e) => e.dataset.type)`);
      assert.deepEqual(clipping, [], "nodes that clip their draft tag");

      const shots: string[] = [];
      for (const screen of SCREENS) {
        await page.eval(`window.show(${JSON.stringify(screen)})`);
        const visible = await page.eval<boolean>(`document.querySelector('[data-node-id="${screen}"]').getClientRects().length > 0`);
        assert.equal(visible, true, `${screen} is shown`);

        // no horizontal overflow
        const widths = await page.eval<{ root: number; doc: number }>(`({ root: document.getElementById("root").scrollWidth, doc: document.documentElement.scrollWidth })`);
        assert.ok(widths.root <= WIDTH && widths.doc <= WIDTH, `${screen} overflows: ${JSON.stringify(widths)}`);

        // no text below 14px
        assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], `${screen} has text below 14px`);

        shots.push(...(await shoot(page, dir, `gallery-${screen.replace(/^gallery-/, "")}`)));
      }

      // The overlays, opened (they are closed in the fixture).
      await page.eval(`window.show("gallery-a", { "a.drawer": true })`);
      assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], "drawer has text below 14px");
      shots.push(...(await shoot(page, dir, "gallery-a-drawer")));
      await page.eval(`window.show("gallery-a", { "a.modal": true })`);
      assert.deepEqual(await page.eval<string[]>(SMALL_TEXT), [], "modal has text below 14px");
      shots.push(...(await shoot(page, dir, "gallery-a-modal")));

      // no page errors
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`screenshots: ${dir} (${shots.length} files)`);
    });
  }, { width: WIDTH, height: HEIGHT });
});

const slot = (value: string) => ({ value, status: "agreed", previous: value });
const themed = (accent: string, warmth = "neutral") => ({ accent: slot(accent), warmth: slot(warmth), radius: slot("soft"), density: slot("regular") });

test("each theme sets its variables on the App element", async (t) => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "design-")), "screens");
  mkdirSync(dir, { recursive: true });
  const base = structuredClone(proto);
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const appVar = (name: string) => page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="${base.root.id}"]')).getPropertyValue("${name}").trim()`);
      const setTheme = (theme: unknown) => page.eval(`(() => { const p = ${JSON.stringify(theme)}; if (p) window.proto.theme = p; else delete window.proto.theme; window.draw(); })()`);

      // no theme: the house defaults
      assert.equal(await appVar("--b-accent"), "#1e293b");

      await setTheme(themed("gold"));
      assert.equal(await appVar("--b-accent"), "#c8961e");
      const ink = await appVar("--b-accent-ink");
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      const primary = await page.eval<string>(`getComputedStyle(document.querySelector('[data-node-id="a.header.add"]')).color`);
      assert.equal(primary, rgb(ink));
      await page.eval(`window.show(${JSON.stringify(SCREENS[0])})`);
      const shots = await shoot(page, dir, `gallery-${SCREENS[0].replace(/^gallery-/, "")}`, "gold");

      // a second render of the same proto changes nothing
      const mutations = await page.eval<number>(`(() => { const o = new MutationObserver(() => {}); o.observe(document.getElementById("root"), { subtree: true, attributes: true, childList: true, characterData: true }); window.draw(); return o.takeRecords().length; })()`);
      assert.equal(mutations, 0, "idempotent render");

      await setTheme(themed("green", "warm"));
      assert.equal(await appVar("--b-accent"), "#15803d");
      assert.equal(await appVar("--b-bg"), "#faf8f3");
      shots.push(...(await shoot(page, dir, `gallery-${SCREENS[0].replace(/^gallery-/, "")}`, "green-warm")));

      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
      t.diagnostic(`screenshots: ${dir} (${shots.length} files)`);
    });
  }, { width: WIDTH, height: HEIGHT });
});

test("gallery: interactions work on the new builders", async (t) => {
  await withChrome(t, async (page) => {
    await withGalleryServer(async (url) => {
      await page.goto(url);
      await page.waitFor("window.ready === true");
      const shown = (id: string) => page.eval<boolean>(`document.querySelector('[data-node-id="${id}"]').getClientRects().length > 0`);

      // Modal and Drawer open and close through on.click.
      assert.equal(await shown("a.modal"), false);
      await page.eval(`document.querySelector('[data-node-id="a.header.add"]').click()`);
      assert.equal(await shown("a.modal"), true);
      await page.eval(`document.querySelector('[data-node-id="a.modal.save"]').click()`);
      assert.equal(await shown("a.modal"), false);
      await page.eval(`document.querySelector('[data-node-id="a.row.filters"]').click()`);
      assert.equal(await shown("a.drawer"), true);

      // Tabs show only the active child.
      assert.deepEqual([await shown("a.tab1"), await shown("a.tab2")], [true, false]);

      // Toggle and Checkbox flip on click.
      await page.eval(`window.show("gallery-d")`);
      const checked = (id: string) => page.eval<string>(`document.querySelector('[data-node-id="${id}"]').getAttribute("aria-checked")`);
      assert.equal(await checked("d.toggle"), "true");
      await page.eval(`document.querySelector('[data-node-id="d.toggle"]').click()`);
      assert.equal(await checked("d.toggle"), "false");
      await page.eval(`document.querySelector('[data-node-id="d.check2"]').click()`);
      assert.equal(await checked("d.check2"), "true");

      // Typed and picked values are kept in UI state across re-renders.
      await page.eval(`(() => {
        const set = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); };
        set('[data-node-id="d.amount"] input', "42");
        set('[data-node-id="d.search"] input', "taxi");
        set('[data-node-id="d.slider"] input', "75");
        const s = document.querySelector('[data-node-id="d.category"] select'); s.value = "Travel"; s.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-node-id="d.segmented"] label:nth-child(3)').click();
        window.draw();
      })()`);
      const r = await page.eval(`({
        amount: document.querySelector('[data-node-id="d.amount"] input').value,
        search: document.querySelector('[data-node-id="d.search"] input').value,
        slider: document.querySelector('[data-node-id="d.slider"] .b-slider-value').textContent,
        category: document.querySelector('[data-node-id="d.category"] select').value,
        segment: document.querySelector('[data-node-id="d.segmented"] .is-active').textContent,
      })`);
      assert.deepEqual(r, { amount: "42", search: "taxi", slider: "75", category: "Travel", segment: "Year" });

      // A blank Table cell stays an empty cell, so the cells after it keep their columns.
      const cellsOf = await page.eval<string[][]>(`(() => {
        const find = (n) => n.id === "b.table" ? n : n.children.map(find).find(Boolean);
        find(window.proto.root).props.rows = ["@Sara K. |  | $420 | #Paid"];
        window.show("gallery-b");
        return [...document.querySelectorAll('[data-node-id="b.table"] tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
      })()`);
      assert.deepEqual(cellsOf, [["SKSara K.", "", "$420", "Paid"]]);
      assert.deepEqual(page.logs.filter((l) => l.startsWith("exception")), []);
    });
  }, { width: WIDTH, height: HEIGHT });
});
