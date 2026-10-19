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
import type { RuntimeLookup, SessionRuntime } from "./session/runtime.ts";
import { runScript, Script } from "./session/script.ts";
import { noopStageSink } from "./stage/channel.ts";
import { emptyDoc } from "./consensus/doc.ts";
import { emptyPrototype, UNTITLED_APP } from "./ui/tree.ts";
import { buildHandoffHtml, buildExportHtml } from "./handoff/export.ts";
import { createBuildLoop } from "./agent/build-loop.ts";
import type { Timers } from "./agent/build-loop.ts";
import { createUiCommandRunner } from "./agent/ui-command.ts";
import { createChatSpeech, createConversationLoop } from "./agent/conversation-loop.ts";
import type { Speech } from "./agent/conversation-loop.ts";
import type { ModelPort } from "./agent/llm.ts";
import type { RealtimeEvent } from "./realtime.ts";
import { z } from "zod";
import { StartSessionRequest, StartSessionResponse } from "@builder/contracts";
import type { SessionStatus } from "@builder/contracts";
import { errorCode } from "./error-code.ts";

export const REALTIME_PATH = "/recall/realtime/";
const BOT_NAME = "Builder";
const MAX_BODY = 1_000_000;
const MEETING_HOSTS = /^(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/i;

const MAX_STAGE_HTML = 200_000;

// What the /local page sends from the operator's mic, in place of Recall's transcript (local mode only).
const LocalSpeech = z.object({
  kind: z.enum(["partial", "utterance", "join", "leave"]),
  speaker: z.string().trim().min(1).max(100),
  text: z.string().trim().max(5000).optional(),
});

type Log = (msg: string, fields?: Record<string, unknown>) => void;


// Runs tasks with the same key one after another, in the order they were queued. Tasks with different keys
// run side by side. Each call's promise settles with its own task.
function createSerialQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  };
}

// Requests that arrived through the public tunnel carry proxy headers; direct
// localhost requests don't. Only Recall-facing routes are reachable publicly.
const viaProxy = (req: http.IncomingMessage) =>
  Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]);

// Session ids the api sends must be UUIDs: the stage and handoff routes only match those.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isMeetingUrl = (s: string) => {
  if (!URL.canParse(s)) return false;
  const u = new URL(s);
  return u.protocol === "https:" && MEETING_HOSTS.test(u.hostname);
};

const bearerToken = (req: http.IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? "")?.[1] ?? null;

// The contract's status for a session, from Recall's last bot status.
function contractStatus(s: Session): SessionStatus {
  if (s.bot_status === "fatal") return "failed";
  if (isTerminal(s.bot_status)) return "ended";
  if (s.bot_status?.startsWith("in_call")) return "in_meeting";
  return "joining";
}

