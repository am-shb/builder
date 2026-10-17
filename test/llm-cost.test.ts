import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp } from "../src/app.ts";
import { MODELS, BUILD_FALLBACKS, createFakePort, createOpenRouterPort } from "../src/agent/llm.ts";
import { PRICES, costOf, withCostRecording } from "../src/agent/cost.ts";
import { patchBatchJsonSchema } from "../src/ui/schema.ts";

const ENV = {
  RECALL_REGION: "us-west-2", RECALL_API_KEY: "test-key",
  RECALL_WEBHOOK_VERIFICATION_SECRET: "whsec_" + Buffer.from("unit-test-secret").toString("base64"),
  PUBLIC_API_BASE_URL: "https://agent.example.com/",
};

const openServers = new Set<http.Server>();
after(() => { for (const s of openServers) { s.closeAllConnections(); s.close(); } });

const REQ = { system: "sys", messages: [{ role: "user", content: "hi" }] };

test("costOf computes cache-aware cost", () => {
  const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 400 };
  const p = PRICES[MODELS.build];
  assert.deepEqual(p, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
  // (1000*4 + 500*20 + 2000*0.2 + 400*5) / 1e6
  assert.ok(Math.abs(costOf(MODELS.build, usage) - 0.0164) < 1e-12);
  assert.ok(costOf(MODELS.conversation, usage) < costOf(MODELS.build, usage));
  // Provider-reported cost wins over the computed value.
  assert.equal(costOf(MODELS.build, { ...usage, costUsd: 0.5 }), 0.5);
  assert.equal(costOf("unknown/model", usage), 0);
});

test("fake port records calls and costs into model_calls", async () => {
  const store = openStore(":memory:");
  const fake = createFakePort([[{ name: "a", input: { x: 1 } }], []]);
  const port = withCostRecording(fake, { store, sessionId: "s1" });
  const r1 = await port.runTools({ loop: "build", ...REQ, tools: [], effort: "medium" });
  await port.runTools({ loop: "conversation", ...REQ, tools: [], effort: "low" });
  assert.deepEqual(r1.toolCalls, [{ name: "a", input: { x: 1 } }]);
  const rows = store.listModelCalls("s1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].loop, "build");
  assert.equal(rows[0].model, MODELS.build);
  assert.equal(rows[1].model, MODELS.conversation);
  assert.ok(rows[0].usd > 0);
  assert.equal(rows[0].input_tokens, r1.usage.inputTokens);
  assert.equal(store.sessionCost("s1"), rows[0].usd + rows[1].usd);
  store.close();
});

test("sessionCost sums per session", () => {
  const store = openStore(":memory:");
  const row = { loop: "build", model: MODELS.build, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ms: 5 };
  store.addModelCall({ sessionId: "a", ...row, usd: 0.25 });
  store.addModelCall({ sessionId: "a", ...row, usd: 0.5 });
  store.addModelCall({ sessionId: "b", ...row, usd: 1 });
  assert.equal(store.sessionCost("a"), 0.75);
  assert.equal(store.sessionCost("b"), 1);
  assert.equal(store.sessionCost("none"), 0);
  store.close();
});

test("session view includes cost_usd", async () => {
  const config = loadConfig(ENV);
  const store = openStore(":memory:");
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({})) as any, sleep: async () => {} });
  const app = createApp({ config, recall, store, log: () => {} });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  try {
    const id = randomUUID();
    store.createIntent(id, "https://meet.google.com/abc-defg-hij");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal(((await (await fetch(`${base}/api/sessions/${id}`)).json()) as any).session.cost_usd, 0);
    store.addModelCall({ sessionId: id, loop: "build", model: MODELS.build, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.125, ms: 1 });
    assert.equal(((await (await fetch(`${base}/api/sessions/${id}`)).json()) as any).session.cost_usd, 0.125);
  } finally { openServers.delete(server); server.closeAllConnections(); server.close(); store.close(); }
});

test("config without OPENROUTER_API_KEY disables agent without throwing", () => {
  const off = loadConfig(ENV);
  assert.equal(off.agentEnabled, false);
  assert.equal(off.openrouterApiKey, null);
  assert.equal(off.ttsVoice, null);
  const on = loadConfig({ ...ENV, OPENROUTER_API_KEY: " or-key ", TTS_VOICE: "voice-1" });
  assert.equal(on.agentEnabled, true);
  assert.equal(on.openrouterApiKey, "or-key");
  assert.equal(on.ttsVoice, "voice-1");
  assert.throws(() => createOpenRouterPort(off), /OPENROUTER_API_KEY/);
});

// ---- OpenRouter port, with the network replaced by a fake fetch ----

type Sent = { url: string; auth: string | null; body: any };

