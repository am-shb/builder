// Conversation loop: Builder's ears and voice (spec §7, §12). Haiku reads a rolling window of
// the attributed transcript plus the consensus summary, and acts only through three tools:
// speak, ui_command and update_build. Making no call is staying silent, the default; the
// speech gate below enforces the speaking policy in code, whatever the model asks for.
// Logs ids, counts, reasons and durations only: never transcript text, prompts or model output.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withCostRecording } from "./cost.ts";
import { toolJsonSchema } from "./tool-schema.ts";
import type { ModelPort, PortTool, RunToolsResult, ToolCall } from "./llm.ts";
import { HandoffSchema, HandoffToolInput } from "./handoff.ts";
import type { Handoff } from "./handoff.ts";
import { matchSpokenPick } from "./spoken-pick.ts";
import { ADDRESS_RE, createStuckDetector } from "./stuck.ts";
import type { StuckDetector, StuckEvent } from "./stuck.ts";
import { findNode } from "../ui/tree.ts";
import type { UiNode } from "../ui/schema.ts";
import type { ConsensusDoc } from "../consensus/doc.ts";
import type { Log, SessionRuntime } from "../session/runtime.ts";
import type { StageEvent } from "../stage/channel.ts";
import type { RecallClient } from "../recall-client.ts";
import type { Store } from "../store.ts";
import { errorCode } from "../error-code.ts";

export const WINDOW = 40;
export const ADDRESSED_MS = 8_000;
export const CONFIRM_MS = 10_000;
export const FEEDBACK_MS = 5_000;
export const MAX_SPOKEN = 300;
// The opening is the room's first impression: about five seconds out loud. A longer one is not
// said, and the fallback below is said instead (the live test's opening ran about ten seconds).
export const OPENING_MAX = 100;
// A question someone asks within this long of Builder's line, as the first thing said after it, is
// a reply to Builder ("why?"), so Builder may answer it as if addressed by name (known issue M4).
export const FOLLOW_UP_MS = 15_000;
const CHAT_MAX = 500;
const SCREEN_MAX_NODES = 80;
// Follow-up turns that failed or invisible commands may trigger before a person speaks again.
export const MAX_COMMAND_FOLLOW_UPS = 2;
// Said when the opening turn fails or the model doesn't open (controller ruling).
export const FALLBACK_OPENING = "Hi, I'm Builder. I'll listen and sketch; say my name if you need me.";

const SYSTEM = readFileSync(new URL("./prompts/conversation.md", import.meta.url), "utf8");

export const SPEAK_REASONS = ["opening", "answer", "stuck", "confirm_conflict", "command_feedback"] as const;
export type SpeakReason = (typeof SPEAK_REASONS)[number];

export const SpeakInput = z.strictObject({
  text: z.string().min(1).max(MAX_SPOKEN),
  reason: z.enum(SPEAK_REASONS),
});

export const UiCommandInput = z.strictObject({
  action: z.enum(["click", "navigate", "type", "toggle", "focus_option", "back"]),
  target: z.string(),
  value: z.string().optional(),
});
export type UiCommand = z.infer<typeof UiCommandInput>;

/** What running a voice command did. `visible: false` means it worked but the room can't see it. */
export type CommandOutcome =
  | { ok: true; visible: boolean }
  | { ok: false; reason: "ambiguous" | "not_found" | "unsupported"; candidates?: string[] };

/**
 * How Builder's lines reach the room: its voice (createSpeech in src/voice/speech.ts) or meeting chat
 * (createChatSpeech). `say` resolves to the utterance id once the line is out; `speaking` stays true
 * while the stage is still playing it.
 */
export type Speech = {
  say(sessionId: string, text: string): Promise<string>;
  stop(sessionId: string): void;
  speaking(sessionId: string): boolean;
};

