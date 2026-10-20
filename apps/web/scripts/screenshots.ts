// Screenshots of the design system and the app shell, with accessibility and layout checks (ADR 0015).
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
  // Types this link into the start form (the panel on desktop; on phones, the sheet that New session opens) and
  // presses Start. "" opens the phone sheet and stops there.
  start?: string;
  // Form edits made before the capture and never submitted (Clerk pre-fills the org form from the email's domain).
  prepare?: { fill?: Record<string, string>; clickText?: string[] };
  // What GET /v1/sessions/:id answers on a session's page (W6): a session, or one of the error states.
  detail?: Record<string, unknown> | "loading" | "404" | "error" | "refresh-error";
};
const ORG_FORM = { fill: { Name: "Northwind Studio" }, clickText: ["Remove"] };

// The session list's states, for the signed-in screenshots. Times are relative to now, so "12 min ago" stays true.
type ApiFixture = "list" | "long" | "empty" | "error" | "loading" | "refresh-error"
  // Starting a session (W5): what POST /v1/sessions answers.
  | "start-success" | "start-reused" | "start-rejected" | "start-in-use" | "start-unavailable" | "start-unknown"
  | "start-network" | "start-busy" | "start-confirm";
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
const NEW_LINK = "https://meet.google.com/bqe-xkpa-ysn";
const UNCONFIRMED = sessionFixture("u", "https://meet.google.com/pzm-rtqa-wlk", "start_unknown", 6);
const LONG = [...LIST, ...Array.from({ length: 9 }, (_, i) =>
  sessionFixture(`l${i}`, `https://meet.google.com/${["bqe", "tnw", "hxa", "mze", "pof", "ruk", "cwi", "gdy", "vla"][i]}-${["xkpa", "lfmd", "qzro", "wtce", "bnyv", "kasj", "oupd", "eirh", "mgqt"][i]}-${["ysn", "kdo", "fua", "pmr", "jzt", "wbe", "hli", "cxo", "qrv"][i]}`,
    i % 4 === 0 ? "failed" : "ended", 60 * 24 * (4 + i * 3)))];
