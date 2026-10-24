import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setColorMode } from "../src/lib/color-mode.ts";
import { FAQ, NAV_LINKS } from "../src/landing/copy.ts";
import { LandingPage } from "../src/landing/LandingPage.tsx";
import { LegalPage } from "../src/landing/LegalPage.tsx";
import { axeViolations } from "./helpers/axe.ts";
import { DESKTOP_MOUSE, PHONE, useScreen } from "./setup.ts";

// The public landing page (ADR 0017).
describe("the landing page", () => {
  it("has one h1 and section headings in order, never skipping a level", () => {
    render(<LandingPage />);
    const headings = [...document.querySelectorAll("h1, h2, h3")];
    expect(headings.filter((h) => h.tagName === "H1").map((h) => h.textContent)).toEqual(["Your meeting ends with a working prototype."]);
    let level = 1;
    for (const h of headings) {
      const next = Number(h.tagName[1]);
      expect(next, h.textContent ?? "").toBeLessThanOrEqual(level + 1);
      level = next;
    }
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(expect.arrayContaining([
      "Three steps, then just talk", "Built for the way decisions really happen", "Questions, answered",
    ]));
  });

  it("every section the nav links to exists, and each is a named region", () => {
    render(<LandingPage />);
    for (const link of NAV_LINKS) {
      const section = document.getElementById(link.href.slice(1));
      expect(section, link.href).toBeTruthy();
      expect(section!.getAttribute("aria-labelledby")).toBe(`${link.href.slice(1)}-title`);
    }
    expect(document.getElementById("demo")).toBeTruthy();
  });

  it("every Start free goes to sign-up and every Sign in to sign-in", () => {
    useScreen(DESKTOP_MOUSE);
    render(<LandingPage />);
    const starts = screen.getAllByRole("link", { name: /^Start free/ });
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (const a of starts) expect(a.getAttribute("href")).toBe("/sign-up");
    for (const a of screen.getAllByRole("link", { name: "Sign in" })) expect(a.getAttribute("href")).toBe("/sign-in");
  });

  it.each([["phone", PHONE, "light"], ["desktop", DESKTOP_MOUSE, "light"], ["phone", PHONE, "dark"], ["desktop", DESKTOP_MOUSE, "dark"]] as const)(
    "has no accessibility violations on a %s in %s mode",
    async (_name, screenSize, mode) => {
      useScreen(screenSize);
      setColorMode(mode, { remember: false });
      const { container } = render(<LandingPage />);
      expect(await axeViolations(container)).toEqual([]);
    },
  );

  it("on a phone, Menu opens a sheet with the links; Escape closes it and focus returns to Menu", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    const sheet = await screen.findByRole("dialog", { name: "Menu" });
    for (const link of NAV_LINKS) expect(within(sheet).getByRole("link", { name: link.label })).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/sign-up");
    await user.keyboard("{Escape}");
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it("the FAQ opens and closes from the keyboard", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    const first = screen.getByRole("button", { name: FAQ.items[0]!.q });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    first.focus();
    await user.keyboard("{Enter}");
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(FAQ.items[0]!.a)).toBeTruthy();
    await user.keyboard(" ");
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("the hero scene is decoration, described in words for screen readers", () => {
    render(<LandingPage />);
    expect(document.querySelector(".scene")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText(/the decision moves from pending to agreed/)).toBeTruthy();
  });

  it("with reduced motion, the hero shows its last frame at once and starts no timer", () => {
    useScreen({ ...PHONE, reducedMotion: true });
    const timers = new Set<unknown>();
    const original = window.setTimeout;
    // The color menu waits for the browser to be idle; that isn't the scene's timer.
    const w = window as unknown as { requestIdleCallback?: unknown };
    const idle = w.requestIdleCallback;
    w.requestIdleCallback = () => 0;
    window.setTimeout = ((fn: () => void, ms?: number) => { const id = original(fn, ms); timers.add(id); return id; }) as typeof window.setTimeout;
    try {
      render(<LandingPage />);
      // The third person's message and the second decision are already on screen.
      const shown = [...document.querySelectorAll(".scene [data-on]")].map((el) => el.textContent ?? "");
      expect(shown.some((t) => t.includes("Could overdue ones show in red?"))).toBe(true);
      expect(shown.some((t) => t.includes("Overdue tasks in red"))).toBe(true);
      expect(timers.size).toBe(0);
    } finally {
      window.setTimeout = original;
      w.requestIdleCallback = idle;
    }
  });

  it("without reduced motion, the hero starts from the beginning", () => {
    render(<LandingPage />);
    const shown = [...document.querySelectorAll(".scene [data-on]")].map((el) => el.textContent ?? "");
    expect(shown.some((t) => t.includes("Could overdue ones show in red?"))).toBe(false);
  });

  it("the demo frame shows a placeholder, not a play button that does nothing", () => {
    render(<LandingPage />);
    const demo = document.getElementById("demo")!;
    expect(within(demo).queryByRole("button")).toBeNull();
    expect(within(demo).getByText("The demo video is on its way.")).toBeTruthy();
  });

  it("names the page in the tab", () => {
    render(<LandingPage />);
    expect(document.title).toMatch(/Your meeting ends with a working prototype/);
  });

  it("a section link in the bar moves focus to its section", () => {
    useScreen(DESKTOP_MOUSE);
    Element.prototype.scrollIntoView ??= () => {};
    render(<LandingPage />);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Pricing" }));
    expect(document.activeElement?.id).toBe("pricing");
  });
});

describe("the legal placeholders", () => {
  it.each([["privacy", "Privacy"], ["terms", "Terms"]] as const)("%s has its heading, says it's a placeholder and passes axe", async (kind, title) => {
    const { container } = render(<LegalPage kind={kind} />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText(/This page is a placeholder/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
