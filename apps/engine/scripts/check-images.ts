// Checks the bundled stock images against their manifest and budgets (spec: 40 files, WebP, <= 800 px, <= 80 KB each,
// <= 3 MB total, source and license per file). Run: node scripts/check-images.ts
import { existsSync, readFileSync } from "node:fs";
import { IMAGES, IMAGE_SUBJECTS } from "../public/renderer/images.js";

const DIR = new URL("../public/renderer/images/", import.meta.url);
const COUNTS: Record<string, number> = { food: 7, places: 7, people: 7, products: 7, workspaces: 7, abstract: 5 };
const MAX_FILE = 80 * 1024;
const MAX_TOTAL = 3 * 1024 * 1024;
const MAX_SIDE = 800;

/** Reads the pixel size from a WebP header (lossy VP8, lossless VP8L, extended VP8X). Null when it is not WebP. */
export function readWebpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const kind = tag(12);
  if (kind === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}

/** Returns a list of problems; empty means the image set is good. */
export function checkImages(): string[] {
  const problems: string[] = [];
  if (IMAGES.length !== 40) problems.push(`expected 40 images, found ${IMAGES.length}`);
  for (const s of IMAGE_SUBJECTS) {
    const n = IMAGES.filter((i) => i.subject === s).length;
    if (n !== COUNTS[s]) problems.push(`${s}: expected ${COUNTS[s]}, found ${n}`);
  }
  let total = 0;
  const licenses = existsSync(new URL("LICENSES.md", DIR)) ? readFileSync(new URL("LICENSES.md", DIR), "utf8") : "";
  if (!licenses) problems.push("LICENSES.md is missing");
  for (const img of IMAGES) {
    const where = img.file;
    if (!existsSync(new URL(img.file, DIR))) { problems.push(`${where}: file missing`); continue; }
    const bytes = readFileSync(new URL(img.file, DIR));
    total += bytes.length;
    if (bytes.length > MAX_FILE) problems.push(`${where}: ${bytes.length} bytes, over ${MAX_FILE}`);
    const size = readWebpSize(bytes);
    if (!size) problems.push(`${where}: not a WebP`);
    else {
      if (Math.max(size.width, size.height) > MAX_SIDE) problems.push(`${where}: ${size.width}x${size.height}, over ${MAX_SIDE}px`);
      if (size.width !== img.width || size.height !== img.height) problems.push(`${where}: manifest ${img.width}x${img.height} but file is ${size.width}x${size.height}`);
    }
    if (!img.author) problems.push(`${where}: no author`);
    if (!/^https:\/\/(www\.)?(unsplash|pexels)\.com\//.test(img.source)) problems.push(`${where}: source is not an unsplash.com or pexels.com URL`);
    if (img.license !== "Unsplash License" && img.license !== "Pexels License") problems.push(`${where}: license "${img.license}"`);
    if (!img.caption || img.caption.split(/\s+/).length > 5) problems.push(`${where}: caption must be 1 to 5 words`);
    if (!licenses.includes(img.file)) problems.push(`${where}: not listed in LICENSES.md`);
  }
  if (total > MAX_TOTAL) problems.push(`total ${total} bytes, over ${MAX_TOTAL}`);
  return problems;
}

if (import.meta.main) {
  const problems = checkImages();
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  const total = IMAGES.reduce((n, i) => n + readFileSync(new URL(i.file, DIR)).length, 0);
  console.log(`ok: ${IMAGES.length} images, ${(total / 1024).toFixed(0)} KB total`);
}
