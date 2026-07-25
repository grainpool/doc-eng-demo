import type { FactClaim, FactTier } from "@relay/contracts";
import type { Env } from "../env.js";

export interface TierResolver {
  tier: FactTier;
  /**
   * "ok" tiers return real claims; "pending" tiers return [] until the phase
   * that wires them (T0 → 04, T2 → 07, T4/T5 → 08).
   */
  status: "ok" | "pending";
  resolve(env: Env): Promise<FactClaim[]>;
}
