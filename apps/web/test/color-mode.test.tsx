// The color mode setting (ADR 0013): System, Light or Dark, kept in localStorage (the one exception to ADR 0012's
// rule), applied before first paint by public/color-mode.js, and chosen from a menu in the header.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthLayout } from "../src/auth/AuthLayout.tsx";
import { AppShell } from "../src/components/AppShell.tsx";
import { ColorModeMenu } from "../src/components/ColorModeMenu.tsx";
import {
  applyColorMode, getColorMode, initColorMode, readStoredMode, setColorMode, STORAGE_KEY, storeMode, type ColorMode,
} from "../src/lib/color-mode.ts";
import { MemoryRouter } from "react-router";
import { axeViolations } from "./helpers/axe.ts";

const root = join(import.meta.dirname, "..");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const publicScript = readFileSync(join(root, "public", "color-mode.js"), "utf8");

const LIGHT = "#f4f6f5";
const DARK = "#0f1513";

// The two theme-color tags as index.html has them.
function setThemeColorTags() {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  for (const [scheme, color] of [["light", LIGHT], ["dark", DARK]]) {
    const m = document.createElement("meta");
    m.setAttribute("name", "theme-color");
    m.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    m.setAttribute("content", color);
    document.head.append(m);
  }
}
const themeColors = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content);
const theme = () => document.documentElement.getAttribute("data-theme");
// A narrower tag a later change might add after the two; it mustn't win over the plain dark one.
const CONTRAST = "#000000";
function addContrastTag() {
  const m = document.createElement("meta");
  m.setAttribute("name", "theme-color");
  m.setAttribute("media", "(prefers-color-scheme: dark) and (prefers-contrast: more)");
  m.setAttribute("content", CONTRAST);
  document.head.append(m);
}

