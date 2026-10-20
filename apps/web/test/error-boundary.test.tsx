import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { App } from "../src/App.tsx";
import { axeViolations } from "./helpers/axe.ts";

// A page that throws while rendering, as a bug or bad data would.
vi.mock("../src/pages/HomePage.tsx", () => ({
  HomePage: () => {
    throw new Error("a page broke");
  },
}));

afterEach(() => setClerk({}));

describe("a page that throws", () => {
  it("shows \"Something went wrong\" with Reload, inside the app's frame, instead of a blank page", async () => {
    // React reports the error to the console; that's expected here.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload, pathname: "/" });
    setClerk({ session: "active", orgId: "org_a" });
    render(<App config={{ clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA", apiUrl: "http://localhost:3001" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(document.body.textContent).not.toContain("a page broke");
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
