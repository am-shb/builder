import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../src/config.ts";
import { createRecallClient } from "../src/recall-client.ts";
import { openStore } from "../src/store.ts";
import { createApp } from "../src/app.ts";
import { MODELS, BUILD_FALLBACKS, DEADLINE_MS, createFakePort, createOpenRouterPort, type ToolCall } from "../src/agent/llm.ts";
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
  const store = await openStore();
  const fake = createFakePort([[{ name: "a", input: { x: 1 } }], []]);
  const port = withCostRecording(fake, { store, sessionId: "s1" });
  const r1 = await port.runTools({ loop: "build", ...REQ, tools: [], effort: "medium" });
  await port.runTools({ loop: "conversation", ...REQ, tools: [], effort: "low" });
  assert.deepEqual(r1.toolCalls, [{ name: "a", input: { x: 1 } }]);
  const rows = await store.listModelCalls("s1");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].loop, "build");
  assert.equal(rows[0].model, MODELS.build);
  assert.equal(rows[1].model, MODELS.conversation);
  assert.ok(rows[0].usd > 0);
  assert.equal(rows[0].input_tokens, r1.usage.inputTokens);
  assert.equal(await store.sessionCost("s1"), rows[0].usd + rows[1].usd);
  await store.close();
});

test("sessionCost sums per session", async () => {
  const store = await openStore();
  const row = { loop: "build", model: MODELS.build, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ms: 5 };
  await store.addModelCall({ sessionId: "a", ...row, usd: 0.25 });
  await store.addModelCall({ sessionId: "a", ...row, usd: 0.5 });
  await store.addModelCall({ sessionId: "b", ...row, usd: 1 });
  assert.equal(await store.sessionCost("a"), 0.75);
  assert.equal(await store.sessionCost("b"), 1);
  assert.equal(await store.sessionCost("none"), 0);
  await store.close();
});

