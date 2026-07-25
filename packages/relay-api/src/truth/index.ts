import {
  CONTRACTS_VERSION,
  ProductTruthSnapshotSchema,
  ulid,
  type FactTier,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import type { Env } from "../env.js";
import { t1Schema } from "./t1-schema.js";
import { t3Config } from "./t3-config.js";
import { t0Runtime, t2Cli, t4Release, t5Human } from "./pending.js";
import type { TierResolver } from "./types.js";

const RESOLVERS: readonly TierResolver[] = [
  t0Runtime,
  t1Schema,
  t2Cli,
  t3Config,
  t4Release,
  t5Human,
];

export interface ProductTruthResponse extends ProductTruthSnapshot {
  /** Phase-02 marker: which tiers are wired vs pending. Extra field on top of
   *  the contract snapshot shape; the snapshot itself stays schema-valid. */
  tier_status: Record<FactTier, "ok" | "pending">;
}

export async function buildProductTruth(env: Env): Promise<ProductTruthResponse> {
  const results = await Promise.all(RESOLVERS.map((r) => r.resolve(env)));
  const facts = results.flat();

  const snapshot: ProductTruthSnapshot = {
    snapshot_id: `snap_${ulid()}`,
    generated_at: new Date().toISOString(),
    relay_contracts_version: CONTRACTS_VERSION,
    facts,
  };
  // Derived endpoint, never hand-maintained — parse to prove contract validity
  // at the boundary (contracts.md §1).
  ProductTruthSnapshotSchema.parse(snapshot);

  const tierStatus = Object.fromEntries(
    RESOLVERS.map((r) => [r.tier, r.status]),
  ) as Record<FactTier, "ok" | "pending">;

  return { ...snapshot, tier_status: tierStatus };
}
