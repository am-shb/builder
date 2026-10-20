import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider } from "../src/api/ApiProvider.tsx";
import { SessionPage } from "../src/pages/SessionPage.tsx";
import { BOT_NAME, PRODUCT_NAME } from "../src/brand.ts";
import { exactTime, limitsText, safeStageUrl, statusExplanation } from "../src/sessions/detail.ts";
import { StageLink } from "../src/sessions/StageLink.tsx";
import { axeViolations } from "./helpers/axe.ts";
import { API, errorBody, fakeApi, session, type Reply } from "./helpers/fake-api.ts";
import { DESKTOP_MOUSE, useScreen } from "./setup.ts";

const NOW = new Date("2026-10-20T15:00:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const STAGE = "https://engine.example.test/stage/11111111?token=stage-secret-token";
const PATH = `GET /v1/sessions/${ID}`;

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname}</output>;
}

function page(reply: Reply) {
  const api = fakeApi({ [PATH]: reply });
  const view = render(
    <ApiProvider baseUrl={API} fetch={api.fetch}>
      <MemoryRouter initialEntries={[`/sessions/${ID}`]}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionPage now={NOW} />} />
          <Route path="/" element={<h1>The list</h1>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ApiProvider>,
  );
  return { api, view };
}
const ok = (over = {}) => ({ status: 200, body: { session: session({ id: ID, createdAt: "2026-10-20T14:48:00.000Z", updatedAt: "2026-10-20T14:50:00.000Z", ...over }) } });
const reads = (api: ReturnType<typeof fakeApi>) => api.requests.filter((r) => r.method === "GET" && r.path === `/v1/sessions/${ID}`);

afterEach(() => {
  setClerk({});
  vi.restoreAllMocks();
});