const TOOLS: PortTool[] = [
  {
    name: "speak",
    description:
      "Say one short line out loud to the meeting: at most two sentences and 300 characters, with at most one " +
      "question. Call it only when this turn's <speaking_allowed> lists the reason you give; any other call is " +
      "discarded. Making no call means staying silent, which is the right choice on most turns.",
    strict: true,
    input_schema: toolJsonSchema(SpeakInput),
    schema: SpeakInput,
  },
  {
    name: "ui_command",
    description:
      "Operate the prototype on screen when someone tells Builder to: click a button, navigate to a screen, " +
      "type a value into a field, toggle a switch, focus a side-by-side option (target A, B or C), or go back. " +
      "Use the words people used for the target, matching a label on the current screen when one fits.",
    strict: true,
    input_schema: toolJsonSchema(UiCommandInput),
    schema: UiCommandInput,
  },
  {
    name: "update_build",
    description:
      "Hand the build loop a summary of the topics discussed since handed_off_through: proposals with who proposed, " +
      "supported and objected, questions raised, a side-by-side choice the room settled, the screen being " +
      "discussed, or a view someone asked to see. Call it whenever a proposal, agreement, objection, disagreement, " +
      "screen change or request was heard. groundingIds lists the bracketed ids of every transcript line the " +
      "summary draws on.",
    strict: true,
    input_schema: toolJsonSchema(HandoffSchema),
    schema: HandoffToolInput,
  },
];

type Snapshot = Extract<StageEvent, { type: "snapshot" }>;
type Line = { id: number | null; speaker: string; text: string };
type Turn = { trigger: string; opening: boolean; stuck: StuckEvent | null; queuedMs: number | null };
type CommandRecord = { at: number; cmd: UiCommand; outcome: CommandOutcome; shown: boolean; fedBack: boolean };

type SessionState = {
  port: ModelPort;
  detector: StuckDetector;
  lines: Line[];
  humanIds: Set<number>;
  present: Set<string>;
  heard: Set<string>;
  recording: boolean;
  opened: boolean;
  openingTried: boolean;
  openingPending: boolean;
  addressedAt: number | null;
  answeredAt: number | null;
  // When Builder's last line went out, until a person says something after it.
  spokeAt: number | null;
  stuck: StuckEvent | null;
  confirmed: Set<string>;
  command: CommandRecord | null;
  commandFollowUps: number;
  handedOffThrough: number;
  // Arrival of the earliest utterance no turn has started on yet.
  waitingSince: number | null;
  inFlight: boolean;
  dirty: boolean;
};

const questions = (text: string) => (text.match(/\?/g) ?? []).length;

/** Meeting-chat stand-in for voice: posts the line (≤500 chars, the Meet limit) and tells the stage Builder spoke. */
export function createChatSpeech(deps: {
  recall: Pick<RecallClient, "sendChatMessage">;
  runtime: (sessionId: string) => SessionRuntime;
  store: Pick<Store, "getSession" | "addEvent">;
  botName?: string;
}): Speech {
  const botName = deps.botName ?? "Builder";
  return {
    async say(sessionId, text) {
      const line = text.slice(0, CHAT_MAX);
      const botId = (await deps.store.getSession(sessionId))?.bot_id;
      if (!botId) throw new Error("no bot for session");
      await deps.recall.sendChatMessage(botId, line);
      await deps.store.addEvent({ sessionId, recallMsgId: null, kind: "bot_chat", speaker: botName, text: line });
      deps.runtime(sessionId).caption({ partial: false, isAgent: true });
      return randomUUID();
    },
    stop() {},
    speaking: () => false,
  };
}

function nodeLabel(n: UiNode): string | null {
  for (const key of ["label", "text", "title", "placeholder"]) {
    const v = n.props[key];
    if (typeof v === "string" && v) return v;
  }
  const tabs = n.props.tabs;
  return Array.isArray(tabs) ? tabs.join(" / ") : null;
}

function screenOutline(snap: Snapshot): string {
  const screen = findNode(snap.proto, snap.proto.currentScreen);
  if (!screen) return `<screen id="${snap.proto.currentScreen}"></screen>`;
  const out: string[] = [];
  const walk = (n: UiNode, depth: number) => {
    if (out.length >= SCREEN_MAX_NODES) return;
    const label = nodeLabel(n);
    out.push(`${"  ".repeat(depth)}- ${n.type}${label ? ` ${JSON.stringify(label)}` : ""} (${n.id})`);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of screen.children) walk(c, 0);
  const comparison = snap.comparison
    ? `\nside-by-side comparison open for conflict ${snap.comparison.conflictId}: ` +
      snap.comparison.variants.map((v) => `${v.label}: ${v.summary}`).join("; ")
    : "";
  return `<screen id="${screen.id}" title=${JSON.stringify(nodeLabel(screen) ?? "")}>\n${out.join("\n")}${comparison}\n</screen>`;
}

