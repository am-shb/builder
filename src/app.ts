// HTTP application: UI, session API, live SSE stream, and the verified
// Recall realtime webhook receiver. Constructed with injected dependencies so
// tests and --smoke exercise exactly this boundary.
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";
import type { RecallClient } from "./recall-client.ts";
import { RecallApiError } from "./recall-client.ts";
import type { Store, Session } from "./store.ts";
import { isTerminal } from "./store.ts";
import { verifyRequestFromRecall } from "./verify.ts";
import { parseRealtimeEvent } from "./realtime.ts";
import { createRuntime } from "./session/runtime.ts";
import type { SessionRuntime } from "./session/runtime.ts";
import { runScript, Script } from "./session/script.ts";
import { noopStageSink } from "./stage/channel.ts";

export const REALTIME_PATH = "/recall/realtime/";
const BOT_NAME = "Builder";
const MAX_BODY = 1_000_000;
const MEETING_HOSTS = /^(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/i;

const MAX_STAGE_HTML = 200_000;

type Log = (msg: string, fields?: Record<string, unknown>) => void;

// Requests that arrived through the public tunnel carry proxy headers; direct
// localhost requests don't. Only Recall-facing routes are reachable publicly.
const viaProxy = (req: http.IncomingMessage) =>
  Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]);

