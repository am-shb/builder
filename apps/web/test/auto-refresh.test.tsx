// Statuses that move on their own (A2, plan WD6): the list and a session's page refresh quietly every 10 seconds
// while a session may still change, and say why a session ended or failed. The api is a fake fetch.
import { act, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider, useOrgQuery } from "../src/api/ApiProvider.tsx";
import type { SessionView } from "../src/api/schemas.ts";
import { BOT_NAME } from "../src/brand.ts";
import { AUTO_REFRESH_MS, useAutoRefresh } from "../src/hooks/useAutoRefresh.ts";
import { HomePage } from "../src/pages/HomePage.tsx";
import { SessionPage } from "../src/pages/SessionPage.tsx";
import { ENDED_REASONS, FAILED_REASONS, STATUS_EXPLANATIONS, statusExplanation } from "../src/sessions/detail.ts";
import { mayStillChange } from "../src/sessions/start.ts";
import { StartSessionProvider } from "../src/sessions/StartSessionProvider.tsx";
import { API, errorBody, fakeApi, session, type Reply } from "./helpers/fake-api.ts";

const NOW = new Date("2026-10-20T15:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setClerk({});
});
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setVisibility = (v: DocumentVisibilityState) => act(() => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
});

describe("useAutoRefresh", () => {
  // An exact clock here: these check the timer to the millisecond, so time mustn't also move with the real clock.
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers();
  });

  it("calls every 10 seconds while active, and not at all while inactive", async () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(({ active }) => useAutoRefresh(active, refresh), { initialProps: { active: false } });
    await tick(AUTO_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    rerender({ active: true });
    await tick(AUTO_REFRESH_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(AUTO_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender({ active: false });
    await tick(AUTO_REFRESH_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender({ active: true });
    unmount();
    await tick(AUTO_REFRESH_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("asks nothing while the tab is hidden, and asks at once when it's back", async () => {
    const refresh = vi.fn();
    renderHook(() => useAutoRefresh(true, refresh));
    await setVisibility("hidden");
    await tick(AUTO_REFRESH_MS * 5);
    expect(refresh).not.toHaveBeenCalled();
    await setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    await tick(AUTO_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("starting in a hidden tab waits until it's shown", async () => {
    visibility = "hidden";
    const refresh = vi.fn();
    renderHook(() => useAutoRefresh(true, refresh));
    await tick(AUTO_REFRESH_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    await setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("mayStillChange", () => {
  const s = (status: string, ageMinutes: number, maxMinutes = 60) =>
    session({ status, createdAt: minutesAgo(ageMinutes), limits: { maxUsd: 5, maxMinutes } });

  it("starting, joining, in the meeting and unconfirmed starts may change; finished ones don't", () => {
    for (const st of ["starting", "joining", "in_meeting", "start_unknown"]) expect(mayStillChange(s(st, 5), NOW), st).toBe(true);
    for (const st of ["ended", "failed", "start_failed", "something_new"]) expect(mayStillChange(s(st, 5), NOW), st).toBe(false);
  });

  it("only within the time limit plus 30 minutes, so an old session stuck at Joining doesn't keep a page asking", () => {
    expect(mayStillChange(s("joining", 90, 60), NOW)).toBe(true);
    expect(mayStillChange(s("joining", 91, 60), NOW)).toBe(false);
    expect(mayStillChange(s("in_meeting", 40, 10), NOW)).toBe(true);
    expect(mayStillChange(s("in_meeting", 41, 10), NOW)).toBe(false);
  });
});

describe("a quiet refresh", () => {
  function hook(reply: () => Reply | Promise<Reply>) {
    let n = 0;
    const fetch = (async () => {
      n += 1;
      const r = await reply();
      if (r === "network_error") throw new TypeError("Failed to fetch");
      if (typeof r === "function") throw new Error("not used");
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const view = renderHook(() => useOrgQuery((api, signal) => api.listSessions(signal)), {
      wrapper: ({ children }) => <ApiProvider baseUrl={API} fetch={fetch}>{children}</ApiProvider>,
    });
    return { ...view, calls: () => n };
  }

  it("shows no busy state, and its new data replaces the old", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let status = "joining";
    const { result } = hook(() => ({ status: 200, body: { sessions: [session({ status })] } }));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    status = "in_meeting";
    act(() => result.current.quietRefresh());
    expect(result.current.refreshing).toBe(false);
    await vi.waitFor(() => expect(result.current.data?.[0]?.status).toBe("in_meeting"));
    expect(result.current.refreshing).toBe(false);
  });

  it("that fails keeps the data on screen and shows no error", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let fail = false;
    const { result, calls } = hook(() => (fail ? "network_error" : { status: 200, body: { sessions: [session({ status: "joining" })] } }));
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    const loadedAt = result.current.loadedAt;
    fail = true;
    act(() => result.current.quietRefresh());
    await vi.waitFor(() => expect(calls()).toBe(2));
    await tick(0);
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeUndefined();
    expect(result.current.data?.[0]?.status).toBe("joining");
    expect(result.current.loadedAt).toBe(loadedAt);
    // A Refresh the person asks for still shows its failure.
    act(() => result.current.refresh());
    await vi.waitFor(() => expect(result.current.status).toBe("error"));
  });
});

describe("a quiet refresh while the person's Refresh runs", () => {
  it("is skipped, so it can't cancel that Refresh or hide its failure", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let calls = 0;
    let release: (() => void) | null = null;
    const fetch = (async () => {
      calls += 1;
      if (calls === 1) return Response.json({ sessions: [session({ status: "joining" })] });
      // The person's Refresh: slow, then failing.
      await new Promise<void>((r) => { release = r; });
      return Response.json(errorBody("db_unavailable"), { status: 503 });
    }) as typeof globalThis.fetch;
    const { result } = renderHook(() => useOrgQuery((api, signal) => api.listSessions(signal)), {
      wrapper: ({ children }) => <ApiProvider baseUrl={API} fetch={fetch}>{children}</ApiProvider>,
    });
    await vi.waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.refresh());
    await vi.waitFor(() => expect(calls).toBe(2));
    act(() => result.current.quietRefresh());
    await tick(0);
    expect(calls).toBe(2);
    expect(result.current.refreshing).toBe(true);
    act(() => release!());
    await vi.waitFor(() => expect(result.current.status).toBe("error"));
    // Once it's settled, quiet refreshes run again.
    act(() => result.current.quietRefresh());
    await vi.waitFor(() => expect(calls).toBe(3));
  });
});

describe("the list", () => {
  function home(sessions: () => SessionView[]) {
    const api = fakeApi({ "GET /v1/sessions": async () => Response.json({ sessions: sessions() }) });
    render(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={["/"]}>
          <StartSessionProvider>
            <Routes><Route path="/" element={<HomePage now={NOW} />} /></Routes>
          </StartSessionProvider>
        </MemoryRouter>
      </ApiProvider>,
    );
    return { reads: () => api.requests.filter((r) => r.path === "/v1/sessions").length };
  }

  it("while a session may still change, refreshes itself every 10 seconds and shows the new status, without announcing it", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let status = "joining";
    const { reads } = home(() => [session({ id: ID, status, createdAt: minutesAgo(2) })]);
    const row = await screen.findByRole("link", { name: /kfp-qzwd-nre/ });
    expect(within(row).getByText("Joining")).toBeTruthy();
    status = "in_meeting";
    await tick(AUTO_REFRESH_MS);
    expect(reads()).toBe(2);
    expect(within(screen.getByRole("link", { name: /kfp-qzwd-nre/ })).getByText("In the meeting")).toBeTruthy();
    expect(screen.queryByText("Updated.")).toBeNull();
    // Once nothing can change, it stops.
    status = "ended";
    await tick(AUTO_REFRESH_MS);
    expect(reads()).toBe(3);
    await tick(AUTO_REFRESH_MS * 5);
    expect(reads()).toBe(3);
  });

  it("a background refresh that fails leaves the list as it was, with no failure notice", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let down = false;
    const api = fakeApi({
      "GET /v1/sessions": async () => (down
        ? Response.json(errorBody("db_unavailable"), { status: 503 })
        : Response.json({ sessions: [session({ id: ID, status: "joining", createdAt: minutesAgo(2) })] })),
    });
    render(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={["/"]}>
          <StartSessionProvider><Routes><Route path="/" element={<HomePage now={NOW} />} /></Routes></StartSessionProvider>
        </MemoryRouter>
      </ApiProvider>,
    );
    await screen.findByRole("link", { name: /kfp-qzwd-nre/ });
    down = true;
    await tick(AUTO_REFRESH_MS);
    expect(api.requests.filter((r) => r.path === "/v1/sessions").length).toBe(2);
    // The page keeps empty live regions; the failure notice would put "Couldn't refresh." in one.
    expect(screen.queryByText(/Couldn't refresh/)).toBeNull();
    expect(within(screen.getByRole("link", { name: /kfp-qzwd-nre/ })).getByText("Joining")).toBeTruthy();
  });

  it("with only finished sessions, or ones too old to change, asks nothing more", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const { reads } = home(() => [
      session({ id: "a", status: "ended", createdAt: minutesAgo(5) }),
      session({ id: "b", status: "joining", createdAt: minutesAgo(600) }),
    ]);
    await screen.findAllByRole("link", { name: /kfp-qzwd-nre/ });
    await tick(AUTO_REFRESH_MS * 5);
    expect(reads()).toBe(1);
  });
});

describe("a session's page", () => {
  function page(current: () => SessionView) {
    const api = fakeApi({ [`GET /v1/sessions/${ID}`]: async () => Response.json({ session: current() }) });
    render(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={[`/sessions/${ID}`]}>
          <Routes><Route path="/sessions/:id" element={<SessionPage now={NOW} />} /></Routes>
        </MemoryRouter>
      </ApiProvider>,
    );
    return { reads: () => api.requests.filter((r) => r.path === `/v1/sessions/${ID}`).length };
  }

  it("follows the session to its end, with the reason, then stops asking", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let now: Partial<SessionView> = { status: "joining" };
    const { reads } = page(() => session({ id: ID, createdAt: minutesAgo(1), ...now }));
    const status = () => within(screen.getByRole("region", { name: "Status" }));
    expect(await screen.findByText(`${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`)).toBeTruthy();
    now = { status: "in_meeting" };
    await tick(AUTO_REFRESH_MS);
    expect(status().getByText("In the meeting")).toBeTruthy();
    now = { status: "ended", errorCode: "max_minutes" };
    await tick(AUTO_REFRESH_MS);
    expect(status().getByText("Ended")).toBeTruthy();
    expect(screen.getByText(ENDED_REASONS.max_minutes!)).toBeTruthy();
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByText("Reason code")).toBeTruthy();
    expect(details.queryByText("Error code")).toBeNull();
    const before = reads();
    await tick(AUTO_REFRESH_MS * 5);
    expect(reads()).toBe(before);
    expect(screen.queryByText("Updated.")).toBeNull();
  });

  it("a failure shows Recall's reason, and its code as an error code", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(() => session({ id: ID, createdAt: minutesAgo(1), status: "failed", errorCode: "meeting_not_found" }));
    expect(await screen.findByText(FAILED_REASONS.meeting_not_found!)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Details" })).getByText("Error code")).toBeTruthy();
  });

  it("a background refresh that fails leaves the page as it was, with no error", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let down = false;
    const api = fakeApi({
      [`GET /v1/sessions/${ID}`]: async () => (down
        ? Response.json(errorBody("db_unavailable"), { status: 503 })
        : Response.json({ session: session({ id: ID, status: "joining", createdAt: minutesAgo(1) }) })),
    });
    render(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={[`/sessions/${ID}`]}>
          <Routes><Route path="/sessions/:id" element={<SessionPage now={NOW} />} /></Routes>
        </MemoryRouter>
      </ApiProvider>,
    );
    await screen.findByText(`${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`);
    down = true;
    await tick(AUTO_REFRESH_MS);
    expect(api.requests.filter((r) => r.path === `/v1/sessions/${ID}`).length).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/couldn't refresh/i)).toBeNull();
    expect(screen.getByText(`${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`)).toBeTruthy();
  });
});

describe("why a session ended or failed", () => {
  it("each known reason has its line; unknown reasons fall back to the status's own line", () => {
    for (const [code, line] of Object.entries(ENDED_REASONS)) expect(statusExplanation("ended", code)).toBe(line);
    for (const [code, line] of Object.entries(FAILED_REASONS)) expect(statusExplanation("failed", code)).toBe(line);
    expect(statusExplanation("ended", "something_new")).toBe(STATUS_EXPLANATIONS.ended);
    expect(statusExplanation("failed", "bot_failed")).toBe(STATUS_EXPLANATIONS.failed);
    expect(statusExplanation("ended")).toBe(STATUS_EXPLANATIONS.ended);
  });

  it("a code named like a built-in property is just unknown", () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(statusExplanation("ended", code), code).toBe(STATUS_EXPLANATIONS.ended);
      expect(statusExplanation("failed", code), code).toBe(STATUS_EXPLANATIONS.failed);
    }
  });

  it("a reason doesn't change what other statuses say", () => {
    expect(statusExplanation("joining", "max_minutes")).toBe(STATUS_EXPLANATIONS.joining);
    expect(statusExplanation("in_meeting", "meeting_not_found")).toBe(STATUS_EXPLANATIONS.in_meeting);
  });
});
