import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clerk, setClerk } from "./helpers/clerk.tsx";
import { ApiProvider, useOrgQuery } from "../src/api/ApiProvider.tsx";
import { API, fakeApi, session } from "./helpers/fake-api.ts";

// Every render, with the org it was for, so a test can see that no render ever showed another org's rows.
let renders: { org: string | null; out: string }[] = [];

function Codes() {
  const q = useOrgQuery((api, signal) => api.listSessions(signal));
  const out = `${q.status}:${(q.data ?? []).map((s) => s.meetingUrl).join(",")}`;
  renders.push({ org: clerk.state.orgId, out });
  return <><output data-testid="out">{out}</output><button type="button" onClick={q.refresh}>Refresh</button></>;
}

const reply = (url: string) => new Response(JSON.stringify({ sessions: [session({ meetingUrl: url })] }), { status: 200 });

afterEach(() => {
  setClerk({});
  renders = [];
});

describe("useOrgQuery", () => {
  it("switching org aborts the old read and never shows the old org's rows, even if its reply comes late", async () => {
    const answers: Record<string, (r: Response) => void> = {};
    const aborted: string[] = [];
    // Like a server that answers anyway: the abort is recorded, but the reply still arrives later.
    const api = fakeApi({
      "GET /v1/sessions": (req, signal) => new Promise<Response>((resolve) => {
        const org = req.headers.Authorization!.replace("Bearer token-", "");
        answers[org] = resolve;
        signal?.addEventListener("abort", () => aborted.push(org));
      }),
    });

    setClerk({ session: "active", orgId: "org_a" });
    const view = render(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    expect(aborted).toEqual(["org_a"]);
    expect(screen.getByTestId("out").textContent).toBe("loading:");

    // org_a's reply arrives after the switch: it's dropped.
    await act(async () => answers.org_a!(reply("https://meet.google.com/from-a")));
    expect(screen.getByTestId("out").textContent).toBe("loading:");
    await act(async () => answers.org_b!(reply("https://meet.google.com/from-b")));
    expect(screen.getByTestId("out").textContent).toBe("ready:https://meet.google.com/from-b");
    expect(renders.filter((r) => r.org === "org_b" && r.out.includes("from-a"))).toEqual([]);
  });

  it("drops the old org's rows in the very render where the org changes, before any effect runs", async () => {
    const api = fakeApi({
      "GET /v1/sessions": async (req) => (req.headers.Authorization === "Bearer token-org_a"
        ? reply("https://meet.google.com/from-a")
        : new Promise<Response>(() => {})),
    });
    setClerk({ session: "active", orgId: "org_a" });
    const view = render(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    expect(await screen.findByText("ready:https://meet.google.com/from-a")).toBeTruthy();

    renders = [];
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    // The first render for org_b already shows nothing of org_a.
    expect(renders[0]).toEqual({ org: "org_b", out: "loading:" });
    expect(renders.filter((r) => r.out.includes("from-a"))).toEqual([]);
  });

  it("a refresh replaces an older read still running: the older reply, arriving last, doesn't overwrite the newer one", async () => {
    const answers: ((r: Response) => void)[] = [];
    const api = fakeApi({ "GET /v1/sessions": () => new Promise<Response>((resolve) => answers.push(resolve)) });
    setClerk({ session: "active", orgId: "org_a" });
    render(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    await act(async () => screen.getByRole("button", { name: "Refresh" }).click());
    expect(answers).toHaveLength(2);
    await act(async () => answers[1]!(reply("https://meet.google.com/newer")));
    await act(async () => answers[0]!(reply("https://meet.google.com/older")));
    expect(screen.getByTestId("out").textContent).toBe("ready:https://meet.google.com/newer");
  });
});
