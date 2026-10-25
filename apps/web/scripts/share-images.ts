// Makes the share image (public/og.png, 1200×630) and the home-screen icon (public/apple-touch-icon.png, 180×180)
// with the installed Chrome (ADR 0017). Run it again when the product's name or the hero changes:
//   npm run share-images -w @builder/web
// The share image is the real landing page's hero, in its still frame (reduced motion), drawn at 1280×672 and scaled
// to 1200×630. Every request but the local dev server's is blocked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = join(import.meta.dirname, "..");
const ICON_TILE = "#0d5c4c"; // the light --primary, the mobile app's icon tile too
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p): p is string => !!p && existsSync(p));
if (!chrome) throw new Error("Chrome not found: set CHROME_PATH");

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
if (!base) throw new Error("the dev server has no local URL");
const browser = await chromium.launch({ executablePath: chrome });
try {
  const share = await browser.newContext({ viewport: { width: 1280, height: 672 }, deviceScaleFactor: 1200 / 1280, colorScheme: "light", reducedMotion: "reduce" });
  await share.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const page = await share.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, "public", "og.png") });
  console.log("public/og.png");

  // The robot on a full square of the primary, in its dark-mode green so it stands out: iOS rounds the corners itself.
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, colorScheme: "dark" });
  const svg = readFileSync(join(root, "public", "favicon.svg"), "utf8");
  await icon.setContent(`<!doctype html><html><body style="margin:0;height:180px;display:grid;place-items:center;background:${ICON_TILE}">${svg.replace("<svg ", '<svg width="128" height="128" ')}</body></html>`);
  await icon.screenshot({ path: join(root, "public", "apple-touch-icon.png") });
  console.log("public/apple-touch-icon.png");
} finally {
  await browser.close();
  await server.close();
}
