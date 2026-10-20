import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { clerk, setClerk } from "./helpers/clerk.tsx";
import { ApiProvider, useOrgQuery } from "../src/api/ApiProvider.tsx";
import { SessionsList } from "../src/sessions/SessionsList.tsx";
import { meetingDisplay } from "../src/sessions/meeting.ts";
import { startedWhen } from "../src/sessions/time.ts";
import { axeViolations } from "./helpers/axe.ts";
import { API, errorBody, fakeApi, session } from "./helpers/fake-api.ts";

const NOW = new Date("2026-10-20T15:00:00");
const iso = (d: string) => new Date(d).toISOString();
const SESSIONS = [
  session({ id: "a", meetingUrl: "https://meet.google.com/kfp-qzwd-nre", status: "in_meeting", createdAt: iso("2026-10-20T14:48:00"), stageUrl: "https://engine.test/stage/a?token=secret-stage-token" }),
  session({ id: "b", meetingUrl: "https://us02web.zoom.us/j/84213377051?pwd=x", status: "joining", createdAt: iso("2026-10-20T14:59:00") }),
  session({ id: "c", meetingUrl: "https://teams.microsoft.com/l/meetup-join/19%3a", status: "start_unknown", createdAt: iso("2026-10-20T14:35:00") }),
  session({ id: "d", meetingUrl: "https://meet.google.com/xtr-mbha-qpo", status: "ended", createdAt: iso("2026-10-19T16:12:00") }),
  session({ id: "e", meetingUrl: "https://meet.google.com/ahn-vexr-kid", status: "paused_for_a_new_reason", createdAt: iso("2026-10-14T10:03:00") }),
];

function ListUnderTest() {
  const list = useOrgQuery((api, signal) => api.listSessions(signal));
  return <SessionsList list={list} now={NOW} />;
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}

function show(api: ReturnType<typeof fakeApi>) {
  return render(
    <ApiProvider baseUrl={API} fetch={api.fetch}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<ListUnderTest />} /><Route path="*" element={null} /></Routes>
        <Where />
      </MemoryRouter>
    </ApiProvider>,
  );
}

const rows = () => screen.queryAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/sessions/"));

afterEach(() => setClerk({}));

