import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clerk, setClerk } from "./helpers/clerk.tsx";
import { App, AppRoutes } from "../src/App.tsx";
import { readConfig } from "../src/config.ts";
import { safeReturnPath } from "../src/auth/guards.tsx";
import { axeViolations } from "./helpers/axe.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}
const where = () => screen.getByTestId("where").textContent;

afterEach(() => setClerk({}));

describe("routes and the guard", () => {
  it("signed out: a member page goes to sign-in, and comes back after", () => {
    setClerk({ session: "none" });
    at("/sessions/abc?x=1");
    expect(where()).toBe(`/sign-in?redirect_url=${encodeURIComponent("/sessions/abc?x=1")}`);
    expect(screen.getByTestId("clerk-sign-in")).toBeTruthy();
  });

  it("signed out on the home page goes to plain /sign-in", () => {
    at("/");
    expect(where()).toBe("/sign-in");
  });

  it("pending (signed in, no org chosen) goes to choose-organization and Clerk's task", () => {
    setClerk({ session: "pending" });
    at("/");
    expect(where()).toBe("/choose-organization");
    expect(screen.getByTestId("clerk-task-choose-organization")).toBeTruthy();
  });

  it("signed in with no org and no task shows the organization list, personal accounts hidden", () => {
    setClerk({ session: "active", orgId: null });
    at("/");
    expect(where()).toBe("/choose-organization");
    const list = screen.getByTestId("clerk-organization-list");
    expect(JSON.parse(list.dataset.props ?? "{}")).toMatchObject({ hidePersonal: true, afterSelectOrganizationUrl: "/" });
  });

  it("a member sees the app with the org switcher (no personal accounts) and the account menu", () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect(where()).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sessions");
    expect(JSON.parse(screen.getByTestId("clerk-organization-switcher").dataset.props ?? "{}")).toMatchObject({ hidePersonal: true });
    expect(screen.getByTestId("clerk-user-button")).toBeTruthy();
  });

  it("a member on sign-in or sign-up goes to the app", () => {
    setClerk({ session: "active", orgId: "org_a" });
    const first = at("/sign-in");
    expect(where()).toBe("/");
    first.unmount();
    at("/sign-up");
    expect(where()).toBe("/");
  });

  it("after sign-in, back to the page asked for; never to another site", () => {
    setClerk({ session: "active", orgId: "org_a" });
    const first = at(`/sign-in?redirect_url=${encodeURIComponent("/sessions/abc?x=1")}`);
    expect(where()).toBe("/sessions/abc?x=1");
    first.unmount();
    at(`/sign-in?redirect_url=${encodeURIComponent("https://evil.example/x")}`);
    expect(where()).toBe("/");
  });

  it("signing out on a session's page goes to plain sign-in, without that page to return to", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const view = at("/sessions/abc");
    setClerk({ session: "none" });
    await act(async () => view.rerender(
      <MemoryRouter initialEntries={["/sessions/abc"]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>,
    ));
    expect(where()).toBe("/sign-in");
  });

  it("a member on choose-organization goes to the app", () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/choose-organization");
    expect(where()).toBe("/");
  });

  it("signed out on choose-organization goes to sign-in", () => {
    at("/choose-organization");
    expect(where()).toBe("/sign-in");
  });

  it("an unknown path goes home", () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/nope/nothing");
    expect(where()).toBe("/");
  });

  it("while Clerk loads, a loading state, not a redirect", () => {
    setClerk({ loaded: false });
    at("/sessions/abc");
    expect(where()).toBe("/sessions/abc");
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });

  it("switching org on the list stays on the list", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const view = at("/");
    setClerk({ session: "active", orgId: "org_b" });
    await act(async () => view.rerender(
      <MemoryRouter initialEntries={["/"]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>,
    ));
    expect(where()).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sessions");
  });

  it("the org switcher's label starts with the name it shows (WCAG 2.5.3)", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect(await screen.findByRole("button", { name: "Org A, switch organization" })).toBeTruthy();
  });

  it("switching org on a session's page goes back to the list", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const view = at("/sessions/abc");
    expect(where()).toBe("/sessions/abc");
    setClerk({ session: "active", orgId: "org_b" });
    await act(async () => view.rerender(
      <MemoryRouter initialEntries={["/sessions/abc"]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>,
    ));
    expect(where()).toBe("/");
  });

  it("the member pages have no accessibility violations", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("the Clerk wiring", () => {
  const config = { clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA", apiUrl: "http://localhost:3001" };

  it("uses in-app URLs, the choose-organization task URL, our theme, and no telemetry", () => {
    setClerk({ session: "none" });
    render(<App config={config} />);
    expect(clerk.providerProps).toMatchObject({
      publishableKey: config.clerkPublishableKey,
      signInUrl: "/sign-in", signUpUrl: "/sign-up", afterSignOutUrl: "/sign-in",
      signInFallbackRedirectUrl: "/", signUpFallbackRedirectUrl: "/",
      taskUrls: { "choose-organization": "/choose-organization" },
      telemetry: false,
    });
    expect(typeof clerk.providerProps?.routerPush).toBe("function");
    expect(typeof clerk.providerProps?.routerReplace).toBe("function");
    expect(clerk.providerProps?.localization).toBeTruthy();
    expect((clerk.providerProps?.appearance as { cssLayerName?: string }).cssLayerName).toBe("clerk");
  });

  it("when Clerk's script fails to load, says so and offers a retry", () => {
    setClerk({ failed: true });
    render(<App config={config} />);
    expect(screen.getByRole("heading", { name: "Sign-in isn't available right now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("with no usable settings, the not-configured page, and Clerk never starts", () => {
    clerk.providerProps = null;
    render(<App config={{ clerkPublishableKey: null, apiUrl: null }} />);
    expect(screen.getByRole("heading", { name: "Not set up yet" })).toBeTruthy();
    expect(clerk.providerProps).toBeNull();
  });
});

describe("Clerk's navigation goes through the router", () => {
  it("routerPush and routerReplace change the page without a reload", async () => {
    setClerk({ session: "none" });
    history.replaceState(null, "", "/sign-in");
    render(<App config={{ clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA", apiUrl: "http://localhost:3001" }} />);
    await act(async () => (clerk.providerProps?.routerPush as (to: string) => void)("/sign-up"));
    expect(location.pathname).toBe("/sign-up");
    expect(screen.getByTestId("clerk-sign-up")).toBeTruthy();
    await act(async () => (clerk.providerProps?.routerReplace as (to: string) => void)("/sign-in"));
    expect(location.pathname).toBe("/sign-in");
    history.replaceState(null, "", "/");
  });
});

describe("safeReturnPath", () => {
  it("keeps a path on this site", () => {
    expect(safeReturnPath("/sessions/abc?x=1#y")).toBe("/sessions/abc?x=1#y");
  });
  it("refuses anything that could leave the site", () => {
    for (const bad of [null, "", "sessions", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/ /evil.example", "https://evil.example", "javascript:alert(1)"]) {
      expect(safeReturnPath(bad), String(bad)).toBe("/");
    }
  });
});

describe("readConfig", () => {
  it("takes a publishable key and an api origin", () => {
    expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_abc", VITE_API_URL: "http://localhost:3001/" }))
      .toEqual({ clerkPublishableKey: "pk_test_abc", apiUrl: "http://localhost:3001" });
  });

  it("refuses a secret key, an empty value or an api URL with a path", () => {
    expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: "sk_test_abc", VITE_API_URL: "" })).toEqual({ clerkPublishableKey: null, apiUrl: null });
    expect(readConfig({ VITE_API_URL: "https://api.example.test/v1" }).apiUrl).toBeNull();
  });
});
