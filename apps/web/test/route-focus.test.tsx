import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { AppRoutes } from "../src/App.tsx";
import { API, fakeApi, session } from "./helpers/fake-api.ts";

const ID = "11111111-1111-4111-8111-111111111111";
let answer: ((r: Response) => void) | undefined;
let scrollTo: ReturnType<typeof vi.spyOn>;

function app({ strict = false } = {}) {
  const api = fakeApi({
    "GET /v1/sessions": { status: 200, body: { sessions: [session({ id: ID })] } },
    [`GET /v1/sessions/${ID}`]: () => new Promise<Response>((resolve) => { answer = resolve; }),
  });
  const tree = <ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter></ApiProvider>;
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}
const loaded = () => act(async () => answer!(new Response(JSON.stringify({ session: session({ id: ID }) }), { status: 200 })));

beforeEach(() => {
  setClerk({ session: "active", orgId: "org_a" });
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => setClerk({}));

describe("moving to another page", () => {
  it("the first page load is left to the browser: no scroll, no focus moved, even with effects run twice (StrictMode)", async () => {
    app({ strict: true });
    await screen.findByText("kfp-qzwd-nre");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("starts at the top, with focus on the new page's heading, and follows it when the page has loaded", async () => {
    app();
    await userEvent.click(await screen.findByRole("link", { name: /^kfp-qzwd-nre/ }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    // While loading: the page's heading, "Session".
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Session" }));
    await loaded();
    // Loaded: the heading is the meeting code, and focus moved to it.
    const heading = screen.getByRole("heading", { level: 1, name: "kfp-qzwd-nre" });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");

    // And back to the list: its heading.
    scrollTo.mockClear();
    await userEvent.click(screen.getByRole("link", { name: "Back to sessions" }));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Sessions" }));
  });

  it("once the person moves focus themselves, the page loading doesn't take it back", async () => {
    app();
    await userEvent.click(await screen.findByRole("link", { name: /^kfp-qzwd-nre/ }));
    const back = screen.getByRole("link", { name: "Back to sessions" });
    act(() => back.focus());
    await loaded();
    expect(document.activeElement).toBe(back);
  });

  it("after a key press, the page loading doesn't take focus back", async () => {
    app();
    await userEvent.click(await screen.findByRole("link", { name: /^kfp-qzwd-nre/ }));
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    act(() => (document.activeElement as HTMLElement).blur());
    await loaded();
    expect(document.activeElement).toBe(document.body);
  });

  it("focus moved with no key or click (a screen reader can) counts too, even if it then falls to the page", async () => {
    app();
    await userEvent.click(await screen.findByRole("link", { name: /^kfp-qzwd-nre/ }));
    const back = screen.getByRole("link", { name: "Back to sessions" });
    act(() => back.focus());
    act(() => back.blur());
    await loaded();
    expect(document.activeElement).toBe(document.body);
  });

  it("a redirect that's part of the first load isn't a move (an unknown address goes to the list)", async () => {
    const api = fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: [] } } });
    render(<ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={["/nope"]}><AppRoutes /></MemoryRouter></ApiProvider>);
    await screen.findByRole("heading", { level: 1, name: "Sessions" });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("after a click or a key, the page loading doesn't take focus back, even when focus fell to the page", async () => {
    app();
    await userEvent.click(await screen.findByRole("link", { name: /^kfp-qzwd-nre/ }));
    // A click on text: focus leaves the heading for the page itself, with no focusin.
    fireEvent.pointerDown(document.body);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    await loaded();
    expect(document.activeElement).toBe(document.body);
  });

  it("steps inside Clerk's sign-in aren't moves: Clerk focuses its own fields", async () => {
    setClerk({ session: "none" });
    let go: ((to: string) => void) | undefined;
    function Nav() {
      const navigate = useNavigate();
      go = (to) => navigate(to);
      return null;
    }
    render(<MemoryRouter initialEntries={["/sign-in"]}><AppRoutes /><Nav /></MemoryRouter>);
    const field = document.createElement("input");
    document.body.append(field);
    act(() => field.focus());
    await act(async () => go!("/sign-in/factor-one"));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
    // Leaving the flow is a move.
    await act(async () => go!("/sign-up"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    field.remove();
  });
});
