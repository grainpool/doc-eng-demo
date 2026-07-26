import { z } from "zod";
import { ActionClassSchema } from "@relay/contracts";

/** contracts.md §11 — the unit of documentation Concord reasons about. */
export const DocUnitSchema = z.object({
  id: z.string(),
  surface: z.enum([
    "mintlify",
    "helpcenter",
    "inproduct",
    "clidocs",
    "release",
    "generated",
  ]),
  path: z.string(),
  anchor: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  body_sha256: z.string(),
  audience: z.enum(["developer", "end_user", "operator", "agent", "mixed"]),
  editorial_register: z.enum([
    "terse_ui",
    "friendly_help",
    "technical_reference",
    "release_note",
  ]),
  owner: z.string(),
  generated: z.boolean(),
  frontmatter: z.record(z.string(), z.unknown()).default({}),
});
export type DocUnit = z.infer<typeof DocUnitSchema>;

export const FileDiffSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
  unified: z.string(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

/** contracts.md §11 — pure adapter: files in, doc units out. */
export interface SurfaceAdapter {
  readonly surface: DocUnit["surface"];
  parse(files: ReadonlyArray<{ path: string; content: string }>): DocUnit[];
  /** Throws if unit.generated is true (constraints.md G8). */
  patch(unit: DocUnit, newBody: string): FileDiff;
  readonly ownedGlobs: readonly string[];
}

/** contracts.md §12 */
export const FactProjectionSchema = z.object({
  id: z.string(),
  fact_key: z.string(),
  doc_unit_id: z.string(),
  mode: z.enum(["generated", "mechanical_value", "derived_prose", "editorial"]),
  asserted_value: z.unknown().nullable(),
  span: z.object({ start: z.number(), end: z.number() }).nullable(),
  extractor: z.enum([
    "declared_reference",
    "frontmatter_field",
    "generated_marker",
    "numeric_pattern",
    "term_occurrence",
    "availability_table",
    "model_extraction",
  ]),
  confidence: z.number().min(0).max(1),
  detected_at: z.string(),
  /**
   * The comparison form of asserted_value (AP2), or null when normalization
   * returned `unknown` — in which case mode has been downgraded to
   * derived_prose and no deterministic action can ever cite this projection.
   */
  normalized_value: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .optional(),
});
export type FactProjection = z.infer<typeof FactProjectionSchema>;

/** Phase 12 findings — recorded now, acted on in Phase 13/15. */
export const FindingSchema = z.object({
  kind: z.enum(["inconsistent_value", "undocumented_fact", "authority_conflict"]),
  fact_key: z.string(),
  doc_unit_id: z.string().nullable(),
  projection_id: z.string().nullable(),
  detail: z.string(),
  /** The fact's owner from the registry — who an escalation would name. */
  owner: z.string().nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A detected change in one authoritative fact between two snapshots. */
export interface FactDelta {
  fact_key: string;
  from: unknown;
  to: unknown;
  kind: string;
  tier: string;
  locator: string;
}

/** contracts.md §13 (run-independent subset used by the pure pipeline). */
export const ImpactSchema = z.object({
  fact_key: z.string(),
  delta: z.object({ from: z.unknown(), to: z.unknown(), kind: z.string() }),
  doc_unit_id: z.string(),
  projection_id: z.string(),
  action: ActionClassSchema,
  classification_rule: z.number().int(),
  explanation: z.string(),
  /**
   * Phase 13: nothing is silently dropped (AP6). Deterministic patches are
   * "proposed"; AI-bucket and conflict impacts are "unresolved" until
   * Phases 14/15; equal values are "no_action".
   */
  disposition: z.enum([
    "applied",
    "proposed",
    "escalated",
    "unresolved",
    "suppressed",
    "no_action",
    "abandoned_budget",
  ]),
});
export type Impact = z.infer<typeof ImpactSchema>;

/** Run-level warnings — documented behavior, surfaced in the report UI. */
export const WarningSchema = z.object({
  kind: z.enum(["generated_file_hand_edited"]),
  path: z.string(),
  detail: z.string(),
});
export type Warning = z.infer<typeof WarningSchema>;
