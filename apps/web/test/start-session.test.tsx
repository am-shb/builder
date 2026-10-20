import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { HomePage } from "../src/pages/HomePage.tsx";
import { BOT_NAME } from "../src/brand.ts";
import { axeViolations } from "./helpers/axe.ts";
import { API, errorBody, fakeApi, session, type Reply } from "./helpers/fake-api.ts";
import { media } from "./setup.ts";

const NOW = new Date("2026-10-20T15:00:00Z");
const LINK = "https://meet.google.com/kfp-qzwd-nre";
const started = session({ id: "new", meetingUrl: LINK, status: "joining", createdAt: NOW.toISOString() });

function page(api: ReturnType<typeof fakeApi>) {
  return render(
    <ApiProvider baseUrl={API} fetch={api.fetch}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<HomePage now={NOW} />} /><Route path="*" element={null} /></Routes>
      </MemoryRouter>
    </ApiProvider>,
  );
}

// The desktop start panel (the phone sheet's form only exists while the sheet is open).
const panelField = () => screen.getAllByLabelText("Meeting link")[0]!;
const startButton = () => screen.getAllByRole("button", { name: /^(Start session|Starting…)$/ })[0]!;
async function startWith(link = LINK) {
  await userEvent.type(panelField(), link);
  await userEvent.click(startButton());
}
// The page's outcome regions are always there; this waits for the one that has something in it.
async function outcome(role: "status" | "alert") {
  return waitFor(() => {
    const el = screen.getAllByRole(role).find((e) => e.textContent && !e.closest("form"));
    if (!el) throw new Error(`no ${role} with content`);
    return el;
  });
}
const nothingIn = (role: "status" | "alert") => screen.getAllByRole(role).every((e) => !e.textContent || e.closest("form"));
const posts = (api: ReturnType<typeof fakeApi>) => api.requests.filter((r) => r.method === "POST");
const lists = (api: ReturnType<typeof fakeApi>) => api.requests.filter((r) => r.method === "GET" && r.path === "/v1/sessions");

function apiWith(reply: Reply, sessions = [session({ id: "old", meetingUrl: "https://meet.google.com/xtr-mbha-qpo", status: "ended" })]) {
  return fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions } }, "POST /v1/sessions": reply });
}

afterEach(() => setClerk({}));

