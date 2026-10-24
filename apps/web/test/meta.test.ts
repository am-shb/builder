import { describe, expect, it } from "vitest";
import { injectMeta, metaTags, SHARE, siteOrigin } from "../build/meta.ts";
import { PRODUCT_NAME } from "../src/brand.ts";

describe("the share tags (ADR 0017)", () => {
  it("take the site's origin from SITE_URL, else Render's, and only an https one (or this computer)", () => {
    expect(siteOrigin({ SITE_URL: "https://www.example.org/some/path" })).toBe("https://www.example.org");
    expect(siteOrigin({ RENDER_EXTERNAL_URL: "https://web.example.net" })).toBe("https://web.example.net");
    expect(siteOrigin({ SITE_URL: "https://a.example.org", RENDER_EXTERNAL_URL: "https://b.example.org" })).toBe("https://a.example.org");
    expect(siteOrigin({ SITE_URL: "http://www.example.org" })).toBeNull();
    expect(siteOrigin({ SITE_URL: "http://localhost:4173" })).toBe("http://localhost:4173");
    expect(siteOrigin({ SITE_URL: "not a url" })).toBeNull();
    expect(siteOrigin({})).toBeNull();
  });

  it("name the product and use an absolute image URL when the origin is known", () => {
    const tags = metaTags("https://www.example.org");
    expect(SHARE.title).toContain(PRODUCT_NAME);
    expect(tags).toContain('<meta property="og:image" content="https://www.example.org/og.png" />');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(tags).toContain('<link rel="canonical" href="https://www.example.org/" />');
  });

  it("keep the image relative, with no canonical link, when it isn't", () => {
    const tags = metaTags(null);
    expect(tags).toContain('<meta property="og:image" content="/og.png" />');
    expect(tags).not.toContain("canonical");
  });

  it("fill the empty title, and refuse a page without one", () => {
    const html = injectMeta("<head><title></title></head>", null);
    expect(html).toContain(`<title>${SHARE.title}</title>`);
    expect(html).toContain('name="description"');
    expect(() => injectMeta("<head></head>", null)).toThrow(/title/);
  });
});
