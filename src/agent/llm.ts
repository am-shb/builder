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
export type RunToolsResult = { toolCalls: ToolCall[]; usage: Usage; ms: number };
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
      const started = Date.now();
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

      const blockNames = new Map<number, string>();
      let reportedCost: number | undefined;
      let message: Anthropic.Message;
      try {
        const stream = client.messages.stream(body as unknown as Anthropic.MessageStreamParams);
        stream.on("streamEvent", (event) => {
          const usage = event.type === "message_start" ? event.message.usage : event.type === "message_delta" ? event.usage : undefined;
          const cost = (usage as { cost?: unknown } | undefined)?.cost;
          if (typeof cost === "number") reportedCost = cost;
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            blockNames.set(event.index, event.content_block.name);
          } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
            const name = blockNames.get(event.index);
            if (name && req.onToolInputDelta) req.onToolInputDelta(name, event.delta.partial_json);
          }
        });
        message = await stream.finalMessage();
      } catch (err) {
        // Typed API/connection errors propagate; only a malformed tool-input stream is absorbed.
        if (err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError) && /JSON/i.test(err.message)) {
          log("llm_bad_stream_json", { loop: req.loop, model });
          return { toolCalls: [], usage: zeroUsage(), ms: Date.now() - started };
        }
        throw err;
      }

      const u = message.usage;
      const usage: Usage = {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        ...(reportedCost === undefined ? {} : { costUsd: reportedCost }),
      };

      const toolCalls: ToolCall[] = [];
      const stop = message.stop_reason;
      if (stop === "refusal" || stop === "max_tokens") {
        // A refusal or truncation can cut a tool input short: never use this turn's tools.
        log("llm_tools_discarded", { loop: req.loop, model, stop_reason: stop });
      } else {
        for (const block of message.content) {
          if (block.type !== "tool_use") continue;
          if (!schemas.has(block.name)) {
            log("llm_tool_dropped", { loop: req.loop, tool: block.name, reason: "unknown_tool" });
            continue;
          }
          const schema = schemas.get(block.name);
          if (schema) {
            const parsed = schema.safeParse(block.input);
            if (!parsed.success) {
              log("llm_tool_dropped", { loop: req.loop, tool: block.name, reason: "invalid_input", issues: parsed.error.issues.length });
              continue;
            }
            toolCalls.push({ name: block.name, input: parsed.data });
          } else {
            toolCalls.push({ name: block.name, input: block.input });
          }
        }
      }

      const ms = Date.now() - started;
      log("llm_call", {
        id: message.id, loop: req.loop, model, stop_reason: stop, tool_calls: toolCalls.length, ms,
        input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens, cache_write_tokens: usage.cacheWriteTokens, cost_usd: usage.costUsd ?? null,
      });
      return { toolCalls, usage, ms };
    },
  };
}

const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

// Scripted port for tests: call N returns script[N] (empty once exhausted) with
// small nonzero usage so cost accounting has something to record.
export function createFakePort(script: ToolCall[][], usage: Usage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }): ModelPort {
  let call = 0;
  return {
    async runTools() {
      return { toolCalls: script[call++] ?? [], usage: { ...usage }, ms: 1 };
    },
  };
}