function consensusSummary(doc: ConsensusDoc) {
  const decisions = (status: "draft" | "pending" | "agreed") =>
    doc.decisions.filter((d) => d.status === status).map((d) => ({ id: d.id, text: d.text, proposedBy: d.proposedBy, ...(d.agreedBy.length ? { agreedBy: d.agreedBy } : {}) }));
  return {
    phase: doc.phase,
    app: doc.app,
    agreed: decisions("agreed"),
    pending: decisions("pending"),
    drafts: decisions("draft"),
    openQuestions: doc.openQuestions.map((q) => ({ id: q.id, text: q.text, raisedBy: q.raisedBy })),
    openConflicts: doc.conflicts.filter((c) => c.status === "open").map((c) => ({
      id: c.id, topic: c.topic, options: c.variants.map((v) => ({ label: v.label, summary: v.summary, backers: v.backers })),
    })),
    nextUp: doc.nextUp,
  };
}

function describeCommand(c: CommandRecord, now: number): string {
  const what = `${c.cmd.action} ${JSON.stringify(c.cmd.target)}${c.cmd.value !== undefined ? ` value ${JSON.stringify(c.cmd.value)}` : ""}`;
  const o = c.outcome;
  const result = o.ok
    ? (o.visible ? "done, visible on screen" : "done, but nothing visible changed")
    : `${o.reason}${o.candidates?.length ? `: candidates ${o.candidates.map((x) => JSON.stringify(x)).join(", ")}` : ""}`;
  return `<last_command seconds_ago="${Math.round((now - c.at) / 1000)}">${what} -> ${result}</last_command>`;
}

