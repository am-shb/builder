import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRODUCT_NAME } from "../src/brand.ts";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clerk, setClerk } from "./helpers/clerk.tsx";
import { App, AppRoutes } from "../src/App.tsx";
import { readConfig } from "../src/config.ts";
import { buildCsp, clerkFrontendApiHost } from "../build/csp.ts";
import { safeReturnPath } from "../src/auth/guards.tsx";
import { axeViolations } from "./helpers/axe.ts";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { API, errorBody, fakeApi, session } from "./helpers/fake-api.ts";

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

let api = fakeApi();
function at(path: string) {
  return render(
    <ApiProvider baseUrl={API} fetch={api.fetch}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  );
}
const where = () => screen.getByTestId("where").textContent;

afterEach(() => {
  setClerk({});
  api = fakeApi();
});

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
      <ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={["/sessions/abc"]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter></ApiProvider>,
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
    expect(screen.getByRole("status", { name: "Loading" }).textContent).toBe("Loading…");
  });

  it("switching org on the list stays on the list", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const view = at("/");
    setClerk({ session: "active", orgId: "org_b" });
    await act(async () => view.rerender(
      <ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={["/"]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter></ApiProvider>,
    ));
    expect(where()).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sessions");
  });

  it("the header shows the member's role from GET /v1/me", async () => {
    api = fakeApi({ "GET /v1/me": { status: 200, body: { userId: "user_1", orgId: "org_a", role: "org:admin" } } });
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect((await screen.findByText("Admin")).textContent).toBe("Your role: Admin");
    expect(api.requests[0]!.headers.Authorization).toBe("Bearer token-org_a");
  });

  it("if GET /v1/me fails, the header shows no role and nothing breaks", async () => {
    api = fakeApi({ "GET /v1/me": "network_error" });
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    await act(async () => {});
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sessions");
  });

  it("the org switcher's label starts with the name it shows (WCAG 2.5.3)", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect(await screen.findByRole("button", { name: "Org A, switch organization" })).toBeTruthy();
  });

  describe("switching org on a session's page", () => {
    const ID = "11111111-1111-4111-8111-111111111111";
    // The session is in org_a only; any other org gets 404, as from the api.
    const inOrgA = () => fakeApi({
      [`GET /v1/sessions/${ID}`]: async (req) => (req.headers.Authorization === "Bearer token-org_a"
        ? new Response(JSON.stringify({ session: session({ id: ID }) }), { status: 200 })
        : new Response(JSON.stringify(errorBody("not_found")), { status: 404 })),
    });
    const switchTo = async (view: ReturnType<typeof at>, orgId: string) => {
      setClerk({ session: "active", orgId });
      await act(async () => view.rerender(
        <ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={[`/sessions/${ID}`]}><AppRoutes /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter></ApiProvider>,
      ));
    };

    it("goes back to the list when it was showing a session", async () => {
      api = inOrgA();
      setClerk({ session: "active", orgId: "org_a" });
      const view = at(`/sessions/${ID}`);
      await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" });
      await switchTo(view, "org_b");
      expect(where()).toBe("/");
    });

    it("stays while it was still loading: nothing of the old org was shown", async () => {
      api = fakeApi({ [`GET /v1/sessions/${ID}`]: () => new Promise<Response>(() => {}) });
      setClerk({ session: "active", orgId: "org_a" });
      const view = at(`/sessions/${ID}`);
      expect(screen.getByRole("heading", { level: 1, name: "Session" })).toBeTruthy();
      await switchTo(view, "org_b");
      expect(where()).toBe(`/sessions/${ID}`);
    });

    it("stays and looks again in the new org when it was showing \"No such session\", as its message says", async () => {
      api = inOrgA();
      setClerk({ session: "active", orgId: "org_b" });
      const view = at(`/sessions/${ID}`);
      await screen.findByRole("heading", { level: 1, name: "No such session in this organization" });
      expect(screen.getByText("It may be in another organization. Switch organization to look there.")).toBeTruthy();
      await switchTo(view, "org_a");
      expect(await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" })).toBeTruthy();
      expect(where()).toBe(`/sessions/${ID}`);
      expect(api.requests.filter((r) => r.path === `/v1/sessions/${ID}`).map((r) => r.headers.Authorization))
        .toEqual(["Bearer token-org_b", "Bearer token-org_a"]);
    });
  });

  it("the header's mark goes home through the router, without reloading the page", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/sessions/abc");
    const home = screen.getByRole("link", { name: PRODUCT_NAME });
    expect(home.getAttribute("href")).toBe("/");
    await userEvent.click(home);
    expect(where()).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sessions");
  });

  it("each page names itself in the tab", () => {
    setClerk({ session: "active", orgId: "org_a" });
    const home = at("/");
    expect(document.title).toBe(`Sessions · ${PRODUCT_NAME}`);
    home.unmount();
    setClerk({ session: "none" });
    const signIn = at("/sign-in");
    expect(document.title).toBe(`Sign in · ${PRODUCT_NAME}`);
    signIn.unmount();
    setClerk({ session: "pending" });
    at("/");
    expect(document.title).toBe(`Choose an organization · ${PRODUCT_NAME}`);
  });

  it("the member pages have no accessibility violations", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    at("/");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("the Clerk wiring", () => {
  const config = { clerkPublishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA", apiUrl: "http://localhost:3001" };

  it("uses in-app URLs, redirects to this origin only, the choose-organization task URL, our theme, and no telemetry", () => {
    setClerk({ session: "none" });
    render(<App config={config} />);
    expect(clerk.providerProps).toMatchObject({
      publishableKey: config.clerkPublishableKey,
      signInUrl: "/sign-in", signUpUrl: "/sign-up", afterSignOutUrl: "/sign-in",
      signInFallbackRedirectUrl: "/", signUpFallbackRedirectUrl: "/",
      taskUrls: { "choose-organization": "/choose-organization" },
      telemetry: false,
    });
    expect(clerk.providerProps?.allowedRedirectOrigins).toEqual([window.location.origin]);
    expect(typeof clerk.providerProps?.routerPush).toBe("function");
    expect(typeof clerk.providerProps?.routerReplace).toBe("function");
    expect(clerk.providerProps?.localization).toBeTruthy();
    expect((clerk.providerProps?.appearance as { cssLayerName?: string }).cssLayerName).toBe("clerk");
    // A long org name is cut short in the header, so the account button stays on a narrow phone.
    const elements = (clerk.providerProps?.appearance as { elements: Record<string, string> }).elements;
    expect(elements.organizationPreviewMainIdentifier).toMatch(/\btruncate\b/);
    expect(elements.organizationPreviewMainIdentifier).toMatch(/\bmax-w-/);
    expect(elements.organizationSwitcherTrigger).toMatch(/\bmin-w-0\b/);
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
  const pk = `pk_test_${btoa("clerk.example.test$")}`;

  it("takes a publishable key and an api origin", () => {
    expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: pk, VITE_API_URL: "http://localhost:3001/" }))
      .toEqual({ clerkPublishableKey: pk, apiUrl: "http://localhost:3001" });
  });

  it("refuses a secret key, a key that doesn't decode to a host, an empty value or an api URL with a path", () => {
    expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: "sk_test_abc", VITE_API_URL: "" })).toEqual({ clerkPublishableKey: null, apiUrl: null });
    expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_abc" }).clerkPublishableKey).toBeNull();
    expect(readConfig({ VITE_API_URL: "https://api.example.test/v1" }).apiUrl).toBeNull();
  });

  it("refuses plain http to another computer in a production build, but not to this one", () => {
    expect(readConfig({ VITE_API_URL: "http://api.example.test", PROD: true }).apiUrl).toBeNull();
    expect(readConfig({ VITE_API_URL: "http://api.example.test", PROD: false }).apiUrl).toBe("http://api.example.test");
    expect(readConfig({ VITE_API_URL: "http://localhost:3001", PROD: true }).apiUrl).toBe("http://localhost:3001");
    expect(readConfig({ VITE_API_URL: "https://api.example.test", PROD: true }).apiUrl).toBe("https://api.example.test");
  });

  it("accepts exactly the values the build's security policy allows", () => {
    const keys = [pk, "pk_test_abc", `pk_live_${btoa("clerk.example.test")}`, "sk_live_x", ""];
    const apis = ["https://api.example.test", "https://API.example.test", "https://api.example.test:443", "https://user:pw@api.example.test",
      "https://api.example.test/v1", "http://api.example.test", "http://localhost:3001", "not a url", ""];
    for (const production of [false, true]) {
      for (const k of keys) {
        const host = clerkFrontendApiHost(k);
        const csp = buildCsp({ publishableKey: k, production });
        expect(readConfig({ VITE_CLERK_PUBLISHABLE_KEY: k, PROD: production }).clerkPublishableKey !== null, k).toBe(host !== null);
        if (host) expect(csp).toContain(`https://${host}`);
      }
      for (const a of apis) {
        const api = readConfig({ VITE_API_URL: a, PROD: production }).apiUrl;
        const connect = buildCsp({ apiUrl: a, production }).split("; ").find((d) => d.startsWith("connect-src ")) ?? "";
        expect(api === null ? connect === "connect-src 'self' https://*.protect.clerk.com:*" : connect.includes(` ${api}`), `${a} ${production}`).toBe(true);
      }
    }
  });
});
