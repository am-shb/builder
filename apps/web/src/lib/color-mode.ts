// The color mode the person chose in the header: System (follow the OS, the default), Light or Dark (ADR 0015).
//
// The one exception to "no browser storage" (ADR 0012): this file, and public/color-mode.js which applies the same
// setting before the page is drawn, keep the choice in localStorage under one key. Only "light" or "dark" is ever
// stored (System removes the key), it's a display preference with nothing private in it, and every read and write is
// wrapped in try/catch: with storage blocked or full the app works as usual and the choice lasts until the page closes.
//
// The mode is applied as `data-theme` on <html>, which globals.css already honors, so every token flips, and Clerk's
// components follow because their appearance variables are those same tokens. No attribute means the system's mode.
// The browser's `theme-color` (the phone's address bar) follows too.

export type ColorMode = "system" | "light" | "dark";
export const COLOR_MODES: readonly ColorMode[] = ["system", "light", "dark"];

// Also written in public/color-mode.js; a test checks the two agree.
export const STORAGE_KEY = "builder.color-mode";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The stored choice, or "system" when there's none, it's not one we wrote, or storage can't be read.
export function readStoredMode(): ColorMode {
  try {
    const value = storage()?.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

// Keeps the choice for the next visit. False when storage refused it; the choice still applies to this page. The old
// value goes first, so a write refused for a full quota leaves System for the next visit, not an older choice.
export function storeMode(mode: ColorMode): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.removeItem(STORAGE_KEY);
    if (mode !== "system") s.setItem(STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

// Sets the page to a mode: `data-theme` on <html>, and the theme-color tags. index.html has one per system mode
// (media="(prefers-color-scheme: light|dark)"); a forced mode gives every tag the first matching tag's color, System
// puts them back.
export function applyColorMode(mode: ColorMode, doc: Document = document): void {
  const root = doc.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;

  const metas = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const m of metas) m.dataset.defaultContent ??= m.content;
  const colorFor = (scheme: string) => metas.find((m) => (m.getAttribute("media") ?? "").includes(`prefers-color-scheme: ${scheme}`))?.dataset.defaultContent;
  for (const m of metas) {
    const own = m.dataset.defaultContent ?? m.content;
    m.content = mode === "system" ? own : (colorFor(mode) ?? own);
  }
}

// The current choice, shared by every toggle on the page, with listeners for React (useColorMode). Read from storage
// when this module loads, so the menu shows the stored choice even before initColorMode runs.
let current: ColorMode = readStoredMode();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

// At startup (main.tsx): read the stored choice and apply it. public/color-mode.js has normally done this already;
// doing it again here covers a page where that script didn't run.
export function initColorMode(): void {
  current = readStoredMode();
  applyColorMode(current);
  notify();
}

export function getColorMode(): ColorMode {
  return current;
}

// `remember: false` applies a mode to this page only (the dev-only design page's ?theme=).
export function setColorMode(mode: ColorMode, { remember = true } = {}): void {
  current = mode;
  if (remember) storeMode(mode);
  applyColorMode(mode);
  notify();
}

// A choice made in another tab of the app reaches this one through the storage event.
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  current = readStoredMode();
  applyColorMode(current);
  notify();
}

export function subscribeColorMode(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