test("session view includes cost_usd", async () => {
  const config = loadConfig(ENV);
  const store = await openStore();
  const recall = createRecallClient({ region: config.region, apiKey: config.apiKey, fetch: (async () => Response.json({})) as any, sleep: async () => {} });
  const app = await createApp({ config, recall, store, log: () => {} });
  const server = http.createServer(app.handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  openServers.add(server);
  try {
    const id = randomUUID();
    await store.createIntent(id, "https://meet.google.com/abc-defg-hij");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal(((await (await fetch(`${base}/api/sessions/${id}`)).json()) as any).session.cost_usd, 0);
    await store.addModelCall({ sessionId: id, loop: "build", model: MODELS.build, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.125, ms: 1 });
    assert.equal(((await (await fetch(`${base}/api/sessions/${id}`)).json()) as any).session.cost_usd, 0.125);
  } finally { openServers.delete(server); server.closeAllConnections(); server.close(); await store.close(); }
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

function twoBlockEvents(a: { name: string; json: string }, b: { name: string; json: string }) {
  const [start] = toolUseStream({ name: a.name, json: [] });
  const block = (index: number, o: { name: string; json: string }) => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${index}`, name: o.name, input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: o.json } },
    { type: "content_block_stop", index },
  ];
  return {
    head: [start, ...block(0, a)],
    second: block(1, b),
    tail: [{ type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 42 } }, { type: "message_stop" }],
  };
}
const sseText = (events: unknown[]) => events.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const tick = () => new Promise((r) => setTimeout(r, 20));

test("port reports each valid tool call through onToolCall as its block closes, before the stream ends", async () => {
  const ev = twoBlockEvents({ name: "emit", json: '{"n":1}' }, { name: "emit", json: '{"n":2}' });
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctl = c; } });
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, {
    fetch: (async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch,
    log: () => {},
  });
  const seen: ToolCall[] = [];
  const pending = port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium", onToolCall: (c) => seen.push(c) });
  ctl.enqueue(enc.encode(sseText(ev.head)));
  await tick();
  assert.deepEqual(seen, [{ name: "emit", input: { n: 1 } }]);
  ctl.enqueue(enc.encode(sseText(ev.second)));
  await tick();
  assert.equal(seen.length, 2);
  ctl.enqueue(enc.encode(sseText(ev.tail)));
  ctl.close();
  const r = await pending;
  assert.equal(seen.length, 2);
  assert.deepEqual(r.toolCalls, seen);
  for (let i = 0; i < seen.length; i++) assert.equal(r.toolCalls[i], seen[i]);
});

test("onToolCall never receives invalid or unknown tool calls", async () => {
  const ev = twoBlockEvents({ name: "emit", json: '{"n":"x"}' }, { name: "nope", json: "{}" });
  const logs: string[] = [];
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: (async () => sse([...ev.head, ...ev.second, ...ev.tail])) as typeof fetch, log: (m) => logs.push(m) });
  const seen: ToolCall[] = [];
  const r = await port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium", onToolCall: (c) => seen.push(c) });
  assert.deepEqual(seen, []);
  assert.deepEqual(r.toolCalls, []);
  assert.equal(r.dropped, 2);
  assert.equal(logs.filter((m) => m === "llm_tool_dropped").length, 2);
});

test("an error thrown by onToolCall rejects runTools with that same error", async () => {
  const ev = twoBlockEvents({ name: "emit", json: '{"n":1}' }, { name: "emit", json: '{"n":2}' });
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: (async () => sse([...ev.head, ...ev.second, ...ev.tail])) as typeof fetch, log: () => {} });
  const boom = new Error("boom");
  let calls = 0;
  await assert.rejects(
    port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium", onToolCall: () => { calls++; throw boom; } }),
    (e) => e === boom,
  );
  assert.equal(calls, 1);
});

test("fake port reports scripted calls through onToolCall before resolving", async () => {
  const a = { name: "a", input: { x: 1 } };
  const b = { name: "b", input: {} };
  const order: ToolCall[] = [];
  let resolved = false;
  const p = createFakePort([[a, b]]).runTools({ loop: "build", ...REQ, tools: [], effort: "medium", onToolCall: (c) => order.push(c) }).then((r) => { resolved = true; return r; });
  assert.deepEqual(order, [a, b]);
  assert.equal(resolved, false);
  const r = await p;
  assert.equal(order[0], r.toolCalls[0]);
  assert.equal(order[1], r.toolCalls[1]);
});

test("truncated tool stream still records the usage seen and drops the partial call", async () => {
  const events = [
    toolUseStream({ name: "emit", json: ['{"n":1}'] })[0],
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t0", name: "emit", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"n":1}' } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "emit", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"n":' } },
    // stream ends here: no content_block_stop, message_delta or message_stop
  ];
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: (async () => sse(events)) as typeof fetch, log: () => {} });
  const r = await port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  assert.deepEqual(r.toolCalls, [{ name: "emit", input: { n: 1 } }]);
  assert.equal(r.dropped, 1);
  assert.equal(r.stopReason, null);
  assert.equal(r.usage.inputTokens, 10);
  assert.equal(r.usage.cacheReadTokens, 200);
  assert.equal(r.usage.cacheWriteTokens, 30);
  assert.ok(r.usage.outputTokens >= 1);
  // The usage is recorded, not zeroed.
  const store = await openStore();
  await withCostRecording(port, { store, sessionId: "t" }).runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  assert.ok(await store.sessionCost("t") > 0);
  await store.close();
});

// ---- deadlines (known issue I1) ----

test("a stream that stalls past its deadline returns the completed calls, keeps the usage seen and logs llm_timeout", async () => {
  // The first events arrive, then nothing more, and the body ignores the abort signal.
  const head = toolUseStream({ name: "emit", json: ['{"n":1}'] }).slice(0, 4);
  const text = head.map((e) => `event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const stalled = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); } }),
    { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: stalled, log: (msg, fields) => logs.push({ msg, fields }), deadlineMs: { build: 100 } });
  const t0 = Date.now();
  const r = await port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  assert.ok(Date.now() - t0 < 2_000, "ends at the deadline, not when the stream does");
  assert.deepEqual(r.toolCalls, [{ name: "emit", input: { n: 1 } }]);
  assert.equal(r.stopReason, null);
  assert.equal(r.usage.inputTokens, 10, "the billed usage is kept");
  assert.ok(logs.some((l) => l.msg === "llm_timeout" && l.fields?.loop === "build" && l.fields?.started === true));
});

test("a call with no response by its deadline fails with LlmTimeoutError", async () => {
  // Like real fetch, this one only ends when its signal aborts.
  const hang = ((_url: unknown, init: RequestInit) => new Promise<Response>((_, reject) =>
    init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
  const logs: string[] = [];
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: hang, log: (m) => logs.push(m), deadlineMs: { conversation: 50 } });
  await assert.rejects(port.runTools({ loop: "conversation", ...REQ, tools: [emitTool], effort: "low" }), (e: Error) => e.name === "LlmTimeoutError");
  assert.ok(logs.includes("llm_timeout"));
  assert.deepEqual(DEADLINE_MS, { conversation: 8_000, build: 90_000 });
});

