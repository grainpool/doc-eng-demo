import { z } from "zod";
import { OPERATION_IDS } from "./operations.js";

/**
 * Artifacts and provenance (contracts.md §6). Invariant I2: an artifact
 * cannot exist without COMPLETE provenance — enforced by NOT NULL columns in
 * the schema AND a parse of this Zod shape at the single insert site.
 */

export const ARTIFACT_KINDS = [
  "plot",
  "table_csv",
  "summary_json",
  "operation_record",
] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ProvenanceSchema = z.object({
  source_file_id: z.string().min(1),
  source_file_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  operation_id: z.enum(OPERATION_IDS),
  params: z.record(z.string(), z.unknown()),
  params_hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Verbatim from the KernelResult that produced the numbers (AP4). */
  runtime_versions: z.record(z.string(), z.string()),
  kernel_image_digest: z.string().min(1),
  session_id: z.string().min(1),
  turn_id: z.string().min(1),
  generated_at: z.string().min(1),
  duration_ms: z.number(),
  derived_from_artifact_ids: z.array(z.string()),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  kind: ArtifactKindSchema,
  name: z.string().min(1),
  r2_key: z.string().min(1),
  byte_size: z.number().int().nonnegative(),
  provenance: ProvenanceSchema,
  retention_expires_at: z.string().nullable(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;
