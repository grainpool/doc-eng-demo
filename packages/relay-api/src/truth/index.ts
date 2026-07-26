import {
  CONTRACTS_VERSION,
  ProductTruthSnapshotSchema,
  ulid,
  type FactTier,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import type { Env } from "../env.js";
import { t0Runtime } from "./t0-runtime.js";
import { t1Schema } from "./t1-schema.js";
import { t2Cli } from "./t2-cli.js";
import { t3Config } from "./t3-config.js";
import { t4Release } from "./t4-release.js";
import { t5Human } from "./t5-human.js";
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
  /** Which tiers resolved real claims for THIS snapshot vs are pending.
   *  Extra field on top of the contract snapshot shape; the snapshot itself
   *  stays schema-valid. */
  tier_status: Record<FactTier, "ok" | "pending">;
}

export async function buildProductTruth(env: Env): Promise<ProductTruthResponse> {
  const resolutions = await Promise.all(RESOLVERS.map((r) => r.resolve(env)));
  const facts = resolutions.flatMap((r) => r.claims);

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
    RESOLVERS.map((r, i) => [r.tier, resolutions[i]?.status ?? "pending"]),
  ) as Record<FactTier, "ok" | "pending">;

  return { ...snapshot, tier_status: tierStatus };
}
