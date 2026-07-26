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
});
export type FactProjection = z.infer<typeof FactProjectionSchema>;

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
});
export type Impact = z.infer<typeof ImpactSchema>;
