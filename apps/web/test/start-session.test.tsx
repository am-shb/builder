import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { AppRoutes } from "../src/App.tsx";
import { HomePage } from "../src/pages/HomePage.tsx";
import { BOT_NAME } from "../src/brand.ts";
import { StartForm } from "../src/sessions/StartForm.tsx";
import { StartSessionProvider } from "../src/sessions/StartSessionProvider.tsx";
import { axeViolations } from "./helpers/axe.ts";
import { API, errorBody, fakeApi, session, type Reply } from "./helpers/fake-api.ts";
import { DESKTOP_MOUSE, useScreen } from "./setup.ts";

const NOW = new Date("2026-10-20T15:00:00Z");
const LINK = "https://meet.google.com/kfp-qzwd-nre";
const started = session({ id: "new", meetingUrl: LINK, status: "joining", createdAt: NOW.toISOString() });

// The app's shape: the start lives above the pages (as in RequireOrg), so another page can be visited mid-start.
function tree(api: ReturnType<typeof fakeApi>) {
  return (
    <ApiProvider baseUrl={API} fetch={api.fetch}>
      <MemoryRouter initialEntries={["/"]}>
        <StartSessionProvider>
          <Routes>
            <Route path="/" element={<HomePage now={NOW} />} />
            <Route path="/sessions/:id" element={<main><h1>A session</h1><Link to="/">Back to sessions</Link></main>} />
          </Routes>
        </StartSessionProvider>
      </MemoryRouter>
    </ApiProvider>
  );
}
const page = (api: ReturnType<typeof fakeApi>) => render(tree(api));

// The wide-screen start panel (CSS hides it on phones; jsdom shows it). The sheet's form only exists while it's open.
const panelField = () => screen.getAllByLabelText("Meeting link")[0]! as HTMLInputElement;
const startButton = () => screen.getAllByRole("button", { name: /^(Start session|Starting…)$/ })[0]!;
async function startWith(link = LINK) {
  await userEvent.type(panelField(), link);
  await userEvent.click(startButton());
}
// The outcome as shown above the list.
const shown = () => waitFor(() => screen.getByTestId("start-outcome"));
// What a screen reader is told: the page's hidden live regions (not the field's own alert, not the visible callout).
const liveRegion = (role: "status" | "alert") => screen.getAllByRole(role).find((e) => e.classList.contains("sr-only"))!;
const announced = (role: "status" | "alert") => waitFor(() => {
  const text = liveRegion(role).textContent;
  if (!text) throw new Error(`nothing announced in ${role}`);
  return text;
});
// The field's own error, which is announced where it appears.
const fieldError = () => within(panelField().closest("form")!).getByRole("alert");
const posts = (api: ReturnType<typeof fakeApi>) => api.requests.filter((r) => r.method === "POST");
const lists = (api: ReturnType<typeof fakeApi>) => api.requests.filter((r) => r.method === "GET" && r.path === "/v1/sessions");
const pending = () => {
  let finish!: (reply?: Response) => void;
  const reply = () => new Promise<Response>((r) => {
    finish = (res) => r(res ?? new Response(JSON.stringify({ session: started, reused: false }), { status: 201 }));
  });
  return { reply, finish: (res?: Response) => finish(res) };
};

function apiWith(reply: Reply, sessions = [session({ id: "old", meetingUrl: "https://meet.google.com/xtr-mbha-qpo", status: "ended" })]) {
  return fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions } }, "POST /v1/sessions": reply });
}

afterEach(() => {
  setClerk({});
  vi.useRealTimers();
});

