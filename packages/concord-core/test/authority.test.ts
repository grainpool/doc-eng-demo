// Phase 12 — authority arbitration (architecture.md §4): the registry names
// the authoritative tier; T4 never overrides a current value; a lower-tier
// disagreement is a RECORDED CONFLICT, not an override; T5 claims only what
// it explicitly declares.
import { describe, expect, it } from "vitest";
import type { FactClaim } from "@relay/contracts";
import { arbitrate, arbitrateAll, expandClaims, ownerOfFact } from "../src/authority.js";

const NOW = "2026-07-26T00:00:00.000Z";

function claim(key: string, value: unknown, tier: FactClaim["tier"], locator = "test"): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator, observed_at: NOW, confidence: 1 };
}

/** The deliberate iOS contradiction fixture: T3 says false, a T4 release
 * announced true, a T5 tie-break decision explicitly claims the key. */
const IOS_KEY = "availability.feature.analysis_sessions.platform.ios";
const FACTS: FactClaim[] = [
  claim(IOS_KEY, false, "T3_CONFIG", "product-config.ts#availability"),
  claim(
    "release.2026_05_02_ios_launch.changes",
    {
      version: "1.5.0",
      changes: [{ fact_key: IOS_KEY, from: false, to: true, kind: "availability_changed" }],
    },
    "T4_RELEASE",
  ),
  claim(
    "decision.dec_ios_rollback_tiebreak.record",
    {
      claims_fact_keys: [IOS_KEY],
      statement: "CONFIG WINS — iOS launch was rolled back; docs must state unavailable.",
    },
    "T5_HUMAN",
  ),
  claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA"),
];

describe("authority arbitration", () => {
  it("a T4 claim about a current value is ALWAYS ignored — T3 stays authoritative", () => {
    const arbitration = arbitrate(IOS_KEY, expandClaims(FACTS));
    expect(arbitration.authoritative_tier).toBe("T3_CONFIG");
    expect(arbitration.authoritative?.value).toBe(false);
    // The release's announced `true` is listed as ignored temporal, and it
    // is NOT a conflict — T4 is temporal by definition, not a dissenter.
    expect(arbitration.ignored_temporal.length).toBe(1);
    expect(arbitration.ignored_temporal[0]?.value).toBe(true);
    expect(arbitration.conflicts.filter((c) => c.claim.tier === "T4_RELEASE")).toEqual([]);
  });

  it("a lower-tier disagreement is a recorded conflict, never an override", () => {
    const facts = [
      claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA"),
      // A (synthetic) T3 claim disagreeing with the T1-authoritative value.
      claim("limit.upload.csv.max_bytes", 5_242_880, "T3_CONFIG"),
    ];
    const arbitration = arbitrate("limit.upload.csv.max_bytes", expandClaims(facts));
    expect(arbitration.authoritative_tier).toBe("T1_SCHEMA");
    expect(arbitration.authoritative?.value).toBe(10_485_760); // NOT overridden
    expect(arbitration.conflicts.length).toBe(1);
    expect(arbitration.conflicts[0]).toMatchObject({ kind: "lower_tier_disagreement" });
    expect(arbitration.conflicts[0]!.detail).toContain("not an override");
  });

  it("an agreeing lower-tier claim in a DIFFERENT rendering is no conflict (normalized comparison)", () => {
    const facts = [
      claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA"),
      claim("limit.upload.csv.max_bytes", "10 MB", "T3_CONFIG"),
    ];
    const arbitration = arbitrate("limit.upload.csv.max_bytes", expandClaims(facts));
    expect(arbitration.conflicts).toEqual([]);
  });

  it("T5 wins only where it explicitly claims the key — and nowhere else", () => {
    const arbitrations = arbitrateAll(FACTS);
    // Explicitly claimed: the decision lands on the iOS key.
    expect(arbitrations.get(IOS_KEY)?.human_claims.length).toBe(1);
    expect(arbitrations.get(IOS_KEY)?.human_claims[0]?.source).toBe(
      "decision.dec_ios_rollback_tiebreak.record",
    );
    // Not claimed: no T5 presence on any other key.
    expect(arbitrations.get("limit.upload.csv.max_bytes")?.human_claims).toEqual([]);
  });

  it("two T5 records claiming one key with different values is an unresolvable conflict by design", () => {
    const key = "decision.dec_a.record";
    const facts = [claim(key, { statement: "A" }, "T5_HUMAN"), claim(key, { statement: "B" }, "T5_HUMAN")];
    const arbitration = arbitrate(key, expandClaims(facts));
    expect(arbitration.conflicts.length).toBe(1);
    expect(arbitration.conflicts[0]).toMatchObject({ kind: "t5_double_claim" });
  });

  it("ownership resolves from the registry for every fact family", () => {
    expect(ownerOfFact("limit.upload.csv.max_bytes")).toBe("eng-platform");
    expect(ownerOfFact("term.canonical.task")).toBe("product-content");
    expect(ownerOfFact("release.2026_02_14_task_rename.changes")).toBe("product");
    expect(ownerOfFact("not.a.registered.key")).toBeNull();
  });
});
