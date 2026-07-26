import { z } from "zod";
import { FactTierSchema } from "./product-truth.js";

/**
 * contracts.md §14 — patches and evidence (added in 1.1.0 for Phase 14).
 * The defining property: a proposed patch is worthless without evidence,
 * and no model-authored patch is ever applied without review.
 */

export const EvidenceSchema = z.object({
  fact_key: z.string(),
  tier: FactTierSchema,
  locator: z.string(),
  value: z.unknown(),
  observed_at: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const PATCH_ORIGINS = [
  "deterministic",
  "model_grounded",
  "model_editorial_draft",
] as const;
export const PatchOriginSchema = z.enum(PATCH_ORIGINS);
export type PatchOrigin = z.infer<typeof PatchOriginSchema>;

export const EDITORIAL_RISKS = ["none", "tone", "structure", "meaning"] as const;

/** The model's structured-output proposal (contracts.md §14). */
export const PatchProposalSchema = z.object({
  new_body: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
  changed_because: z.string().max(400),
  editorial_risk: z.enum(EDITORIAL_RISKS),
  needs_human_because: z.string().nullable(),
});
export type PatchProposal = z.infer<typeof PatchProposalSchema>;

export const PatchValidationSchema = z.object({
  evidence_resolvable: z.boolean(),
  introduces_no_new_facts: z.boolean(),
  respects_editorial_register: z.boolean(),
  path_allowlisted: z.boolean(),
  falsification: z.object({
    attempted: z.boolean(),
    refuted: z.boolean(),
    refutation: z.string().nullable(),
  }),
});
export type PatchValidation = z.infer<typeof PatchValidationSchema>;

export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "partial",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;
