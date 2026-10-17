// Manual live probe (costs about a cent). Needs OPENROUTER_API_KEY in the env or .env.
//   node scripts/probe-models.ts
// For each model: one tiny runTools call with a trivial strict tool, then one with the
// real strict patch-batch schema (confirms OpenRouter/Anthropic accept it). Prints
// tool-call count, USD cost, and whether onToolInputDelta fired more than once.
import { existsSync } from "node:fs";
import { z } from "zod";
import { createOpenRouterPort, MODELS } from "../src/agent/llm.ts";
import type { Loop, PortTool } from "../src/agent/llm.ts";
import { costOf } from "../src/agent/cost.ts";
import { patchBatchJsonSchema, ToolPatchBatch } from "../src/ui/schema.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const port = createOpenRouterPort({ openrouterApiKey: key }, { log: (msg, f) => console.log(JSON.stringify({ msg, ...f })) });

const Ping = z.strictObject({ word: z.string() });
const pingTool: PortTool = {
  name: "ping", description: "Report the word you were asked to report.", strict: true, schema: Ping,
  input_schema: { type: "object", properties: { word: { type: "string" } }, required: ["word"], additionalProperties: false },
};
const patchTool: PortTool = {
  name: "apply_patch", description: "Apply a batch of prototype patch ops. Use one add op for an empty app.",
  strict: true, schema: ToolPatchBatch, input_schema: patchBatchJsonSchema(),
};

async function probe(label: string, loop: Loop, tool: PortTool, prompt: string) {
  let deltas = 0;
  try {
    const r = await port.runTools({
      loop, system: "You are a probe. Call the provided tool exactly once.", effort: loop === "build" ? "medium" : "low",
      messages: [{ role: "user", content: prompt }], tools: [tool],
      onToolInputDelta: () => { deltas++; },
    });
    console.log(`${label} ${MODELS[loop]}: tool_calls=${r.toolCalls.length} usd=${costOf(MODELS[loop], r.usage).toFixed(6)} ms=${r.ms} deltas=${deltas} streamed_more_than_once=${deltas > 1}`);
  } catch (err) {
    console.log(`${label} ${MODELS[loop]}: FAILED ${err instanceof Error ? err.constructor.name + " " + err.message : "error"}`);
  }
}

for (const loop of ["conversation", "build"] as const) {
  await probe("trivial", loop, pingTool, "Report the word 'hello'.");
  await probe("patch-schema", loop, patchTool, "Add a single root screen named Home with a heading saying Hello.");
}
