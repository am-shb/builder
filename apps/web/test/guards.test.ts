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
// Everything that ends up in the built site or decides what goes in it.
const shipped = [...src, ...read([join(root, "index.html"), join(root, "vite.config.ts"), ...filesIn(join(root, "build"))])];

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
    ["localStorage or sessionStorage", /\b(local|session)Storage\b/],
    ["console", /\bconsole\./],
  ])("never uses %s", (_name, pattern) => {
    expect(offenders(src, pattern)).toEqual([]);
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
