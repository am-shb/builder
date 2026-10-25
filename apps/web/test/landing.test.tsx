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
      "Three steps, then just talk", "A product manager's habits, built in", "Questions, answered",
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

  it("pricing shows the Free plan, whose button goes to sign-up, and nothing links to an email address", () => {
    useScreen(DESKTOP_MOUSE);
    const { container } = render(<LandingPage />);
    const pricing = document.getElementById("pricing")!;
    const buttons = within(pricing).getAllByRole("link");
    expect(buttons.map((a) => a.textContent)).toEqual(["Start free"]);
    expect(buttons[0]!.getAttribute("href")).toBe("/sign-up");
    expect(within(pricing).queryByText(/Priced at launch/)).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Contact" })).toBeNull();
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

  it("the FAQ says when it pushes back, and that the room decides", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    await user.click(screen.getByRole("button", { name: "Will it push back on our ideas?" }));
    expect(screen.getByText(/It stays quiet while you talk\..*It never decides for you: the room does\./)).toBeTruthy();
  });

  it("the hero scene is decoration, described in words for screen readers", () => {
    render(<LandingPage />);
    expect(document.querySelector(".scene-art")?.getAttribute("aria-hidden")).toBe("true");
    // The tabs above it are real buttons, one per meeting.
    expect(within(screen.getByRole("group", { name: "Example meetings" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Café app", "Sales review"]);
    expect(screen.getByText(/the decision moves from pending to agreed/)).toBeTruthy();
  });

  it("with reduced motion, the hero shows the café's two options at once and starts no timer", async () => {
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
      const sales = document.querySelector(".scene [data-room='sales']")!;
      const cafe = document.querySelector(".scene [data-room='cafe']")!;
      expect(sales.hasAttribute("data-off")).toBe(true);
      expect(cafe.hasAttribute("data-off")).toBe(false);
      // Both options, each with who backs it and its trade-off; nothing picked yet.
      const said = (room: Element) => [...room.querySelectorAll("[data-on]")].map((el) => el.textContent ?? "");
      expect(said(cafe).some((t) => t.includes("Backed by Sana"))).toBe(true);
      expect(said(cafe).some((t) => t.includes("Backed by Ravi"))).toBe(true);
      expect(said(cafe).some((t) => t.includes("Higher margin per order"))).toBe(true);
      expect(said(cafe).some((t) => t.includes("Faster for regulars"))).toBe(true);
      expect(cafe.querySelector(".sc-ab")?.getAttribute("data-layout")).toBe("split");
      expect(screen.getByRole("button", { name: "Café app" }).getAttribute("aria-current")).toBe("true");
      // The other pill shows the sales review's still: the finished dashboard, every decision agreed.
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sales review" })); });
      expect(sales.hasAttribute("data-off")).toBe(false);
      expect(cafe.hasAttribute("data-off")).toBe(true);
      expect(said(sales).some((t) => t.includes("Yes, put it at the top."))).toBe(true);
      expect(sales.querySelectorAll(".sc-card[data-on]").length).toBe(5);
      expect(within(sales as HTMLElement).getAllByText("4 of 4 agreed").length).toBeGreaterThan(0);
      expect(timers.size).toBe(0);
    } finally {
      window.setTimeout = original;
      w.requestIdleCallback = idle;
    }
  });

  it("the hero opens on the café app, and paused, a pill jumps to that meeting's key moment", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    const pills = within(screen.getByRole("group", { name: "Example meetings" })).getAllByRole("button");
    expect(pills.map((b) => b.textContent)).toEqual(["Café app", "Sales review"]);
    const [cafe, sales] = pills as [HTMLElement, HTMLElement];
    expect(cafe.getAttribute("aria-current")).toBe("true");
    expect(sales.hasAttribute("aria-current")).toBe(false);
    const cafeRoom = document.querySelector(".scene [data-room='cafe']")!;
    const salesRoom = document.querySelector(".scene [data-room='sales']")!;
    expect(cafeRoom.hasAttribute("data-off")).toBe(false);
    expect(salesRoom.hasAttribute("data-off")).toBe(true);
    // Its first line is already there to read.
    const said = [...cafeRoom.querySelectorAll("[data-on]")].map((el) => el.textContent ?? "");
    expect(said.some((t) => t.includes("Let's build the Maple Café app"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Pause animation" }));
    await user.click(sales);
    expect(sales.getAttribute("aria-current")).toBe("true");
    expect(salesRoom.hasAttribute("data-off")).toBe(false);
    expect(cafeRoom.hasAttribute("data-off")).toBe(true);
    expect(salesRoom.querySelectorAll(".sc-card[data-on]").length).toBe(5);
    await user.click(cafe);
    expect(cafeRoom.querySelector(".sc-ab")?.getAttribute("data-layout")).toBe("split");
  });

  it("the hero's loop can be paused and played again (WCAG 2.2.2)", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);
    const scene = document.querySelector(".scene")!;
    expect(scene.hasAttribute("data-paused")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Pause animation" }));
    expect(scene.hasAttribute("data-paused")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Play animation" }));
    expect(scene.hasAttribute("data-paused")).toBe(false);
  });

  it("with reduced motion there is nothing to pause, so no pause button", () => {
    useScreen({ ...PHONE, reducedMotion: true });
    render(<LandingPage />);
    expect(screen.queryByRole("button", { name: /animation/ })).toBeNull();
  });

  it("without reduced motion, the hero starts from the beginning", () => {
    render(<LandingPage />);
    const shown = [...document.querySelectorAll(".scene [data-on]")].map((el) => el.textContent ?? "");
    expect(shown.some((t) => t.includes("Yes, put it at the top."))).toBe(false);
    expect(document.querySelectorAll(".scene .sc-card[data-on]").length).toBe(0);
  });

  it("the demo frame shows a placeholder, not a play button that does nothing", () => {
    render(<LandingPage />);
    const demo = document.getElementById("demo")!;
    expect(within(demo).queryByRole("button")).toBeNull();
    expect(within(demo).getByText("The demo video is on its way.")).toBeTruthy();
  });

  it("the footer says where it was built", () => {
    render(<LandingPage />);
    expect(within(screen.getByRole("contentinfo")).getByText(/Built at Build North 2026/)).toBeTruthy();
  });

  it("names the page in the tab", () => {
    render(<LandingPage />);
    expect(document.title).toMatch(/The AI product manager that builds what you decide/);
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
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
