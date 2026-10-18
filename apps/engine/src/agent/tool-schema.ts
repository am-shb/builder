// Wire form of tool input schemas for `strict: true` tools, shared by both loops.
// Strict tool schemas reject numeric, length and item-count constraints, and want anyOf
// rather than oneOf. Those constraints stay enforced locally: the port re-validates every
// tool input against the tool's zod `schema`.
import { z } from "zod";

const STRICT_UNSUPPORTED = new Set([
  "$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems",
]);

export function strictCompatible(schema: unknown): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (STRICT_UNSUPPORTED.has(k)) continue;
      out[k === "oneOf" ? "anyOf" : k] = clean(val);
    }
    return out;
  };
  return clean(schema) as Record<string, unknown>;
}

/** The JSON schema to send for a zod tool input under `strict: true`. */
export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictCompatible(z.toJSONSchema(schema, { target: "draft-7" }));
}
