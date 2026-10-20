// Saves a signed-in browser session from the Clerk development instance, for `npm run screenshots` (signed-in states).
//   npm run save-session -w @builder/web -- <folder outside the repo> <test phone number, e.g. +12015550123> [organization]
// It signs in headless, through its own local dev server, as an account that already exists with a fictional test
// phone number (+1 XXX 555-0100 to 0199), using Clerk's test mode: the text-message code is 424242 and no SMS is sent.
// Test mode exists only on development instances, so the script refuses a production key and any other number. It
// never signs up (sign-up has a bot check that a script must not get around; create the account by hand once).
// A new session may first ask which organization to use: with [organization] given, it picks that existing one (it never
// creates one). It saves signed-in.json (a member of an org) or pending.json (no org chosen yet), then:
//   SIGNED_IN_STATE=<folder>/signed-in.json npm run screenshots -w @builder/web
// The files hold session cookies for the development instance: keep them out of the repo and delete them when done.
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer, loadEnv } from "vite";

const root = join(import.meta.dirname, "..");
const [folderArg, phoneArg, orgName] = process.argv.slice(2);
const folder = folderArg ? resolve(folderArg) : "";
if (!folder) throw new Error("give a folder for the session file, outside the repo");
if (folder.startsWith(resolve(root, "../.."))) throw new Error("keep the session file outside the repo");
const phone = (phoneArg ?? "").replace(/[^\d+]/g, "");
if (!/^\+1\d{3}55501\d{2}$/.test(phone)) throw new Error("use a fictional test number, +1 XXX 555-0100 to 555-0199");
if (!loadEnv("development", root, "VITE_").VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")) {
  throw new Error("test-mode sign-in needs a Clerk development key (pk_test_) in apps/web/.env");
}
mkdirSync(folder, { recursive: true, mode: 0o700 });

const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!chrome) throw new Error("Chrome not found: set CHROME_PATH");

const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { port: 0, strictPort: false } });
await server.listen();
const base = server.resolvedUrls?.local[0]?.replace(/\/$/, "") ?? "";
const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext();
const page = await context.newPage();
const path = () => new URL(page.url()).pathname;
try {
  await page.goto(`${base}/sign-in`, { waitUntil: "networkidle" });
  await page.waitForSelector(".cl-rootBox");
  await page.getByText("Use phone", { exact: true }).click();
  await page.locator("input[type=tel]").fill(phone.slice(2));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForTimeout(2500);
  // Clerk may ask for the password first; take the text-message code instead.
  if (await page.getByText("Use another method").count()) {
    await page.getByText("Use another method").click();
    await page.getByText(/send sms code|text message|sms code/i).first().click();
  }
  for (let i = 0; i < 3 && !["/", "/choose-organization"].includes(path()); i++) {
    await page.waitForTimeout(2500);
    const code = page.locator("input[autocomplete='one-time-code'], input[name^='codeInput']").first();
    if (!(await code.count())) break;
    await code.click();
    await page.keyboard.type("424242");
  }
  await page.waitForTimeout(2500);
  if (path() === "/choose-organization" && orgName) {
    await context.storageState({ path: join(folder, "pending.json") });
    console.log(`saved ${join(folder, "pending.json")}`);
    await page.locator(".cl-rootBox").getByText(orgName, { exact: true }).first().click();
    await page.waitForURL(`${base}/`, { timeout: 20000 });
    await page.waitForTimeout(2000);
  }
  const file = path() === "/" ? "signed-in.json" : path() === "/choose-organization" ? "pending.json" : null;
  if (!file) throw new Error(`sign-in stopped at ${path()}`);
  await context.storageState({ path: join(folder, file) });
  console.log(`saved ${join(folder, file)}`);
} finally {
  await browser.close();
  await server.close();
}
