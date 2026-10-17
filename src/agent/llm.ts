// Model port: the single place that talks to a model. Everything goes through
// OpenRouter's Anthropic-format Messages endpoint with the official SDK.
// Never logs keys, prompts, tool inputs or responses: ids, counts and timings only.
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const MODELS = {
  conversation: "anthropic/claude-haiku-5.5",
  build: "anthropic/claude-opus-5.5",
} as const;
export type Loop = keyof typeof MODELS;

// OpenRouter `fallbacks`: tried in order when the primary model fails. Build calls only.
export const BUILD_FALLBACKS: string[] = ["anthropic/claude-opus-5"];

export type ToolCall = { name: string; input: unknown };

// Token counts as the Anthropic Messages API reports them: inputTokens excludes
// cache reads/writes. costUsd is OpenRouter's own cost when the response carried one.
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
};

// A model-facing tool definition. `schema` is optional and never sent: when
// present, every model-produced input is validated against it before use.
export type PortTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
  schema?: z.ZodType;
};

export type RunToolsRequest = {
  loop: Loop;
  system: string;
  messages: unknown[];
  tools: unknown[];
  effort: "low" | "medium";
  onToolInputDelta?: (toolName: string, partialJson: string) => void;
};
// stopReason is the model's stop_reason (null if the stream was cut off); dropped counts
// tool calls discarded as unknown, incomplete, unparseable or schema-invalid.
export type RunToolsResult = { toolCalls: ToolCall[]; usage: Usage; ms: number; stopReason: string | null; dropped: number };
export type ModelPort = { runTools(req: RunToolsRequest): Promise<RunToolsResult> };

type Log = (msg: string, fields?: Record<string, unknown>) => void;

const MAX_TOKENS: Record<Loop, number> = { conversation: 2048, build: 32000 };
const EPHEMERAL = { type: "ephemeral" } as const;

export function createOpenRouterPort(
  config: { openrouterApiKey: string | null },
  opts: { fetch?: typeof fetch; log?: Log } = {},
): ModelPort {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is required for the model port");
  const log = opts.log ?? (() => {});
  const client = new Anthropic({
    baseURL: "https://openrouter.ai/api",
    authToken: config.openrouterApiKey,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    async runTools(req) {
      const started0 = Date.now();
      const model = MODELS[req.loop];
      const defs = req.tools as PortTool[];
      const schemas = new Map(defs.map((t) => [t.name, t.schema] as const));

      // Strip our local-only `schema`, turn on eager input streaming, and put a cache
      // breakpoint on the last tool (tools render before system) and on the system prompt.
      const tools = defs.map(({ schema: _schema, ...wire }, i) => ({
        ...wire,
        eager_input_streaming: true,
        ...(i === defs.length - 1 ? { cache_control: EPHEMERAL } : {}),
      }));
      const body = {
        model,
        max_tokens: MAX_TOKENS[req.loop],
        system: [{ type: "text", text: req.system, cache_control: EPHEMERAL }],
        messages: req.messages,
        tools,
        output_config: { effort: req.effort },
        // OpenRouter-only field: {model: string}[] (max 3). Build loop only.
        ...(req.loop === "build" ? { fallbacks: BUILD_FALLBACKS.map((m) => ({ model: m })) } : {}),
      };

      // Everything below is accumulated from raw stream events (not the SDK's final
      // message) so usage and completed tool calls survive a truncated stream.
      type Block = { name: string; json: string; closed: boolean };
      const blocks = new Map<number, Block>();
      const usage: Usage = zeroUsage();
      let stopReason: string | null = null;
      let messageId: string | null = null;
      let started = false;
      const take = (n: unknown, into: (v: number) => void) => { if (typeof n === "number") into(n); };
      try {
        const stream = client.messages.stream(body as unknown as Anthropic.MessageStreamParams);
        stream.on("streamEvent", (event) => {
          started = true;
          if (event.type === "message_start") messageId = event.message.id;
          const u = (event.type === "message_start" ? event.message.usage : event.type === "message_delta" ? event.usage : undefined) as
            | Record<string, unknown> | undefined;
          if (u) {
            take(u.input_tokens, (v) => { usage.inputTokens = v; });
            take(u.output_tokens, (v) => { usage.outputTokens = v; });
            take(u.cache_read_input_tokens, (v) => { usage.cacheReadTokens = v; });
            take(u.cache_creation_input_tokens, (v) => { usage.cacheWriteTokens = v; });
            take(u.cost, (v) => { usage.costUsd = v; });
          }
          if (event.type === "message_delta") stopReason = event.delta.stop_reason ?? stopReason;
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            blocks.set(event.index, { name: event.content_block.name, json: "", closed: false });
          } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
            const b = blocks.get(event.index);
            if (b) {
              b.json += event.delta.partial_json;
              req.onToolInputDelta?.(b.name, event.delta.partial_json);
            }
          } else if (event.type === "content_block_stop") {
            const b = blocks.get(event.index);
            if (b) b.closed = true;
          }
        });
        await stream.done();
      } catch (err) {
        // Typed API/connection errors, and anything before the response began, propagate.
        // A non-API SDK error after events started means the stream ended or broke
        // mid-way: keep the usage seen (the call was billed) and the completed tool calls.
        if (!started || !(err instanceof Anthropic.AnthropicError) || err instanceof Anthropic.APIError) throw err;
        log("llm_stream_truncated", { loop: req.loop, model, id: messageId });
      }

      const toolCalls: ToolCall[] = [];
      let dropped = 0;
      if (stopReason === "refusal" || stopReason === "max_tokens") {
        // A refusal or truncation can cut a tool input short: never use this turn's tools.
        log("llm_tools_discarded", { loop: req.loop, model, stop_reason: stopReason });
      } else {
        for (const block of [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b)) {
          const drop = (reason: string, extra: Record<string, unknown> = {}) => {
            dropped++;
            log("llm_tool_dropped", { loop: req.loop, tool: block.name, reason, ...extra });
          };
          if (!schemas.has(block.name)) { drop("unknown_tool"); continue; }
          if (!block.closed) { drop("incomplete_input"); continue; }
          let input: unknown;
          try {
            input = JSON.parse(block.json.trim() === "" ? "{}" : block.json);
          } catch {
            drop("invalid_json");
            continue;
          }
          const schema = schemas.get(block.name);
          if (schema) {
            const checked = validateToolInput(schema, input);
            if (!checked.ok) {
              drop("invalid_input", { issues: checked.issues.length, issue_details: issueDetails(checked.issues) });
              continue;
            }
            if (checked.repairs.length) log("llm_tool_repaired", { loop: req.loop, tool: block.name, repairs: checked.repairs });
            input = checked.data;
          }
          toolCalls.push({ name: block.name, input });
        }
      }

      const ms = Date.now() - started0;
      log("llm_call", {
        id: messageId, loop: req.loop, model, stop_reason: stopReason, tool_calls: toolCalls.length, dropped, ms,
        input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens, cache_write_tokens: usage.cacheWriteTokens, cost_usd: usage.costUsd ?? null,
      });
      return { toolCalls, usage, ms, stopReason, dropped };
    },
  };
}