describe("starting a session", () => {
  it("sends the link only, with the token, then says the bot is joining and reloads the list", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith({ status: 201, body: { session: started, reused: false } });
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const outcome = await shown();
    expect(within(outcome).getByText(`${BOT_NAME} is joining the meeting.`)).toBeTruthy();
    expect(within(outcome).getByRole("link", { name: /View session/ }).getAttribute("href")).toBe("/sessions/new");
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]!.body).toEqual({ meetingUrl: LINK });
    expect(posts(api)[0]!.headers.Authorization).toBe("Bearer token-org_a");
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(panelField().value).toBe("");
  });

  it("the outcome is announced once, in a live region; the callout itself isn't one, and focus stays put", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    expect(await announced("status")).toBe(`${BOT_NAME} is joining the meeting. Admit it when it asks to join.`);
    expect(liveRegion("alert").textContent).toBe("");
    const outcome = await shown();
    expect(outcome.closest("[role=status], [role=alert], [aria-live]")).toBeNull();
    expect(document.activeElement).toBe(startButton());
  });

  it("the Dismiss button puts a success away, and nothing is left to announce", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await userEvent.click(within(await shown()).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("start-outcome")).toBeNull();
    expect(liveRegion("status").textContent).toBe("");
  });

  it("after any outcome that isn't about the link itself, the field empties", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 503, body: errorBody("limits_unavailable") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await shown();
    expect(panelField().value).toBe("");
  });

  it("a link that isn't an https URL sends nothing, and the field's error is announced each time", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith({ status: 201, body: { session: started, reused: false } });
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    for (const bad of ["meet.google.com/abc", "http://meet.google.com/abc-defg-hij", "javascript:alert(1)"]) {
      await userEvent.clear(panelField());
      await startWith(bad);
      await waitFor(() => expect(fieldError().textContent).toBe("Use an https Google Meet, Zoom or Teams link."));
      expect(panelField().getAttribute("aria-describedby")).toContain(fieldError().querySelector("p")!.id);
    }
    expect(posts(api)).toHaveLength(0);
  });

  it("the same link error twice in a row is cleared in between, so it's announced again", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith("not a link");
    await waitFor(() => expect(fieldError().textContent).not.toBe(""));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(fieldError().textContent ?? ""));
    observer.observe(fieldError(), { childList: true, subtree: true, characterData: true });
    await userEvent.click(startButton());
    await waitFor(() => expect(seen.at(-1)).toBe("Use an https Google Meet, Zoom or Teams link."));
    observer.disconnect();
    expect(seen).toContain("");
  });

  it("while sending, the field is read-only and the button busy, so a double click sends one request", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const slow = pending();
    const api = apiWith(slow.reply);
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.type(panelField(), LINK);
    await userEvent.dblClick(startButton());
    expect(startButton().textContent).toBe("Starting…");
    expect(startButton().getAttribute("aria-disabled")).toBe("true");
    expect(panelField().readOnly).toBe(true);
    await act(async () => slow.finish());
    expect(posts(api)).toHaveLength(1);
  });

  it("an active session for the meeting is reused: no second bot", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 200, body: { session: { ...started, status: "in_meeting" }, reused: true } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const outcome = await shown();
    expect(outcome.textContent).toContain(`This meeting already has a ${BOT_NAME} session.`);
    expect(outcome.textContent).toContain("Status: In the meeting. No second bot was sent.");
    expect(within(outcome).getByRole("link", { name: /^View session/ })).toBeTruthy();
    expect(panelField().value).toBe("");
  });

  it("the api refusing the link shows under the field, once the request was sent", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith({ status: 400, body: errorBody("invalid_request") });
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith("https://example.com/not-a-meeting");
    await waitFor(() => expect(fieldError().textContent).toBe("Use an https Google Meet, Zoom or Teams link."));
    expect(posts(api)).toHaveLength(1);
    expect(screen.queryByTestId("start-outcome")).toBeNull();
    expect(panelField().value).toBe("https://example.com/not-a-meeting");
  });

  it("typing in the field after a reply about the link puts that reply away", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 400, body: errorBody("invalid_request") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith("https://example.com/not-a-meeting");
    await waitFor(() => expect(fieldError().textContent).not.toBe(""));
    await userEvent.type(panelField(), "x");
    expect(fieldError().textContent).toBe("");
    expect(panelField().getAttribute("aria-invalid")).toBeNull();
  });

  it.each([
    [502, "engine_rejected", "meeting_in_use", `${BOT_NAME} already has a session in this meeting.`],
    [401, "unauthenticated", undefined, "Your sign-in has expired or isn't accepted here."],
    [403, "no_active_org", undefined, "Choose an organization to continue."],
    [502, "engine_rejected", "session_conflict", "Starting meetings isn't working right now (session_conflict)."],
    [503, "engine_unavailable", undefined, "Starting meetings isn't available right now."],
    [503, "limits_unavailable", undefined, "Starting meetings isn't set up on this server yet."],
  ])("%i %s %s: no bot was sent, in our words", async (status, code, engineCode, title) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status, body: errorBody(code, engineCode ? { session: { ...started, status: "start_failed", errorCode: engineCode } } : {}) }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const outcome = await shown();
    expect(outcome.textContent).toContain(title);
    expect(outcome.textContent).not.toContain("api says");
    expect(await announced("alert")).toContain(title);
  });

  it("a sign-in reply offers Sign in again; a missing organization offers to choose one", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const first = page(apiWith({ status: 401, body: errorBody("unauthenticated") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    expect(within(await shown()).getByRole("button", { name: "Sign in again" })).toBeTruthy();
    first.unmount();
    page(apiWith({ status: 403, body: errorBody("no_active_org") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    expect(within(await shown()).getByRole("link", { name: "Choose an organization" }).getAttribute("href")).toBe("/choose-organization");
  });

  it("Recall refusing the link shows under the field, with the link kept to fix", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 502, body: errorBody("engine_rejected", { session: { ...started, status: "start_failed", errorCode: "recall_rejected" } }) }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await waitFor(() => expect(fieldError().textContent).toBe(`${BOT_NAME} couldn't join this meeting. Check the link and that the meeting is open, then try again.`));
    expect(panelField().value).toBe(LINK);
    expect(screen.queryByTestId("start-outcome")).toBeNull();
  });

  it.each([
    ["a 502 from a proxy (not our error body)", { status: 502, raw: "<html>Bad gateway</html>" }],
    ["a 503 from a proxy", { status: 503, raw: "Service Unavailable" }],
  ] as const)("%s may come after a bot was sent: the warning, not a plain error", async (_name, reply) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith(reply));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const outcome = await shown();
    expect(outcome.textContent).toMatch(/before trying again/);
    expect(within(outcome).queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it.each([
    ["504 engine_outcome_unknown", { status: 504, body: errorBody("engine_outcome_unknown", { session: { ...started, status: "start_unknown" } }) }, true],
    ["500 internal_error", { status: 500, body: errorBody("internal_error") }, false],
    ["a network failure", "network_error", false],
    ["an unreadable reply", { status: 201, raw: "<html>" }, false],
    ["an unknown code", { status: 599, body: errorBody("something_new") }, false],
  ] as const)("%s: a bot may exist, so warn, reload the list and offer no retry", async (_name, reply, hasSession) => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith(reply as Reply);
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const outcome = await shown();
    expect(outcome.textContent).toMatch(/before trying again/);
    expect(outcome.textContent).toContain("Nothing is retried on its own.");
    expect(within(outcome).queryByRole("button", { name: /start|try again|retry/i })).toBeNull();
    expect(within(outcome).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(Boolean(within(outcome).queryByRole("link", { name: /^View session/ }))).toBe(hasSession);
    expect(await announced("alert")).toMatch(/before trying again/);
    await waitFor(() => expect(lists(api)).toHaveLength(2));
    expect(posts(api)).toHaveLength(1);
  });

  it("after an unknown outcome, the same meeting asks first even if the list couldn't reload; the field was emptied", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let reads = 0;
    const api = fakeApi({
      "GET /v1/sessions": async () => (++reads === 1
        ? new Response(JSON.stringify({ sessions: [] }), { status: 200 })
        : Promise.reject(new TypeError("Failed to fetch"))),
      "POST /v1/sessions": "network_error",
    });
    page(api);
    await screen.findByRole("heading", { name: "Start your first session" });
    await startWith();
    await shown();
    expect(panelField().value).toBe("");
    // The same meeting, pasted from somewhere else.
    await startWith(`${LINK.replace("kfp-qzwd-nre", "KFP-QZWD-NRE")}/?authuser=0`);
    expect(await screen.findByRole("alertdialog", { name: "Start another session for this link?" })).toBeTruthy();
    expect(posts(api)).toHaveLength(1);
  });

  it("WD8: a recent unconfirmed start for the same meeting asks first; Cancel sends nothing and returns focus; Start anyway sends", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const unconfirmed = session({ id: "u", meetingUrl: LINK, status: "start_unknown", createdAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    const api = apiWith({ status: 201, body: { session: started, reused: false } }, [unconfirmed]);
    page(api);
    await screen.findByText("kfp-qzwd-nre");
    await startWith(`${LINK}#join`);
    const dialog = await screen.findByRole("alertdialog", { name: "Start another session for this link?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(posts(api)).toHaveLength(0);
    expect(document.activeElement).toBe(startButton());
    await userEvent.click(startButton());
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start anyway" }));
    expect(posts(api)).toHaveLength(1);
  });

  it.each([
    ["older than 30 minutes", LINK, 31],
    ["for another meeting", "https://meet.google.com/abc-defg-hij", 10],
  ])("WD8 doesn't ask about an unconfirmed start %s", async (_name, unconfirmedLink, minutesAgo) => {
    setClerk({ session: "active", orgId: "org_a" });
    const other = session({ id: "u", meetingUrl: unconfirmedLink, status: "start_unknown", createdAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString() });
    const api = apiWith({ status: 201, body: { session: started, reused: false } }, [other]);
    page(api);
    await screen.findByText(new URL(unconfirmedLink).pathname.slice(1));
    await startWith();
    await shown();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(api)).toHaveLength(1);
  });

  it("a start isn't aborted by switching org; its result names the org it was for, with no link into it", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const slow = pending();
    const api = apiWith(slow.reply);
    const view = page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(tree(api));
    await act(async () => slow.finish());
    const outcome = await shown();
    expect(outcome.textContent).toContain("This was in Org A.");
    expect(within(outcome).queryByRole("link")).toBeNull();
  });

  it("leaving the list mid-start doesn't lose the outcome: a may-have-sent-a-bot warning is there on return", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const slow = pending();
    const api = apiWith(slow.reply);
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await userEvent.click(screen.getByRole("link", { name: /xtr-mbha-qpo/ }));
    expect(await screen.findByRole("heading", { name: "A session" })).toBeTruthy();
    await act(async () => slow.finish(new Response("<html>Gateway timeout</html>", { status: 504 })));
    await userEvent.click(screen.getByRole("link", { name: "Back to sessions" }));
    const outcome = await shown();
    expect(outcome.textContent).toMatch(/couldn't confirm/);
    expect(panelField().value).toBe("");
    // And the next start for that meeting asks first.
    await startWith();
    expect(await screen.findByRole("alertdialog", { name: "Start another session for this link?" })).toBeTruthy();
    expect(posts(api)).toHaveLength(1);
  });

  it("a link typed in the panel is still there after visiting another page", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.type(panelField(), LINK);
    await userEvent.click(screen.getByRole("link", { name: /xtr-mbha-qpo/ }));
    await userEvent.click(await screen.findByRole("link", { name: "Back to sessions" }));
    await screen.findByText("xtr-mbha-qpo");
    expect(panelField().value).toBe(LINK);
  });

  it("while a start runs, the sheet can't be closed and closing the tab asks first; after it, the tab closes freely", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const slow = pending();
    page(apiWith(slow.reply));
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    await userEvent.type(within(sheet).getByLabelText("Meeting link"), LINK);
    await userEvent.click(within(sheet).getByRole("button", { name: "Start session" }));
    expect((within(sheet).getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "New session" })).toBeTruthy();
    const leaving = new Event("beforeunload", { cancelable: true });
    dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await act(async () => slow.finish());
    expect(screen.queryByRole("dialog")).toBeNull();
    const later = new Event("beforeunload", { cancelable: true });
    dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("on a phone, New session opens the sheet; after a start it closes, focus goes back to New session, then the outcome is announced", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    const newSession = screen.getAllByRole("button", { name: "New session" })[0]!;
    await userEvent.click(newSession);
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    await userEvent.type(within(sheet).getByLabelText("Meeting link"), LINK);
    await userEvent.click(within(sheet).getByRole("button", { name: "Start session" }));
    await shown();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(newSession);
    expect(await announced("status")).toContain(`${BOT_NAME} is joining the meeting.`);
  });

  it("closing the sheet without starting returns focus to New session and keeps the link typed", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    const newSession = screen.getAllByRole("button", { name: "New session" })[0]!;
    await userEvent.click(newSession);
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    await userEvent.type(within(sheet).getByLabelText("Meeting link"), LINK);
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(newSession);
    await userEvent.click(newSession);
    expect((within(await screen.findByRole("dialog")).getByLabelText("Meeting link") as HTMLInputElement).value).toBe(LINK);
  });

  it("with no sessions, the empty state offers New session below 1024px, under a level-3 heading", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }, []));
    expect(await screen.findByRole("heading", { name: "Start your first session", level: 3 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New session" })).toHaveLength(1);
  });

  it("when nothing had focus (Safari doesn't focus a clicked button), closing the confirm puts focus on the Start button", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const unconfirmed = session({ id: "u", meetingUrl: LINK, status: "start_unknown", createdAt: new Date(NOW.getTime() - 60_000).toISOString() });
    page(apiWith({ status: 201, body: { session: started, reused: false } }, [unconfirmed]));
    await screen.findByText("kfp-qzwd-nre");
    await userEvent.type(panelField(), LINK);
    // Submit without focusing anything, as a mouse click in Safari does.
    panelField().blur();
    act(() => { panelField().form!.requestSubmit(); });
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect(["Start session", "New session"]).toContain(document.activeElement?.textContent);
  });

  it("has no accessibility violations: the page with a warning, and the sheet open", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    useScreen(DESKTOP_MOUSE);
    page(apiWith("network_error"));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await shown();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    await screen.findByRole("dialog", { name: "New session" });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("the start in the real app (through RequireOrg)", () => {
  function app(api: ReturnType<typeof fakeApi>) {
    return render(<ApiProvider baseUrl={API} fetch={api.fetch}><MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter></ApiProvider>);
  }

  it("a start keeps running across the app's own pages: its warning is shown and announced on return, and the next start asks", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const slow = pending();
    const api = apiWith(slow.reply);
    app(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await userEvent.click(screen.getByRole("link", { name: /xtr-mbha-qpo/ }));
    expect(await screen.findByRole("heading", { name: "No such session in this organization." })).toBeTruthy();
    await act(async () => slow.finish(new Response("<html>Gateway timeout</html>", { status: 504 })));
    await userEvent.click(screen.getByRole("link", { name: "Back to sessions" }));
    expect((await shown()).textContent).toMatch(/couldn't confirm/);
    expect(await announced("alert")).toMatch(/couldn't confirm/);
    await startWith();
    expect(await screen.findByRole("alertdialog", { name: "Start another session for this link?" })).toBeTruthy();
    expect(posts(api)).toHaveLength(1);
  });
});

describe("announcements", () => {
  it("on a phone, nothing is announced while the sheet is still there (it hides the page from screen readers)", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    const region = liveRegion("status");
    const sheetPresentWhenAnnounced: boolean[] = [];
    const observer = new MutationObserver(() => {
      if (region.textContent) sheetPresentWhenAnnounced.push(screen.queryByRole("dialog") !== null);
    });
    observer.observe(region, { childList: true, subtree: true, characterData: true });
    await userEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    await userEvent.type(within(sheet).getByLabelText("Meeting link"), LINK);
    await userEvent.click(within(sheet).getByRole("button", { name: "Start session" }));
    await announced("status");
    observer.disconnect();
    // jsdom has no exit animation, so the sheet is gone in the same render as the outcome; in a browser it stays for
    // 250 ms, which HomePage waits out (onClosed). The screenshot script checks that in Chrome, with motion on.
    expect(sheetPresentWhenAnnounced).toEqual([false]);
  });

  it("an outcome put away before its announcement went out is never announced", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.type(panelField(), LINK);
    await userEvent.click(startButton());
    await userEvent.click(within(await shown()).getByRole("button", { name: "Dismiss" }));
    await act(async () => frames.splice(0).forEach((cb) => cb(0)));
    raf.mockRestore();
    expect(liveRegion("status").textContent).toBe("");
  });
});

describe("the start form", () => {
  it("after 3 seconds of sending, says it can take a while, in a status region that was already there", () => {
    vi.useFakeTimers();
    const props = { value: LINK, onValueChange: () => {}, onStart: () => {} };
    const view = render(<StartForm {...props} sending={false} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    view.rerender(<StartForm {...props} sending />);
    act(() => vi.advanceTimersByTime(2900));
    expect(region.textContent).toBe("");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).toBe("This can take up to 20 seconds. Keep this page open.");
    view.rerender(<StartForm {...props} sending={false} />);
    expect(region.textContent).toBe("");
  });
});
