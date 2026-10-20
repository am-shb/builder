// Screenshots of the design system and the app shell, with accessibility and layout checks (ADR 0013).
//   npm run screenshots -w @builder/web            every shot below
//   npm run screenshots -w @builder/web -- shell   only shots whose name contains "shell"
// It starts its own Vite dev server on a free port, drives the installed Chrome through playwright-core (no browser
// download; set CHROME_PATH if Chrome isn't found), and blocks every request that isn't to that local server, so it
// can't reach the api or anything paid. Shots marked `clerk` may also reach the Clerk development instance named by
// apps/web/.env's publishable key (free) and Clerk's bot check; nothing else. Signed-in shots load a browser session
// saved by hand from that instance: set SIGNED_IN_STATE (a member of an org) and PENDING_STATE (signed up, no org yet)
// to Playwright storage-state files, kept outside the repo. Shots whose state file isn't set are skipped. Each shot runs axe (color contrast included, which jsdom can't check)
// and fails if the page scrolls sideways. PNGs go to apps/web/screenshots/ (git-ignored). Never run by `npm test`.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { createServer, loadEnv, type ViteDevServer } from "vite";
import { clerkFrontendApiHost } from "../build/csp.ts";

const root = join(import.meta.dirname, "..");
const out = join(root, "screenshots");
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Shot = {
  name: string; path: string; width: number; height: number; dark: boolean; fullPage: boolean;
  // May reach the Clerk development instance.
  clerk?: boolean;
  // A saved session to start from.
  state?: "signed-in" | "pending";
  // Served by a dev server with no usable settings.
  unconfigured?: boolean;
  // Clicked after the page settles (opens a menu), by accessible name.
  click?: string;
  // The api's answers, served in the browser from fixtures (no real api, no network): see apiFixture below.
  api?: ApiFixture;
  // Form edits made before the capture and never submitted (Clerk pre-fills the org form from the email's domain).
  prepare?: { fill?: Record<string, string>; clickText?: string[] };
};
const ORG_FORM = { fill: { Name: "Northwind Studio" }, clickText: ["Remove"] };

