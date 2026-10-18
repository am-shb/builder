// Manual live probe of the conversation loop's tool inputs (Haiku, a few cents at most).
//   node --env-file=.env scripts/probe-handoff.ts   (from a worktree: --env-file=<repo root>/.env)
// Drives the real conversation loop (real system prompt, tools and user turn) through the real
// OpenRouter port on synthetic meetings, one model call per round. The tools reach the port
// without their local zod schema, so the raw model input comes back; this script checks it
// against the wire schema and prints per call: tool names, valid or invalid, and for each issue
// its dotted path, zod code and the JSON type found at that path; then what the port's own
// validation (validateToolInput with the tool's local schema) does with it: accepted or dropped.
// It never prints the key, the transcript, the prompt, or model output beyond tool names, issue
// paths and types (an unknown key is named only when it is one of the tool schema's own fields).
import { randomUUID } from "node:crypto";
import { openStore } from "../src/store.ts";
import { createRuntime } from "../src/session/runtime.ts";
import { createOpenRouterPort, issueDetails, MODELS, validateToolInput } from "../src/agent/llm.ts";
import type { ModelPort, PortTool, RunToolsResult, ToolCall } from "../src/agent/llm.ts";
import { createConversationLoop } from "../src/agent/conversation-loop.ts";
import type { Speech } from "../src/agent/conversation-loop.ts";
import { costOf } from "../src/agent/cost.ts";
import type { ConsensusDoc } from "../src/consensus/doc.ts";
import { HandoffSchema } from "../src/agent/handoff.ts";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}

const real = createOpenRouterPort({ openrouterApiKey: key }, {
  log: (msg, f) => { if (msg === "llm_call") totalUsd += typeof f?.cost_usd === "number" ? f.cost_usd : 0; },
});
let totalUsd = 0;
let computedUsd = 0;
let calls = 0;
let live = false;
let inFlight = false;

// JSON type at a path in the raw input: "absent", "null", "array", "object", "string", ...
function typeAt(input: unknown, path: string): string {
  let v: unknown = input;
  for (const k of path === "" ? [] : path.split(".")) {
    if (v === null || typeof v !== "object" || !(k in (v as object))) return "absent";
    v = (v as Record<string, unknown>)[k];
  }
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

// Every property name declared anywhere in a JSON schema: our schema's vocabulary.
function propertyNames(schema: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const v of schema) propertyNames(v, into);
  else if (schema && typeof schema === "object") {
    for (const [k, v] of Object.entries(schema)) {
      if (k === "properties" && v && typeof v === "object") for (const name of Object.keys(v)) into.add(name);
      propertyNames(v, into);
    }
  }
  return into;
}

async function liveCall(req: Parameters<ModelPort["runTools"]>[0]): Promise<RunToolsResult> {
  const defs = req.tools as PortTool[];
  const schemas = new Map(defs.map((t) => [t.name, t.schema] as const));
  const vocab = new Map(defs.map((t) => [t.name, propertyNames(t.input_schema)] as const));
  // No onToolCall: the conversation loop forwards each hand-off as it streams, and this probe
  // returns the calls at the end, so streaming here would forward every hand-off twice.
  const r = await real.runTools({ ...req, onToolCall: undefined, tools: defs.map(({ schema: _s, ...wire }) => wire) });
  computedUsd += costOf(MODELS[req.loop], r.usage);
  const kept: ToolCall[] = [];
  const rows: string[] = [];
  for (const call of r.toolCalls) {
    const schema = schemas.get(call.name)!;
    // "raw" is the input checked exactly as the wire schema declares it (for update_build that is
    // HandoffSchema, before HandoffToolInput's hoist); "port" is what the port now does with it.
    const raw = (call.name === "update_build" ? HandoffSchema : schema).safeParse(call.input);
    if (raw.success) {
      rows.push(`  ${call.name}: valid`);
      kept.push({ name: call.name, input: schema.parse(call.input) });
      continue;
    }
    const port = validateToolInput(schema, call.input);
    rows.push(`  ${call.name}: INVALID raw (${raw.error.issues.length} issues), port: ${port.ok ? `accepted${port.repairs.length ? `, stripped keys at [${port.repairs.map((r) => r.path || "(root)").join(", ")}]` : ""}` : "dropped"}`);
    for (const [n, d] of issueDetails(raw.error.issues).entries()) {
      const issue = raw.error.issues[n];
      // An unknown key prints only when it is a field name of this tool's own schema (ours, not
      // model content), i.e. a known field at the wrong level; anything else prints as <other>.
      const extra = issue.code === "unrecognized_keys"
        ? ` keys=[${issue.keys.map((k) => (vocab.get(call.name)!.has(k) ? k : "<other>")).join(", ")}]`
        : "";
      rows.push(`    path=${d.path || "(root)"} code=${d.code} found=${typeAt(call.input, d.path)}${extra}`);
    }
    if (port.ok) kept.push({ name: call.name, input: port.data });
  }
  console.log(`call ${calls}: stop=${r.stopReason} tools=[${r.toolCalls.map((c) => c.name).join(", ")}] port_dropped=${r.dropped} usd=${(r.usage.costUsd ?? costOf(MODELS[req.loop], r.usage)).toFixed(5)}`);
  for (const row of rows) console.log(row);
  return { ...r, toolCalls: kept };
}