export const tokenMatches = (given: string | null, expected: string | null) => {
  if (!given || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// Agent deps are injected (server.ts builds the real ones when OPENROUTER_API_KEY is set); without
// them the app is listen-only. Speech is Builder's voice (src/voice/speech.ts) when server.ts has a
// TTS voice configured, and meeting chat otherwise.
// `clock` and `timers` default to real time; replays and tests inject virtual ones.
export type AgentDeps = { port: ModelPort; speech?: Speech; clock?: () => number; timers?: Timers };

// Async because a restart reloads the calls still going from the database before any request is served.
export async function createApp(deps: { config: Config; recall: RecallClient; store: Store; log?: Log; indexHtml?: string; stageHtml?: string; localHtml?: string; runtime?: RuntimeLookup; agent?: AgentDeps }) {
  const { config, recall, store } = deps;
  const log: Log = deps.log ?? ((msg, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields })));
  const indexHtml = deps.indexHtml ?? readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const stageHtml = deps.stageHtml ?? readFileSync(new URL("../public/stage.html", import.meta.url), "utf8");
  const localHtml = config.local ? deps.localHtml ?? readFileSync(new URL("../public/local.html", import.meta.url), "utf8") : null;
  const runtime = deps.runtime ?? createRuntime({ store, channel: noopStageSink, log });
  // A session's runtime starts from its saved consensus, which is read from the database. Every way in from
  // outside (an event, the stage, a restart) loads it first; the loops then use runtime(id) as before.
  const loadRuntime = (sessionId: string): Promise<SessionRuntime> =>
    runtime.load ? runtime.load(sessionId) : Promise.resolve().then(() => runtime(sessionId));
  const clock = deps.agent?.clock ?? Date.now;
  const buildLoop = deps.agent
    ? createBuildLoop({ port: deps.agent.port, runtime, store, clock, botName: BOT_NAME, log, ...(deps.agent.timers ? { timers: deps.agent.timers } : {}) })
    : null;
  const conversation = deps.agent && buildLoop ? createConversationLoop({
    port: deps.agent.port, runtime, store, clock, botName: BOT_NAME, log, buildLoop,
    uiCommand: createUiCommandRunner({ runtime, clock }),
    speech: deps.agent.speech ?? createChatSpeech({ recall, runtime, store, botName: BOT_NAME }),
  }) : null;
  // After a restart, pick up the calls still going (known issue M2): the conversation loop reloads
  // its transcript window, and the build loop restarts the no-objection timer.
  for (const s of buildLoop ? await store.listActiveSessions() : []) {
    await loadRuntime(s.id);
    if (s.bot_status === "in_call_recording") await conversation?.resume(s.id);
    buildLoop?.resume(s.id);
  }
  const rendererDir = new URL("../public/renderer/", import.meta.url);
  const stageUrl = async (s: Session) =>
    `${config.publicBaseUrl}/stage/${s.id}?token=${encodeURIComponent(s.stage_token ?? await store.ensureStageToken(s.id))}`;

  // The handoff has its own read-only token: the stage token also opens the stage socket (known issue I7).
  const handoffPath = async (s: Session) =>
    `/handoff/${s.id}?token=${encodeURIComponent(s.handoff_token ?? await store.ensureHandoffToken(s.id))}`;

  // Realtime events (and local-mode speech) for one session are handled one at a time, in arrival order, as
  // the synchronous store did: event ids, the transcript window and the agent all follow that order.
  const perSession = createSerialQueue();
  // Finding an unfinished session for a meeting and writing a new intent happen together, so two requests
  // for the same meeting at once can't both send a bot. In this process; the engine runs as one instance.
  const perMeeting = createSerialQueue();
  // Work that runs after its request was answered (a Recall event, a line from the local mic), until it settles.
  // A shutdown waits for it (known issue R3).
  const background = new Set<Promise<void>>();
  const inBackground = (task: () => Promise<void>, onError: (err: unknown) => void) => {
    const p = new Promise<void>((r) => setImmediate(r)).then(task).catch(onError);
    background.add(p);
    void p.finally(() => background.delete(p));
  };

  // ---- live fan-out to browsers (SSE) ----
  const subscribers = new Map<string, Set<http.ServerResponse>>();
  function publish(sessionId: string, type: string, data: unknown) {
    for (const res of subscribers.get(sessionId) ?? []) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  // ---- session creation: intent first, then Recall ----
  // One start: reuse the active session for this meeting within the same org (E3; `org` absent means the
  // operator's own sessions, which have no org), or write the intent row and then ask Recall for a bot. Recall is
  // asked once: a network failure leaves the intent row for a person to reconcile, never a retry.
  type StartOutcome =
    | { kind: "existing"; session: Session }
    | { kind: "created"; session: Session }
    | { kind: "rejected"; session: Session; error: string; status: number }
    | { kind: "unknown"; session: Session };

  async function startBot(meetingUrl: string, opts: { id?: string; org?: { orgId: string; maxUsd: number; maxMinutes: number } } = {}): Promise<StartOutcome> {
    const claim = await perMeeting(meetingUrl, async () => {
      const existing = await store.findActiveForMeeting(meetingUrl, opts.org?.orgId ?? null);
      return existing ? { existing } : { session: await store.createIntent(opts.id ?? randomUUID(), meetingUrl, opts.org) };
    });
    if (claim.existing) return { kind: "existing", session: claim.existing };

    const session = claim.session!;
    const current = async () => (await store.getSession(session.id)) ?? session;
    try {
      const bot = await recall.createBot({
        meetingUrl,
        botName: BOT_NAME,
        realtimeWebhookUrl: `${config.publicBaseUrl}${REALTIME_PATH}`,
        screenshareUrl: await stageUrl(session),
        variant: config.botVariant,
        metadata: { session_id: session.id, app: "meet2build-live-agent-poc" },
      });
      await store.markCreated(session.id, bot.id);
      log("bot.created", { session_id: session.id, bot_id: bot.id });
      return { kind: "created", session: await current() };
    } catch (err) {
      if (err instanceof RecallApiError) {
        // Definite rejection from Recall: no bot exists.
        await store.markCreateFailed(session.id, err.message);
        log("bot.create_failed", { session_id: session.id, status: err.status });
        return { kind: "rejected", session: await current(), error: err.message, status: err.status };
      }
      // Network-level failure: outcome unknown. Leave the intent row in place.
      log("bot.create_ambiguous", { session_id: session.id });
      return { kind: "unknown", session: await current() };
    }
  }

  // The operator's routes (/api/sessions and local mode): the same answers as before the api existed.
  async function createSession(meetingUrl: string): Promise<{ status: number; body: unknown }> {
    const outcome = await startBot(meetingUrl);
    switch (outcome.kind) {
      case "existing":
        if (outcome.session.state === "intent") {
          // A previous create never resolved (crash / ambiguous network failure).
          // Don't blindly re-send: surface it so it can be reconciled.
          return { status: 409, body: { error: "A bot request for this meeting is unresolved; check the Recall dashboard before retrying.", session: outcome.session } };
        }
        return { status: 200, body: { session: outcome.session, reused: true } };
      case "created":
        return { status: 201, body: { session: outcome.session } };
      case "rejected":
        return { status: 502, body: { error: outcome.error, session: outcome.session } };
      case "unknown":
        return { status: 504, body: { error: "Recall request outcome unknown; not retrying automatically.", session: outcome.session } };
    }
  }

  // ---- POST /internal/sessions: the api starts a session for an org (ADR 0008, E1-E3) ----
  // Answers with StartSessionResponse from contracts/, or { error: { code } }. The api reads any 4xx as "no bot was
  // sent" and any 5xx as "a bot may exist", so:
  // - 201: started; 200: this sessionId was started before (E2), its current state
  // - 409 meeting_in_use: the org already has another active session in this meeting, so no second bot
  // - 409 session_conflict: this sessionId exists with another org or meeting
  // - 422 recall_rejected: Recall refused, no bot exists
  // - 504 recall_outcome_unknown: Recall didn't answer clearly, or an earlier start for this id never resolved
  type InternalReply = { status: number; body: unknown };
  const internalError = (status: number, code: string): InternalReply => ({ status, body: { error: { code } } });
  const startResponse = async (s: Session): Promise<InternalReply["body"]> =>
    StartSessionResponse.parse({ sessionId: s.id, status: contractStatus(s), stageUrl: await stageUrl(s) });

  // E2: starts for the same sessionId in this process share one attempt. After it, the stored row answers.
  const internalStarts = new Map<string, { req: StartSessionRequest; reply: Promise<InternalReply> }>();
  const sameStart = (s: { org_id: string | null; meeting_url: string }, r: StartSessionRequest) => s.org_id === r.orgId && s.meeting_url === r.meetingUrl;

  async function replayStart(s: Session, r: StartSessionRequest): Promise<InternalReply> {
    if (!sameStart(s, r)) return internalError(409, "session_conflict");
    if (s.state === "created") return { status: 200, body: await startResponse(s) };
    if (s.state === "create_failed") return internalError(422, "recall_rejected");
    return internalError(504, "recall_outcome_unknown");
  }

  async function startForApi(r: StartSessionRequest): Promise<InternalReply> {
    const existing = await store.getSession(r.sessionId);
    if (existing) return replayStart(existing, r);
    const outcome = await startBot(r.meetingUrl, { id: r.sessionId, org: { orgId: r.orgId, maxUsd: r.limits.maxUsd, maxMinutes: r.limits.maxMinutes } });
    switch (outcome.kind) {
      case "existing": return internalError(409, "meeting_in_use");
      case "created": return { status: 201, body: await startResponse(outcome.session) };
      case "rejected": return internalError(422, "recall_rejected");
      case "unknown": return internalError(504, "recall_outcome_unknown");
    }
  }

  async function handleInternalStart(req: http.IncomingMessage): Promise<InternalReply> {
    const parsed = StartSessionRequest.safeParse(await readJson(req));
    if (!parsed.success || !UUID.test(parsed.data.sessionId) || !isMeetingUrl(parsed.data.meetingUrl)) {
      return internalError(400, "invalid_request");
    }
    const r = parsed.data;
    let inFlight = internalStarts.get(r.sessionId);
    if (inFlight && !sameStart({ org_id: inFlight.req.orgId, meeting_url: inFlight.req.meetingUrl }, r)) return internalError(409, "session_conflict");
    if (!inFlight) {
      inFlight = { req: r, reply: startForApi(r).finally(() => internalStarts.delete(r.sessionId)) };
      internalStarts.set(r.sessionId, inFlight);
    }
    const reply = await inFlight.reply;
    const code = (reply.body as { error?: { code?: string } }).error?.code;
    log("internal.session_start", { session_id: r.sessionId, org_id: r.orgId, status: reply.status, ...(code ? { code } : {}) });
    return reply;
  }

  // ---- lifecycle polling (feasibility shortcut; production uses dashboard webhooks) ----
  // Never rejects: it runs on a timer. Failures are logged with a status or error name.
  async function pollOnce() {
    let active: Session[];
    try {
      active = await store.listActiveSessions();
    } catch (err) {
      log("bot.poll_failed", { error: errorCode(err) });
      return;
    }
    for (const s of active) {
      let last;
      try {
        const bot = await recall.getBot(s.bot_id!);
        last = bot.status_changes?.at(-1);
      } catch (err) {
        log("bot.poll_failed", { session_id: s.id, error: err instanceof RecallApiError ? err.status : "network" });
        continue;
      }
      if (!last || (last.code === s.bot_status && last.sub_code === s.bot_sub_code)) continue;
      try {
        await store.updateBotStatus(s.id, last.code, last.sub_code);
      } catch (err) {
        log("bot.status_save_failed", { session_id: s.id, error: errorCode(err) });
        continue;
      }
      log("bot.status", { session_id: s.id, status: last.code, sub_code: last.sub_code });
      publish(s.id, "status", { status: last.code, sub_code: last.sub_code, message: last.message });
      if (last.code === "in_call_recording") conversation?.onBotRecording(s.id);
      if (isTerminal(last.code)) endSession(s.id, last.code);
    }
  }

  // The call is over (known issue I5): Builder stops speaking and the agent stops for this session,
  // so nothing costs money any more and the consensus, and with it the handoff, is final (spec §14).
  function endSession(sessionId: string, status: string) {
    try {
      conversation?.onBotEnded(sessionId);
      buildLoop?.end(sessionId);
      log("session.ended", { session_id: sessionId, status });
    } catch (err) {
      log("session.end_failed", { session_id: sessionId, error: errorCode(err) });
    }
  }

  // ---- verified realtime events ----
  // Queued per session (Recall puts our session id in the bot's metadata; the bot id stands in without it).
  async function processRealtime(rawBody: string, msgId: string | null) {
    let parsed: RealtimeEvent | null;
    try {
      parsed = parseRealtimeEvent(JSON.parse(rawBody));
    } catch {
      log("realtime.unparseable");
      return;
    }
    if (!parsed) return;
    const event = parsed;
    await perSession(event.sessionId ?? `bot:${event.botId ?? ""}`, async () => {
      const session = (event.sessionId && await store.getSession(event.sessionId)) ||
        (event.botId && await store.getSessionByBotId(event.botId)) || undefined;
      if (!session) {
        log("realtime.unknown_session", { kind: event.kind });
        return;
      }
      await handleEvent(session, event, msgId);
    });
  }

  // A transcript or participant event for a session, from Recall or (in local mode) the operator's mic.
  async function handleEvent(session: Session, parsed: RealtimeEvent, msgId: string | null) {
    // Late events after the call ended are stored, but the agent no longer acts on them.
    const agent = isTerminal(session.bot_status) ? null : conversation;
    if (parsed.kind === "partial") {
      (await loadRuntime(session.id)).caption({ partial: true, isAgent: false });
      publish(session.id, "partial", { speaker: parsed.speaker, text: parsed.text });
      agent?.onPartial(session.id, { speaker: parsed.speaker, text: parsed.text });
      return;
    }
    // One statement, unique on Recall's message id: a redelivery reads as a duplicate however it overlaps.
    const stored = await store.addEvent({ sessionId: session.id, recallMsgId: msgId, kind: parsed.kind, speaker: parsed.speaker, text: parsed.text });
    if (!stored) {
      log("realtime.duplicate", { kind: parsed.kind });
      return;
    }
    log("realtime.processed", { session_id: session.id, kind: parsed.kind });
    const rt = await loadRuntime(session.id);
    if (parsed.kind === "utterance") rt.caption({ partial: false, isAgent: false });
    publish(session.id, "event", stored);
    if (parsed.kind === "utterance") agent?.onUtterance(session.id, { id: stored.id, speaker: parsed.speaker, text: parsed.text });
    else if (parsed.kind === "join" || parsed.kind === "leave") agent?.onParticipant(session.id, { kind: parsed.kind, name: parsed.speaker });
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
  async function sessionView(s: Session) {
    const [stage_url, handoff, cost_usd, events] = await Promise.all([stageUrl(s), handoffPath(s), store.sessionCost(s.id), store.listEvents(s.id)]);
    return { ...s, stage_url, handoff_url: `${config.publicBaseUrl}${handoff}`, cost_usd, events };
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
    // No transcript is served here: the operator's live stream is /api/sessions/<id>/stream (local only).
    const stage = path.match(/^\/stage\/([0-9a-f-]{36})(\/state)?$/);
    if (req.method === "GET" && stage) {
      const s = await store.getSession(stage[1]);
      if (!s || !tokenMatches(url.searchParams.get("token"), s.stage_token)) return json(res, 404, { error: "not found" });
      // The stage polls this: quick-tunnel proxies buffer text/event-stream.
      if (stage[2] === "/state") {
        return json(res, 200, { ...(await loadRuntime(s.id)).snapshot(), html: s.stage_html });
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(stageHtml);
    }

    // ---- handoff: read by engineers after the meeting (public, gated by its own read-only token) ----
    const handoff = path.match(/^\/handoff\/([0-9a-f-]{36})(\/export)?$/);
    if (req.method === "GET" && handoff) {
      const s = await store.getSession(handoff[1]);
      if (!s || !tokenMatches(url.searchParams.get("token"), s.handoff_token)) return json(res, 404, { error: "not found" });
      // Before anything is drawn or decided, the handoff is empty rather than missing (known issue M8).
      const consensus = await store.getConsensus(s.id) ?? { doc: emptyDoc(), proto: emptyPrototype(UNTITLED_APP) };
      const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
      let body: string;
      if (handoff[2]) {
        headers["Content-Disposition"] = 'attachment; filename="builder-handoff.html"';
        body = buildExportHtml(consensus.doc, consensus.proto);
      } else {
        body = buildHandoffHtml(consensus.doc, consensus.proto, `/handoff/${s.id}/export?token=${encodeURIComponent(s.handoff_token!)}`);
      }
      log("handoff.served", { session_id: s.id, export: Boolean(handoff[2]), bytes: body.length });
      res.writeHead(200, headers);
      return res.end(body);
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
      // Runs outside the request: an error here would otherwise take the whole process down,
      // and again on every later event for the session (known issue I6).
      inBackground(() => processRealtime(raw, msgId), (err) => log("realtime.process_failed", { error: errorCode(err) }));
      return;
    }

    if (req.method === "GET" && path === "/healthz") return json(res, 200, { ok: true });

    // Everything below is the local control surface: never served through the tunnel.
    if (viaProxy(req)) return json(res, 404, { error: "not found" });

    // ---- the api's internal routes (ADR 0008): private network only (the proxy check above), and the shared
    // bearer token. Off (404) when ENGINE_INTERNAL_TOKEN isn't set. ----
    if (path.startsWith("/internal/")) {
      if (!config.internalToken) return json(res, 404, { error: "not found" });
      if (!tokenMatches(bearerToken(req), config.internalToken)) return json(res, 401, { error: { code: "unauthorized" } });
      if (req.method === "POST" && path === "/internal/sessions") {
        const reply = await handleInternalStart(req);
        return json(res, reply.status, reply.body);
      }
      return json(res, 404, { error: { code: "not_found" } });
    }

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(indexHtml);
    }
    if (req.method === "GET" && path === "/api/sessions") return json(res, 200, { sessions: await store.listSessions() });

    // ---- local mode: the operator's own mic stands in for the meeting ----
    if (localHtml !== null && req.method === "GET" && path === "/local") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(localHtml);
    }
    if (config.local && req.method === "POST" && path === "/api/local/sessions") {
      const result = await createSession(`local:${randomUUID()}`);
      // The stand-in bot is in the call already: pick that up now rather than at the next poll.
      await pollOnce();
      const id = (result.body as { session?: Session }).session?.id;
      const s = id ? await store.getSession(id) : undefined;
      return json(res, result.status, s ? { session: await sessionView(s) } : result.body);
    }

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

    const m = path.match(/^\/api\/sessions\/([0-9a-f-]{36})(\/stream|\/cost|\/chat|\/leave|\/screenshare|\/stage|\/script|\/speech)?$/);
    if (m) {
      const session = await store.getSession(m[1]);
      if (!session) return json(res, 404, { error: "not found" });
      const sub = m[2];

      if (req.method === "GET" && !sub) return json(res, 200, { session: await sessionView(session) });
      if (req.method === "GET" && sub === "/stream") return openStream(req, res, session);
      // The operator page's running total, polled every few seconds: one sum, not every stored event (known issue M7).
      if (req.method === "GET" && sub === "/cost") return json(res, 200, { cost_usd: await store.sessionCost(session.id) });

      // Content shown on the shared screen. Later, the LLM agent writes here.
      if (req.method === "POST" && sub === "/stage") {
        const raw = await readBody(req);
        const html = String(JSON.parse(raw).html ?? "");
        if (html.length > MAX_STAGE_HTML) return json(res, 413, { error: "stage html too large" });
        await store.setStageHtml(session.id, html);
        publish(session.id, "stage", { html });
        log("stage.updated", { session_id: session.id, bytes: html.length });
        return json(res, 200, { ok: true });
      }

      // Local mode: a line (or a partial, or a join) from the operator's mic, handled as Recall's would be.
      if (config.local && req.method === "POST" && sub === "/speech") {
        const parsed = LocalSpeech.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: "invalid speech" });
        if (isTerminal(session.bot_status)) return json(res, 409, { error: "session has ended" });
        const { kind, speaker, text } = parsed.data;
        if ((kind === "partial" || kind === "utterance") && !text) return json(res, 400, { error: "text is required" });
        json(res, 200, { ok: true });
        inBackground(() => perSession(session.id, () => handleEvent(session, { kind, botId: session.bot_id, sessionId: session.id, speaker, text: text || null }, null)),
          (err) => log("local.speech_failed", { error: errorCode(err) }));
        return;
      }

      // Visual-QA script driver (local only: this block is behind the viaProxy gate).
      if (req.method === "POST" && sub === "/script") {
        const parsed = Script.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: "invalid script" });
        const results = await runScript(await loadRuntime(session.id), parsed.data);
        log("script.ran", { session_id: session.id, steps: results.length, failed: results.filter((r) => !r.ok).length });
        return json(res, 200, { results });
      }

      if (sub === "/screenshare" && (req.method === "POST" || req.method === "DELETE")) {
        if (!session.bot_id || isTerminal(session.bot_status)) return json(res, 409, { error: "bot is not in the call" });
        try {
          if (req.method === "POST") await recall.startScreenshare(session.bot_id, await stageUrl(session));
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
            await store.addEvent({ sessionId: session.id, recallMsgId: null, kind: "bot_chat", speaker: BOT_NAME, text: message });
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
        log("http.error", { error: errorCode(err) });
        if (!res.headersSent) json(res, 500, { error: "internal error" });
      });
    },
    pollOnce,
    // For a shutdown (known issue R3): resolves once the events already answered are handled and every change to
    // a session's prototype and doc so far is saved. Stop the server first, so no new events arrive. Model calls in
    // flight aren't waited for; what they return is lost, as on any restart (M2).
    async drain(): Promise<void> {
      while (background.size) await Promise.allSettled([...background]);
      await runtime.flush?.();
    },
    // Stuck detection; server.ts calls it about once a second.
    tickAgent: () => conversation?.poll(clock()),
  };
}
