// DOM helpers shared by the component builders. Every helper that writes to the DOM touches it only on change,
// so a builder's update stays idempotent (re-rendering an unchanged prototype mutates nothing).
import { parseCells } from "@renderer/catalog.js";
import { iconData } from "@renderer/icons.js";

export const str = (v, d = "") => (v === undefined || v === null ? d : String(v));
export const arr = (v) => (Array.isArray(v) ? v.map(String) : []);

/** A finite number from a number or numeric string, else `d`. */
export function num(v, d) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

export const nums = (v) => (Array.isArray(v) ? v.map((x) => num(x, NaN)).filter(Number.isFinite) : []);

/** `v` as an integer in [lo, hi]; `d` when missing. */
export function clampInt(v, lo, hi, d) {
  return Math.min(hi, Math.max(lo, Math.round(num(v, d))));
}

export function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** Text that hides its element when empty. */
export function setOptional(el, text) {
  setText(el, text);
  setHidden(el, !text);
}

export function setAttr(el, name, value) {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function setClass(el, cls, on) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Keeps exactly one `<prefix><value>` class on el (none when value is empty). */
export function setVariant(el, prefix, value) {
  for (const c of [...el.classList]) if (c.startsWith(prefix) && c !== prefix + value) el.classList.remove(c);
  if (value && !el.classList.contains(prefix + value)) el.classList.add(prefix + value);
}

export function withParts(el, parts) {
  el.parts = parts;
  return el;
}

/** True (and remembers `key`) when the content key differs from the last build of el's inner parts. */
export function changed(el, key) {
  if (el.__key === key) return false;
  el.__key = key;
  return true;
}

// Rebuilds a list of child elements only when their text changes (keeps stable DOM otherwise).
export function syncTexts(parent, texts, make) {
  const have = [...parent.children];
  texts.forEach((t, i) => {
    if (have[i]) setText(have[i], t);
    else parent.append(make(t));
  });
  for (const extra of have.slice(texts.length)) extra.remove();
}

export function initials(name) {
  const words = str(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? "" : "";
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = 6;

/** Stable color slot for a name, so the same person always gets the same circle. */
export function avatarColor(name) {
  let x = 0;
  for (const ch of str(name).trim().toLowerCase()) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % AVATAR_COLORS;
}

export function avatar(name, cls = "") {
  const el = h("span", `b-av is-av-${avatarColor(name)}${cls ? " " + cls : ""}`, initials(name));
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** Swaps an avatar circle's color and initials in place. */
export function syncAvatar(circle, name) {
  const fresh = avatar(name);
  if (circle.className !== fresh.className) circle.className = fresh.className;
  setText(circle, fresh.textContent);
}

export function pill(text, tone = "default") {
  return h("span", `b-pill is-tone-${tone}`, text);
}

/** "$1,150", "38%", "-12", "4.5k": shown right-aligned and bold in tables and lists. */
export const isAmount = (text) => /^[-+−]?[$€£¥]?\s?\d[\d.,]*\s?[%kKmM]?$/.test(str(text).trim());

export function cells(row, options) {
  return parseCells(row, options);
}

/** One parsed compact cell as an element: a person (avatar + name), a pill, or text. */
export function cellEl(cell) {
  if (cell.kind === "person") {
    const el = h("span", "b-person");
    el.append(avatar(cell.text, "is-sm"), h("span", "b-person-name", cell.text));
    return el;
  }
  if (cell.kind === "pill") return pill(cell.text, cell.tone);
  return h("span", isAmount(cell.text) ? "b-cell-text is-amount" : "b-cell-text", cell.text);
}

/** "food-3" -> "food": the subject word a picture is chosen by. */
export function subject(image) {
  return str(image).trim().replace(/[-_\s]*\d+$/, "").replace(/[-_]+/g, " ");
}

/** Until the built-in images land: a tinted block that names its subject. */
export function imageBlock(image, cls = "") {
  const el = h("div", `b-img-block${cls ? " " + cls : ""}`);
  el.append(h("span", "b-img-word", subject(image) || "Image"));
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * An inline Lucide `<svg>` for a curated icon name or alias, or null when the name is unknown. Built with
 * createElementNS from the stored element list (never innerHTML). It strokes with currentColor, so it follows the
 * text color of whatever holds it.
 */
export function icon(name, size = 20) {
  const parts = iconData(name);
  if (!parts) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  const px = String(Math.max(8, Math.round(num(size, 20))));
  for (const [k, v] of [
    ["viewBox", "0 0 24 24"], ["width", px], ["height", px], ["fill", "none"], ["stroke", "currentColor"],
    ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["focusable", "false"],
  ]) svg.setAttribute(k, v);
  for (const [tag, attrs] of parts) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) child.setAttribute(k, v);
    svg.append(child);
  }
  return svg;
}

/** Puts the icon in `host` (hiding it when the name is empty or unknown); rebuilds only when the name or size changes. */
export function syncIcon(host, name, size = 20) {
  const key = `${str(name).trim().toLowerCase()}|${size}`;
  if (host.__iconKey === key) return;
  host.__iconKey = key;
  const svg = icon(name, size);
  if (svg) host.replaceChildren(svg);
  else host.replaceChildren();
  setHidden(host, !svg);
}