describe("the session page", () => {
  it("reads the session with the token, and shows the meeting, status, times and limits", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const { api } = page(ok({ status: "joining", limits: { maxUsd: 5, maxMinutes: 60 } }));
    expect(await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" })).toBeTruthy();
    expect(reads(api)[0]!.headers.Authorization).toBe("Bearer token-org_a");
    expect(screen.getByText("Google Meet, started 12 min ago")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Status" })).getByText("Joining")).toBeTruthy();
    expect(screen.getByText(`${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`)).toBeTruthy();
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByText("https://meet.google.com/kfp-qzwd-nre")).toBeTruthy();
    expect(details.getByText(exactTime("2026-10-20T14:48:00.000Z"))).toBeTruthy();
    expect(details.getByText(exactTime("2026-10-20T14:50:00.000Z"))).toBeTruthy();
    expect(details.getByText("$5.00")).toBeTruthy();
    expect(details.getByText("60 minutes")).toBeTruthy();
    expect(details.queryByText("Error code")).toBeNull();
    // Set by an effect after the data arrives, which can run just after the heading shows: wait for it.
    await waitFor(() => expect(document.title).toBe(`kfp-qzwd-nre · ${PRODUCT_NAME}`));
  });

  it("shows the meeting link as text, never as a link", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok());
    await screen.findByRole("heading", { level: 1 });
    expect([...document.querySelectorAll("a")].some((a) => a.href.includes("meet.google.com"))).toBe(false);
  });

  it("a long error code wraps instead of pushing the page sideways", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ status: "start_failed", errorCode: "engine_internal_session_conflict_while_creating_bot" }));
    const code = await screen.findByText("engine_internal_session_conflict_while_creating_bot");
    expect(code.className).toContain("break-all");
    // The explanation names the code too.
    const explanation = screen.getByText(/^Starting meetings isn't working right now \(engine_internal/);
    expect(explanation.className).toContain("wrap-anywhere");
  });

  it.each([
    ["recall_rejected", `${BOT_NAME} couldn't join this meeting. Check the link and that the meeting is open, then try again.`],
    ["meeting_in_use", `${BOT_NAME} already has a session in this meeting. Check the meeting. No second bot was sent.`],
    ["session_conflict", "Starting meetings isn't working right now (session_conflict)."],
  ])("a session that didn't start with %s says why, as the start's reply did", async (errorCode, text) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ status: "start_failed", errorCode }));
    const region = await screen.findByRole("region", { name: "Status" });
    expect(region.textContent).toBe(`Didn't start${text}`);
    expect(statusExplanation("start_failed", errorCode)).toBe(text);
  });

  it("shows an error code for support", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ status: "start_failed", errorCode: "recall_rejected" }));
    await screen.findByRole("heading", { level: 1 });
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByText("recall_rejected").tagName).toBe("CODE");
    // Why it didn't start, from the code, worded as the start's reply worded it.
    expect(screen.getByText(`${BOT_NAME} couldn't join this meeting. Check the link and that the meeting is open, then try again.`)).toBeTruthy();
  });

  it.each([
    ["starting", "Starting", `We're asking ${BOT_NAME} to join.`],
    ["joining", "Joining", `${BOT_NAME} is joining the meeting. Admit it if the meeting asks.`],
    ["in_meeting", "In the meeting", `${BOT_NAME} is in the meeting.`],
    ["ended", "Ended", null],
    ["failed", "Failed", `${BOT_NAME} left the meeting because of an error.`],
    ["start_failed", "Didn't start", "The meeting service refused. Check the link and try again."],
    ["start_unknown", "Check the meeting", `We couldn't confirm whether ${BOT_NAME} joined. Check the meeting before starting again.`],
    ["paused", "Unknown", "This page doesn't know this status yet. Refresh later."],
    ["constructor", "Unknown", "This page doesn't know this status yet. Refresh later."],
  ])("status %s reads as %s, with the plan's explanation", async (status, label, explanation) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ status }));
    const region = await screen.findByRole("region", { name: "Status" });
    expect(region.textContent).toBe(`${label === "Unknown" ? "?" : ""}${label}${explanation ?? ""}`);
  });

  it("Refresh reads again and keeps the page on screen; a failed refresh says so quietly", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    const { api } = page(async () => (++n === 1
      ? new Response(JSON.stringify(ok({ status: "joining" }).body), { status: 200 })
      : new Response(JSON.stringify(errorBody("db_unavailable")), { status: 503 })));
    await screen.findByText("Joining");
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/^Couldn't refresh\. Showing the details from /);
    expect(screen.getByRole("heading", { level: 1, name: "kfp-qzwd-nre" })).toBeTruthy();
    expect(reads(api)).toHaveLength(2);
  });

  it("Refresh shows a new status", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    page(async () => new Response(JSON.stringify(ok({ status: ++n === 1 ? "joining" : "in_meeting" }).body), { status: 200 }));
    await screen.findByText("Joining");
    // Nothing said before the person asks.
    expect(screen.queryByText("Updated.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("In the meeting")).toBeTruthy();
    // A screen reader hears that it worked, in a polite live region.
    expect((await screen.findByText("Updated.")).closest("[role=status]")).not.toBeNull();
  });

  it("a failed Refresh says \"Couldn't refresh\", never \"Updated.\"", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    page(async () => (++n === 1
      ? new Response(JSON.stringify(ok().body), { status: 200 })
      : new Response(JSON.stringify(errorBody("db_unavailable")), { status: 503 })));
    await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" });
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Updated.")).toBeNull();
  });

  it("while loading: a labelled loading state, then the page", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let finish: (() => void) | undefined;
    page(() => new Promise<Response>((r) => { finish = () => r(new Response(JSON.stringify(ok().body), { status: 200 })); }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    // Not just a label: words a screen reader reads out.
    expect(screen.getByRole("status", { name: "Loading session" }).textContent).toBe("Loading the session…");
    expect(screen.getByRole("heading", { level: 1, name: "Session" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sessions" }).getAttribute("href")).toBe("/");
    await act(async () => finish!());
    expect(await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading session" })).toBeNull();
  });

  it("404: no such session in this organization, with the way back", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page({ status: 404, body: errorBody("not_found") });
    expect(await screen.findByRole("heading", { level: 1, name: "No such session in this organization" })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Back to sessions" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it.each([
    [{ status: 503, body: errorBody("db_unavailable") } as Reply, "Sessions aren't available right now.", true],
    ["network_error" as Reply, `Can't reach ${PRODUCT_NAME}. Check your connection.`, true],
    [{ status: 401, body: errorBody("unauthenticated") } as Reply, "Your sign-in has expired or isn't accepted here.", false],
    [{ status: 200, body: { nope: true } } as Reply, "Something went wrong (bad_response).", true],
  ])("an error reading it is shown in our words: %o", async (reply, title, tryAgain) => {
    setClerk({ session: "active", orgId: "org_a" });
    page(reply);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).not.toContain("api says");
    expect(Boolean(within(alert).queryByRole("button", { name: "Try again" }))).toBe(tryAgain);
    expect(screen.getByRole("link", { name: "Back to sessions" })).toBeTruthy();
  });

  it("Try again after an error reads again", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    page(async () => (++n === 1
      ? new Response(JSON.stringify(errorBody("internal_error")), { status: 500 })
      : new Response(JSON.stringify(ok().body), { status: 200 })));
    await userEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "kfp-qzwd-nre" })).toBeTruthy();
  });

  it("going to another session's page reads that session and never shows the previous one", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const other = "22222222-2222-4222-8222-222222222222";
    let finish: (() => void) | undefined;
    const api = fakeApi({
      [PATH]: ok({ stageUrl: STAGE }),
      [`GET /v1/sessions/${other}`]: () => new Promise<Response>((r) => {
        finish = () => r(new Response(JSON.stringify({ session: session({ id: other, meetingUrl: "https://meet.google.com/abc-defg-hij", status: "ended" }) }), { status: 200 }));
      }),
    });
    function Go() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(`/sessions/${other}`)}>Next session</button>;
    }
    render(
      <ApiProvider baseUrl={API} fetch={api.fetch}>
        <MemoryRouter initialEntries={[`/sessions/${ID}`]}>
          <Routes><Route path="/sessions/:id" element={<><SessionPage now={NOW} /><Go /></>} /></Routes>
        </MemoryRouter>
      </ApiProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    expect(screen.getByText(STAGE)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next session" }));
    expect(screen.getByRole("status", { name: "Loading session" })).toBeTruthy();
    expect(screen.queryByText("kfp-qzwd-nre")).toBeNull();
    expect(document.body.innerHTML).not.toContain("stage-secret-token");
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => finish!());
    expect(await screen.findByRole("heading", { level: 1, name: "abc-defg-hij" })).toBeTruthy();
    expect(api.requests.map((r) => r.path).filter((p) => p.startsWith("/v1/sessions/"))).toEqual([`/v1/sessions/${ID}`, `/v1/sessions/${other}`]);
  });

  it("a second failed refresh shows (and announces) the failure again", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    let fail: (() => void) | undefined;
    page(async () => {
      if (++n === 1) return new Response(JSON.stringify(ok().body), { status: 200 });
      return new Promise<Response>((r) => { fail = () => r(new Response(JSON.stringify(errorBody("db_unavailable")), { status: 503 })); });
    });
    await screen.findByRole("heading", { level: 1 });
    for (const round of [1, 2]) {
      fail = undefined;
      await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
      expect(screen.queryByRole("alert"), `round ${round}: gone while retrying`).toBeNull();
      await waitFor(() => expect(fail).toBeTypeOf("function"));
      await act(async () => fail!());
      expect(await screen.findByRole("alert")).toBeTruthy();
    }
  });

  it("a refresh that finds the session gone shows the 404 page, not the old details or stage link", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    let n = 0;
    page(async () => (++n === 1
      ? new Response(JSON.stringify(ok({ stageUrl: STAGE }).body), { status: 200 })
      : new Response(JSON.stringify(errorBody("not_found")), { status: 404 })));
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "No such session in this organization" })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("stage-secret-token");
    expect(screen.queryByText("kfp-qzwd-nre")).toBeNull();
  });

  it("has no accessibility violations: loaded with the stage link shown, and the 404", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    useScreen(DESKTOP_MOUSE);
    const first = page(ok({ stageUrl: STAGE, errorCode: "x_code" }));
    await screen.findByRole("heading", { level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Show stage link" }));
    expect(await axeViolations(document.body)).toEqual([]);
    first.view.unmount();
    page({ status: 404, body: errorBody("not_found") });
    await screen.findByRole("heading", { name: "No such session in this organization" });
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("the stage link", () => {
  it("is hidden until asked for: not in the page at all, with the warning beside the button", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ stageUrl: STAGE }));
    const show = await screen.findByRole("button", { name: "Show stage link" });
    expect(document.body.innerHTML).not.toContain("stage-secret-token");
    expect(show.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(show.getAttribute("aria-describedby")!)!.textContent).toBe(
      `This link controls the stage shown in the meeting. Anyone with it can change what's on screen and interrupt ${BOT_NAME}'s voice. `
      + "Don't share it, and don't open it while the meeting is running unless you mean to. Opening it also saves it in this browser's history.",
    );
    await userEvent.click(show);
    expect(screen.getByText(STAGE)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Copy" }));
  });

  it("opens in a new tab with no opener and no referrer", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ stageUrl: STAGE }));
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    const open = screen.getByRole("link", { name: /Open stage/ });
    expect(open.getAttribute("href")).toBe(STAGE);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(open.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("Copy puts it on the clipboard and says so; Hide takes it off the page and focus goes back to Show", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    page(ok({ stageUrl: STAGE }));
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(STAGE);
    expect(await screen.findByText("Copied.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(document.body.innerHTML).not.toContain("stage-secret-token");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show stage link" }));
  });

  it("a second Copy is announced again; Hide and Show again drop the old \"Copied.\"", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
    page(ok({ stageUrl: STAGE }));
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    const first = await screen.findByText("Copied.");
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText("Copied.")).not.toBe(first));
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    await userEvent.click(screen.getByRole("button", { name: "Show stage link" }));
    expect(screen.queryByText("Copied.")).toBeNull();
  });

  it("when copying fails, says so and selects the link to copy by hand", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
    page(ok({ stageUrl: STAGE }));
    await userEvent.click(await screen.findByRole("button", { name: "Show stage link" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Couldn't copy. The link is selected; copy it yourself.")).toBeTruthy();
    expect(getSelection()?.toString()).toBe(STAGE);
  });

  it("a session with no stage link says so", async () => {
    setClerk({ session: "active", orgId: "org_a" });
    page(ok({ status: "start_failed" }));
    expect(await screen.findByText("There's no stage link for this session.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show stage link" })).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "not a url"])("never renders %s as a link", (bad) => {
    render(<StageLink stageUrl={bad} dev />);
    expect(screen.getByText("This session's stage link can't be shown here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show stage link" })).toBeNull();
    expect(document.querySelector("a")).toBeNull();
  });

  it("plain http is a link only on the local dev server (the local engine)", async () => {
    const local = "http://localhost:3000/stage/abc?token=t";
    const prod = render(<StageLink stageUrl={local} dev={false} />);
    expect(screen.getByText("This session's stage link can't be shown here.")).toBeTruthy();
    prod.unmount();
    render(<StageLink stageUrl={local} dev />);
    await userEvent.click(screen.getByRole("button", { name: "Show stage link" }));
    expect(screen.getByRole("link", { name: /Open stage/ }).getAttribute("href")).toBe(local);
  });
});

