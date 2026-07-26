import { z } from "zod";

/** contracts.md §13 — the action classes Concord can take on an impact. */
export const ACTION_CLASSES = [
  "DETERMINISTIC_REGEN",
  "GROUNDED_PATCH",
  "EDITORIAL_REVIEW",
  "UNRESOLVED_CONFLICT",
  "NO_ACTION",
] as const;
export const ActionClassSchema = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClassSchema>;

/** contracts.md §16 — seeded defect taxonomy for the eval corpus. */
export const DEFECT_CLASSES = [
  "STALE_VALUE",
  "WRONG_PLATFORM",
  "TERM_DRIFT",
  "BROKEN_REF",
  "DUP_GUIDANCE",
  "MISSING_PREREQ",
  "STALE_CLI",
  "CONTRADICTION",
  "UNSUPPORTED_CLAIM",
  "IA_PROBLEM",
  "STALE_INPRODUCT_COPY",
  "UNDECLARED_FACT_REF",
] as const;
export const DefectClassSchema = z.enum(DEFECT_CLASSES);
export type DefectClass = z.infer<typeof DefectClassSchema>;

export const SeededDefectSchema = z.object({
  id: z.string().min(1),
  class: DefectClassSchema,
  doc_unit_id: z.string().min(1),
  fact_key: z.string().nullable(),
  description: z.string().min(1),
  /** Applied IN MEMORY at eval time; null for expected_detection:false items
   *  and for UNDECLARED_FACT_REF seeds that live in the real estate. */
  injection: z.object({ find: z.string(), replace: z.string() }).nullable(),
  expected_detection: z.boolean(),
  expected_action: ActionClassSchema,
  notes: z.string(),
});
export type SeededDefect = z.infer<typeof SeededDefectSchema>;