test("non-stream errors still propagate", async () => {
  const fail = (async () => new Response(JSON.stringify({ error: { message: "no" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: fail, log: () => {} });
  await assert.rejects(port.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" }), (e: any) => e.status === 401);
});

test("result reports stopReason and dropped count for invalid calls", async () => {
  const mk = (events: unknown[]) => createOpenRouterPort({ openrouterApiKey: "k" }, { fetch: (async () => sse(events)) as typeof fetch, log: () => {} });
  const run = (p: ReturnType<typeof mk>) => p.runTools({ loop: "build", ...REQ, tools: [emitTool], effort: "medium" });
  const ok = await run(mk(toolUseStream({ name: "emit", json: ['{"n":1}'] })));
  assert.deepEqual([ok.stopReason, ok.dropped, ok.toolCalls.length], ["tool_use", 0, 1]);
  const bad = await run(mk(toolUseStream({ name: "emit", json: ['{"n":"x"}'] })));
  assert.deepEqual([bad.stopReason, bad.dropped, bad.toolCalls.length], ["tool_use", 1, 0]);
  const unknown = await run(mk(toolUseStream({ name: "nope", json: ['{"n":1}'] })));
  assert.equal(unknown.dropped, 1);
  const refused = await run(mk(toolUseStream({ name: "emit", json: ['{"n":1}'], stop: "refusal" })));
  assert.deepEqual([refused.stopReason, refused.toolCalls.length], ["refusal", 0]);
  const fake = await createFakePort([[{ name: "a", input: {} }]]).runTools({ loop: "build", ...REQ, tools: [], effort: "medium" });
  assert.deepEqual([fake.stopReason, fake.dropped], ["tool_use", 0]);
});

test("llm_tool_dropped logs each zod issue's dotted path and code, never values or messages", async () => {
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const Nested = z.strictObject({ items: z.array(z.strictObject({ tag: z.string(), kind: z.enum(["a", "b"]) })) });
  const tool = { name: "nest", description: "n", strict: true, input_schema: {}, schema: Nested };
  const port = createOpenRouterPort({ openrouterApiKey: "k" }, {
    fetch: (async () => sse(toolUseStream({ name: "nest", json: ['{"items":[{"tag":"ok","kind":"a"},{"tag":9137,"kind":"secret-kind","extra":"leak-me"}]}'] }))) as typeof fetch,
    log: (msg, fields) => logs.push({ msg, fields }),
  });
  const r = await port.runTools({ loop: "conversation", ...REQ, tools: [tool], effort: "low" });
  assert.equal(r.dropped, 1);
  const drop = logs.find((l) => l.msg === "llm_tool_dropped")!;
  assert.equal(drop.fields!.reason, "invalid_input");
  assert.equal(drop.fields!.issues, 3);
  const details = drop.fields!.issue_details as { path: string; code: string }[];
  assert.deepEqual(
    [...details].sort((a, b) => a.path.localeCompare(b.path)),
    [{ path: "items.1", code: "unrecognized_keys" }, { path: "items.1.kind", code: "invalid_value" }, { path: "items.1.tag", code: "invalid_type" }],
  );
  const text = JSON.stringify(logs);
  for (const leak of ["leak-me", "secret-kind", "extra", "9137", "expected"]) assert.ok(!text.includes(leak), `log must not contain ${leak}`);
});

test("port strips unknown keys at any depth for every tool, and keeps everything else strict", async () => {
  const Q = z.strictObject({ items: z.array(z.strictObject({ tag: z.string(), raisedBy: z.string().nullable(), note: z.string().optional() })) });
  const tool = { name: "q", description: "q", strict: true, input_schema: {}, schema: Q };
  const run = async (input: unknown) => {
    const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
    const port = createOpenRouterPort({ openrouterApiKey: "k" }, {
      fetch: (async () => sse(toolUseStream({ name: "q", json: [JSON.stringify(input)] }))) as typeof fetch,
      log: (msg, fields) => logs.push({ msg, fields }),
    });
    const r = await port.runTools({ loop: "build", ...REQ, tools: [tool], effort: "medium" });
    return { r, logs };
  };

  const ok = await run({ items: [{ tag: "a", raisedBy: null }, { tag: "b", raisedBy: "Sara", stray: 1 }], top: true });
  assert.equal(ok.r.dropped, 0);
  assert.deepEqual(ok.r.toolCalls[0].input, { items: [{ tag: "a", raisedBy: null }, { tag: "b", raisedBy: "Sara" }] });
  const repaired = ok.logs.find((l) => l.msg === "llm_tool_repaired")!;
  assert.deepEqual(repaired.fields, { loop: "build", tool: "q", repairs: [{ path: "items.1", code: "unrecognized_keys" }, { path: "", code: "unrecognized_keys" }] });
  assert.ok(!JSON.stringify(ok.logs).includes("stray"), "never the key names or values");

  const clean = await run({ items: [{ tag: "a", raisedBy: null }] });
  assert.equal(clean.logs.some((l) => l.msg === "llm_tool_repaired"), false, "a valid call needs no repair");

  // Not repaired: a wrong type next to an unknown key, a missing required nullable, an explicit null
  // for an optional field (none seen from the models), and an unknown key inside a non-object.
  for (const bad of [
    { items: [{ tag: 1, raisedBy: null, stray: 1 }] },
    { items: [{ tag: "a" }] },
    { items: [{ tag: "a", raisedBy: null, note: null }] },
    { items: "nope" },
  ]) {
    const r = await run(bad);
    assert.equal(r.r.dropped, 1, JSON.stringify(bad));
    assert.ok(r.logs.some((l) => l.msg === "llm_tool_dropped" && l.fields?.reason === "invalid_input"));
  }
});
