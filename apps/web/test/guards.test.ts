// Source scans for the rules in ADR 0012 that a type check can't see. They read the files as text, so they also
// catch code that no test happens to run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// import.meta.dirname, not import.meta.url: under jsdom the URL isn't a file: URL.
const root = join(import.meta.dirname, "..");

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : /\.(ts|tsx|html)$/.test(name) ? [p] : [];
  });
}

const read = (files: string[]) => files.map((p) => ({ file: relative(root, p), text: readFileSync(p, "utf8") }));
// The app's own code, which ships to the browser.
const src = read(filesIn(join(root, "src")));
// The public folder's scripts and pages, which ship as they are.
const publicDir = join(root, "public");
const publicFiles = read((function all(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? all(join(dir, n)) : /\.(js|html)$/.test(n) ? [join(dir, n)] : []));
})(publicDir));
const appCode = [...src, ...publicFiles];
// Everything that ends up in the built site or decides what goes in it.
const shipped = [...appCode, ...read([join(root, "index.html"), join(root, "vite.config.ts"), ...filesIn(join(root, "build"))])];

function offenders(files: { file: string; text: string }[], pattern: RegExp): string[] {
  return files.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
}

describe("the app's code", () => {
  it("has files to scan", () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it.each([
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML or outerHTML", /\b(inner|outer)HTML\b/],
    ["eval or new Function", /\beval\s*\(|\bnew\s+Function\b/],
    ["console", /\bconsole\./],
  ])("never uses %s", (_name, pattern) => {
    expect(offenders(appCode, pattern)).toEqual([]);
  });
});

// No browser storage (ADR 0012), with one exception (ADR 0015): the color mode setting, kept by src/lib/color-mode.ts
// and applied before first paint by public/color-mode.js. Nothing else in the app or the public folder may use it.
describe("browser storage", () => {
  const STORAGE = /\b(local|session)Storage\b|\bindexedDB\b|\bdocument\.cookie\b/;
  const EXCEPTIONS = new Set(["src/lib/color-mode.ts", "public/color-mode.js"]);
  // Reads Clerk's sign-in cookie and nothing else (checked below); not storage the app keeps.
  const COOKIE_READ = "src/lib/signed-in-hint.ts";
  // The first argument of every getItem, setItem and removeItem call.
  const storageKeys = (text: string) => [...text.matchAll(/\.(getItem|setItem|removeItem)\(\s*([^,)]+)/g)].map((m) => m[2]!.trim());
  it("finds the public script", () => {
    expect(publicFiles.map(({ file }) => file)).toContain("public/color-mode.js");
  });

  it("is used only by the color mode setting", () => {
    expect(offenders(appCode, STORAGE).filter((f) => !EXCEPTIONS.has(f) && f !== COOKIE_READ)).toEqual([]);
  });

  it("the exceptions use localStorage only, through getItem, setItem and removeItem, for the one key", () => {
    const exceptions = appCode.filter(({ file }) => EXCEPTIONS.has(file));
    expect(exceptions.map(({ file }) => file).sort()).toEqual([...EXCEPTIONS].sort());
    for (const { file, text } of exceptions) {
      expect(text, file).not.toMatch(/\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/);
      // No other storage call (clear, key, length) and no property access on storage (storage[key], storage.x = ...).
      expect(text, file).not.toMatch(/\.(clear|key)\(|localStorage\s*\[|\b(?:s|localStorage)\.(?!getItem|setItem|removeItem)\w+\s*=/);
      const calls = storageKeys(text);
      expect(calls.length, file).toBeGreaterThan(0);
      for (const key of calls) expect(["STORAGE_KEY", '"builder.color-mode"'], `${file}: ${key}`).toContain(key);
    }
  });

  // The one cookie read (ADR 0017): Clerk's sign-in hint, read to pick which chunk to load. Read only, never written.
  it("the sign-in hint only reads document.cookie", () => {
    const hint = appCode.find(({ file }) => file === "src/lib/signed-in-hint.ts");
    expect(hint?.text).toMatch(/\bdocument\.cookie\b/);
    expect(hint?.text).not.toMatch(/document\.cookie\s*=(?!=)|\b(local|session)Storage\b|\bindexedDB\b/);
  });

  it("the key check catches another key", () => {
    expect(storageKeys('s.removeItem(STORAGE_KEY); localStorage.setItem("prefs", "x"); s.getItem(key)')).toEqual(["STORAGE_KEY", '"prefs"', "key"]);
  });
});

describe("configuration", () => {
  const ALLOWED_VITE = new Set(["VITE_CLERK_PUBLISHABLE_KEY", "VITE_API_URL"]);

  it("reads no VITE_ variable but the two public ones", () => {
    const names = shipped.flatMap(({ text }) => text.match(/\bVITE_[A-Z0-9_]+/g) ?? []);
    expect(names.filter((n) => !ALLOWED_VITE.has(n))).toEqual([]);
  });

  it("keeps Vite's default envPrefix, so nothing else is exposed", () => {
    expect(offenders(shipped, /\benvPrefix\b/)).toEqual([]);
  });
});

describe("no URLs of ours in the code", () => {
  // Third-party hosts the CSP has to name. Our own origins come only from VITE_API_URL and the publishable key.
  const ALLOWED_HOSTS = new Set(["challenges.cloudflare.com", "*.protect.clerk.com", "img.clerk.com"]);

  it("names no origin other than the CSP's third-party hosts", () => {
    const found = shipped.flatMap(({ file, text }) =>
      [...text.matchAll(/\b(?:https?|wss?):\/\/([^\s"'`/:;)]+)/g)]
        .map((m) => m[1]!)
        .filter((host) => !host.startsWith("$") && !ALLOWED_HOSTS.has(host))
        .map((host) => `${file}: ${host}`));
    expect(found).toEqual([]);
  });

  it("never mentions a Render host", () => {
    expect(offenders(shipped, /onrender\.com/)).toEqual([]);
  });
});

describe("colors come from the tokens", () => {
  // Raw colors live in src/styles/globals.css only (ADR 0015); components use the tokens through Tailwind.
  const RAW_COLOR = /#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;

  it("no component or page names a raw color", () => {
    const outside = src.filter(({ file }) => !file.endsWith("globals.css"));
    expect(offenders(outside, RAW_COLOR)).toEqual([]);
  });

  it("the guard catches a raw color", () => {
    expect(RAW_COLOR.test('className="bg-[#0d5c4c]"')).toBe(true);
    expect(RAW_COLOR.test("color: rgb(0 0 0)")).toBe(true);
    expect(RAW_COLOR.test('href="#main"')).toBe(false);
  });
});


describe("the display font", () => {
  // Large headings only (ADR 0015): the landing page, the app's page titles and a session's title. Never in forms,
  // dialogs, sheets, menus, buttons, pills or Clerk's components, so no other file may name its classes. Every use
  // names a size (`display display-lg`), so looking for the sizes finds them all.
  const DISPLAY = /\bdisplay-(?:xl|lg|md|sm)\b|\bfont-display\b/;
  const ALLOWED = (file: string) => file.startsWith("src/landing/") || ["src/components/AppShell.tsx", "src/pages/SessionPage.tsx"].includes(file);
  const users = () => src.filter(({ file, text }) => file.endsWith(".tsx") && DISPLAY.test(text)).map(({ file }) => file);

  it("is used only on the landing page, page titles and a session's title", () => {
    expect(users().filter((f) => !ALLOWED(f))).toEqual([]);
  });

  it("the check finds the files that use it", () => {
    expect(users()).toEqual(expect.arrayContaining(["src/components/AppShell.tsx", "src/pages/SessionPage.tsx", "src/landing/hero/Hero.tsx"]));
  });
});