export const tokenMatches = (given: string | null, expected: string | null) => {
  if (!given || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createApp(deps: { config: Config; recall: RecallClient; store: Store; log?: Log; indexHtml?: string; stageHtml?: string; runtime?: (sessionId: string) => SessionRuntime }) {
  const { config, recall, store } = deps;
  const log: Log = deps.log ?? ((msg, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields })));
  const indexHtml = deps.indexHtml ?? readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const stageHtml = deps.stageHtml ?? readFileSync(new URL("../public/stage.html", import.meta.url), "utf8");
  const runtime = deps.runtime ?? createRuntime({ store, channel: noopStageSink, log });
  const rendererDir = new URL("../public/renderer/", import.meta.url);
  const stageUrl = (s: Session) =>
    `${config.publicBaseUrl}/stage/${s.id}?token=${encodeURIComponent(store.ensureStageToken(s.id))}`;

  // ---- live fan-out to browsers (SSE) ----
  const subscribers = new Map<string, Set<http.ServerResponse>>();
  // In-progress (partial) utterance per session, for the polled stage view.
  const latestPartial = new Map<string, { speaker: string | null; text: string | null }>();
  function publish(sessionId: string, type: string, data: unknown) {
    for (const res of subscribers.get(sessionId) ?? []) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  // ---- session creation: intent first, then Recall ----
  async function createSession(meetingUrl: string): Promise<{ status: number; body: unknown }> {
    const existing = store.findActiveForMeeting(meetingUrl);
    if (existing) {
      if (existing.state === "intent") {
        // A previous create never resolved (crash / ambiguous network failure).
        // Don't blindly re-send: surface it so it can be reconciled.
        return { status: 409, body: { error: "A bot request for this meeting is unresolved; check the Recall dashboard before retrying.", session: existing } };
      }
      return { status: 200, body: { session: existing, reused: true } };
    }

    const session = store.createIntent(randomUUID(), meetingUrl);
    try {
      const bot = await recall.createBot({
        meetingUrl,
        botName: BOT_NAME,
        realtimeWebhookUrl: `${config.publicBaseUrl}${REALTIME_PATH}`,
        screenshareUrl: stageUrl(session),
        variant: config.botVariant,
        metadata: { session_id: session.id, app: "meet2build-live-agent-poc" },
      });
      store.markCreated(session.id, bot.id);
      log("bot.created", { session_id: session.id, bot_id: bot.id });
      return { status: 201, body: { session: store.getSession(session.id) } };
    } catch (err) {
      if (err instanceof RecallApiError) {
        // Definite rejection from Recall: no bot exists.
        store.markCreateFailed(session.id, err.message);
        log("bot.create_failed", { session_id: session.id, status: err.status });
        return { status: 502, body: { error: err.message, session: store.getSession(session.id) } };
      }
      // Network-level failure: outcome unknown. Leave the intent row in place.
      log("bot.create_ambiguous", { session_id: session.id });
      return { status: 504, body: { error: "Recall request outcome unknown; not retrying automatically.", session: store.getSession(session.id) } };
    }
  }

  // ---- lifecycle polling (feasibility shortcut; production uses dashboard webhooks) ----
  async function pollOnce() {
    for (const s of store.listActiveSessions()) {
      try {
        const bot = await recall.getBot(s.bot_id!);
        const last = bot.status_changes?.at(-1);
        if (last && (last.code !== s.bot_status || last.sub_code !== s.bot_sub_code)) {
          store.updateBotStatus(s.id, last.code, last.sub_code);
          log("bot.status", { session_id: s.id, status: last.code, sub_code: last.sub_code });
          publish(s.id, "status", { status: last.code, sub_code: last.sub_code, message: last.message });
        }
      } catch (err) {
        log("bot.poll_failed", { session_id: s.id, error: err instanceof RecallApiError ? err.status : "network" });
      }
    }
  }

  // ---- verified realtime events ----
  function processRealtime(rawBody: string, msgId: string | null) {
    let parsed;
    try {
      parsed = parseRealtimeEvent(JSON.parse(rawBody));
    } catch {
      log("realtime.unparseable");
      return;
    }
    if (!parsed) return;
    const session = (parsed.sessionId && store.getSession(parsed.sessionId)) ||
      (parsed.botId && store.getSessionByBotId(parsed.botId)) || undefined;
    if (!session) {
      log("realtime.unknown_session", { kind: parsed.kind });
      return;
    }
    if (parsed.kind === "partial") {
      latestPartial.set(session.id, { speaker: parsed.speaker, text: parsed.text });
      runtime(session.id).caption({ speaker: parsed.speaker ?? "Unknown", text: parsed.text ?? "", partial: true, isAgent: false });
      publish(session.id, "partial", { speaker: parsed.speaker, text: parsed.text });
      return;
    }
    if (parsed.kind === "utterance") latestPartial.delete(session.id);
    const stored = store.addEvent({ sessionId: session.id, recallMsgId: msgId, kind: parsed.kind, speaker: parsed.speaker, text: parsed.text });
    if (!stored) {
      log("realtime.duplicate", { kind: parsed.kind });
      return;
    }
    log("realtime.processed", { session_id: session.id, kind: parsed.kind });
    if (parsed.kind === "utterance") {
      runtime(session.id).caption({ speaker: parsed.speaker ?? "Unknown", text: parsed.text ?? "", partial: false, isAgent: false });
    }
    publish(session.id, "event", stored);
  }

  // ---- HTTP plumbing ----
  async function readBody(req: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error("body too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  async function readJson(req: http.IncomingMessage): Promise<unknown> {
    try {
      return JSON.parse(await readBody(req));
    } catch {
      return null;
    }
  }
  function json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
  function sessionView(s: Session) {
    return { ...s, stage_url: stageUrl(s), events: store.listEvents(s.id) };
  }
  function openStream(req: http.IncomingMessage, res: http.ServerResponse, s: Session) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: status\ndata: ${JSON.stringify({ status: s.bot_status, sub_code: s.bot_sub_code })}\n\n`);
    const set = subscribers.get(s.id) ?? new Set();
    set.add(res);
    subscribers.set(s.id, set);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      set.delete(res);
    });
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;

    // ---- stage: the page the bot screenshares into the meeting (public, token-gated) ----
    const stage = path.match(/^\/stage\/([0-9a-f-]{36})(\/stream|\/state)?$/);
    if (req.method === "GET" && stage) {
      const s = store.getSession(stage[1]);
      if (!s || !tokenMatches(url.searchParams.get("token"), s.stage_token)) return json(res, 404, { error: "not found" });
      if (stage[2] === "/stream") return openStream(req, res, s);
      // The stage polls this: quick-tunnel proxies buffer text/event-stream.
      if (stage[2] === "/state") {
        return json(res, 200, { ...runtime(s.id).snapshot(), html: s.stage_html });
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(stageHtml);
    }

    // Static renderer assets: public, no secrets.
    const asset = path.match(/^\/renderer\/([A-Za-z0-9._-]+\.(js|css))$/);
    if (req.method === "GET" && asset) {
      let body: Buffer;
      try {
        body = readFileSync(new URL(asset[1], rendererDir));
      } catch {
        return json(res, 404, { error: "not found" });
      }
      res.writeHead(200, { "Content-Type": asset[2] === "js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(body);
    }

    if (req.method === "POST" && (path === REALTIME_PATH || path === REALTIME_PATH.slice(0, -1))) {
      let raw: string;
      try {
        raw = await readBody(req);
        verifyRequestFromRecall({ secret: config.verificationSecret, headers: req.headers, payload: raw });
      } catch (err) {
        log("realtime.rejected", { reason: (err as Error).message });
        return json(res, 401, { error: "unverified" });
      }
      const msgId = (req.headers["webhook-id"] as string | undefined) ?? null;
      json(res, 200, { ok: true });
      setImmediate(() => processRealtime(raw, msgId));
      return;
    }

    if (req.method === "GET" && path === "/healthz") return json(res, 200, { ok: true });

    // Everything below is the local control surface: never served through the tunnel.
    if (viaProxy(req)) return json(res, 404, { error: "not found" });

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(indexHtml);
    }
    if (req.method === "GET" && path === "/api/sessions") return json(res, 200, { sessions: store.listSessions() });

    if (req.method === "POST" && path === "/api/sessions") {
      let meetingUrl: string;
      try {
        const body = JSON.parse(await readBody(req));
        meetingUrl = String(body.meeting_url ?? "").trim();
        const u = new URL(meetingUrl);
        if (u.protocol !== "https:" || !MEETING_HOSTS.test(u.hostname)) throw new Error();
      } catch {
        return json(res, 400, { error: "Provide a valid https Google Meet, Zoom or Teams meeting_url." });
      }
      const result = await createSession(meetingUrl);
      return json(res, result.status, result.body);
    }

    const m = path.match(/^\/api\/sessions\/([0-9a-f-]{36})(\/stream|\/chat|\/leave|\/screenshare|\/stage|\/script)?$/);
    if (m) {
      const session = store.getSession(m[1]);
      if (!session) return json(res, 404, { error: "not found" });
      const sub = m[2];

      if (req.method === "GET" && !sub) return json(res, 200, { session: sessionView(session) });
      if (req.method === "GET" && sub === "/stream") return openStream(req, res, session);

      // Content shown on the shared screen. Later, the LLM agent writes here.
      if (req.method === "POST" && sub === "/stage") {
        const raw = await readBody(req);
        const html = String(JSON.parse(raw).html ?? "");
        if (html.length > MAX_STAGE_HTML) return json(res, 413, { error: "stage html too large" });
        store.setStageHtml(session.id, html);
        publish(session.id, "stage", { html });
        log("stage.updated", { session_id: session.id, bytes: html.length });
        return json(res, 200, { ok: true });
      }

      // Visual-QA script driver (local only: this block is behind the viaProxy gate).
      if (req.method === "POST" && sub === "/script") {
        const parsed = Script.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: "invalid script" });
        const results = await runScript(runtime(session.id), parsed.data);
        log("script.ran", { session_id: session.id, steps: results.length, failed: results.filter((r) => !r.ok).length });
        return json(res, 200, { results });
      }

      if (sub === "/screenshare" && (req.method === "POST" || req.method === "DELETE")) {
        if (!session.bot_id || isTerminal(session.bot_status)) return json(res, 409, { error: "bot is not in the call" });
        try {
          if (req.method === "POST") await recall.startScreenshare(session.bot_id, stageUrl(session));
          else await recall.stopScreenshare(session.bot_id);
          log(req.method === "POST" ? "screenshare.started" : "screenshare.stopped", { session_id: session.id });
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 502, { error: (err as Error).message });
        }
      }

      if (req.method === "POST" && (sub === "/chat" || sub === "/leave")) {
        if (!session.bot_id || isTerminal(session.bot_status)) return json(res, 409, { error: "bot is not in the call" });
        try {
          if (sub === "/chat") {
            const message = String(JSON.parse(await readBody(req)).message ?? "").trim();
            if (!message || message.length > 500) return json(res, 400, { error: "message must be 1-500 chars (Google Meet limit)" });
            await recall.sendChatMessage(session.bot_id, message);
            store.addEvent({ sessionId: session.id, recallMsgId: null, kind: "bot_chat", speaker: BOT_NAME, text: message });
          } else {
            await recall.leaveCall(session.bot_id);
          }
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, 502, { error: (err as Error).message });
        }
      }
    }

    json(res, 404, { error: "not found" });
  }

  return {
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => {
      handle(req, res).catch((err) => {
        log("http.error", { error: (err as Error).message });
        if (!res.headersSent) json(res, 500, { error: "internal error" });
      });
    },
    pollOnce,
  };
}
