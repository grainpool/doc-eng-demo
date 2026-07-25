// Phase 02: /api/product-truth returns a valid ProductTruthSnapshot with real
// T1 + T3 claims (resolvable locators) and empty-but-marked T0/T2/T4/T5.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ProductTruthSnapshotSchema,
  matchFactKey,
  type FactTier,
} from "@relay/contracts";

interface ProductTruthResponse {
  snapshot_id: string;
  facts: {
    key: string;
    value: unknown;
    tier: FactTier;
    locator: string;
    confidence: number;
  }[];
  tier_status: Record<FactTier, "ok" | "pending">;
}

describe("GET /api/product-truth", () => {
  it("returns a schema-valid snapshot with real T1+T3 claims and pending markers", async () => {
    const res = await SELF.fetch("https://example.com/api/product-truth");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProductTruthResponse;

    // The response is a valid ProductTruthSnapshot (extra tier_status field aside).
    const parsed = ProductTruthSnapshotSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    // Real claims from the two wired tiers.
    const tiers = new Set(body.facts.map((f) => f.tier));
    expect(tiers).toEqual(new Set(["T1_SCHEMA", "T3_CONFIG"]));
    expect(body.facts.length).toBeGreaterThanOrEqual(15);

    // Pending tiers are marked, not fabricated.
    expect(body.tier_status).toEqual({
      T0_RUNTIME: "pending",
      T1_SCHEMA: "ok",
      T2_CLI: "pending",
      T3_CONFIG: "ok",
      T4_RELEASE: "pending",
      T5_HUMAN: "pending",
    });

    for (const fact of body.facts) {
      // Every key is registered, and its registry tier matches the claim's tier.
      const entry = matchFactKey(fact.key);
      expect(entry, `unregistered fact key ${fact.key}`).not.toBeNull();
      expect(entry?.tier).toBe(fact.tier);

      // Every locator is non-empty and plausibly resolvable: repo-file#anchor.
      expect(fact.locator).toMatch(/^packages\/[a-z-]+\/src\/[a-z-]+\.ts#.+$/);
      expect(fact.confidence).toBe(1);
    }

    // The central fact of the demo is present with the enforced value.
    const limit = body.facts.find((f) => f.key === "limit.upload.csv.max_bytes");
    expect(limit?.value).toBe(10485760);
  });
});
