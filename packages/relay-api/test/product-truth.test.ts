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

    // Real claims from the wired tiers (T0 needs the container — absent in
    // the pool, asserted against the deployed URL below).
    const tiers = new Set(body.facts.map((f) => f.tier));
    expect(tiers).toEqual(new Set(["T1_SCHEMA", "T2_CLI", "T3_CONFIG"]));
    expect(body.facts.length).toBeGreaterThanOrEqual(50);

    // Pending tiers are marked, not fabricated.
    expect(body.tier_status).toEqual({
      T0_RUNTIME: "pending",
      T1_SCHEMA: "ok",
      T2_CLI: "ok",
      T3_CONFIG: "ok",
      T4_RELEASE: "pending",
      T5_HUMAN: "pending",
    });

    for (const fact of body.facts) {
      // Every key is registered, and its registry tier matches the claim's tier.
      const entry = matchFactKey(fact.key);
      expect(entry, `unregistered fact key ${fact.key}`).not.toBeNull();
      expect(entry?.tier).toBe(fact.tier);

      // Every locator is non-empty and plausibly resolvable, per tier:
      // repo-file#anchor for code-sourced tiers, kernel-image digest for T0,
      // the committed introspection fixture for T2.
      const locatorPattern =
        fact.tier === "T0_RUNTIME"
          ? /^kernel-image:[0-9a-f]{64}#.+$/
          : fact.tier === "T2_CLI"
            ? /^fixtures\/cli-introspection\.json#.+$/
            : /^packages\/[a-z-]+\/src\/[a-z-]+\.ts#.+$/;
      expect(fact.locator, fact.key).toMatch(locatorPattern);
      expect(fact.confidence).toBe(1);
    }

    // The central fact of the demo is present with the enforced value.
    const limit = body.facts.find((f) => f.key === "limit.upload.csv.max_bytes");
    expect(limit?.value).toBe(10485760);
  });
});

describe("GET /api/product-truth — deployed (T0 from the live kernel)", () => {
  it(
    "T0 facts carry real runtime versions and the image digest as locator",
    { timeout: 150_000, retry: 1 },
    async () => {
      const res = await fetch("https://relay.otonieltrejo.com/api/product-truth");
      expect(res.status).toBe(200);
      const body = (await res.json()) as ProductTruthResponse;

      expect(body.tier_status.T0_RUNTIME).toBe("ok");
      const t0 = body.facts.filter((f) => f.tier === "T0_RUNTIME");
      // python + 4 packages + 8 operation-enabled facts
      expect(t0.length).toBe(13);

      const semver = /^\d+\.\d+\.\d+$/;
      for (const key of [
        "runtime.python.version",
        "runtime.package.pandas.version",
        "runtime.package.scipy.version",
        "runtime.package.statsmodels.version",
        "runtime.package.matplotlib.version",
      ]) {
        const fact = t0.find((f) => f.key === key);
        expect(fact, key).toBeDefined();
        expect(String(fact?.value)).toMatch(semver);
        expect(fact?.locator).toMatch(/^kernel-image:[0-9a-f]{64}#.+$/);
      }

      const enabled = t0.filter((f) =>
        /^analysis\.operation\.[a-z_]+\.enabled$/.test(f.key),
      );
      expect(enabled.length).toBe(8);
      expect(enabled.every((f) => f.value === true)).toBe(true);
    },
  );
});
