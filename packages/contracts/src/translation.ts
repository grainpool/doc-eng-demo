import { z } from "zod";
import { OPERATION_IDS } from "./operations.js";

/**
 * NL → operation translation result (contracts.md §5). The discriminated
 * union is the structured-output schema for the translator call:
 * `operation_id` is the CLOSED enum, so even a fully successful prompt
 * injection cannot name an operation that does not exist (security.md §5).
 * The model is a router, never an executor.
 */
export const TranslationResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("operation"),
    operation_id: z.enum(OPERATION_IDS),
    params: z.record(z.string(), z.unknown()),
    rationale: z.string().max(280),
  }),
  z.object({
    kind: z.literal("unsupported"),
    reason: z.string().max(280),
    supported_alternatives: z.array(z.enum(OPERATION_IDS)).max(3),
  }),
]);

export type TranslationResult = z.infer<typeof TranslationResultSchema>;