export function createConversationLoop(deps: {
  port: ModelPort;
  runtime: (sessionId: string) => SessionRuntime;
  buildLoop: { handoff(sessionId: string, h: Handoff): void; taken?(sessionId: string): Promise<void> | null };
  speech: Speech;
  store: Store;
  clock: () => number;
  botName?: string;
  log?: Log;
  uiCommand?: (sessionId: string, cmd: UiCommand) => CommandOutcome;
}) {
  const { runtime, buildLoop, speech, store, clock } = deps;
  const botName = deps.botName ?? "Builder";
  const log: Log = deps.log ?? (() => {});
  // Without a runner (tests, listen-only wiring) every command is reported as unsupported.
  const uiCommand = deps.uiCommand ?? (() => ({ ok: false, reason: "unsupported" }) as CommandOutcome);
  const sessions = new Map<string, SessionState>();
  // Sessions whose call is over: no more turns, speech or stuck checks (known issue I5).
  const ended = new Set<string>();

  // `already`: the session was recording before a restart, so it has had its opening. Only resume() knows
  // that. A session met first through an event isn't recording yet: after a restart, every call still
  // recording is resumed before the app serves anything.
  const state = (sessionId: string, already = false): SessionState => {
    let st = sessions.get(sessionId);
    if (!st) {
      st = {
        port: withCostRecording(deps.port, { store, sessionId, log }),
        detector: createStuckDetector({ clock }),
        lines: [], humanIds: new Set(), present: new Set(), heard: new Set(),
        recording: already, opened: already, openingTried: already, openingPending: false,
        addressedAt: null, answeredAt: null, spokeAt: null, stuck: null, confirmed: new Set(), command: null, commandFollowUps: 0,
        handedOffThrough: 0, waitingSince: null, inFlight: false, dirty: false,
      };
      sessions.set(sessionId, st);
    }
    return st;
  };

  const humans = (st: SessionState) => [...new Set([...st.present, ...st.heard])];
  const view = (sessionId: string) => runtime(sessionId).snapshot() as Snapshot;

  // Conflicts resolved within CONFIRM_MS and not yet confirmed. A resolution records decision d-<id>.
  function freshResolutions(st: SessionState, doc: ConsensusDoc, now: number): string[] {
    return doc.conflicts
      .filter((c) => c.status === "resolved" && !st.confirmed.has(c.id))
      .filter((c) => {
        const at = doc.decisions.find((d) => d.id === `d-${c.id}`)?.decidedAt;
        return at !== undefined && now - at <= CONFIRM_MS;
      })
      .map((c) => c.id);
  }

  // The speech gate: which reasons may speak right now. The model is told, and the code enforces it.
  function openReasons(st: SessionState, turn: Turn, doc: ConsensusDoc, now: number): SpeakReason[] {
    const open: SpeakReason[] = [];
    if (turn.opening && !st.opened) open.push("opening");
    if (st.addressedAt !== null && now - st.addressedAt <= ADDRESSED_MS && st.addressedAt !== st.answeredAt) open.push("answer");
    if (st.stuck) open.push("stuck");
    if (freshResolutions(st, doc, now).length) open.push("confirm_conflict");
    const c = st.command;
    if (c && !c.fedBack && now - c.at <= FEEDBACK_MS && !(c.outcome.ok && c.outcome.visible)) open.push("command_feedback");
    return open;
  }

  function markAddressed(sessionId: string, st: SessionState, inputs: { lastSpeechWasQuestion?: boolean } = {}) {
    const now = clock();
    st.addressedAt = now;
    runtime(sessionId).updateMoodInputs({ ...inputs, addressedUntil: now + ADDRESSED_MS });
  }

  function pushLine(st: SessionState, line: Line) {
    st.lines.push(line);
    if (st.lines.length > WINDOW) st.lines.splice(0, st.lines.length - WINDOW);
  }

  function maybeOpen(sessionId: string, st: SessionState) {
    if (!st.recording || st.openingTried || humans(st).length === 0) return;
    st.openingTried = true;
    st.openingPending = true;
    schedule(sessionId, st);
  }

  function schedule(sessionId: string, st: SessionState) {
    if (ended.has(sessionId)) return;
    if (st.inFlight) {
      st.dirty = true;
      return;
    }
    run(sessionId, st).catch((err) => log("conversation.turn_failed", { session_id: sessionId, error: errorCode(err) }));
  }

  function userTurn(st: SessionState, snap: Snapshot, turn: Turn, open: SpeakReason[], now: number): string {
    const transcript = st.lines
      .map((l) => (l.id === null ? `[${botName}, you] ${l.text}` : `[${l.id}] ${l.speaker}: ${l.text}`))
      .join("\n");
    const people = humans(st);
    return [
      `<trigger>${turn.trigger}</trigger>`,
      `<speaking_allowed>${open.length ? open.join(", ") : "none"}</speaking_allowed>`,
      `<people>${people.length ? people.join(", ") : "nobody yet"}</people>`,
      `<consensus>\n${JSON.stringify(consensusSummary(snap.doc))}\n</consensus>`,
      screenOutline(snap),
      ...(st.command ? [describeCommand(st.command, now)] : []),
      `<transcript handed_off_through="${st.handedOffThrough}">\n${transcript}\n</transcript>`,
    ].join("\n\n");
  }

  function forwardHandoff(sessionId: string, st: SessionState, input: unknown): boolean {
    const parsed = HandoffSchema.safeParse(input);
    if (!parsed.success) {
      log("conversation.handoff_invalid", { session_id: sessionId, issues: parsed.error.issues.length });
      return false;
    }
    const ids = [...new Set(parsed.data.groundingIds)].filter((id) => st.humanIds.has(id));
    if (!ids.length) {
      log("handoff.ungrounded", { session_id: sessionId, given: parsed.data.groundingIds.length });
      return false;
    }
    buildLoop.handoff(sessionId, { ...parsed.data, groundingIds: ids });
    st.handedOffThrough = Math.max(st.handedOffThrough, ...ids);
    return true;
  }

  function runCommand(sessionId: string, st: SessionState, input: unknown): boolean {
    const parsed = UiCommandInput.safeParse(input);
    if (!parsed.success) {
      log("conversation.command_invalid", { session_id: sessionId });
      return false;
    }
    let outcome: CommandOutcome;
    try {
      outcome = uiCommand(sessionId, parsed.data);
    } catch (err) {
      log("conversation.command_failed", { session_id: sessionId, error: errorCode(err) });
      outcome = { ok: false, reason: "unsupported" };
    }
    st.command = { at: clock(), cmd: parsed.data, outcome, shown: false, fedBack: false };
    log("conversation.command", { session_id: sessionId, action: parsed.data.action, ok: outcome.ok, ...(outcome.ok ? { visible: outcome.visible } : { reason: outcome.reason }) });
    // A failed or invisible command is shown to the model in a follow-up turn, so it can say so,
    // but only a couple of times in a row: a model that keeps failing must not loop on its own.
    if (!(outcome.ok && outcome.visible)) {
      if (st.commandFollowUps < MAX_COMMAND_FOLLOW_UPS) {
        st.commandFollowUps++;
        st.dirty = true;
      } else {
        log("conversation.command_followup_capped", { session_id: sessionId });
      }
    }
    return true;
  }

  async function trySpeak(sessionId: string, st: SessionState, turn: Turn, input: unknown, first: boolean): Promise<SpeakReason | null> {
    const parsed = SpeakInput.safeParse(input);
    if (!parsed.success) {
      log("speak.blocked", { session_id: sessionId, reason: null, why: "invalid_input" });
      return null;
    }
    const { text, reason } = parsed.data;
    const now = clock();
    const doc = view(sessionId).doc;
    const why = !first ? "one_per_turn"
      : !openReasons(st, turn, doc, now).includes(reason) ? "reason_not_open"
      : reason === "opening" && text.length > OPENING_MAX ? "too_long"
      : questions(text) > 1 ? "too_many_questions"
      : speech.speaking(sessionId) ? "already_speaking"
      : null;
    if (why) {
      log("speak.blocked", { session_id: sessionId, reason, why });
      return null;
    }

    // Consume what allowed this line before it goes out, so a later turn can't repeat it.
    const addressedAt = st.addressedAt;
    if (reason === "opening") st.opened = true;
    if (reason === "answer") st.answeredAt = addressedAt;
    if (reason === "stuck") st.stuck = null;
    if (reason === "confirm_conflict") for (const id of freshResolutions(st, doc, now)) st.confirmed.add(id);
    if (reason === "command_feedback" && st.command) st.command.fedBack = true;
    return (await deliver(sessionId, st, text, reason, addressedAt)) ? reason : null;
  }

  // Says a line that passed the gate, then updates the window, the stuck detector and the mood.
  async function deliver(sessionId: string, st: SessionState, text: string, reason: SpeakReason, addressedAt: number | null): Promise<boolean> {
    try {
      await speech.say(sessionId, text);
    } catch (err) {
      log("speak.failed", { session_id: sessionId, reason, error: errorCode(err) });
      return false;
    }
    pushLine(st, { id: null, speaker: botName, text });
    st.spokeAt = clock();
    const asked = text.trim().endsWith("?");
    if (asked) st.detector.onAgentQuestion();
    const inputs: { lastSpeechWasQuestion: boolean; addressedUntil?: number } = { lastSpeechWasQuestion: asked };
    // Answered: stop "thinking", unless someone addressed Builder again meanwhile.
    if (reason === "answer" && st.addressedAt === addressedAt) inputs.addressedUntil = 0;
    runtime(sessionId).updateMoodInputs(inputs);
    log("speak", { session_id: sessionId, reason, chars: text.length, question: asked });
    return true;
  }

  // What a turn has done so far. Hand-offs and commands take effect as their tool calls stream in,
  // so `handled` lets apply() skip them and `handoffMs` is when the first hand-off went out. `queued`
  // holds the turn's commands that wait for a pick being taken, in arrival order.
  type TurnWork = { handled: Set<ToolCall>; handoffs: number; commands: number; handoffMs: number | null; queued: Promise<void> | null };

  function handleCall(sessionId: string, st: SessionState, call: ToolCall, work: TurnWork, startedAt: number) {
    if (work.handled.has(call)) return;
    if (call.name === "update_build") {
      work.handled.add(call);
      if (forwardHandoff(sessionId, st, call.input)) {
        work.handoffs++;
        work.handoffMs ??= clock() - startedAt;
      }
    } else if (call.name === "ui_command") {
      work.handled.add(call);
      // A pick merges its winner only once the build loop has read its grounding lines from the store. A command
      // may aim at the winner's nodes, so while a hand-off is being taken it runs after that, as it did when picks
      // resolved synchronously; and a command behind it waits too, to keep their order.
      const pending = buildLoop.taken?.(sessionId) ?? null;
      if (!pending && !work.queued) {
        if (runCommand(sessionId, st, call.input)) work.commands++;
        return;
      }
      work.queued = (work.queued ?? Promise.resolve()).then(() => pending).then(() => {
        if (!ended.has(sessionId) && runCommand(sessionId, st, call.input)) work.commands++;
      }).catch((err) => log("conversation.command_failed", { session_id: sessionId, error: errorCode(err) }));
    }
  }

  async function apply(sessionId: string, st: SessionState, turn: Turn, result: RunToolsResult, work: TurnWork, startedAt: number) {
    // Hand-offs and commands normally took effect as they streamed, in arrival order, before any
    // speech. Anything still unhandled goes now: hand-offs first (a settled choice resolves
    // synchronously, which confirm_conflict depends on), then commands, then at most one line of speech.
    for (const call of result.toolCalls) if (call.name === "update_build") handleCall(sessionId, st, call, work, startedAt);
    // A pick resolves its conflict only once the build loop has read its grounding lines from the store. Commands
    // and confirm_conflict depend on the resolution, so they wait for it, as the old synchronous store let them.
    await buildLoop.taken?.(sessionId);
    for (const call of result.toolCalls) if (call.name === "ui_command") handleCall(sessionId, st, call, work, startedAt);
    await work.queued;
    let spoke: SpeakReason | null = null;
    let first = true;
    for (const call of result.toolCalls) {
      if (call.name !== "speak") continue;
      const s = await trySpeak(sessionId, st, turn, call.input, first);
      first = false;
      spoke ??= s;
    }
    return spoke;
  }

  async function run(sessionId: string, st: SessionState) {
    st.inFlight = true;
    st.dirty = false;
    const now = clock();
    const fresh = st.command && !st.command.shown ? st.command : null;
    const turn: Turn = {
      trigger: st.openingPending ? "opening" : st.stuck ? `stuck: ${st.stuck.reason}` : fresh ? "command_result" : "utterance",
      opening: st.openingPending,
      stuck: st.stuck,
      queuedMs: null,
    };
    if (turn.trigger === "utterance" && st.waitingSince !== null) turn.queuedMs = now - st.waitingSince;
    st.waitingSince = null;
    if (fresh) fresh.shown = true;
    try {
      try {
        await modelTurn(sessionId, st, turn, now);
      } catch (err) {
        log("conversation.turn_failed", { session_id: sessionId, trigger: turn.trigger.split(":")[0], error: errorCode(err) });
      }
      // The room always gets an opening: the fixed line when the model failed or didn't open.
      if (turn.opening && !st.opened && !ended.has(sessionId)) {
        st.opened = true;
        log("conversation.opening_fallback", { session_id: sessionId });
        await deliver(sessionId, st, FALLBACK_OPENING, "opening", st.addressedAt);
      }
    } finally {
      if (turn.opening) st.openingPending = false;
      if (turn.stuck && st.stuck === turn.stuck) st.stuck = null;
      st.inFlight = false;
      if (st.dirty) schedule(sessionId, st);
    }
  }

  async function modelTurn(sessionId: string, st: SessionState, turn: Turn, now: number) {
    const snap = view(sessionId);
    const open = openReasons(st, turn, snap.doc, now);
    const work: TurnWork = { handled: new Set(), handoffs: 0, commands: 0, handoffMs: null, queued: null };
    const result = await st.port.runTools({
      loop: "conversation", system: SYSTEM, tools: TOOLS, effort: "low",
      messages: [{ role: "user", content: userTurn(st, snap, turn, open, now) }],
      onToolCall: (call) => {
        // Streamed calls are too late to act on once the call has ended, like the turn's other calls.
        if (ended.has(sessionId)) return;
        try {
          handleCall(sessionId, st, call, work, now);
        } catch (err) {
          log("conversation.stream_call_failed", { session_id: sessionId, tool: call.name, error: errorCode(err) });
        }
      },
    });
    // The call ended while the model was thinking: its answer is too late to act on.
    if (ended.has(sessionId)) {
      log("conversation.turn_discarded", { session_id: sessionId, reason: "ended", tool_calls: result.toolCalls.length });
      return;
    }
    const spoke = await apply(sessionId, st, turn, result, work, now);
    log("conversation.turn", {
      session_id: sessionId, trigger: turn.trigger.split(":")[0], stop_reason: result.stopReason,
      tool_calls: result.toolCalls.length, dropped: result.dropped, ms: Math.round(result.ms),
      lines: st.lines.length, handoffs: work.handoffs, commands: work.commands, spoke,
      queued_ms: turn.queuedMs, handoff_ms: work.handoffMs,
    });
  }

  function pollSessions(now: number) {
    for (const [sessionId, st] of sessions) {
      if (!st.recording) continue;
      try {
        st.detector.onDoc(view(sessionId).doc);
        const ev = st.detector.poll(now);
        if (!ev) continue;
        st.stuck = ev;
        log("conversation.stuck", { session_id: sessionId, reason: ev.reason });
        schedule(sessionId, st);
      } catch (err) {
        log("conversation.poll_failed", { session_id: sessionId, error: errorCode(err) });
      }
    }
  }

  // Entry points are called from processRealtime and timers in app.ts: they log errors and never throw.
  const guard = (entry: string, sessionId: string | null, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      log("conversation.entry_failed", { ...(sessionId ? { session_id: sessionId } : {}), entry, error: errorCode(err) });
    }
  };

  // Speaks "So: <label>. Everyone OK?" for a conflict a spoken pick just resolved, through the same path as
  // speak (reason confirm_conflict), and marks it confirmed so the model's own confirmation is not also said.
  async function confirmPick(sessionId: string, conflictId: string, winner: string): Promise<void> {
    try {
      if (ended.has(sessionId)) return;
      const st = state(sessionId);
      const doc = view(sessionId).doc;
      const now = clock();
      const c = doc.conflicts.find((x) => x.id === conflictId);
      if (!c || c.status !== "resolved" || c.winner !== winner || !freshResolutions(st, doc, now).includes(conflictId)) return;
      if (speech.speaking(sessionId)) return;
      st.confirmed.add(conflictId);
      let said = false;
      try {
        said = await deliver(sessionId, st, `So: ${winner}. Everyone OK?`, "confirm_conflict", null);
      } finally {
        // Unsaid, so the model's own confirm_conflict (or a later turn) can still confirm it.
        if (!said) st.confirmed.delete(conflictId);
      }
      if (said) log("conversation.confirm_spoken", { session_id: sessionId, conflict_id: conflictId, winner });
    } catch (err) {
      log("conversation.confirm_failed", { session_id: sessionId, error: errorCode(err) });
    }
  }

  // A person's line that plainly picks an option shown on screen goes straight to the build loop, grounded in
  // that line, without waiting for the model to notice. The line still gets its normal turn. Never throws.
  const spokenPick = (sessionId: string, eventId: number, speaker: string | null, text: string) => {
    if (!speaker) return;
    try {
      const comparison = view(sessionId).comparison;
      if (!comparison) return;
      const winner = matchSpokenPick(text, comparison.variants.map((v) => v.label));
      if (!winner) return;
      log("conversation.spoken_pick", { session_id: sessionId, conflict_id: comparison.conflictId, winner });
      buildLoop.handoff(sessionId, {
        topics: [{ title: "Pick", task: `Merging option ${winner}`, proposals: [], questionsRaised: [], resolvedChoice: { conflictId: comparison.conflictId, winner } }],
        mood: "converging", groundingIds: [eventId],
      });
      // Once the pick is taken and really resolved the conflict, Builder confirms it itself.
      const taken = buildLoop.taken?.(sessionId) ?? null;
      const confirm = () => confirmPick(sessionId, comparison.conflictId, winner);
      if (taken) void taken.then(confirm, (err) => log("conversation.confirm_failed", { session_id: sessionId, error: errorCode(err) }));
      else void confirm();
    } catch (err) {
      log("conversation.spoken_pick_failed", { session_id: sessionId, error: errorCode(err) });
    }
  };

  return {
    onUtterance(sessionId: string, u: { id: number; speaker: string | null; text: string | null }): void {
      const text = u.text;
      if (u.speaker === botName || !text || ended.has(sessionId)) return;
      guard("onUtterance", sessionId, () => {
        const st = state(sessionId);
        pushLine(st, { id: u.id, speaker: u.speaker ?? "Unknown", text });
        st.humanIds.add(u.id);
        spokenPick(sessionId, u.id, u.speaker, text);
        st.waitingSince ??= clock();
        if (u.speaker) st.heard.add(u.speaker);
        st.commandFollowUps = 0;
        // Builder's name, or a question as the first reply to Builder's last line ("why?").
        const followUp = st.spokeAt !== null && clock() - st.spokeAt <= FOLLOW_UP_MS && text.trim().endsWith("?");
        st.spokeAt = null;
        const addressed = ADDRESS_RE.test(text) || followUp;
        st.detector.onHumanUtterance(text, u.speaker, addressed);
        try {
          if (addressed) markAddressed(sessionId, st, { lastSpeechWasQuestion: false });
          else runtime(sessionId).updateMoodInputs({ lastSpeechWasQuestion: false });
        } catch (err) {
          log("conversation.mood_failed", { session_id: sessionId, error: errorCode(err) });
        }
        maybeOpen(sessionId, st);
        schedule(sessionId, st);
      });
    },

    // Partials only make the character react: being addressed shows at once, before any model call.
    // Someone talking over Builder's voice stops it (the server fallback to the stage's own barge-in, spec 7).
    onPartial(sessionId: string, p: { speaker: string | null; text: string | null }): void {
      if (p.speaker === botName || !p.text || ended.has(sessionId)) return;
      guard("onPartial", sessionId, () => {
        if (speech.speaking(sessionId)) {
          speech.stop(sessionId);
          log("barge_in", { session_id: sessionId, source: "partial" });
        }
        if (ADDRESS_RE.test(p.text!)) markAddressed(sessionId, state(sessionId));
      });
    },

    onParticipant(sessionId: string, e: { kind: "join" | "leave"; name: string | null }): void {
      const name = e.name;
      if (!name || name === botName || ended.has(sessionId)) return;
      guard("onParticipant", sessionId, () => {
        const st = state(sessionId);
        if (e.kind === "join") st.present.add(name);
        else {
          st.present.delete(name);
          st.heard.delete(name);
        }
        maybeOpen(sessionId, st);
      });
    },

    onBotRecording(sessionId: string): void {
      if (ended.has(sessionId)) return;
      guard("onBotRecording", sessionId, () => {
        const st = state(sessionId);
        st.recording = true;
        maybeOpen(sessionId, st);
      });
    },

    // After a restart, for a call still recording (known issue M2): the opening is done, and the
    // transcript window and who is in the meeting are rebuilt from the stored events. The reloaded
    // lines count as handed off: the build loop had its turn at them, and handing them off again
    // could replay support for a decision reopened since.
    // Never rejects: a failure is logged like any entry point's.
    async resume(sessionId: string): Promise<void> {
      if (ended.has(sessionId) || sessions.has(sessionId)) return;
      let session, stored;
      try {
        [session, stored] = await Promise.all([store.getSession(sessionId), store.listEvents(sessionId)]);
      } catch (err) {
        log("conversation.entry_failed", { session_id: sessionId, entry: "resume", error: errorCode(err) });
        return;
      }
      // Met in the meantime (ended, or an event came first): what is in memory wins.
      if (ended.has(sessionId) || sessions.has(sessionId)) return;
      guard("resume", sessionId, () => {
        const st = state(sessionId, session?.bot_status === "in_call_recording");
        for (const e of stored) {
          if (e.speaker === botName) continue;
          if (e.kind === "utterance" && e.text) {
            pushLine(st, { id: e.id, speaker: e.speaker ?? "Unknown", text: e.text });
            st.humanIds.add(e.id);
            if (e.speaker) st.heard.add(e.speaker);
            st.handedOffThrough = Math.max(st.handedOffThrough, e.id);
          } else if (!e.speaker) {
            continue;
          } else if (e.kind === "join") {
            st.present.add(e.speaker);
          } else if (e.kind === "leave") {
            st.present.delete(e.speaker);
            st.heard.delete(e.speaker);
          }
        }
        log("conversation.resumed", { session_id: sessionId, lines: st.lines.length, people: humans(st).length });
      });
    },

    // The bot left the call (done, call_ended or fatal): stop speaking and drop the session's state.
    // A turn still in flight finishes, but its result is discarded.
    onBotEnded(sessionId: string): void {
      guard("onBotEnded", sessionId, () => {
        ended.add(sessionId);
        sessions.delete(sessionId);
        speech.stop(sessionId);
        log("conversation.ended", { session_id: sessionId });
      });
    },

    // Called about once a second: feeds the stuck detector and runs a turn when the room is stuck.
    poll(now: number): void {
      guard("poll", null, () => pollSessions(now));
    },
  };
}

export type ConversationLoop = ReturnType<typeof createConversationLoop>;
