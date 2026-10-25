// The deployed site's settings in render.yaml (I1): the headers a <meta> policy can't send, and the rewrite that lets
// a deep link (/sessions/:id) load the app. Read as text, so a change there that drops one fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function webService(): string {
  const yaml = readFileSync(join(import.meta.dirname, "../../../render.yaml"), "utf8");
  const start = yaml.indexOf("    name: builder-web\n");
  if (start < 0) throw new Error("render.yaml should define the builder-web service");
  const next = yaml.indexOf("\n  - type:", start);
  // Without comment lines: the checks are about settings, not their explanations.
  return yaml.slice(start, next < 0 ? undefined : next).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
}

// Every `- path / name / value` header rule, as [path, name, value].
function headers(block: string): [string, string, string][] {
  return [...block.matchAll(/- path: (\S+)\n\s+name: (\S+)\n\s+value: "?(.+?)"?\n/g)].map((m) => [m[1]!, m[2]!, m[3]!]);
}

describe("builder-web in render.yaml", () => {
  const block = webService();

  it("is a static site on main, deployed after CI passes, from the repo root's build", () => {
    expect(block).toContain("runtime: static");
    expect(block).toContain("branch: main");
    expect(block).toContain("autoDeployTrigger: checksPass");
    expect(block).toContain("buildCommand: npm ci --workspace @builder/web --include-workspace-root && npm run build -w @builder/web");
    expect(block).toContain("staticPublishPath: ./apps/web/dist");
    expect(block).not.toContain("rootDir");
  });

  it("sends the security headers on every path", () => {
    expect(headers(block)).toEqual([
      ["/*", "Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"],
      ["/*", "X-Frame-Options", "DENY"],
      ["/*", "Referrer-Policy", "no-referrer"],
      ["/*", "X-Content-Type-Options", "nosniff"],
      ["/*", "Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
      ["/*", "Cross-Origin-Opener-Policy", "same-origin-allow-popups"],
    ]);
  });

  it("rewrites every path to index.html, so a deep link loads the app", () => {
    expect(block).toMatch(/- type: rewrite\n\s+source: \/\*\n\s+destination: \/index\.html\n/);
  });

  it("keeps the origins out of the repo: every setting is entered in the dashboard", () => {
    for (const key of ["VITE_CLERK_PUBLISHABLE_KEY", "VITE_API_URL", "VITE_ANDROID_APP_URL"]) {
      expect(block).toMatch(new RegExp(`- key: ${key}\\n\\s+sync: false\\n`));
    }
    expect(block).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+\.(onrender\.com|clerk)/);
  });
});
