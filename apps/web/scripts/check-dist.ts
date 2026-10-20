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
