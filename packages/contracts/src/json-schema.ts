import { z } from "zod";

/**
 * Structured-output JSON Schemas are always DERIVED from the Zod contract,
 * never hand-written twice (contracts.md §1). This is the single wrapper the
 * Anthropic `output_config.format` call sites use from Phase 05 on.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}
