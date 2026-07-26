// Phase 15 — conflicts (contracts.md §15): the T3-vs-T4 contradiction
// escalates with a named owner and non-empty missing_information, NO patch;
// resolution === null in every case (invariant I7); all five kinds are
// reachable; a conflict blocks every impact on its fact key in that run —
// and those impacts still appear with a terminal disposition.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliIntrospectionSchema, ConflictSchema, type FactClaim } from "@relay/contracts";
import {
  circularReferences,
  detectConflicts,
  insufficientEvidenceConflict,
} from "../src/conflicts.js";
import { runPipeline } from "../src/pipeline.js";
import { readEstate } from "../cli/ingest.js";
import { generatorFacts } from "../cli/generator-facts.js";
import { sha256Hex } from "../src/hash.js";
import type { DocUnit } from "../src/types.js";

const NOW = "2026-07-26T00:00:00.000Z";
const IOS_KEY = "availability.feature.analysis_sessions.platform.ios";

function claim(key: string, value: unknown, tier: FactClaim["tier"], locator = "test"): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator, observed_at: NOW, confidence: 1 };
}

/** The standing fixture: T3 denies iOS, the T4 launch record asserted it. */
const IOS_FACTS: FactClaim[] = [
  claim(IOS_KEY, false, "T3_CONFIG", "packages/contracts/src/product-config.ts#availability"),
  claim(
    "release.2026_05_02_ios_launch.changes",
    {
      version: "1.5.0",
      released_at: "2026-05-02T00:00:00Z",
      summary: "Analysis sessions announced for iOS",
      changes: [{ fact_key: IOS_KEY, from: false, to: true, kind: "availability_changed" }],
    },
    "T4_RELEASE",
    "product-truth/releases#rel_2026_05_02_ios_launch",
  ),
];

