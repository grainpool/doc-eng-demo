import { z } from "zod";
import { EvidenceSchema } from "./patches.js";

/**
 * contracts.md §15 — conflicts (added in 1.2.0 for Phase 15).
 * Escalation is a first-class success: sometimes the responsible action is
 * to refuse to edit, name the owner, and say what is missing.
 */

export const CONFLICT_KINDS = [
  "authority_disagreement",
  "insufficient_evidence",
  "ambiguous_ownership",
  "temporal_contradiction",
  "circular_reference",
] as const;
export const ConflictKindSchema = z.enum(CONFLICT_KINDS);
export type ConflictKind = z.infer<typeof ConflictKindSchema>;

/**
 * `resolution` is typed z.null() DELIBERATELY: the type system forbids
 * Concord from inventing a resolution (invariant I7). If a future phase
 * adds human resolution, it adds a separate ConflictResolution record
 * authored by a human — it does not widen this field.
 */
export const ConflictSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  fact_key: z.string(),
  kind: ConflictKindSchema,
  claims: z.array(EvidenceSchema).min(2), // the disagreeing claims, verbatim
  missing_information: z.array(z.string()),
  likely_owner: z.string(),
  suggested_question: z.string(),
  resolution: z.null(),
});
export type Conflict = z.infer<typeof ConflictSchema>;

/** The run-independent subset the pure pipeline produces. */
export const ConflictDraftSchema = ConflictSchema.omit({ id: true, run_id: true });
export type ConflictDraft = z.infer<typeof ConflictDraftSchema>;
