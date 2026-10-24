// After `vite build`: the dev-only design page must not be in the production site (ADR 0015), and the page has no
// inline script.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));
const leaks = files(dist).filter((f) => /\.(js|html|css)$/.test(f)).filter((f) => {
  const text = readFileSync(f, "utf8");
  return text.includes("design-page") || text.includes("Design system");
});
if (leaks.length) {
  console.error(`the design page is in the production build: ${leaks.join(", ")}`);
  process.exit(1);
}
console.log("dist: no design page");

// The color mode script must ship, as a file from our origin: the CSP allows no inline script (ADR 0012, ADR 0015).
const html = readFileSync(join(dist, "index.html"), "utf8");
const inline = (html.match(/<script\b[^>]*>/g) ?? []).filter((tag) => !/\ssrc=/.test(tag));
if (inline.length) {
  console.error(`dist/index.html has an inline script: ${inline.join(", ")}`);
  process.exit(1);
}
if (!html.includes('<script src="/color-mode.js"></script>') || !statSync(join(dist, "color-mode.js"), { throwIfNoEntry: false })) {
  console.error("dist is missing the color mode script (public/color-mode.js) or index.html no longer loads it");
  process.exit(1);
}
console.log("dist: no inline scripts; color-mode.js ships");

// The landing page loads without Clerk or zod (ADR 0017): its entry chunk and every chunk it imports, followed through
// their static imports, contain neither.
const assets = join(dist, "assets");
const entry = readdirSync(assets).find((n) => /^entry-[\w-]+\.js$/.test(n));
if (!entry) {
  console.error("dist has no landing entry chunk (assets/entry-*.js)");
  process.exit(1);
}
const seen = new Set<string>();
const follow = (name: string) => {
  if (seen.has(name)) return;
  seen.add(name);
  for (const m of readFileSync(join(assets, name), "utf8").matchAll(/from\s*"\.\/([\w.-]+\.js)"|import\s*"\.\/([\w.-]+\.js)"/g)) follow((m[1] ?? m[2])!);
};
follow(entry);
const heavy = [...seen].filter((n) => /clerk|ZodError|\$ZodType/i.test(readFileSync(join(assets, n), "utf8")));
if (heavy.length) {
  console.error(`the landing page loads Clerk or zod: ${heavy.join(", ")}`);
  process.exit(1);
}
console.log(`dist: the landing page's ${seen.size} chunks load neither Clerk nor zod`);

// The share tags, the share image, the home-screen icon and robots.txt ship (ADR 0017).
for (const tag of ['property="og:image"', 'name="twitter:card"', 'name="description"', 'rel="apple-touch-icon"']) {
  if (!html.includes(tag)) {
    console.error(`dist/index.html has no ${tag} tag`);
    process.exit(1);
  }
}
for (const file of ["og.png", "apple-touch-icon.png", "robots.txt", "favicon.svg"]) {
  if (!statSync(join(dist, file), { throwIfNoEntry: false })) {
    console.error(`dist is missing ${file}`);
    process.exit(1);
  }
}
console.log("dist: share tags, share image, icons and robots.txt ship");
