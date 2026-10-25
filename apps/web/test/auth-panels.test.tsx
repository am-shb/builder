import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthLayout } from "../src/auth/AuthLayout.tsx";
import { axeViolations } from "./helpers/axe.ts";

describe("the sign-up page's side panel", () => {
  it("shows the pitch and the café picture, with no heading of its own", async () => {
    const { container } = render(<MemoryRouter><AuthLayout variant="sign-up"><p>Clerk card</p></AuthLayout></MemoryRouter>);
    expect(screen.getByText(/Your next meeting ends with a/)).toBeTruthy();
    expect(screen.getByText(/An AI product manager for your calls/)).toBeTruthy();
    // The picture is hidden from screen readers; its caption says what it shows, and that a person picked.
    const figure = container.querySelector("figure")!;
    expect(figure.querySelector("figcaption")!.textContent).toContain("Theo, someone in the meeting, picks B");
    expect(figure.querySelector("[aria-hidden='true'].rounded-panel")).toBeTruthy();
    // Clerk's card title is the page's one heading.
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });

});

describe("the sign-in page's side panel", () => {
  it("welcomes a returning member, with no heading of its own and a picture hidden from screen readers", async () => {
    const { container } = render(<MemoryRouter><AuthLayout variant="sign-in"><p>Clerk card</p></AuthLayout></MemoryRouter>);
    expect(screen.getByText(/Welcome/)).toBeTruthy();
    expect(screen.getByText(/Your sessions, prototypes and decisions are right where you left them/)).toBeTruthy();
    expect(screen.queryByText(/Your next meeting ends with a/)).toBeNull();
    expect(container.querySelector("[aria-hidden='true'] .rounded-panel")).toBeTruthy();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is the default", () => {
    render(<MemoryRouter><AuthLayout><p>Clerk card</p></AuthLayout></MemoryRouter>);
    expect(screen.getByText(/right where you left them/)).toBeTruthy();
  });
});
