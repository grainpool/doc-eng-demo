import {
  FACT_TIERS,
  matchFactKey,
  type FactClaim,
  type FactTier,
} from "@relay/contracts";
import { unitOfFactKey } from "./normalize-value.js";
import { sameNormalized } from "./normalize-value.js";

/**
 * Authority arbitration (architecture.md §4, implemented per the packet's
 * arbitration rule):
 *  - the fact-key REGISTRY names the authoritative tier per fact;
 *  - a claim from a LOWER tier that disagrees is a CONFLICT, not an
 *    override — recorded here, acted on in Phase 15;
 *  - a T4_RELEASE claim about a CURRENT value is ALWAYS ignored (T4 is
 *    temporal: authoritative for when, never for what-is-now);
 *  - T5_HUMAN wins only where a decision EXPLICITLY claims the key; two T5
 *    records claiming one key with different values is unresolvable by
 *    design.
 */

/** A claim ABOUT a fact key, after expansion from the snapshot. */
export interface TierClaim {
  key: string;
  value: unknown;
  tier: FactTier;
  /** The snapshot claim (locator or claim key) this was expanded from. */
  source: string;
}

export interface AuthorityConflict {
  fact_key: string;
  kind: "lower_tier_disagreement" | "t5_double_claim";
  authoritative_tier: FactTier;
  claim: TierClaim;
  detail: string;
}

export interface Arbitration {
  key: string;
  owner: string | null;
  authoritative_tier: FactTier | null;
  /** The claim from the registry-named tier, if present. */
  authoritative: TierClaim | null;
  /** T5 decisions that explicitly claim this key (they win what they claim). */
  human_claims: TierClaim[];
  /** T4 claims about the current value — always ignored, listed for audit. */
  ignored_temporal: TierClaim[];
  conflicts: AuthorityConflict[];
}

const TIER_RANK: Record<FactTier, number> = Object.fromEntries(
  FACT_TIERS.map((tier, i) => [tier, i]),
) as Record<FactTier, number>;

/**
 * Expand a snapshot's facts into per-key claims:
 *  - T0–T3 facts claim their own key directly;
 *  - a T4 `release.<id>.changes` record claims each `changes[].fact_key`
 *    (with the `to` value) — temporally;
 *  - a T5 `decision.<id>.record` claims each of its `claims_fact_keys`.
 * The T4/T5 records' own keys also remain claims on themselves.
 */
export function expandClaims(facts: readonly FactClaim[]): TierClaim[] {
  const claims: TierClaim[] = [];
  for (const fact of facts) {
    claims.push({ key: fact.key, value: fact.value, tier: fact.tier, source: fact.locator });
    if (fact.tier === "T4_RELEASE") {
      const record = fact.value as { changes?: { fact_key: string; to: unknown }[] } | null;
      for (const change of record?.changes ?? []) {
        claims.push({
          key: change.fact_key,
          value: change.to,
          tier: "T4_RELEASE",
          source: fact.key,
        });
      }
    }
    if (fact.tier === "T5_HUMAN") {
      const record = fact.value as
        | { claims_fact_keys?: string[]; statement?: string }
        | null;
      for (const key of record?.claims_fact_keys ?? []) {
        claims.push({
          key,
          value: record?.statement ?? null,
          tier: "T5_HUMAN",
          source: fact.key,
        });
      }
    }
  }
  return claims;
}

/** Arbitrate every claim on one key. */
export function arbitrate(key: string, claims: readonly TierClaim[]): Arbitration {
  const entry = matchFactKey(key);
  const relevant = claims.filter((c) => c.key === key);
  const result: Arbitration = {
    key,
    owner: entry?.owner ?? null,
    authoritative_tier: entry?.tier ?? null,
    authoritative: null,
    human_claims: [],
    ignored_temporal: [],
    conflicts: [],
  };
  if (!entry) return result;

  for (const claim of relevant) {
    // T4 about a current value: ignored ALWAYS — unless the registry itself
    // names T4 as authoritative (the release.<id>.changes family's own keys).
    if (claim.tier === "T4_RELEASE" && entry.tier !== "T4_RELEASE") {
      result.ignored_temporal.push(claim);
      continue;
    }
    // T5 wins only what it explicitly claims: an expanded T5 claim IS
    // explicit by construction, so it lands as a human claim on this key.
    if (claim.tier === "T5_HUMAN" && entry.tier !== "T5_HUMAN") {
      result.human_claims.push(claim);
      continue;
    }
    if (claim.tier === entry.tier) {
      if (result.authoritative === null) {
        result.authoritative = claim;
      } else if (
        JSON.stringify(result.authoritative.value) !== JSON.stringify(claim.value)
      ) {
        result.conflicts.push({
          fact_key: key,
          kind: entry.tier === "T5_HUMAN" ? "t5_double_claim" : "lower_tier_disagreement",
          authoritative_tier: entry.tier,
          claim,
          detail:
            entry.tier === "T5_HUMAN"
              ? `two T5 records claim ${key} with different values — unresolvable by design`
              : `two ${entry.tier} claims for ${key} disagree`,
        });
      }
      continue;
    }
    // A claim from a tier that is NOT authoritative for this key: if it
    // disagrees with the authoritative value it is a conflict, never an
    // override. (Compared after arbitrating the authoritative claim below.)
  }

  // Two T5 records explicitly claiming the SAME key with different
  // positions is unresolvable by design — wherever the key's authority
  // lives. Concord escalates; it never picks between humans.
  if (result.human_claims.length >= 2) {
    const [first, ...rest] = result.human_claims;
    for (const other of rest) {
      if (JSON.stringify(first!.value) !== JSON.stringify(other.value)) {
        result.conflicts.push({
          fact_key: key,
          kind: "t5_double_claim",
          authoritative_tier: entry.tier,
          claim: other,
          detail: `two T5 records (${first!.source}, ${other.source}) claim ${key} with different positions — unresolvable by design`,
        });
      }
    }
  }

  // Second pass for non-authoritative, non-T4/T5 tiers: disagreement check.
  if (result.authoritative) {
    const authClaim = result.authoritative;
    for (const claim of relevant) {
      if (claim === authClaim) continue;
      if (claim.tier === entry.tier) continue; // handled above
      if (claim.tier === "T4_RELEASE" || claim.tier === "T5_HUMAN") continue;
      const valueType = entry.valueType;
      const agrees =
        valueType === "json"
          ? JSON.stringify(claim.value) === JSON.stringify(authClaim.value)
          : sameNormalized(claim.value, authClaim.value, valueType, unitOfFactKey(key));
      if (!agrees) {
        result.conflicts.push({
          fact_key: key,
          kind: "lower_tier_disagreement",
          authoritative_tier: entry.tier,
          claim,
          detail:
            `${claim.tier} (rank ${TIER_RANK[claim.tier]}) claims ` +
            `${JSON.stringify(claim.value)} but ${entry.tier} is authoritative ` +
            `with ${JSON.stringify(authClaim.value)} — recorded as a conflict, not an override`,
        });
      }
    }
  }
  return result;
}

/** Arbitrate every key claimed anywhere in the snapshot. */
export function arbitrateAll(facts: readonly FactClaim[]): Map<string, Arbitration> {
  const claims = expandClaims(facts);
  const keys = [...new Set(claims.map((c) => c.key))];
  return new Map(keys.map((key) => [key, arbitrate(key, claims)]));
}

/** Ownership resolution: every fact's owner comes from the registry. */
export function ownerOfFact(key: string): string | null {
  return matchFactKey(key)?.owner ?? null;
}
