// The page's title, description and share tags (ADR 0017), written into index.html at build time and in the dev
// server, from the product's name. Crawlers and chat apps read them without running the page's script. The share
// image's URL is made absolute when the build knows the site's origin: SITE_URL, else the RENDER_EXTERNAL_URL that
// Render sets on its builds. Without one it stays relative, which browsers accept and some crawlers don't.
import type { Plugin } from "vite";
import { PRODUCT_NAME } from "@builder/session-core/brand";
import { HOME_DESCRIPTION, HOME_TITLE } from "../src/landing/copy.ts";

export const SHARE = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  image: "/og.png",
  imageAlt: `${PRODUCT_NAME}: a meeting on one side, a prototype building itself on the other.`,
  width: 1200,
  height: 630,
};

// An https origin (or http for this computer), without a path; anything else is ignored.
export function siteOrigin(env: Record<string, string | undefined>): string | null {
  for (const raw of [env.SITE_URL, env.RENDER_EXTERNAL_URL]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
    } catch {
      // Not a URL: try the next one.
    }
  }
  return null;
}

export function metaTags(origin: string | null): string {
  const abs = (path: string) => (origin ? `${origin}${path}` : path);
  const tags: [string, string, string][] = [
    ["name", "description", SHARE.description],
    ["property", "og:type", "website"],
    ["property", "og:site_name", PRODUCT_NAME],
    ["property", "og:title", SHARE.title],
    ["property", "og:description", SHARE.description],
    ["property", "og:image", abs(SHARE.image)],
    ["property", "og:image:width", String(SHARE.width)],
    ["property", "og:image:height", String(SHARE.height)],
    ["property", "og:image:alt", SHARE.imageAlt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", SHARE.title],
    ["name", "twitter:description", SHARE.description],
    ["name", "twitter:image", abs(SHARE.image)],
    ["name", "twitter:image:alt", SHARE.imageAlt],
  ];
  if (origin) tags.push(["property", "og:url", `${origin}/`]);
  const lines = tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`);
  if (origin) lines.push(`<link rel="canonical" href="${escapeAttr(`${origin}/`)}" />`);
  lines.push('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  return lines.join("\n    ");
}

// Fills the empty <title> and puts the tags right after it.
export function injectMeta(html: string, origin: string | null): string {
  if (!html.includes("<title></title>")) throw new Error("index.html needs an empty <title></title> for the share tags");
  return html.replace("<title></title>", `<title>${escapeText(SHARE.title)}</title>\n    ${metaTags(origin)}`);
}

// The two fonts the first screen needs, preloaded so they download with the page rather than after its script:
// the text font and the display font, Latin only (globals.css).
const PRELOAD_FONTS = [/^assets\/schibsted-grotesk-latin-wght-normal-[\w-]+\.woff2$/, /^assets\/fraunces-latin-full-normal-[\w-]+\.woff2$/];

export function fontPreloads(files: string[]): string {
  return PRELOAD_FONTS.map((pattern) => files.find((f) => pattern.test(f)))
    .filter((f): f is string => !!f)
    .map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`)
    .join("\n    ");
}

export function metaPlugin(): Plugin {
  return {
    name: "builder-meta",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const withMeta = injectMeta(html, siteOrigin(process.env));
        const preloads = ctx.bundle ? fontPreloads(Object.keys(ctx.bundle)) : "";
        return preloads ? withMeta.replace("</title>", `</title>\n    ${preloads}`) : withMeta;
      },
    },
  };
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