// Storage that throws on every use, as in a browser that blocks site data, or a full quota.
function breakStorage(how: "access" | "calls") {
  if (how === "access") {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  } else {
    for (const name of ["getItem", "setItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, name).mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    }
  }
}

// Runs public/color-mode.js as the browser would: a plain script, on the page as it stands.
function runPublicScript() {
  // Indirect eval runs the shipped text in the global scope, as a <script> would. Only tests do this (guards.test.ts).
  (0, eval)(publicScript);
}

afterEach(() => {
  // Before setup.ts resets the setting, which needs working storage.
  vi.restoreAllMocks();
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
});

describe("the stored choice", () => {
  it("is System when nothing is stored, or something we didn't write", () => {
    expect(readStoredMode()).toBe("system");
    for (const junk of ["", "System", "DARK", "blue", "system"]) {
      localStorage.setItem(STORAGE_KEY, junk);
      expect(readStoredMode(), junk).toBe("system");
    }
  });

  it("keeps Light and Dark under one key, and System removes it", () => {
    expect(storeMode("dark")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(readStoredMode()).toBe("dark");
    storeMode("light");
    expect(readStoredMode()).toBe("light");
    storeMode("system");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("a write refused for a full quota leaves System for the next visit, not an older choice", () => {
    storeMode("light");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    expect(storeMode("dark")).toBe(false);
    expect(readStoredMode()).toBe("system");
  });

  it.each(["access", "calls"] as const)("with storage blocked (%s), reads System and writes nothing, without throwing", (how) => {
    breakStorage(how);
    expect(readStoredMode()).toBe("system");
    expect(storeMode("dark")).toBe(false);
    expect(storeMode("system")).toBe(false);
  });
});

describe("applying a mode", () => {
  it("sets data-theme for Light and Dark and removes it for System", () => {
    applyColorMode("dark");
    expect(theme()).toBe("dark");
    applyColorMode("light");
    expect(theme()).toBe("light");
    applyColorMode("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("gives both theme-color tags the chosen mode's color, and puts them back for System", () => {
    setThemeColorTags();
    applyColorMode("dark");
    expect(themeColors()).toEqual([DARK, DARK]);
    applyColorMode("light");
    expect(themeColors()).toEqual([LIGHT, LIGHT]);
    applyColorMode("system");
    expect(themeColors()).toEqual([LIGHT, DARK]);
  });

  it("with a third, narrower tag, the first tag for the mode gives the color", () => {
    setThemeColorTags();
    addContrastTag();
    applyColorMode("dark");
    expect(themeColors()).toEqual([DARK, DARK, DARK]);
    applyColorMode("system");
    expect(themeColors()).toEqual([LIGHT, DARK, CONTRAST]);
  });

  it("works with no theme-color tags", () => {
    expect(() => applyColorMode("dark")).not.toThrow();
  });
});

describe("the store", () => {
  it("starts from the stored choice and applies it", () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    initColorMode();
    expect(getColorMode()).toBe("dark");
    expect(theme()).toBe("dark");
  });

  it("reads the stored choice when the module loads, before initColorMode", async () => {
    localStorage.setItem(STORAGE_KEY, "dark");
    vi.resetModules();
    const fresh = await import("../src/lib/color-mode.ts");
    expect(fresh.getColorMode()).toBe("dark");
  });

  it("a mode for this page only isn't remembered", () => {
    setColorMode("dark", { remember: false });
    expect(theme()).toBe("dark");
    expect(getColorMode()).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("with storage blocked, a choice still applies to this page", () => {
    breakStorage("calls");
    setColorMode("dark");
    expect(getColorMode()).toBe("dark");
    expect(theme()).toBe("dark");
  });

  it("follows a choice made in another tab", async () => {
    render(<ColorModeMenu />);
    act(() => {
      localStorage.setItem(STORAGE_KEY, "light");
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "light" }));
    });
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Color mode: Light" })).toBeTruthy();
    // Another tab clearing all site data.
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(theme()).toBeNull();
    expect(screen.getByRole("button", { name: "Color mode: System" })).toBeTruthy();
  });

  it("ignores other keys' storage events", () => {
    render(<ColorModeMenu />);
    setColorMode("dark");
    localStorage.removeItem(STORAGE_KEY);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "something.else" })); });
    expect(theme()).toBe("dark");
  });
});

describe("before first paint (public/color-mode.js)", () => {
  it("index.html loads it as a blocking script from our origin, after the theme-color tags and before the app", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    const tag = /<script\b[^>]*color-mode\.js[^>]*>/.exec(head);
    expect(tag).not.toBeNull();
    expect(tag![0]).toBe('<script src="/color-mode.js">');
    expect(head.lastIndexOf('name="theme-color"')).toBeLessThan(tag!.index);
    expect(indexHtml.indexOf("/src/main.tsx")).toBeGreaterThan(tag!.index);
    // No inline script anywhere: every <script> has a src (the CSP allows no inline scripts).
    for (const s of indexHtml.match(/<script\b[^>]*>/g) ?? []) expect(s).toMatch(/\ssrc=/);
  });

  it("uses the same storage key as the app", () => {
    expect(publicScript).toContain(`"${STORAGE_KEY}"`);
  });

  it.each([
    ...(["system", "light", "dark"] as ColorMode[]).map((mode) => [mode, false] as const),
    ...(["light", "dark"] as ColorMode[]).map((mode) => [mode, true] as const),
  ])("leaves the page as the app's applyColorMode would (%s, a third tag: %s)", (mode, third) => {
    const tags = () => { setThemeColorTags(); if (third) addContrastTag(); };
    tags();
    storeMode(mode);
    runPublicScript();
    const fromScript = { theme: theme(), colors: themeColors() };
    // The same page through the app's own code.
    document.documentElement.removeAttribute("data-theme");
    tags();
    applyColorMode(readStoredMode());
    expect(fromScript).toEqual({ theme: theme(), colors: themeColors() });
  });

  it("then the app can go back to System, restoring the tags the script changed", () => {
    setThemeColorTags();
    storeMode("dark");
    runPublicScript();
    applyColorMode("system");
    expect(themeColors()).toEqual([LIGHT, DARK]);
  });

  it.each(["access", "calls"] as const)("does nothing, without throwing, when storage is blocked (%s)", (how) => {
    setThemeColorTags();
    breakStorage(how);
    expect(runPublicScript).not.toThrow();
    expect(theme()).toBeNull();
    expect(themeColors()).toEqual([LIGHT, DARK]);
  });

  it("ignores a value it didn't write", () => {
    localStorage.setItem(STORAGE_KEY, "purple");
    runPublicScript();
    expect(theme()).toBeNull();
  });
});