// The session list's states, for the signed-in screenshots. Times are relative to now, so "12 min ago" stays true.
type ApiFixture = "list" | "long" | "empty" | "error" | "loading" | "refresh-error";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function sessionFixture(id: string, meetingUrl: string, status: string, minutesAgo: number) {
  return { id, meetingUrl, status, limits: { maxUsd: 5, maxMinutes: 60 }, createdAt: ago(minutesAgo), updatedAt: ago(minutesAgo) };
}
const LIST = [
  sessionFixture("1", "https://meet.google.com/kfp-qzwd-nre", "in_meeting", 12),
  sessionFixture("2", "https://us02web.zoom.us/j/84213377051", "joining", 1),
  sessionFixture("3", "https://teams.microsoft.com/l/meetup-join/19%3ameeting", "start_unknown", 25),
  sessionFixture("4", "https://meet.google.com/xtr-mbha-qpo", "ended", 60 * 22),
  sessionFixture("5", "https://meet.google.com/ahn-vexr-kid", "start_failed", 60 * 24 * 3),
];
const LONG = [...LIST, ...Array.from({ length: 9 }, (_, i) =>
  sessionFixture(`l${i}`, `https://meet.google.com/${["bqe", "tnw", "hxa", "mze", "pof", "ruk", "cwi", "gdy", "vla"][i]}-${["xkpa", "lfmd", "qzro", "wtce", "bnyv", "kasj", "oupd", "eirh", "mgqt"][i]}-${["ysn", "kdo", "fua", "pmr", "jzt", "wbe", "hli", "cxo", "qrv"][i]}`,
    i % 4 === 0 ? "failed" : "ended", 60 * 24 * (4 + i * 3)))];
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
shots.push({ name: "shell-phone-360-light", path: "/_design?view=shell", width: 360, height: 780, dark: false, fullPage: false });
for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  const clerk = true;
  shots.push(
    { name: `auth-sign-in-phone-${mode}`, path: "/sign-in", ...PHONE, dark, fullPage: false, clerk },
    { name: `auth-sign-in-desktop-${mode}`, path: "/sign-in", ...DESKTOP, dark, fullPage: false, clerk },
    { name: `auth-sign-up-phone-${mode}`, path: "/sign-up", ...PHONE, dark, fullPage: true, clerk },
    { name: `auth-sign-up-desktop-${mode}`, path: "/sign-up", ...DESKTOP, dark, fullPage: false, clerk },
    { name: `auth-choose-org-phone-${mode}`, path: "/choose-organization", ...PHONE, dark, fullPage: true, clerk, state: "pending", prepare: ORG_FORM },
    { name: `auth-choose-org-desktop-${mode}`, path: "/choose-organization", ...DESKTOP, dark, fullPage: false, clerk, state: "pending", prepare: ORG_FORM },
    { name: `app-home-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", api: "list" },
    { name: `app-home-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: false, clerk, state: "signed-in", api: "list" },
    { name: `list-empty-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", api: "empty" },
    { name: `list-empty-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: false, clerk, state: "signed-in", api: "empty" },
    { name: `list-loading-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", api: "loading" },
    { name: `list-loading-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: false, clerk, state: "signed-in", api: "loading" },
    { name: `list-error-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", api: "error" },
    { name: `list-error-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: false, clerk, state: "signed-in", api: "error" },
    { name: `list-long-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: true, clerk, state: "signed-in", api: "long" },
    { name: `list-long-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: true, clerk, state: "signed-in", api: "long" },
    { name: `list-refresh-error-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", api: "refresh-error", click: "refresh" },
    { name: `app-session-phone-${mode}`, path: "/sessions/00000000-0000-4000-8000-000000000000", ...PHONE, dark, fullPage: false, clerk, state: "signed-in" },
    { name: `app-org-menu-desktop-${mode}`, path: "/", ...DESKTOP, dark, fullPage: false, clerk, state: "signed-in", click: "org" },
    { name: `app-user-menu-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, clerk, state: "signed-in", click: "user" },
    { name: `app-not-configured-phone-${mode}`, path: "/", ...PHONE, dark, fullPage: false, unconfigured: true },
  );
}
shots.push(
  { name: "auth-sign-in-phone-360-light", path: "/sign-in", width: 360, height: 780, dark: false, fullPage: false, clerk: true },
  { name: "app-home-phone-360-light", path: "/", width: 360, height: 780, dark: false, fullPage: false, clerk: true, state: "signed-in", api: "list" },
  { name: "list-empty-phone-360-light", path: "/", width: 360, height: 780, dark: false, fullPage: false, clerk: true, state: "signed-in", api: "empty" },
  { name: "list-error-phone-360-dark", path: "/", width: 360, height: 780, dark: true, fullPage: false, clerk: true, state: "signed-in", api: "error" },
  { name: "app-signed-out-redirect-desktop-light", path: "/sessions/00000000-0000-4000-8000-000000000000", ...DESKTOP, dark: false, fullPage: false, clerk: true },
);

function chromePath(): string {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found: set CHROME_PATH");
  return found;
}

const only = process.argv[2];
const clerkKey = loadEnv("development", root, "VITE_").VITE_CLERK_PUBLISHABLE_KEY;
const fapi = clerkFrontendApiHost(clerkKey);
// Clerk development instances draw a dotted "Development mode" strip under their footer, and axe measures the footer's
// "Secured by" against it. Production instances have no strip, so with a development key that one finding is a note.
const devInstance = clerkKey?.startsWith("pk_test_") ?? false;
const CLERK_HOSTS = [fapi, "img.clerk.com", "challenges.cloudflare.com"].filter((h): h is string => !!h);
const states = { "signed-in": process.env.SIGNED_IN_STATE, pending: process.env.PENDING_STATE };
const apiOrigin = loadEnv("development", root, "VITE_").VITE_API_URL?.replace(/\/+$/, "") ?? "";

