// The landing page's layout check (ADR 0017), in the installed Chrome against its own dev server:
//   npm run landing-layout -w @builder/web            every width and zoom below
//   npm run landing-layout -w @builder/web -- 1440    only cases whose label contains "1440"
// At each width (and at 125% and 150% zoom, as fewer CSS pixels) it scrolls through the page so every part is shown,
// then fails on: sideways scrolling; any two visible texts overlapping; any text off the screen; the hero's headline
// leaving its column, running past three lines, or any hero text touching the scene; and any pill-shaped button or
// link whose words wrap. Each width runs twice: with
// reduced motion (the still frames) and with motion, in the hero's busiest moment. Every request but the dev
// server's is blocked. Never run by `npm test`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");
const only = process.argv[2];
const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1366, 1440, 1536, 1680, 1920, 2560];
const ZOOMS: [number, number][] = [[390, 1.25], [1280, 1.25], [1280, 1.5], [1440, 1.25], [1440, 1.5], [1920, 1.25], [1920, 1.5]];
type Case = { width: number; zoom: number; motion: boolean; dark: boolean };
const cases: Case[] = [
  ...WIDTHS.flatMap((width) => [{ width, zoom: 1, motion: false, dark: false }, { width, zoom: 1, motion: true, dark: true }]),
  ...ZOOMS.map(([width, zoom]) => ({ width, zoom, motion: false, dark: false })),
];
const label = (c: Case) => `${c.width}px${c.zoom !== 1 ? ` at ${c.zoom * 100}%` : ""}, ${c.motion ? "motion" : "reduced motion"}, ${c.dark ? "dark" : "light"}`;

const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p): p is string => !!p && existsSync(p));
if (!chrome) throw new Error("Chrome not found: set CHROME_PATH");
const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
if (!base) throw new Error("the dev server has no local URL");
const browser = await chromium.launch({ executablePath: chrome });

let failures = 0;
try {
  for (const c of cases.filter((x) => !only || label(x).includes(only))) {
    const width = Math.round(c.width / c.zoom);
    const height = Math.round((c.width >= 1024 ? c.width * 0.5625 : 844) / c.zoom);
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: c.zoom, colorScheme: c.dark ? "dark" : "light", reducedMotion: c.motion ? "no-preference" : "reduce" });
    await context.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // Scroll down in steps so each part's reveal runs, then back to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.7)) {
        scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 60));
      }
      scrollTo({ top: 0, behavior: "instant" });
    });
    // With motion: wait for the reveals to finish, and for the hero's moment with the most on screen.
    await page.waitForTimeout(c.motion ? 6700 : 300);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      // Where a text is drawn: its glyphs, cut to its own box when that box clips it (an ellipsis).
      const textBox = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (getComputedStyle(el).overflowX === "visible") return r;
        const b = el.getBoundingClientRect();
        return new DOMRect(Math.max(r.left, b.left), r.top, Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left)), r.height);
      };
      const sy = scrollY;
      const page = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top + sy, bottom: r.bottom + sy });
      type Box = { left: number; right: number; top: number; bottom: number };
      const hit = (a: Box, b: Box, pad = 1) => a.left < b.right - pad && b.left < a.right - pad && a.top < b.bottom - pad && b.top < a.bottom - pad;
      const inside = (a: Box, b: Box, tol = 1) => a.left >= b.left - tol && a.right <= b.right + tol && a.top >= b.top - tol && a.bottom <= b.bottom + tol;
      const shown = (el: Element) => {
        for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.05) return false;
          if (e.classList.contains("sr-only")) return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const texts = (rootEl: Element) => [...rootEl.querySelectorAll("*")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && shown(el));
      const name = (el: Element) => `${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 30)}"`;

      const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      if (sideways > 0) out.push(`the page scrolls sideways by ${sideways}px`);

      // Every visible text on the page: on screen, and never on top of another one. The open sheet and the header
      // aren't part of the page's flow, so the header is left out (it is checked on its own below).
      const header = document.querySelector("header");
      const all = texts(document.body).filter((el) => !header?.contains(el)).map((el) => ({ el, box: page(textBox(el)) }));
      const vw = document.documentElement.clientWidth;
      for (const t of all) if (t.box.left < -1 || t.box.right > vw + 1) out.push(`${name(t.el)} runs off the screen`);
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i]!, b = all[j]!;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          if (hit(a.box, b.box)) out.push(`${name(a.el)} overlaps ${name(b.el)}`);
        }
      }
      // The header's items never overlap each other.
      const navItems = [...document.querySelectorAll("header nav a, header nav button")].filter(shown);
      for (let i = 0; i < navItems.length; i++) for (let j = i + 1; j < navItems.length; j++) {
        if (hit(navItems[i]!.getBoundingClientRect(), navItems[j]!.getBoundingClientRect())) out.push(`header ${name(navItems[i]!)} overlaps ${name(navItems[j]!)}`);
      }

      // Every pill (a button or a link drawn as one) fits its words on one line.
      for (const pill of [...document.querySelectorAll("a.rounded-full, button.rounded-full")].filter(shown)) {
        // Only its visible words: not its icon, not a label for screen readers.
        const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
        const tops = new Set<number>();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent!.trim() || !shown(node.parentElement!)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) if (r.width > 1) tops.add(Math.round(r.top / 6));
        }
        if (tops.size > 1) out.push(`${name(pill)} wraps onto ${tops.size} lines`);
      }

      // The hero: the headline stays in its column, at most three lines; no hero text touches the scene.
      const h1 = document.querySelector("#hero-title")!;
      const column = h1.parentElement!.getBoundingClientRect();
      if (!inside(textBox(h1), column)) out.push("the headline leaves its column");
      const lines = Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight));
      if (lines > 3) out.push(`the headline runs to ${lines} lines`);
      const scene = document.querySelector(".scene > .overflow-hidden")!.getBoundingClientRect();
      for (const el of texts(h1.parentElement!)) if (hit(textBox(el), scene)) out.push(`${name(el)} touches the hero scene`);
      for (const el of texts(document.querySelector(".scene")!)) if (!inside(textBox(el), scene)) out.push(`scene ${name(el)} leaves its window`);
      return { out, lines, size: getComputedStyle(h1).fontSize, texts: all.length };
    });
    if (problems.out.length) {
      failures++;
      console.log(`FAIL ${label(c)}\n  ${[...new Set(problems.out)].slice(0, 12).join("\n  ")}`);
    } else {
      console.log(`ok   ${label(c)}: ${problems.texts} texts, headline ${problems.size} on ${problems.lines} lines`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `${failures} failing cases` : "every case passes");
process.exit(failures ? 1 : 0);
