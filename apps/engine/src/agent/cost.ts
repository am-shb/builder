// Per-call cost accounting. Prices are USD per million tokens.
import { MODELS } from "./llm.ts";
import type { ModelPort, Usage } from "./llm.ts";
import type { Store } from "../store.ts";

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Source: OpenRouter public model catalog (GET https://openrouter.ai/api/v1/models),
// fetched 2026-10-17, per-token rates x 1e6; cacheWrite is the 5-minute-TTL rate.
// The model pages (openrouter.ai/anthropic/<slug>) did not show a pricing table
// to our fetcher, so the catalog endpoint behind them is the source.
//  - claude-opus-5.5:  prompt 4e-6, completion 2e-5, cache read 2e-7, cache write 5e-6
//  - claude-haiku-5.5: prompt 1e-7, completion 5e-7, cache read 1e-8, cache write 1.25e-7
//    (the catalog lists a higher tier above 100k prompt tokens: 0.50/2.50; not modelled,
//     our prompts are far smaller. The provider-reported cost wins anyway.)
//  - claude-opus-5 (build fallback): prompt 5e-6, completion 2.5e-5, cache read 5e-7, cache write 6.25e-6
export const PRICES: Record<string, Price> = {
  "anthropic/claude-opus-5.5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "anthropic/claude-haiku-5.5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "anthropic/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

// OpenRouter's own cost for the call is preferred when the response carried it.
export function costOf(model: string, usage: Usage): number {
  if (typeof usage.costUsd === "number") return usage.costUsd;
  const p = PRICES[model];
  if (!p) return 0;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) / 1e6;
}

// Wraps a port so every call lands in model_calls for the session.
export function withCostRecording(port: ModelPort, ctx: { store: Pick<Store, "addModelCall">; sessionId: string }): ModelPort {
  return {
    async runTools(req) {
      const result = await port.runTools(req);
      const model = MODELS[req.loop];
      await ctx.store.addModelCall({
        sessionId: ctx.sessionId, loop: req.loop, model,
        inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens, cacheWriteTokens: result.usage.cacheWriteTokens,
        usd: costOf(model, result.usage), ms: result.ms,
      });
      return result;
    },
  };
}
