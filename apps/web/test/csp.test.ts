import { describe, expect, it } from "vitest";
import { apiOrigin, buildCsp, clerkFrontendApiHost, injectCsp } from "../build/csp.ts";

// Made-up hosts under .test (reserved, never resolves), not any real instance.
const key = (host: string, kind = "test") => `pk_${kind}_${Buffer.from(`${host}$`).toString("base64")}`;
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("apiOrigin", () => {
  it("takes an http or https origin, dropping a trailing slash", () => {
    expect(apiOrigin("https://api.example.test")).toBe("https://api.example.test");
    expect(apiOrigin("https://api.example.test/")).toBe("https://api.example.test");
    expect(apiOrigin("http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("returns the normal form of an origin", () => {
    expect(apiOrigin("https://API.example.test")).toBe("https://api.example.test");
    expect(apiOrigin("https://api.example.test:443")).toBe("https://api.example.test");
    expect(apiOrigin("https://api.example.test:8443")).toBe("https://api.example.test:8443");
  });

  it("refuses plain http to another computer in a production build", () => {
    expect(apiOrigin("http://api.example.test", { production: true })).toBeNull();
    expect(apiOrigin("http://127.0.0.1:3001", { production: true })).toBe("http://127.0.0.1:3001");
    expect(buildCsp({ apiUrl: "http://api.example.test", production: true })).not.toContain("api.example.test");
  });

  it("refuses anything that isn't a bare origin", () => {
    for (const bad of [undefined, "", "  ", "api.example.test", "ftp://api.example.test", "https://api.example.test/v1",
      "https://api.example.test?x=1", "https://api.example.test#x", "https://user:pw@api.example.test", "javascript:alert(1)", "https://a b.test"]) {
      expect(apiOrigin(bad), String(bad)).toBeNull();
    }
  });
});

describe("clerkFrontendApiHost", () => {
  it("decodes the host from a test or live publishable key", () => {
    expect(clerkFrontendApiHost(key("fancy-cat-12.clerk.accounts.test"))).toBe("fancy-cat-12.clerk.accounts.test");
    expect(clerkFrontendApiHost(key("clerk.example.test", "live"))).toBe("clerk.example.test");
  });

  it("refuses a key that isn't one", () => {
    const noDollar = `pk_test_${Buffer.from("clerk.example.test").toString("base64")}`;
    const notAHost = key("evil.test; script-src *");
    for (const bad of [undefined, "", "sk_test_abc", "pk_test_", "pk_test_!!!", noDollar, notAHost, key("localhost")]) {
      expect(clerkFrontendApiHost(bad), String(bad)).toBeNull();
    }
  });
});

describe("buildCsp", () => {
  it("names the api and the Clerk host when both are set", () => {
    const csp = buildCsp({ apiUrl: "https://api.example.test", publishableKey: key("fancy-cat-12.clerk.accounts.test") });
    expect(directive(csp, "connect-src")).toContain("https://api.example.test");
    expect(directive(csp, "connect-src")).toContain("https://fancy-cat-12.clerk.accounts.test");
    expect(directive(csp, "script-src")).toContain("https://fancy-cat-12.clerk.accounts.test");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
  });

  it("leaves out what's missing or invalid, and stays strict", () => {
    const csp = buildCsp({ apiUrl: "not a url", publishableKey: undefined });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://*.protect.clerk.com:*");
    expect(directive(csp, "script-src")).toBe("script-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com");
  });

  it("never allows eval, wildcards on their own, or inline scripts", () => {
    const csp = buildCsp({ apiUrl: "https://api.example.test", publishableKey: key("clerk.example.test") });
    expect(csp).not.toContain("unsafe-eval");
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline");
    expect(csp.split(/[\s;]+/)).not.toContain("*");
  });
});

describe("injectCsp", () => {
  const html = '<!doctype html><html><head>\n    <meta charset="UTF-8" />\n    <title></title>\n' +
    '<script type="module" src="/assets/index.js"></script></head><body></body></html>';

  it("puts the policy right after the charset and before any script", () => {
    const out = injectCsp(html, "default-src 'self'");
    const charset = out.indexOf("<meta charset");
    const csp = out.indexOf('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />');
    expect(charset).toBeGreaterThanOrEqual(0);
    expect(csp).toBeGreaterThan(charset);
    expect(csp).toBeLessThan(out.indexOf("<script"));
  });

  it("escapes the attribute, and fails without a charset tag", () => {
    expect(injectCsp(html, 'a"<b>&')).toContain('content="a&quot;&lt;b&gt;&amp;"');
    expect(() => injectCsp("<html><head></head></html>", "x")).toThrow(/charset/);
  });
});
