// A stand-in for the engine's POST /internal/sessions (ADR 0008), built from the @builder/contracts schemas:
// it parses what it gets with StartSessionRequest and builds its replies with StartSessionResponse. So a contract
// change that the api's client doesn't follow fails the api's tests. It never talks to Recall or a model.
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StartSessionRequest, StartSessionResponse } from "@builder/contracts";
import type { SessionStatus } from "@builder/contracts";

export const FAKE_ENGINE_TOKEN = "fake-engine-token-0123456789abcdef";

/** How the fake answers the next start request. */
export type Behavior =
  | { kind: "ok"; status?: SessionStatus; httpStatus?: number; extra?: Record<string, unknown>; sessionId?: string }
  | { kind: "reply"; httpStatus: number; body: string; contentType?: string }
  | { kind: "hang" }
  | { kind: "destroy" }
  | { kind: "redirect"; location: string };

export type Received = { method: string; path: string; authorization: string | null; body: unknown };

export type FakeEngine = {
  url: string;
  received: Received[];
  // Requests that passed the token and schema checks.
  accepted: StartSessionRequest[];
  behave(b: Behavior): void;
  close(): Promise<void>;
};

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export async function startFakeEngine(): Promise<FakeEngine> {
  const received: Received[] = [];
  const accepted: StartSessionRequest[] = [];
  let behavior: Behavior = { kind: "ok" };

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req as AsyncIterable<Buffer>) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    received.push({ method: req.method ?? "", path: req.url ?? "", authorization: req.headers.authorization ?? null, body });

    if (req.method !== "POST" || req.url !== "/internal/sessions") return send(res, 404, { error: { code: "not_found" } });
    if (req.headers.authorization !== `Bearer ${FAKE_ENGINE_TOKEN}`) return send(res, 401, { error: { code: "unauthorized" } });
    const parsed = StartSessionRequest.safeParse(body);
    if (!parsed.success) return send(res, 400, { error: { code: "invalid_request" } });
    accepted.push(parsed.data);

    const b = behavior;
    switch (b.kind) {
      case "ok": {
        const id = b.sessionId ?? parsed.data.sessionId;
        const reply = StartSessionResponse.parse({
          sessionId: id,
          status: b.status ?? "joining",
          stageUrl: `https://engine.test/stage/${id}?token=stage-secret`,
        });
        return send(res, b.httpStatus ?? 201, { ...reply, ...b.extra });
      }
      case "reply":
        res.writeHead(b.httpStatus, { "content-type": b.contentType ?? "application/json" });
        return res.end(b.body);
      case "hang":
        return; // never answers; close() cuts the socket
      case "destroy":
        return res.socket?.destroy();
      case "redirect":
        res.writeHead(307, { location: b.location });
        return res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    accepted,
    behave(b) {
      behavior = b;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