describe("starting a session", () => {
  it("sends the link only, with the token, then says the bot is joining and reloads the list", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith({ status: 201, body: { session: started, reused: false } });
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const status = await outcome("status");
    expect(within(status).getByText(`${BOT_NAME} is joining the meeting.`)).toBeTruthy();
    expect(within(status).getByRole("link", { name: /View session/ }).getAttribute("href")).toBe("/sessions/new");
    expect(posts(api)).toHaveLength(1);
    expect(posts(api)[0]!.body).toEqual({ meetingUrl: LINK });
    expect(posts(api)[0]!.headers.Authorization).toBe("Bearer token-org_a");
    expect(lists(api)).toHaveLength(2);
    expect((panelField() as HTMLInputElement).value).toBe("");
  });

  it("after any outcome that isn't about the link itself, the field empties", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 503, body: errorBody("limits_unavailable") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await outcome("alert");
    expect((panelField() as HTMLInputElement).value).toBe("");
  });

  it("a link that isn't an https URL sends nothing", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = apiWith({ status: 201, body: { session: started, reused: false } });
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    for (const bad of ["meet.google.com/abc", "http://meet.google.com/abc-defg-hij", "javascript:alert(1)"]) {
      await userEvent.clear(panelField());
      await startWith(bad);
      expect(screen.getAllByText("Use an https Google Meet, Zoom or Teams link.").length).toBeGreaterThan(0);
    }
    expect(posts(api)).toHaveLength(0);
  });

  it("while sending, the field and the button are disabled, so a double click sends one request", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let finish!: () => void;
    const api = apiWith(() => new Promise<Response>((r) => { finish = () => r(new Response(JSON.stringify({ session: started, reused: false }), { status: 201 })); }));
    page(api);
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.type(panelField(), LINK);
    await userEvent.dblClick(startButton());
    expect(startButton().textContent).toBe("Starting…");
    expect((panelField() as HTMLInputElement).readOnly).toBe(true);
    await act(async () => finish());
    expect(posts(api)).toHaveLength(1);
  });

  it("an active session for the meeting is reused: no second bot", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 200, body: { session: { ...started, status: "in_meeting" }, reused: true } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const status = await outcome("status");
    expect(status.textContent).toContain(`This meeting already has a ${BOT_NAME} session.`);
    expect(status.textContent).toContain("Status: In the meeting. No second bot was sent.");
    expect((panelField() as HTMLInputElement).value).toBe("");
  });

  it("the api refusing the link shows under the field", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 400, body: errorBody("invalid_request") }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith("https://example.com/not-a-meeting");
    expect(await screen.findByText("Use an https Google Meet, Zoom or Teams link.")).toBeTruthy();
    expect(nothingIn("alert")).toBe(true);
    expect((panelField() as HTMLInputElement).value).toBe("https://example.com/not-a-meeting");
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
    const alert = await outcome("alert");
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).not.toContain("api says");
  });

  it("Recall refusing the link shows under the field, with the link kept to fix", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 502, body: errorBody("engine_rejected", { session: { ...started, status: "start_failed", errorCode: "recall_rejected" } }) }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    expect(await screen.findByText(`${BOT_NAME} couldn't join this meeting. Check the link and that the meeting is open, then try again.`)).toBeTruthy();
    expect((panelField() as HTMLInputElement).value).toBe(LINK);
    expect(nothingIn("alert")).toBe(true);
  });

  it.each([
    ["a 502 from a proxy (not our error body)", { status: 502, raw: "<html>Bad gateway</html>" }],
    ["a 503 from a proxy", { status: 503, raw: "Service Unavailable" }],
  ] as const)("%s may come after a bot was sent: the warning, not a plain error", async (_name, reply) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith(reply));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const alert = await outcome("alert");
    expect(alert.textContent).toMatch(/before trying again/);
    expect(within(alert).queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("after an unknown outcome, the same link asks first even if the list couldn't reload; the field was emptied", async () => {
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
    const alert = await outcome("alert");
    await waitFor(() => expect(alert.contains(document.activeElement)).toBe(true));
    expect((panelField() as HTMLInputElement).value).toBe("");
    await startWith();
    expect(await screen.findByRole("alertdialog", { name: "Start another session for this link?" })).toBeTruthy();
    expect(posts(api)).toHaveLength(1);
  });

  it("focus moves to the outcome", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    const status = await outcome("status");
    await waitFor(() => expect(status.contains(document.activeElement)).toBe(true));
  });

  it("while a start runs, the sheet can't be closed, and leaving the page asks first", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let finish!: () => void;
    page(apiWith(() => new Promise<Response>((r) => { finish = () => r(new Response(JSON.stringify({ session: started, reused: false }), { status: 201 })); })));
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
    await act(async () => finish());
    expect(screen.queryByRole("dialog")).toBeNull();
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
    const alert = await outcome("alert");
    expect(alert.textContent).toMatch(/before trying again/);
    expect(alert.textContent).toContain("Nothing is retried on its own.");
    expect(within(alert).queryByRole("button", { name: /start|try again|retry/i })).toBeNull();
    expect(within(alert).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(Boolean(within(alert).queryByRole("link", { name: /View the session/ }))).toBe(hasSession);
    expect(lists(api)).toHaveLength(2);
    expect(posts(api)).toHaveLength(1);
  });

  it("WD8: a recent unconfirmed start for the same link asks first; Cancel sends nothing, Start anyway sends", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const unconfirmed = session({ id: "u", meetingUrl: LINK, status: "start_unknown", createdAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    const api = apiWith({ status: 201, body: { session: started, reused: false } }, [unconfirmed]);
    page(api);
    await screen.findByText("kfp-qzwd-nre");
    await startWith();
    const dialog = await screen.findByRole("alertdialog", { name: "Start another session for this link?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(posts(api)).toHaveLength(0);
    await userEvent.click(startButton());
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Start anyway" }));
    expect(posts(api)).toHaveLength(1);
  });

  it("WD8 doesn't ask about an unconfirmed start older than 30 minutes, or for another link", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const old = session({ id: "u", meetingUrl: LINK, status: "start_unknown", createdAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() });
    const api = apiWith({ status: 201, body: { session: started, reused: false } }, [old]);
    page(api);
    await screen.findByText("kfp-qzwd-nre");
    await startWith();
    await outcome("status");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(api)).toHaveLength(1);
  });

  it("a start isn't aborted by switching org; its result names the org it was for, with no link into it", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let finish!: () => void;
    const api = apiWith(() => new Promise<Response>((r) => { finish = () => r(new Response(JSON.stringify({ session: started, reused: false }), { status: 201 })); }));
    const view = page(api);
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<HomePage now={NOW} />} /></Routes></MemoryRouter>
      </ApiProvider>,
    );
    await act(async () => finish());
    const status = await outcome("status");
    expect(status.textContent).toContain("This was in Org A.");
    expect(within(status).queryByRole("link")).toBeNull();
  });

  it("on a phone, New session opens the sheet; after a start it closes and the outcome shows", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }));
    await screen.findByText("xtr-mbha-qpo");
    await userEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    const sheet = await screen.findByRole("dialog", { name: "New session" });
    await userEvent.type(within(sheet).getByLabelText("Meeting link"), LINK);
    await userEvent.click(within(sheet).getByRole("button", { name: "Start session" }));
    expect(await outcome("status")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with no sessions, the empty state offers New session on phones", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(apiWith({ status: 201, body: { session: started, reused: false } }, []));
    await screen.findByRole("heading", { name: "Start your first session" });
    expect(screen.getAllByRole("button", { name: "New session" })).toHaveLength(1);
  });

  it("has no accessibility violations: the page, the sheet and a warning", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    media.matches = true;
    page(apiWith("network_error"));
    await screen.findByText("xtr-mbha-qpo");
    await startWith();
    await outcome("alert");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