// A session's page (W6). The stage link is a made-up one on a reserved test domain; it holds no real token.
const DETAIL_ID = "0b5f6c1e-6d2a-4c55-9e0e-2a8f3b1c7d40";
const STAGE_URL = `https://engine.example.test/stage/${DETAIL_ID}?token=demo-not-a-real-token-7f3a9c2e51b04d6a`;
const detailFixture = (status: string, extra: Record<string, unknown> = {}) =>
  ({ ...sessionFixture(DETAIL_ID, "https://meet.google.com/kfp-qzwd-nre", status, 12), updatedAt: ago(3), ...extra });
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
// Where the layout changes: a tablet in portrait (one column, a dialog to start) and the first two-column width.
const TABLET = { width: 768, height: 1024 };
const LAPTOP = { width: 1024, height: 768 };
const LANDSCAPE_PHONE = { width: 844, height: 390 };
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
// Starting a session (W5): every outcome at phone and desktop width in light, the main ones in dark too.
const START: [string, ApiFixture, string, boolean][] = [
  ["start-sheet", "list", "", true],
  ["start-invalid", "list", "meet.google.com/abc", true],
  ["start-busy", "start-busy", NEW_LINK, true],
  ["start-success", "start-success", NEW_LINK, true],
  ["start-reused", "start-reused", "https://meet.google.com/kfp-qzwd-nre", false],
  ["start-rejected", "start-rejected", NEW_LINK, false],
  ["start-in-use", "start-in-use", NEW_LINK, false],
  ["start-unavailable", "start-unavailable", NEW_LINK, false],
  ["start-unknown", "start-unknown", NEW_LINK, true],
  ["start-network", "start-network", NEW_LINK, false],
  ["start-confirm", "start-confirm", "https://meet.google.com/pzm-rtqa-wlk", true],
];
for (const [name, api, link, alsoDark] of START) {
  for (const dark of alsoDark ? [false, true] : [false]) {
    const mode = dark ? "dark" : "light";
    const base = { path: "/", dark, clerk: true, state: "signed-in" as const, api, start: link };
    shots.push({ name: `${name}-phone-${mode}`, ...PHONE, fullPage: false, ...base });
    if (name !== "start-sheet") shots.push({ name: `${name}-desktop-${mode}`, ...DESKTOP, fullPage: false, ...base });
  }
}
shots.push(
  { name: "start-unknown-phone-360-light", path: "/", width: 360, height: 780, dark: false, fullPage: false, clerk: true, state: "signed-in", api: "start-unknown", start: NEW_LINK },
  { name: "start-sheet-phone-360-dark", path: "/", width: 360, height: 780, dark: true, fullPage: false, clerk: true, state: "signed-in", api: "list", start: "" },
);
// A session's page (W6): the main state at every width, the others at phone and desktop width.
{
  const SIZES = { "360": { width: 360, height: 780 }, "390": PHONE, "768": TABLET, "1024": LAPTOP, "1280": DESKTOP } as const;
  const detailPath = `/sessions/${DETAIL_ID}`;
  const states: [string, Shot["detail"], string | undefined, (keyof typeof SIZES)[]][] = [
    ["detail-stage-shown", detailFixture("joining", { stageUrl: STAGE_URL }), "show-stage", ["360", "390", "768", "1024", "1280"]],
    ["detail-in-meeting", detailFixture("in_meeting", { stageUrl: STAGE_URL }), undefined, ["360", "390", "768", "1024", "1280"]],
    ["detail-start-failed", detailFixture("start_failed", { errorCode: "recall_rejected" }), undefined, ["390", "1280"]],
    ["detail-unknown", detailFixture("start_unknown", { stageUrl: STAGE_URL }), undefined, ["390", "1280"]],
    ["detail-ended", detailFixture("ended", { stageUrl: STAGE_URL }), undefined, ["390", "1280"]],
    ["detail-new-status", detailFixture("paused"), undefined, ["390"]],
    ["detail-loading", "loading", undefined, ["390", "1280"]],
    ["detail-404", "404", undefined, ["390", "1280"]],
    ["detail-error", "error", undefined, ["390", "1280"]],
    ["detail-refresh-error", "refresh-error", "refresh", ["390", "1280"]],
  ];
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    for (const [name, detail, click, sizes] of states) {
      for (const size of sizes) {
        shots.push({ name: `${name}-${size}-${mode}`, path: detailPath, ...SIZES[size], dark, fullPage: true, clerk: true, state: "signed-in",
          api: "list", detail, ...(click ? { click } : {}) });
      }
    }
  }
}
// The layout's edges: 768 (iPad portrait), 1024 (the first two-column width) and a phone held sideways.
for (const dark of [false, true]) {
  const mode = dark ? "dark" : "light";
  const base = { path: "/", dark, fullPage: false, clerk: true, state: "signed-in" as const };
  for (const [size, viewport] of [["768", TABLET], ["1024", LAPTOP]] as const) {
    shots.push(
      { name: `app-home-${size}-${mode}`, ...viewport, ...base, api: "list" },
      { name: `start-success-${size}-${mode}`, ...viewport, ...base, api: "start-success", start: NEW_LINK },
      { name: `start-unknown-${size}-${mode}`, ...viewport, ...base, api: "start-unknown", start: NEW_LINK },
      { name: `list-empty-${size}-${mode}`, ...viewport, ...base, api: "empty" },
    );
  }
  shots.push({ name: `start-sheet-768-${mode}`, ...TABLET, ...base, api: "list", start: "" });
  shots.push({ name: `app-home-landscape-${mode}`, ...LANDSCAPE_PHONE, ...base, api: "list" });
}
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
      // Start shots keep motion on, so the sheet's exit animation is real for the announcement check below.
      reducedMotion: shot.start ? "no-preference" : "reduce", hasTouch: shot.width < 1024, isMobile: shot.width < 1024,
      ...(statePath ? { storageState: statePath } : {}),
    });
    const page = await context.newPage();
    // Only the local dev server is reachable, plus the Clerk development instance for shots that need it. Requests to
    // the api are answered here, from fixtures, and never leave the browser.
    let sessionReads = 0;
    let started = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      const host = new URL(url).hostname;
      if (shot.api && apiOrigin && url.startsWith(apiOrigin)) {
        const cors = { "Access-Control-Allow-Origin": base, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST", Vary: "Origin" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        const path = new URL(url).pathname;
        if (path === "/v1/me") return route.fulfill({ status: 200, headers: cors, json: { userId: "user_1", orgId: "org_1", role: "org:admin" } });
        if (path === "/v1/sessions" && request.method() === "POST") {
          const fresh = { ...sessionFixture("new", NEW_LINK, "joining", 0) };
          const failed = (status: number, code: string, session?: object) =>
            route.fulfill({ status, headers: cors, json: { error: { code, message: "x" }, ...(session ? { session } : {}) } });
          started = true;
          switch (shot.api) {
            case "start-success": return route.fulfill({ status: 201, headers: cors, json: { session: fresh, reused: false } });
            case "start-reused": return route.fulfill({ status: 200, headers: cors, json: { session: { ...LIST[0], status: "in_meeting" }, reused: true } });
            case "start-rejected": return failed(502, "engine_rejected", { ...fresh, status: "start_failed", errorCode: "recall_rejected" });
            case "start-in-use": return failed(502, "engine_rejected", { ...fresh, status: "start_failed", errorCode: "meeting_in_use" });
            case "start-unavailable": return failed(503, "limits_unavailable");
            case "start-unknown": return failed(504, "engine_outcome_unknown", { ...fresh, status: "start_unknown" });
            case "start-network": return route.abort();
            case "start-busy": return; // never answered: the form stays busy
            default: return route.fulfill({ status: 201, headers: cors, json: { session: fresh, reused: false } });
          }
        }
        if (path === "/v1/sessions") {
          sessionReads += 1;
          if (shot.api?.startsWith("start-")) {
            const base = shot.api === "start-confirm" ? [UNCONFIRMED, ...LIST] : LIST;
            // What the api saved for the start, as the reloaded list shows it.
            const savedAs: Partial<Record<ApiFixture, string>> = {
              "start-success": "joining", "start-unknown": "start_unknown", "start-network": "start_unknown",
              "start-rejected": "start_failed", "start-in-use": "start_failed",
            };
            const saved = shot.api ? savedAs[shot.api] : undefined;
            const added = started && saved ? [sessionFixture("new", NEW_LINK, saved, 0)] : [];
            return route.fulfill({ status: 200, headers: cors, json: { sessions: [...added, ...base] } });
          }
          if (shot.api === "loading") return; // never answered: the loading state stays
          if (shot.api === "error" || (shot.api === "refresh-error" && sessionReads > 1)) {
            return route.fulfill({ status: 503, headers: cors, json: { error: { code: "db_unavailable", message: "x" } } });
          }
          const sessions = shot.api === "empty" ? [] : shot.api === "long" ? LONG : LIST;
          return route.fulfill({ status: 200, headers: cors, json: { sessions } });
        }
        if (path.startsWith("/v1/sessions/") && shot.detail) {
          sessionReads += 1;
          if (shot.detail === "loading") return; // never answered
          if (shot.detail === "404") return route.fulfill({ status: 404, headers: cors, json: { error: { code: "not_found", message: "x" } } });
          if (shot.detail === "error" || (shot.detail === "refresh-error" && sessionReads > 1)) {
            return route.fulfill({ status: 503, headers: cors, json: { error: { code: "db_unavailable", message: "x" } } });
          }
          const session = shot.detail === "refresh-error" ? detailFixture("joining", { stageUrl: STAGE_URL }) : shot.detail;
          return route.fulfill({ status: 200, headers: cors, json: { session } });
        }
        return route.fulfill({ status: 404, headers: cors, json: { error: { code: "not_found", message: "x" } } });
      }
      return url.startsWith(base) || (shot.clerk && CLERK_HOSTS.includes(host)) ? route.continue() : route.abort();
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    // A loading shot never gets its answer, so the network never goes idle.
    await page.goto(base + shot.path, { waitUntil: shot.api === "loading" || shot.detail === "loading" ? "load" : "networkidle" });
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
    if (shot.click === "show-stage") await page.getByRole("button", { name: "Show stage link" }).click();
    if (shot.start !== undefined) {
      let form = page.locator("main");
      // Below 1024px the start panel is hidden: New session opens a sheet (phones) or a dialog (tablets).
      if (shot.width < 1024) {
        await page.getByRole("button", { name: "New session" }).first().click();
        form = page.getByRole("dialog", { name: "New session" });
        await form.waitFor();
      }
      if (shot.start) {
        // Screen readers can't hear the page while the sheet or dialog is open, so an outcome must not be announced
        // until it has gone (jsdom can't check this: it has no exit animation).
        await page.evaluate(() => {
          const w = window as unknown as { earlyAnnouncements: number };
          w.earlyAnnouncements = 0;
          for (const region of document.querySelectorAll(".sr-only[role=status], .sr-only[role=alert]")) {
            new MutationObserver(() => {
              if (region.textContent && document.querySelector("[role=dialog]")) w.earlyAnnouncements += 1;
            }).observe(region, { childList: true, subtree: true, characterData: true });
          }
        });
        await form.getByLabel("Meeting link").first().fill(shot.start);
        await form.getByRole("button", { name: "Start session" }).first().click();
      }
      await page.waitForTimeout(900);
      if (shot.start) {
        const early = await page.evaluate(() => (window as unknown as { earlyAnnouncements?: number }).earlyAnnouncements ?? 0);
        if (early) errors.push(`announced the outcome ${early} time(s) while a dialog was still open`);
      }
    }
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
