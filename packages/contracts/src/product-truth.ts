import { z } from "zod";

/** The six product-truth source tiers (architecture.md §4). */
export const FACT_TIERS = [
  "T0_RUNTIME",
  "T1_SCHEMA",
  "T2_CLI",
  "T3_CONFIG",
  "T4_RELEASE",
  "T5_HUMAN",
] as const;

export const FactTierSchema = z.enum(FACT_TIERS);
export type FactTier = z.infer<typeof FactTierSchema>;

/** contracts.md §3.2 */
export const FactClaimSchema = z.object({
  key: z.string(),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), z.unknown()),
  ]),
  tier: FactTierSchema,
  locator: z.string(), // file#anchor, "kernel:/versions", "cli:introspect", "decision:<id>"
  observed_at: z.string(),
  confidence: z.number().min(0).max(1), // 1.0 for T0/T1/T2
});
export type FactClaim = z.infer<typeof FactClaimSchema>;

export const ProductTruthSnapshotSchema = z.object({
  snapshot_id: z.string(),
  generated_at: z.string(),
  relay_contracts_version: z.string(),
  facts: z.array(FactClaimSchema),
});
export type ProductTruthSnapshot = z.infer<typeof ProductTruthSnapshotSchema>;
