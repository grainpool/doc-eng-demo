import { z } from "zod";

/**
 * Structured-output JSON Schemas are always DERIVED from the Zod contract,
 * never hand-written twice (contracts.md §1). This is the single wrapper the
 * Anthropic `output_config.format` call sites use from Phase 05 on.
 *
 * zod's `z.toJSONSchema()` emits discriminated unions as `oneOf`, which the
 * structured-outputs API rejects ("Schema type 'oneOf' is not supported" —
 * observed live, COMPAT.md Phase 05). For schema-validation purposes the two
 * differ only in exclusivity, and a discriminated union is mutually exclusive
 * by construction, so rewriting `oneOf` → `anyOf` preserves meaning exactly.
 */
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key === "oneOf" ? "anyOf" : key] = normalize(value);
    }
    // The API also requires every object schema to be explicitly CLOSED
    // ("'additionalProperties: object/true' is not supported", observed
    // live). Our Zod objects are closed by intent; make it explicit.
    if (out.type === "object" && typeof out.additionalProperties !== "boolean") {
      out.additionalProperties = false;
    }
    return out;
  }
  return node;
}

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return normalize(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/**
 * The structured-outputs endpoint accepts only a SUBSET of JSON Schema:
 * numeric bounds (minimum/maximum), length bounds (minLength/maxItems/…) and
 * similar validation keywords are rejected with a 400 (observed live,
 * COMPAT.md Phase 05). `zodToOutputFormatSchema` prunes a derived schema down
 * to the accepted structural subset. The dropped constraints are NOT lost:
 * every consumer re-validates the model's output against the full Zod schema
 * (the re-validation gate), which is the authoritative check anyway.
 */
const OUTPUT_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
  "default",
  "title",
  "$defs",
  "$ref",
]);

function mapValues(
  node: Record<string, unknown>,
  fn: (v: unknown) => unknown,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fn(v)]));
}

function pruneSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(pruneSchema);
  if (node === null || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!OUTPUT_KEYWORDS.has(key)) continue;
    if (key === "properties" || key === "$defs") {
      // Values of these maps are schemas, but the KEYS are property names —
      // never keyword-filtered.
      out[key] = mapValues(value as Record<string, unknown>, pruneSchema);
    } else if (typeof value === "object" && value !== null) {
      out[key] = pruneSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function zodToOutputFormatSchema(
  schema: z.ZodType,
): Record<string, unknown> {
  return pruneSchema(zodToJsonSchema(schema)) as Record<string, unknown>;
}