async function startServer(unconfigured: boolean): Promise<{ server: ViteDevServer; base: string }> {
  // Variables already in the environment win over .env files; an invalid key gives the "not set up" page.
  if (unconfigured) process.env.VITE_CLERK_PUBLISHABLE_KEY = "unset";
  const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false } });
  await server.listen();
  if (unconfigured) delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
  if (!base) throw new Error("the dev server has no local URL");
  return { server, base };
}
const configured = await startServer(false);
const unconfigured = await startServer(true);
const browser = await chromium.launch({ executablePath: chromePath() });
mkdirSync(out, { recursive: true });
let problems = 0;
try {
  for (const shot of shots.filter((s) => !only || s.name.includes(only))) {
    if (shot.clerk && !fapi) {
      console.log(`skip ${shot.name} (no Clerk publishable key in apps/web/.env)`);
      continue;
    }
    const statePath = shot.state ? states[shot.state] : undefined;
    if (shot.state && !statePath) {
      console.log(`skip ${shot.name} (${shot.state === "pending" ? "PENDING_STATE" : "SIGNED_IN_STATE"} not set)`);
      continue;
    }
    const base = shot.unconfigured ? unconfigured.base : configured.base;
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2, colorScheme: shot.dark ? "dark" : "light",
      reducedMotion: "reduce", hasTouch: shot.width < 768, isMobile: shot.width < 768,
      ...(statePath ? { storageState: statePath } : {}),
    });
    const page = await context.newPage();
    // Only the local dev server is reachable, plus the Clerk development instance for shots that need it. Requests to
    // the api are answered here, from fixtures, and never leave the browser.
    let sessionReads = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const host = new URL(url).hostname;
      if (shot.api && apiOrigin && url.startsWith(apiOrigin)) {
        const cors = { "Access-Control-Allow-Origin": base, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST", Vary: "Origin" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        const path = new URL(url).pathname;
        if (path === "/v1/me") return route.fulfill({ status: 200, headers: cors, json: { userId: "user_1", orgId: "org_1", role: "org:admin" } });
        if (path === "/v1/sessions") {
          sessionReads += 1;
          if (shot.api === "loading") return; // never answered: the loading state stays
          if (shot.api === "error" || (shot.api === "refresh-error" && sessionReads > 1)) {
            return route.fulfill({ status: 503, headers: cors, json: { error: { code: "db_unavailable", message: "x" } } });
          }
          const sessions = shot.api === "empty" ? [] : shot.api === "long" ? LONG : LIST;
          return route.fulfill({ status: 200, headers: cors, json: { sessions } });
        }
        return route.fulfill({ status: 404, headers: cors, json: { error: { code: "not_found", message: "x" } } });
      }
      return url.startsWith(base) || (shot.clerk && CLERK_HOSTS.includes(host)) ? route.continue() : route.abort();
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    // A loading shot never gets its answer, so the network never goes idle.
    await page.goto(base + shot.path, { waitUntil: shot.api === "loading" ? "load" : "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    if (shot.clerk) await page.waitForSelector(".cl-rootBox, .cl-organizationSwitcher-root, .cl-userButton-root, main", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(shot.clerk ? 1200 : 400);
    for (const text of shot.prepare?.clickText ?? []) {
      const target = page.getByText(text, { exact: true }).first();
      if (await target.count()) await target.click();
    }
    for (const [label, value] of Object.entries(shot.prepare?.fill ?? {})) await page.getByLabel(label, { exact: true }).fill(value);
    if (shot.prepare) {
      await page.locator(":focus").evaluate((el) => (el as HTMLElement).blur()).catch(() => {});
      await page.waitForTimeout(300);
    }
    if (shot.click === "org") await page.locator(".cl-organizationSwitcherTrigger").click();
    if (shot.click === "user") await page.locator(".cl-userButtonTrigger").click();
    if (shot.click === "refresh") await page.getByRole("button", { name: "Refresh" }).click();
    if (shot.click) await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errors.push(`scrolls sideways by ${overflow}px`);
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: Document) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const result = await axe.run(document);
      // The selector and the element's text, so a failure inside Clerk's markup can be found.
      const describe = (target: string[]) => {
        const el = document.querySelector(target.join(" "));
        const text = el?.textContent?.trim().replace(/\s+/g, " ").slice(0, 40);
        return text ? `${target.join(" ")} ("${text}")` : target.join(" ");
      };
      return result.violations.flatMap((v) => v.nodes.map((n) => ({
        rule: v.id, where: describe(n.target), inClerkFooter: !!document.querySelector(n.target.join(" "))?.closest(".cl-footer"),
      })));
    });
    const notes: string[] = [];
    for (const v of violations) {
      const devStrip = devInstance && v.rule === "color-contrast" && v.inClerkFooter && v.where.includes("Secured by");
      (devStrip ? notes : errors).push(`${v.rule}: ${v.where}${devStrip ? " (Clerk development-mode strip; not on production instances)" : ""}`);
    }
    const file = join(out, `${shot.name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: shot.fullPage });
    problems += errors.length;
    console.log(`${errors.length ? "FAIL" : "ok  "} ${shot.name}${errors.length ? `\n     ${errors.join("\n     ")}` : ""}${notes.length ? `\n     note: ${notes.join("\n     note: ")}` : ""}`);
    await context.close();
  }
} finally {
  await browser.close();
  await configured.server.close();
  await unconfigured.server.close();
}
console.log(problems ? `${problems} problem(s); screenshots in ${out}` : `all clean; screenshots in ${out}`);
process.exitCode = problems ? 1 : 0;
