# 0013: The build loop runs on Sonnet 5.5

- **Status:** accepted
- **Date:** 2026-10-19
- **Deciders:** Amir Shahbandegan
- **Area:** Meeting engine (`src/agent`)

## Context
[ADR 0002](0002-build-todo-and-streamed-tool-calls.md) deferred "a faster build model (Sonnet) in place of Opus"
until a paid replay could compare quality. Since then, the live meeting on 2026-10-19 (session `df84cdfa`, 4 min 44 s
in the call) put a number on the cost. Model spend was $0.369. The build loop (Opus 5.5, 19 calls) was $0.355 of
that, and the conversation loop (Haiku 5.5, 36 calls) was $0.014. That is about $4.70 per meeting hour in models
alone, which matters for pricing ([ADR 0009](0009-pricing-model.md)). Build calls took 3.0 to 9.7 s, with a median
of 4.6 s.

## Options considered
1. **Keep Opus 5.5 and lower its effort.** Fewer thinking tokens, but the per-token price stays at $4 / $20 per
   million.
2. **Sonnet 5.5 at the same effort.** Half the per-token price ($2 / $10, cache reads $0.10 against $0.20), and
   faster. It accepts the request the port already sends: `output_config.effort`, strict tools with eager input
   streaming, `tool_choice` auto, no sampling parameters and no `thinking` field.
3. **Wait for a paid replay before switching.** Measures quality first, but delays the saving.

## Decision
Option 2. `MODELS.build` is `anthropic/claude-sonnet-5.5`, with OpenRouter fallback `anthropic/claude-sonnet-5`
(`src/agent/llm.ts`). Both ids and prices were checked against OpenRouter's live model list on 2026-10-19
(`src/agent/cost.ts`). Effort stays `medium`, set explicitly: Sonnet 5.5 defaults to `high`.

## Consequences
- Build calls cost about half as much per token, so a meeting like the one above should spend roughly half as much
  on the build loop.
- Quality hasn't been compared yet. The next live meeting checks the build loop's patches and consensus updates
  against the manual checklist (README). If quality drops, raise effort to `high` before going back to Opus.
  Going back is a one-line change in `MODELS`.
- Spec §12 now names Sonnet 5.5 for the build loop.
