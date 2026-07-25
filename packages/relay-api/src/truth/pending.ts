import type { FactClaim } from "@relay/contracts";
import type { TierResolver } from "./types.js";

/**
 * Tiers whose real sources arrive in later phases: T0 from the running kernel
 * (Phase 04), T2 from `relay introspect --json` (Phase 07), T4 from release
 * records and T5 from decision records (Phase 08). Until then: empty claims,
 * explicitly marked pending in the response — never fabricated values.
 */
function pending(tier: TierResolver["tier"]): TierResolver {
  return {
    tier,
    status: "pending",
    resolve: (): Promise<FactClaim[]> => Promise.resolve([]),
  };
}

export const t0Runtime = pending("T0_RUNTIME");
export const t2Cli = pending("T2_CLI");
export const t4Release = pending("T4_RELEASE");
export const t5Human = pending("T5_HUMAN");