describe("the session list", () => {
  it("shows each session's code, status, platform and time, newest first as the api returns them, each linking to its page", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS } } }));
    await screen.findByText("kfp-qzwd-nre");
    expect(rows().map((r) => r.getAttribute("href"))).toEqual(["/sessions/a", "/sessions/b", "/sessions/c", "/sessions/d", "/sessions/e"]);
    // Each row is one link whose name reads in order, with pauses between the parts.
    for (const name of [
      "kfp-qzwd-nre, In the meeting, Google Meet, 12 min ago",
      "842 1337 7051, Joining, Zoom, 1 min ago",
      "Teams meeting, Check the meeting, Teams, 25 min ago",
      "xtr-mbha-qpo, Ended, Google Meet, yesterday at 4:12 PM",
      "ahn-vexr-kid, Unknown, Google Meet, Oct 14 at 10:03 AM",
    ]) expect(screen.getByRole("link", { name })).toBeTruthy();
  });

  it("a status it doesn't know is read as just \"Unknown\"", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS.slice(4) } } }));
    await screen.findByText("ahn-vexr-kid");
    expect(screen.getByRole("link", { name: /^ahn-vexr-kid, Unknown, Google Meet/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /\?/ })).toBeNull();
  });

  it("never shows a stage link: it's a control link (plan WD5)", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const view = show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS } } }));
    await screen.findByText("kfp-qzwd-nre");
    expect(view.container.innerHTML).not.toContain("secret-stage-token");
    expect(view.container.innerHTML).not.toContain("/stage/");
  });

  it("opening a row goes to the session's page", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS } } }));
    await userEvent.click(await screen.findByText("842 1337 7051"));
    expect(screen.getByTestId("where").textContent).toBe("/sessions/b");
  });

  it("shows skeleton rows while loading", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    show(fakeApi({ "GET /v1/sessions": () => new Promise<Response>(() => {}) }));
    expect(await screen.findByRole("list", { name: "Loading sessions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(true);
  });

  it("with no sessions, the empty state with the three steps, and Refresh still there", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: [] } } });
    show(api);
    expect(await screen.findByRole("heading", { name: "Start your first session" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(api.requests).toHaveLength(2);
  });

  it("at the api's 50, says the list shows the most recent", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const many = Array.from({ length: 50 }, (_, i) => session({ id: `s${i}`, createdAt: iso("2026-10-20T10:00:00") }));
    show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: many } } }));
    expect(await screen.findByText("Showing the 50 most recent sessions.")).toBeTruthy();
  });

  it("Refresh reloads, keeping the rows on screen while it does", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let calls = 0;
    let release!: (r: Response) => void;
    const api = fakeApi({
      "GET /v1/sessions": () => {
        calls += 1;
        const body = JSON.stringify({ sessions: calls === 1 ? SESSIONS.slice(0, 1) : SESSIONS.slice(0, 2) });
        return calls === 1 ? Promise.resolve(new Response(body, { status: 200 })) : new Promise<Response>((r) => { release = () => r(new Response(body, { status: 200 })); });
      },
    });
    show(api);
    await screen.findByText("kfp-qzwd-nre");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByText("kfp-qzwd-nre")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeTruthy();
    await act(async () => release(new Response()));
    expect(rows()).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("a failed read says why, in our words; Refresh tries again, and nothing retries by itself", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = fakeApi({ "GET /v1/sessions": { status: 503, body: errorBody("db_unavailable") } });
    show(api);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Sessions aren't available right now.")).toBeTruthy();
    expect(alert.textContent).not.toContain("api says");
    expect(within(alert).queryByRole("button")).toBeNull();
    expect(api.requests).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(api.requests).toHaveLength(2);
  });

  it("a refresh that fails keeps the rows and shows why above them", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let calls = 0;
    show(fakeApi({
      "GET /v1/sessions": async () => (++calls === 1
        ? new Response(JSON.stringify({ sessions: SESSIONS.slice(0, 1) }), { status: 200 })
        : Promise.reject(new TypeError("Failed to fetch"))),
    }));
    await screen.findByText("kfp-qzwd-nre");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/^Couldn't refresh\. Showing the list from \d{1,2}:\d{2}\s?[AP]M\.$/);
    expect(within(alert).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Refresh/ })).toHaveLength(1);
    expect(screen.getByText("kfp-qzwd-nre")).toBeTruthy();
  });

  it("an expired sign-in offers to sign in again, and only when asked", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    clerk.signOut.mockClear();
    show(fakeApi({ "GET /v1/sessions": { status: 401, body: errorBody("unauthenticated") } }));
    const button = await screen.findByRole("button", { name: "Sign in again" });
    expect(clerk.signOut).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" });
  });

  it("no active org links to choosing one", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    show(fakeApi({ "GET /v1/sessions": { status: 403, body: errorBody("no_active_org") } }));
    expect((await screen.findByRole("link", { name: "Choose an organization" })).getAttribute("href")).toBe("/choose-organization");
  });

  it("switching org reloads the list with the new org's token", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const api = fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS.slice(0, 1) } } });
    const view = show(api);
    await screen.findByText("kfp-qzwd-nre");
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<ListUnderTest />} /></Routes><Where /></MemoryRouter>
      </ApiProvider>,
    );
    await act(async () => {});
    expect(api.requests.map((r) => r.headers.Authorization)).toEqual(["Bearer token-org_a", "Bearer token-org_b"]);
  });

  it("has no accessibility violations, with rows and when empty", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const first = show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: SESSIONS } } }));
    await screen.findByText("kfp-qzwd-nre");
    expect(await axeViolations(document.body)).toEqual([]);
    first.unmount();
    show(fakeApi({ "GET /v1/sessions": { status: 200, body: { sessions: [] } } }));
    await screen.findByRole("heading", { name: "Start your first session" });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("meetingDisplay", () => {
  it.each([
    ["https://meet.google.com/kfp-qzwd-nre?authuser=0", "kfp-qzwd-nre", "Google Meet"],
    ["https://zoom.us/j/84213377051?pwd=abc", "842 1337 7051", "Zoom"],
    ["https://us02web.zoom.us/j/123456789", "123 456 789", "Zoom"],
    ["https://zoom.us/my/someone", "Zoom meeting", "Zoom"],
    ["https://teams.microsoft.com/l/meetup-join/19%3ameeting", "Teams meeting", "Teams"],
    ["https://teams.live.com/meet/9876", "Teams meeting", "Teams"],
    ["https://teams.microsoft.com/meet/2984571036921?p=abc", "298 457 103 692 1", "Teams"],
    ["https://zoom.us/j/842133770512", "Zoom meeting", "Zoom"],
    ["https://meet.google.com/lookup/abcdef", "Google Meet", "Google Meet"],
    ["not a url", "not a url", "Meeting"],
  ])("%s", (url, code, platform) => {
    const m = meetingDisplay(url);
    expect([m.code, m.platformLabel]).toEqual([code, platform]);
  });
});

describe("startedWhen", () => {
  it.each([
    ["2026-10-20T14:59:40", "just now"],
    ["2026-10-20T14:48:00", "12 min ago"],
    ["2026-10-20T11:30:00", "3 h ago"],
    ["2026-10-19T16:12:00", "yesterday at 4:12 PM"],
    ["2026-10-15T10:03:00", "Oct 15 at 10:03 AM"],
    ["2026-09-03T09:00:00", "Sep 3 at 9:00 AM"],
    ["2025-12-24T18:30:00", "Dec 24, 2025 at 6:30 PM"],
  ])("%s", (when, text) => {
    expect(startedWhen(iso(when), NOW, "en-US")).toBe(text);
  });

  it("ten minutes ago is \"10 min ago\", even across midnight", () => {
    expect(startedWhen(iso("2026-10-19T23:55:00"), new Date("2026-10-20T00:05:00"), "en-US")).toBe("10 min ago");
  });

  it("a time in the future (a skewed clock) reads \"just now\"", () => {
    expect(startedWhen(iso("2026-10-21T09:00:00"), NOW, "en-US")).toBe("just now");
  });

  it("an unreadable time doesn't break the row", () => {
    expect(startedWhen("nope", NOW)).toBe("at an unknown time");
  });
});
