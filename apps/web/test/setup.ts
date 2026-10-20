// Tests never reach the network (ADR 0012): not Clerk, not the api, not the engine, not any paid service. Every way a
// test could open a connection fails the test instead. A test that needs a reply passes its own fake fetch.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

export class NetworkBlockedError extends Error {
  constructor(what: string) {
    super(`${what} is blocked in tests. Pass a fake instead.`);
    this.name = "NetworkBlockedError";
  }
}

function blocked(what: string) {
  return function () {
    throw new NetworkBlockedError(what);
  };
}

const g = globalThis as Record<string, unknown>;
g.fetch = async () => {
  throw new NetworkBlockedError("fetch");
};
g.WebSocket = blocked("WebSocket");
g.EventSource = blocked("EventSource");
g.XMLHttpRequest = blocked("XMLHttpRequest");
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "sendBeacon", { value: blocked("navigator.sendBeacon"), configurable: true });
}

// jsdom has no matchMedia or ResizeObserver; Radix and the layout hooks use them. The fake answers each query from a
// pretend screen: a width and a pointer. Tests see a phone (390px, touch) unless they call `useScreen`.
export const media = { width: 390, coarse: true };
export const PHONE = { width: 390, coarse: true };
export const DESKTOP_MOUSE = { width: 1280, coarse: false };
export function useScreen(screen: { width: number; coarse: boolean }) {
  Object.assign(media, screen);
}

// Understands the queries the app uses: (min-width: Npx), (max-width: Npx) and (pointer: coarse|fine), joined by "and".
export function mediaMatches(query: string): boolean {
  return query.split(/\s+and\s+/).every((part) => {
    const m = /^\(\s*(min-width|max-width|pointer)\s*:\s*([\w.]+?)(px)?\s*\)$/.exec(part.trim());
    if (!m) return false;
    const [, feature, value] = m;
    if (feature === "pointer") return value === (media.coarse ? "coarse" : "fine");
    return feature === "min-width" ? media.width >= Number(value) : media.width <= Number(value);
  });
}

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    matches: mediaMatches(query), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }),
});
g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
// axe probes a canvas for icon fonts; jsdom has none and prints a warning per call.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
  useScreen(PHONE);
});
