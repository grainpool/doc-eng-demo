import { z } from "zod";
import { FactClaimSchema } from "./product-truth.js";
import { ActionClassSchema } from "./defects.js";
import { EvidenceSchema, PatchOriginSchema, PatchValidationSchema, RunStatusSchema } from "./patches.js";
import { ConflictSchema } from "./conflicts.js";

/**
 * contracts.md §17 — Change Lab (added in 1.3.0 for Phase 17).
 * `mode: "replay"` requires no auth and serves a committed recording of a
 * REAL run; `mode: "live"` (Phase 18) requires Access identity. The same
 * ChangeLabRun shape renders both — the public demo is the real thing's
 * recorded output, never a mock.
 */

/** security.md §4.1 — the fact mutation allowlist, EXHAUSTIVE and frozen.
 * A mutation whose key is absent is rejected with MUTATION_NOT_ALLOWED
 * before value validation. Nine keys, closed value sets, no free text. */
export const FACT_MUTATION_ALLOWLIST = Object.freeze({
  "term.canonical.task": ["Job", "Task", "Run"],
  "limit.upload.csv.max_bytes": [5_242_880, 10_485_760, 26_214_400],
  "availability.feature.analysis_sessions.platform.ios": [true, false],
  "availability.feature.analysis_sessions.platform.android": [true, false],
  "availability.feature.connector_drive.platform.web": [true, false],
  "retention.artifact.days": [7, 30, 90],
  "plan.feature.analysis_sessions.min_plan": ["free", "pro", "team"],
  "flag.analysis.regression_enabled": [true, false],
  "analysis.operation.distribution_test.enabled": [true, false],
} as const satisfies Record<string, readonly (string | number | boolean)[]>);

export function mutationAllowed(factKey: string, value: unknown): boolean {
  const allowed = (FACT_MUTATION_ALLOWLIST as Record<string, readonly unknown[]>)[factKey];
  if (!allowed) return false;
  return allowed.some((v) => v === value);
}

export const AllowedMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fact_value"), fact_key: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal("doc_body"), doc_unit_id: z.string(), body: z.string().max(8192) }),
]);
export type AllowedMutation = z.infer<typeof AllowedMutationSchema>;

export const ChangeLabRequestSchema = z.object({
  mutation: AllowedMutationSchema,
  mode: z.enum(["replay", "live"]),
  idempotency_key: z.string(),
});
export type ChangeLabRequest = z.infer<typeof ChangeLabRequestSchema>;

export const FileDiffSchema = z.object({
  path: z.string(),
  before: z.string(),
  after: z.string(),
  unified: z.string(),
});

/** Full §13 impact record (persisted shape). */
export const ImpactRecordSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  fact_key: z.string(),
  delta: z.object({ from: z.unknown(), to: z.unknown(), kind: z.string() }),
  doc_unit_id: z.string(),
  projection_id: z.string(),
  action: ActionClassSchema,
  classification_rule: z.number().int(),
  explanation: z.string(),
  disposition: z.enum([
    "applied", "proposed", "escalated", "unresolved", "suppressed", "no_action", "abandoned_budget",
  ]),
  resolution_note: z.string().nullable(),
  patch_id: z.string().nullable(),
  conflict_id: z.string().nullable(),
});
export type ImpactRecord = z.infer<typeof ImpactRecordSchema>;

/** Full §14 patch record (persisted shape). */
export const PatchRecordSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  impact_ids: z.array(z.string()),
  doc_unit_id: z.string().nullable(),
  diff: FileDiffSchema,
  origin: PatchOriginSchema,
  evidence: z.array(EvidenceSchema),
  model_call_id: z.string().nullable(),
  requires_review: z.boolean(),
  validation: PatchValidationSchema.nullable(),
  changed_because: z.string().nullable(),
  needs_human_because: z.string().nullable(),
});
export type PatchRecord = z.infer<typeof PatchRecordSchema>;

export const ChangeLabRunSchema = z.object({
  run_id: z.string(),
  mode: z.enum(["replay", "live"]),
  status: RunStatusSchema,
  mutation: AllowedMutationSchema,
  detected_facts: z.array(FactClaimSchema),
  impacts: z.array(ImpactRecordSchema),
  patches: z.array(PatchRecordSchema),
  conflicts: z.array(ConflictSchema),
  findings: z.array(
    z.object({
      kind: z.string(),
      fact_key: z.string(),
      doc_unit_id: z.string().nullable(),
      detail: z.string(),
      owner: z.string().nullable(),
      disposition: z.string(),
      refutation: z.string().nullable(),
    }),
  ),
  generated_release_entry: z.string().nullable(),
  pull_request_url: z.string().nullable(),
  model_usage: z.object({
    calls: z.number(),
    input_tokens: z.number(),
    output_tokens: z.number(),
    estimated_usd: z.number(),
  }),
  steps: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      started_at: z.string(),
      duration_ms: z.number(),
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type ChangeLabRun = z.infer<typeof ChangeLabRunSchema>;