describe("ColorModeMenu", () => {
  it("is a labelled button showing the current choice", () => {
    render(<ColorModeMenu />);
    const button = screen.getByRole("button", { name: "Color mode: System" });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    act(() => setColorMode("dark"));
    expect(screen.getByRole("button", { name: "Color mode: Dark" })).toBeTruthy();
  });

  it("works from the keyboard: open, move, choose, and focus goes back to the button", async () => {
    const user = userEvent.setup();
    render(<ColorModeMenu />);
    await user.tab();
    const button = screen.getByRole("button", { name: "Color mode: System" });
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe(button.id);
    const items = screen.getAllByRole("menuitemradio");
    expect(screen.getByRole("group", { name: "Color mode" })).toBeTruthy();
    expect(items.map((i) => [i.textContent, i.getAttribute("aria-checked")])).toEqual([
      ["System", "true"], ["Light", "false"], ["Dark", "false"],
    ]);
    // Opened from the keyboard, focus starts on the first item; two steps down is Dark.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(theme()).toBe("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    const after = screen.getByRole("button", { name: "Color mode: Dark" });
    expect(document.activeElement).toBe(after);
  });

  it("Escape closes the menu without changing the mode", async () => {
    const user = userEvent.setup();
    render(<ColorModeMenu />);
    await user.click(screen.getByRole("button", { name: "Color mode: System" }));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(theme()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Color mode: System" }));
  });

  it("choosing System again removes the stored choice", async () => {
    const user = userEvent.setup();
    setColorMode("light");
    render(<ColorModeMenu />);
    await user.click(screen.getByRole("button", { name: "Color mode: Light" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "System" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(theme()).toBeNull();
  });

  it("with storage blocked, the menu still changes the mode", async () => {
    breakStorage("access");
    const user = userEvent.setup();
    render(<ColorModeMenu />);
    await user.click(screen.getByRole("button", { name: "Color mode: System" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Light" }));
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Color mode: Light" })).toBeTruthy();
  });

  it("has no accessibility violations in the header, closed or open", async () => {
    const user = userEvent.setup();
    render(<AppShell><p>Content</p></AppShell>);
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Color mode: System" }));
    const menu = await screen.findByRole("menu");
    expect(screen.getByRole("banner").contains(menu)).toBe(true);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("in the headers", () => {
  it("the app's header has it between the org switcher and the account menu", () => {
    render(<AppShell org={<button>Org</button>} account={<button>Account</button>}><p>Content</p></AppShell>);
    const header = screen.getByRole("banner");
    const names = [...header.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual(["Org", "Color mode: System", "Account"]);
  });

  it("pages without an org or account (not configured, Clerk unavailable) have it too", () => {
    render(<AppShell><p>Content</p></AppShell>);
    expect(screen.getByRole("button", { name: "Color mode: System" })).toBeTruthy();
  });

  it("sign-in, sign-up and choosing an organization have it, so Clerk's card can be checked in either mode", () => {
    render(<MemoryRouter><AuthLayout><p>Clerk card</p></AuthLayout></MemoryRouter>);
    expect(screen.getByRole("banner").querySelector('button[aria-label="Color mode: System"]')).not.toBeNull();
  });
});
