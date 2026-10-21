// Source scans for the rules in ADR 0012 and ADR 0016 that a type check can't see. They read the files as text, so
// they also catch code that no test happens to run. The web app has the same scans (apps/web/test/guards.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = join(import.meta.dirname, "..");

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

// Paths with forward slashes whatever the machine, so the expectations below read the same everywhere.
const read = (files: string[]) => files.map((p) => ({ file: relative(root, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));
// The app's own code, which ships in the bundle.
const app = read([...filesIn(join(root, "app")), ...filesIn(join(root, "src"))]);
const shipped = [...app, ...read([join(root, "app.json")])];

const offenders = (files: { file: string; text: string }[], pattern: RegExp) => files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);

test("there are files to scan", () => {
  assert.ok(app.length > 10);
});

test("the app never logs, evaluates code, or keeps anything in plain storage", () => {
  assert.deepEqual(offenders(app, /\bconsole\./), []);
  assert.deepEqual(offenders(app, /\beval\s*\(|\bnew\s+Function\b/), []);
  // Tokens live in Clerk's secure-store cache only; nothing of ours goes to AsyncStorage or the like.
  assert.deepEqual(offenders(app, /AsyncStorage|\blocalStorage\b|MMKV/), []);
});

test("the app reads no EXPO_PUBLIC_ variable but the two public ones, and nothing else from process.env", () => {
  const ALLOWED = new Set(["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "EXPO_PUBLIC_API_URL"]);
  const names = app.flatMap(({ text }) => text.match(/\bEXPO_PUBLIC_[A-Z0-9_]+/g) ?? []);
  assert.deepEqual(names.filter((n) => !ALLOWED.has(n)), []);
  const reads = app.flatMap(({ text }) => text.match(/process\.env\.[A-Za-z0-9_]+/g) ?? []);
  assert.deepEqual(reads.filter((r) => !ALLOWED.has(r.slice("process.env.".length))), []);
});

test("no URL of ours is written in the code: origins come from the settings", () => {
  const found = shipped.flatMap(({ file, text }) =>
    [...text.matchAll(/\b(?:https?|wss?):\/\/([^\s"'`/:;)]+)/g)].map((m) => `${file}: ${m[1]}`));
  assert.deepEqual(found, []);
  assert.deepEqual(offenders(shipped, /onrender\.com|clerk\.accounts\.dev/), []);
});

test("colors come from the theme: no raw color outside src/theme.ts", () => {
  const RAW_COLOR = /#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b|\b(?:rgba?|hsla?|oklch)\(/i;
  assert.deepEqual(offenders(app.filter(({ file }) => file !== "src/theme.ts"), RAW_COLOR), []);
  assert.ok(RAW_COLOR.test('color: "#0d5c4c"'));
});

test("meeting links are shown as text, and the only link opened is the stage link after its protocol check", () => {
  const opens = app.filter(({ text }) => /openBrowserAsync|Linking\.openURL|openURL\(/.test(text)).map(({ file }) => file);
  assert.deepEqual(opens, ["app/(app)/sessions/[id].tsx"]);
  const detail = app.find(({ file }) => file === "app/(app)/sessions/[id].tsx")!.text;
  assert.ok(detail.includes("safeStageUrl("), "the stage link goes through safeStageUrl before it can be opened");
});
