import type { TierResolver } from "./types.js";

/**
 * Tiers whose real sources arrive in later phases: T4 from release records
 * and T5 from decision records (Phase 08). Until then: empty claims,
 * explicitly marked pending in the response — never fabricated values.
 * (T0 wired in Phase 04, T2 in Phase 07.)
 */
function pending(tier: TierResolver["tier"]): TierResolver {
  return {
    tier,
    resolve: () => Promise.resolve({ status: "pending" as const, claims: [] }),
  };
}

export const t4Release = pending("T4_RELEASE");
export const t5Human = pending("T5_HUMAN");