function sse(events: unknown[]): Response {
  const text = events.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function toolUseStream(opts: { name: string; json: string[]; stop?: string; cost?: number }) {
  return [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 30 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: opts.name, input: {} } },
    ...opts.json.map((partial_json) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: opts.stop ?? "tool_use", stop_sequence: null }, usage: { output_tokens: 42, ...(opts.cost === undefined ? {} : { cost: opts.cost }) } },
    { type: "message_stop" },
  ];
}

function portWith(events: unknown[]) {
  const sent: Sent[] = [];
  const fakeFetch = (async (url: any, init: any) => {
    sent.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(init.body) });
    return sse(events);
  }) as typeof fetch;
  const port = createOpenRouterPort({ openrouterApiKey: "or-test-key" }, { fetch: fakeFetch, log: () => {} });
  return { port, sent };
}

const EmitSchema = z.strictObject({ n: z.number() });
const emitTool = { name: "emit", description: "emit", strict: true, input_schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, schema: EmitSchema };

test("port sends baseURL openrouter, model slugs, and fallbacks only on build calls", async () => {
  const { port, sent } = portWith(toolUseStream({ name: "emit", json: ['{"n":', "1}"] }));
  await port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  await port.runTools({ loop: "conversation", ...REQ, tools: [emitTool], effort: "low" });
  const [build, conv] = sent;
  assert.equal(build.url, "https://openrouter.ai/api/v1/messages");
  assert.equal(build.auth, "Bearer or-test-key");
  assert.equal(build.body.model, "anthropic/claude-opus-5.5");
  assert.deepEqual(build.body.fallbacks, BUILD_FALLBACKS.map((model) => ({ model })));
  assert.deepEqual(build.body.fallbacks, [{ model: "anthropic/claude-opus-5" }]);
  assert.equal(build.body.output_config.effort, "medium");
  assert.equal(conv.body.model, "anthropic/claude-haiku-5.5");
  assert.equal("fallbacks" in conv.body, false);
  assert.equal(conv.body.output_config.effort, "low");
  for (const s of sent) {
    assert.equal(s.body.stream, true);
    assert.equal("tool_choice" in s.body, false);
    assert.equal("schema" in s.body.tools[0], false, "zod schema must not be sent");
  }
});

test("port sends strict eager tools unchanged and caches system and tools", async () => {
  const { port, sent } = portWith(toolUseStream({ name: "emit", json: ['{"n":1}'] }));
  const batchTool = { name: "patch", description: "p", strict: true, input_schema: patchBatchJsonSchema() };
  await port.runTools({ loop: "build", system: "SYS", messages: REQ.messages, tools: [emitTool, batchTool], effort: "medium" });
  const body = sent[0].body;
  assert.equal(body.tools[0].strict, true);
  assert.equal(body.tools[0].eager_input_streaming, true);
  assert.deepEqual(body.tools[1].input_schema, patchBatchJsonSchema());
  assert.equal(body.tools[1].strict, true);
  // Cache breakpoint on the last tool and on the system prompt.
  assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral" });
  assert.equal(body.tools[0].cache_control, undefined);
  assert.deepEqual(body.system, [{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }]);
});

test("port returns validated tool calls, usage, provider cost, and streams input deltas", async () => {
  const { port } = portWith(toolUseStream({ name: "emit", json: ['{"n":', "7", "}"], cost: 0.0123 }));
  const deltas: [string, string][] = [];
  const r = await port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium", onToolInputDelta: (n, d) => deltas.push([n, d]) });
  assert.deepEqual(r.toolCalls, [{ name: "emit", input: { n: 7 } }]);
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 42, cacheReadTokens: 200, cacheWriteTokens: 30, costUsd: 0.0123 });
  assert.ok(deltas.length > 1);
  assert.deepEqual(deltas.map((d) => d[0]), ["emit", "emit", "emit"]);
  assert.equal(deltas.map((d) => d[1]).join(""), '{"n":7}');
  assert.ok(r.ms >= 0);
});

test("port drops invalid tool input, unknown tools, and ignores calls after refusal or max_tokens", async () => {
  const logs: string[] = [];
  const mk = (events: unknown[]) => createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: (async () => sse(events)) as typeof fetch, log: (m) => logs.push(m) });
  const run = (p: ReturnType<typeof mk>) => p.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  assert.deepEqual((await run(mk(toolUseStream({ name: "emit", json: ['{"n":"nope"}'] })))).toolCalls, []);
  assert.deepEqual((await run(mk(toolUseStream({ name: "other", json: ['{"n":1}'] })))).toolCalls, []);
  assert.deepEqual((await run(mk(toolUseStream({ name: "emit", json: ['{"n":1}'], stop: "refusal" })))).toolCalls, []);
  assert.deepEqual((await run(mk(toolUseStream({ name: "emit", json: ['{"n":1}'], stop: "max_tokens" })))).toolCalls, []);
  assert.ok(logs.length >= 4);
  assert.ok(!logs.join("\n").includes("nope"), "tool input must not be logged");
});