describe("conflicts (§15) — the five kinds, I7", () => {
  it("the T3-vs-T4 contradiction produces temporal_contradiction with owner and information gap", () => {
    const conflicts = detectConflicts(IOS_FACTS, []);
    const contradiction = conflicts.find((c) => c.kind === "temporal_contradiction");
    expect(contradiction).toBeDefined();
    expect(contradiction!.fact_key).toBe(IOS_KEY);
    expect(contradiction!.likely_owner).toBe("product"); // FACT_REGISTRY
    expect(contradiction!.missing_information.length).toBeGreaterThan(0);
    expect(contradiction!.claims.length).toBeGreaterThanOrEqual(2);
    // The disagreeing claims, verbatim, from both tiers:
    const tiers = contradiction!.claims.map((c) => c.tier).sort();
    expect(tiers).toEqual(["T3_CONFIG", "T4_RELEASE"]);
    expect(contradiction!.suggested_question).toContain("rolled back");
    expect(contradiction!.resolution).toBeNull(); // I7
    // And it round-trips the CONTRACT schema, where resolution is z.null().
    expect(() =>
      ConflictSchema.parse({ ...contradiction, id: "cfl_x", run_id: "run_x" }),
    ).not.toThrow();
    expect(() =>
      ConflictSchema.parse({ ...contradiction, id: "cfl_x", run_id: "run_x", resolution: "T3 wins" }),
    ).toThrow(); // the type system forbids inventing a resolution
  });

  it("a T4 transition matching the current value is NOT a contradiction", () => {
    const facts: FactClaim[] = [
      claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA"),
      claim(
        "release.2025_11_10_upload_limit_10mb.changes",
        {
          released_at: "2025-11-10T00:00:00Z",
          changes: [{ fact_key: "limit.upload.csv.max_bytes", from: 5_242_880, to: 10_485_760, kind: "limit_changed" }],
        },
        "T4_RELEASE",
      ),
    ];
    expect(detectConflicts(facts, []).filter((c) => c.kind === "temporal_contradiction")).toEqual([]);
  });

  it("authority_disagreement: two tiers claim different current values", () => {
    const facts = [
      claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA"),
      claim("limit.upload.csv.max_bytes", 5_242_880, "T3_CONFIG"),
    ];
    const conflicts = detectConflicts(facts, []);
    const disagreement = conflicts.find((c) => c.kind === "authority_disagreement");
    expect(disagreement).toBeDefined();
    expect(disagreement!.likely_owner).toBe("eng-platform");
    expect(disagreement!.resolution).toBeNull();
  });

  it("ambiguous_ownership: the two competing regression-flag decisions (planted fixture)", () => {
    const facts: FactClaim[] = [
      claim("flag.analysis.regression_enabled", true, "T3_CONFIG"),
      claim(
        "decision.dec_regression_flag_keep.record",
        { claims_fact_keys: ["flag.analysis.regression_enabled"], statement: "stays ENABLED" },
        "T5_HUMAN",
      ),
      claim(
        "decision.dec_regression_flag_pause.record",
        { claims_fact_keys: ["flag.analysis.regression_enabled"], statement: "should be PAUSED" },
        "T5_HUMAN",
      ),
    ];
    const conflicts = detectConflicts(facts, []);
    const ownership = conflicts.find((c) => c.kind === "ambiguous_ownership");
    expect(ownership).toBeDefined();
    expect(ownership!.fact_key).toBe("flag.analysis.regression_enabled");
    expect(ownership!.likely_owner).toBe("eng-analysis");
    expect(ownership!.suggested_question).toContain("Which one stands");
    expect(ownership!.resolution).toBeNull();
  });

  it("insufficient_evidence names the unresolvable locator and the owner", () => {
    const conflict = insufficientEvidenceConflict(
      "limit.upload.csv.max_bytes",
      "docs/sla-page#uptime",
      [claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA")],
    );
    expect(conflict.kind).toBe("insufficient_evidence");
    expect(conflict.likely_owner).toBe("eng-platform");
    expect(conflict.missing_information.some((m) => m.includes("sla-page"))).toBe(true);
    expect(conflict.resolution).toBeNull();
  });

  it("circular_reference: unit A cites B as source and B cites A", () => {
    const unit = (id: string, path: string, body: string): DocUnit => ({
      id,
      surface: "mintlify",
      path,
      anchor: "s",
      title: "t",
      body,
      body_sha256: sha256Hex(body),
      audience: "developer",
      editorial_register: "technical_reference",
      owner: "docs",
      generated: false,
      frontmatter: {},
    });
    const a = unit(
      "mintlify:docs-mintlify/limits.mdx#s",
      "docs-mintlify/limits.mdx",
      "The limit is 10 MB, source: [quotas](/quotas).",
    );
    const b = unit(
      "mintlify:docs-mintlify/quotas.mdx#s",
      "docs-mintlify/quotas.mdx",
      "Quota values are as documented in [limits](/limits).",
    );
    const conflicts = circularReferences([a, b]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.kind).toBe("circular_reference");
    expect(conflicts[0]!.claims.length).toBe(2);
    expect(conflicts[0]!.resolution).toBeNull();
    // One-directional citation is fine:
    expect(circularReferences([a, unit("x", "docs-mintlify/quotas.mdx", "No links here.")])).toEqual([]);
  });
});

describe("conflict blocking in the pipeline", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const CLI = CliIntrospectionSchema.parse(
    JSON.parse(readFileSync(join(root, "fixtures", "cli-introspection.json"), "utf8")),
  );

  it("a conflict on a fact key blocks EVERY impact on that key — with terminal dispositions, not hidden", () => {
    // A limit delta whose key ALSO has an authority disagreement.
    const base = generatorFacts();
    const previous = { snapshot_id: "p", generated_at: NOW, relay_contracts_version: "1.2.0", facts: base };
    const conflicted = [
      ...base.map((f) =>
        f.key === "limit.upload.csv.max_bytes" ? { ...f, value: 26_214_400 } : f,
      ),
      claim("limit.upload.csv.max_bytes", 5_242_880, "T3_CONFIG", "synthetic-disagreement"),
    ];
    const out = runPipeline({
      previous,
      current: { snapshot_id: "c", generated_at: NOW, relay_contracts_version: "1.2.0", facts: conflicted },
      files: readEstate(),
      detectedAt: NOW,
      cli: CLI,
    });
    expect(out.conflicts.some((c) => c.fact_key === "limit.upload.csv.max_bytes")).toBe(true);
    const limitImpacts = out.impacts.filter((i) => i.fact_key === "limit.upload.csv.max_bytes");
    expect(limitImpacts.length).toBeGreaterThanOrEqual(4);
    for (const impact of limitImpacts) {
      expect(impact.disposition).toBe("unresolved"); // blocked, visible
      expect(impact.explanation).toContain("BLOCKED");
    }
    // No patch touches the conflicted fact's renderings.
    const patched = out.patches.map((p) => p.path);
    expect(patched).not.toContain("help-center/articles/upload-failed.md");
  });
});
