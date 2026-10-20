import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setClerk } from "./helpers/clerk.tsx";
import { ApiProvider, useOrgQuery } from "../src/api/ApiProvider.tsx";
import { API, fakeApi, session } from "./helpers/fake-api.ts";

function Codes() {
  const q = useOrgQuery((api, signal) => api.listSessions(signal));
  return <output data-testid="out">{q.status}:{(q.data ?? []).map((s) => s.meetingUrl).join(",")}</output>;
}

afterEach(() => setClerk({}));

describe("useOrgQuery", () => {
  it("switching org aborts the old read and never shows the old org's rows, even if its reply comes late", async () => {
    const answers: Record<string, (r: Response) => void> = {};
    const aborted: string[] = [];
    const api = fakeApi({
      "GET /v1/sessions": (req, signal) => new Promise<Response>((resolve, reject) => {
        const org = req.headers.Authorization!.replace("Bearer token-", "");
        answers[org] = resolve;
        signal?.addEventListener("abort", () => { aborted.push(org); reject(new DOMException("aborted", "AbortError")); });
      }),
    });
    const reply = (url: string) => new Response(JSON.stringify({ sessions: [session({ meetingUrl: url })] }), { status: 200 });

    setClerk({ session: "active", orgId: "org_a" });
    const view = render(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    setClerk({ session: "active", orgId: "org_b" });
    view.rerender(<ApiProvider baseUrl={API} fetch={api.fetch}><Codes /></ApiProvider>);
    await act(async () => {});
    expect(aborted).toEqual(["org_a"]);
    expect(screen.getByTestId("out").textContent).toBe("loading:");

    await act(async () => answers.org_a?.(reply("https://meet.google.com/from-a")));
    expect(screen.getByTestId("out").textContent).toBe("loading:");
    await act(async () => answers.org_b!(reply("https://meet.google.com/from-b")));
    expect(screen.getByTestId("out").textContent).toBe("ready:https://meet.google.com/from-b");
  });
});
