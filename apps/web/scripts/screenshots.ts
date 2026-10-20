// Screenshots of the design system and the app shell, with accessibility and layout checks (ADR 0013).
//   npm run screenshots -w @builder/web            every shot below
//   npm run screenshots -w @builder/web -- shell   only shots whose name contains "shell"
// It starts its own Vite dev server on a free port, drives the installed Chrome through playwright-core (no browser
// download; set CHROME_PATH if Chrome isn't found), and blocks every request that isn't to that local server, so it
// can't reach Clerk, the api or anything paid. Each shot runs axe (color contrast included, which jsdom can't check)
// and fails if the page scrolls sideways. PNGs go to apps/web/screenshots/ (git-ignored). Never run by `npm test`.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");
const out = join(root, "screenshots");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Shot = { name: string; path: string; width: number; height: number; dark: boolean; fullPage: boolean };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const shots: Shot[] = [];
for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  shots.push(
    { name: `design-phone-${mode}`, path: "/_design", ...PHONE, dark, fullPage: true },
    { name: `design-desktop-${mode}`, path: "/_design", ...DESKTOP, dark, fullPage: true },
    { name: `shell-phone-${mode}`, path: "/_design?view=shell", ...PHONE, dark, fullPage: false },
    { name: `shell-desktop-${mode}`, path: "/_design?view=shell", ...DESKTOP, dark, fullPage: true },
    { name: `shell-empty-phone-${mode}`, path: "/_design?view=shell&empty=1", ...PHONE, dark, fullPage: false },
    { name: `shell-empty-desktop-${mode}`, path: "/_design?view=shell&empty=1", ...DESKTOP, dark, fullPage: true },
    { name: `shell-sheet-phone-${mode}`, path: "/_design?view=shell&open=sheet", ...PHONE, dark, fullPage: false },
    { name: `shell-confirm-desktop-${mode}`, path: "/_design?view=shell&open=confirm", ...DESKTOP, dark, fullPage: false },
    { name: `shell-toast-phone-${mode}`, path: "/_design?view=shell&toast=1", ...PHONE, dark, fullPage: false },
  );
}
shots.push(
  { name: "shell-phone-360-light", path: "/_design?view=shell", width: 360, height: 780, dark: false, fullPage: false },
  { name: "home-phone-light", path: "/", ...PHONE, dark: false, fullPage: false },
  { name: "home-desktop-dark", path: "/", ...DESKTOP, dark: true, fullPage: false },
);

function chromePath(): string {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found: set CHROME_PATH");
  return found;
}

const only = process.argv[2];
const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
if (!base) throw new Error("the dev server has no local URL");
const browser = await chromium.launch({ executablePath: chromePath() });
mkdirSync(out, { recursive: true });
let problems = 0;
try {
  for (const shot of shots.filter((s) => !only || s.name.includes(only))) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2, colorScheme: shot.dark ? "dark" : "light",
      reducedMotion: "reduce", hasTouch: shot.width < 768, isMobile: shot.width < 768,
    });
    const page = await context.newPage();
    // Nothing leaves this machine: only the local dev server is reachable.
    await page.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(base + shot.path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errors.push(`scrolls sideways by ${overflow}px`);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const result = await axe.run(document);
      return result.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    });
    errors.push(...violations);
    const file = join(out, `${shot.name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: shot.fullPage });
    problems += errors.length;
    console.log(`${errors.length ? "FAIL" : "ok  "} ${shot.name}${errors.length ? `\n     ${errors.join("\n     ")}` : ""}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(problems ? `${problems} problem(s); screenshots in ${out}` : `all clean; screenshots in ${out}`);
process.exitCode = problems ? 1 : 0;
