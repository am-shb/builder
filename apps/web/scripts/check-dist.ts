// After `vite build`: the dev-only design page must not be in the production site (ADR 0013).
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