// Only rounds marked live reach the model; the lines before them build up the window for free.
const port: ModelPort = {
  async runTools(req) {
    if (!live) return { toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ms: 0, stopReason: "end_turn", dropped: 0 };
    live = false;
    calls++;
    inFlight = true;
    try {
      return await liveCall(req);
    } finally {
      inFlight = false;
    }
  },
};

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise<void>((res) => setImmediate(res)); };

type Round = [speaker: string, text: string][];
type Scenario = { name: string; doc?: ConsensusDoc; rounds: Round[] };

const variantBatch = (label: string) => ({ ops: [], label });
const conflictDoc: ConsensusDoc = {
  phase: "explore", app: { name: "Habit tracker", purpose: "Build daily habits" }, openQuestions: [], nextUp: [],
  decisions: [{ id: "d1", text: "Home screen lists today's habits", status: "agreed", proposedBy: "Maya", agreedBy: ["Jon"], affects: ["home"], rejectedOptions: [], decidedAt: 1 }],
  conflicts: [{
    id: "c1", topic: "How progress is shown", status: "open", openedAt: 1,
    variants: [
      { label: "A", summary: "Streak counter on each habit", backers: ["Maya"], batch: variantBatch("Streak counter") },
      { label: "B", summary: "Monthly calendar heatmap", backers: ["Jon"], batch: variantBatch("Calendar heatmap") },
    ],
  }],
};

const scenarios: Scenario[] = [
  {
    name: "habit tracker: proposals, then a disagreement",
    rounds: [
      [
        ["Maya", "So the idea is a habit tracker. You open it and see today's habits as a checklist."],
        ["Jon", "Yeah, and tapping a habit marks it done for today."],
        ["Maya", "Let's also have a big plus button at the bottom to add a new habit."],
        ["Jon", "Agreed, plus button at the bottom right."],
      ],
      [
        ["Jon", "For progress I really want streaks, like a flame with the number of days."],
        ["Maya", "I don't like streaks, they make people quit when they break. I'd rather show a weekly percentage."],
        ["Jon", "Hmm, but streaks are what makes these apps sticky."],
        ["Maya", "What happens to the streak if you're sick for a day though?"],
      ],
    ],
  },
  {
    name: "habit tracker with an open conflict: the room settles it, asks for a view",
    doc: conflictDoc,
    rounds: [
      [
        ["Maya", "Okay, about the progress view, the streak counter or the calendar."],
        ["Jon", "I still think the calendar heatmap reads better at a glance."],
      ],
      [
        ["Maya", "Fine, you convinced me, let's go with option B, the calendar."],
        ["Jon", "Great, B it is."],
        ["Maya", "Can we see the settings screen next? I want reminders in there."],
      ],
    ],
  },
  {
    name: "habit tracker: addressed with a question and a screen request",
    rounds: [
      [
        ["Priya", "We need some kind of reminder per habit, like a time of day."],
        ["Sam", "And maybe an optional note. Builder, can you show us the habit detail screen?"],
      ],
    ],
  },
];

for (const sc of scenarios) {
  console.log(`\n== ${sc.name}`);
  const store = openStore(":memory:");
  const sessionId = randomUUID();
  store.createIntent(sessionId, "https://meet.google.com/abc-defg-hij");
  const runtime = createRuntime({ store, channel: { send() {}, sendAudio() {}, clients: () => 0 } });
  if (sc.doc) runtime(sessionId).setDoc(sc.doc);
  const speech: Speech = { say: async () => randomUUID(), stop() {}, speaking: () => false };
  let handoffs = 0;
  const loop = createConversationLoop({
    port, runtime, speech, store, clock: Date.now,
    buildLoop: { handoff() { handoffs++; } },
    log: (msg, f) => { if (msg.startsWith("handoff.") || msg.endsWith("_invalid")) console.log(`  loop: ${msg} ${JSON.stringify(f && { issues: f.issues, given: f.given })}`); },
  });
  for (const round of sc.rounds) {
    for (const [i, [speaker, text]] of round.entries()) {
      const e = store.addEvent({ sessionId, recallMsgId: null, kind: "utterance", speaker, text })!;
      if (i === round.length - 1) live = true;
      const before = calls;
      loop.onUtterance(sessionId, { id: e.id, speaker, text });
      await flush();
      if (i === round.length - 1 || calls > before) for (let w = 0; w < 600 && (live || inFlight); w++) await new Promise<void>((res) => setTimeout(res, 100));
      await flush();
    }
  }
  console.log(`  handoffs forwarded: ${handoffs}`);
  store.close();
}

console.log(`\ncalls=${calls} openrouter_usd=${totalUsd.toFixed(5)} computed_usd=${computedUsd.toFixed(5)}`);