describe("the page's words", () => {
  it("safeStageUrl keeps https (and http in dev) only", () => {
    expect(safeStageUrl(STAGE)).toBe(STAGE);
    expect(safeStageUrl("http://localhost:3000/stage/x")).toBeNull();
    expect(safeStageUrl("http://localhost:3000/stage/x", { dev: true })).toBe("http://localhost:3000/stage/x");
    for (const bad of [undefined, "", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:x", "ftp://x.test/a", "//evil.test/x"]) {
      expect(safeStageUrl(bad, { dev: true }), String(bad)).toBeNull();
    }
  });

  it("limits read as money and minutes", () => {
    expect(limitsText({ maxUsd: 5, maxMinutes: 60 }, "en-US")).toEqual({ spend: "$5.00", time: "60 minutes" });
    expect(limitsText({ maxUsd: 0.5, maxMinutes: 1 }, "en-US")).toEqual({ spend: "$0.50", time: "1 minute" });
    expect(limitsText({ maxUsd: 12.345, maxMinutes: 90.5 }, "en-US")).toEqual({ spend: "$12.35", time: "90.5 minutes" });
  });

  it("exact times carry their time zone", () => {
    expect(exactTime("2026-10-20T14:48:00.000Z", "en-US")).toMatch(/^Oct 20, 2026, \d{1,2}:48 [AP]M (?:[A-Z]{2,5}|GMT[+-]\d{1,2}(?::\d{2})?)$/);
    expect(exactTime("2026-10-20T14:48:00.000Z", "en-US")).toBe(new Date("2026-10-20T14:48:00.000Z").toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }));
  });

  it("a broken time reads as Unknown", () => {
    expect(exactTime("not a time")).toBe("Unknown");
  });
});