// Where and how a tool input failed validation: the dotted path (schema keys and array
// indexes) and the zod issue code. Never the issue message or values, which can carry content.
export function issueDetails(issues: readonly { path: readonly PropertyKey[]; code: string }[]): { path: string; code: string }[] {
  return issues.map((i) => ({ path: i.path.map(String).join("."), code: i.code }));
}

type Issue = z.core.$ZodIssue;
type Checked = { ok: true; data: unknown; repairs: { path: string; code: string }[] } | { ok: false; issues: Issue[] };

/**
 * Validates a model's tool input against the tool's zod schema. `strict: true` is not enforced end
 * to end through OpenRouter: a live probe (scripts/probe-handoff.ts) saw Haiku add a key the schema
 * does not declare, at the wrong level. Undeclared keys are the one slip repaired, for every tool:
 * they are stripped and the input validated again. Everything else stays strict (types, enums, ids,
 * required fields, nulls), and an input that still fails is reported with its original issues.
 */
export function validateToolInput(schema: z.ZodType, input: unknown): Checked {
  const first = schema.safeParse(input);
  if (first.success) return { ok: true, data: first.data, repairs: [] };
  const strays = first.error.issues.filter((i) => i.code === "unrecognized_keys");
  if (!strays.length) return { ok: false, issues: first.error.issues };
  const copy = structuredClone(input);
  for (const issue of strays) {
    let at: unknown = copy;
    for (const k of issue.path) at = at && typeof at === "object" ? (at as Record<PropertyKey, unknown>)[k] : undefined;
    if (at && typeof at === "object" && !Array.isArray(at)) for (const k of issue.keys) delete (at as Record<string, unknown>)[k];
  }
  const second = schema.safeParse(copy);
  return second.success ? { ok: true, data: second.data, repairs: issueDetails(strays) } : { ok: false, issues: first.error.issues };
}

const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

// Scripted port for tests: call N returns script[N] (empty once exhausted) with
// small nonzero usage so cost accounting has something to record.
export function createFakePort(script: ToolCall[][], usage: Usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }): ModelPort {
  let call = 0;
  return {
    async runTools() {
      const toolCalls = script[call++] ?? [];
      return { toolCalls, usage: { ...usage }, ms: 1, stopReason: toolCalls.length ? "tool_use" : "end_turn", dropped: 0 };
    },
  };
}

// Scripted port for end-to-end replays: the conversation loop (Haiku) and the build loop (Opus)
// share one port, so each call is routed to its own loop's script by the request's `loop`.
export function createRoutedFakePort(scripts: Record<Loop, ToolCall[][]>, usage?: Usage): ModelPort {
  const ports: Record<Loop, ModelPort> = {
    conversation: createFakePort(scripts.conversation, usage),
    build: createFakePort(scripts.build, usage),
  };
  return { runTools: (req) => ports[req.loop].runTools(req) };
}
