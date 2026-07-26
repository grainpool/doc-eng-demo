import type { FactClaim, FactTier } from "@relay/contracts";
import type { Env } from "../env.js";

export interface TierResolution {
  /**
   * "ok" tiers return real claims; "pending" tiers return [] — either because
   * the wiring phase hasn't happened yet (T2 → 07, T4/T5 → 08) or because the
   * live source is unreachable right now (T0 without its container). Status
   * is part of the resolution so it can never say "ok" over absent facts.
   */
  status: "ok" | "pending";
  claims: FactClaim[];
}

export interface TierResolver {
  tier: FactTier;
  resolve(env: Env): Promise<TierResolution>;
}
