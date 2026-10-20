// Theme model: slot options, palettes and the pure mapping from slot values to CSS custom properties.
// Import-free: Node loads this file server-side (schema validation) as well as the browser.

/** @typedef {"accent"|"warmth"|"radius"|"density"} ThemeSlotName */
/** @typedef {{ value: string, status: "draft"|"agreed", decisionId?: string, previous: string, reverted?: { value: string, decisionId: string } }} ThemeSlot */
/** @typedef {Record<ThemeSlotName, ThemeSlot>} Theme */
/** @typedef {Record<ThemeSlotName, string>} ThemeValues */

/** @type {ThemeSlotName[]} */
export const THEME_SLOTS = ["accent", "warmth", "radius", "density"];

/** First option of each slot is the house default. @type {Record<ThemeSlotName, string[]>} */
export const THEME_OPTIONS = {
  accent: ["slate", "blue", "indigo", "violet", "pink", "red", "orange", "gold", "green", "teal"],
  warmth: ["neutral", "warm", "cool"],
  radius: ["soft", "sharp", "round"],
  density: ["regular", "compact", "roomy"],
};

/** @type {ThemeValues} */
export const DEFAULT_THEME_VALUES = {
  accent: "slate", warmth: "neutral", radius: "soft", density: "regular",
};

const ACCENTS = {
  slate: "#1e293b", blue: "#2563eb", indigo: "#4f46e5", violet: "#7c3aed", pink: "#db2777",
  red: "#dc2626", orange: "#ea580c", gold: "#c8961e", green: "#15803d", teal: "#0f766e",
};

// bg, surface, line, ink, ink-2, ink-3
const WARMTH = {
  neutral: ["#f6f7f9", "#ffffff", "#e2e8f0", "#0f172a", "#475569", "#64748b"],
  warm: ["#faf8f3", "#ffffff", "#ece6d8", "#1c1917", "#57534e", "#78716c"],
  cool: ["#f3f6fb", "#ffffff", "#dbe3ef", "#0f172a", "#475569", "#64748b"],
};

const RADIUS = { sharp: 4, soft: 12, round: 20 };
const DENSITY = { compact: [10, 12], regular: [14, 18], roomy: [20, 24] };

const STATUS = {
  ok: { fg: "#166534", bg: "#dcfce7", alt: ["#115e59", "#ccfbf1"] },
  warn: { fg: "#92400e", bg: "#fef3c7", alt: ["#78350f", "#fde68a"] },
  bad: { fg: "#991b1b", bg: "#fee2e2", alt: ["#9f1239", "#ffe4e6"] },
};

const DARK_INK = "#111827";
const WHITE = "#ffffff";

/** @param {string} hex @returns {[number, number, number]} */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number[]} c */
function toHex(c) {
  return "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
}

/** @param {string} hex */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colors. */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** @param {string} hex HSL hue in degrees */
function hue(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** @param {string} accent @param {string} bg */
function mix(accent, bg, t) {
  const a = rgb(accent);
  const b = rgb(bg);
  return toHex(b.map((v, i) => v + (a[i] - v) * t));
}

/** @param {Theme | undefined} theme @returns {ThemeValues} */
export function themeValues(theme) {
  /** @type {ThemeValues} */
  const out = { ...DEFAULT_THEME_VALUES };
  if (theme) for (const s of THEME_SLOTS) if (theme[s]) out[s] = theme[s].value;
  return out;
}

/** @param {ThemeValues} values @returns {Record<string, string>} */
export function themeVars(values) {
  const accent = ACCENTS[values.accent] ?? ACCENTS.slate;
  const [bg, surface, line, ink, ink2, ink3] = WARMTH[values.warmth] ?? WARMTH.neutral;
  const radius = RADIUS[values.radius] ?? RADIUS.soft;
  const [gap, pad] = DENSITY[values.density] ?? DENSITY.regular;
  const accentHue = hue(accent);
  const status = {};
  for (const [key, s] of Object.entries(STATUS)) {
    const near = hueDistance(accentHue, hue(s.fg)) <= 35;
    status[key] = near ? s.alt : [s.fg, s.bg];
  }
  return {
    "--b-accent": accent,
    "--b-accent-soft": mix(accent, bg, 0.14),
    "--b-accent-ink": contrast(WHITE, accent) >= contrast(DARK_INK, accent) ? WHITE : DARK_INK,
    "--b-bg": bg,
    "--b-surface": surface,
    "--b-line": line,
    "--b-ink": ink,
    "--b-ink-2": ink2,
    "--b-ink-3": ink3,
    "--b-ok": status.ok[0],
    "--b-ok-bg": status.ok[1],
    "--b-warn": status.warn[0],
    "--b-warn-bg": status.warn[1],
    "--b-bad": status.bad[0],
    "--b-bad-bg": status.bad[1],
    "--b-radius": `${radius}px`,
    "--b-radius-sm": `${radius / 2}px`,
    "--b-gap": `${gap}px`,
    "--b-pad": `${pad}px`,
    "--b-chart-1": accent,
    "--b-chart-2": ink3,
    "--b-chart-3": status.ok[0],
  };
}

/**
 * How the theme differs between two prototypes: "values" when any slot value differs, "settled" when values
 * match but some slot went draft -> agreed keeping its decisionId (an agree; a revert drops the id), otherwise null.
 * @returns {"values"|"settled"|null}
 */
export function themeChange(prev, next) {
  if (!prev) return null;
  const a = themeValues(prev.theme);
  const b = themeValues(next.theme);
  if (THEME_SLOTS.some((s) => a[s] !== b[s])) return "values";
  for (const s of THEME_SLOTS) {
    const was = prev.theme?.[s];
    const now = next.theme?.[s];
    if (was?.status === "draft" && now?.status === "agreed" && was.decisionId !== undefined && now.decisionId === was.decisionId) return "settled";
  }
  return null;
}
