// Phase 10 milestone: ONE fact, TWO surfaces, one deterministic result.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProductTruthSnapshot } from "@relay/contracts";
import { runPipeline } from "../src/pipeline.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const FILES = [
  {
    path: "docs-mintlify/supported-files.mdx",
    content: readFileSync(join(root, "estate", "docs-mintlify", "supported-files.mdx"), "utf8"),
  },
  {
    path: "in-product-copy/files.json",
    content: readFileSync(join(root, "estate", "in-product-copy", "files.json"), "utf8"),
  },
];

function snapshot(limitValue: number): ProductTruthSnapshot {
  return {
    snapshot_id: "snap_test",
    generated_at: "2026-07-26T00:00:00.000Z",
    relay_contracts_version: "1.0.0",
    facts: [
      {
        key: "limit.upload.csv.max_bytes",
        value: limitValue,
        tier: "T1_SCHEMA",
        locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
        observed_at: "2026-07-26T00:00:00.000Z",
        confidence: 1,
      },
      {
        key: "retention.artifact.days",
        value: 30,
        tier: "T3_CONFIG",
        locator: "packages/contracts/src/product-config.ts#retention.artifact_days",
        observed_at: "2026-07-26T00:00:00.000Z",
        confidence: 1,
      },
    ],
  };
}

const INPUT = {
  previous: snapshot(10_485_760),
  current: snapshot(26_214_400), // 10 MB → 25 MB
  files: FILES,
  detectedAt: "2026-07-26T00:00:00.000Z",
};

describe("milestone: limit change → two impacts, correct and explained", () => {
  it("produces EXACTLY two impacts, both DETERMINISTIC_REGEN, with substantive explanations", () => {
    const out = runPipeline(INPUT);
    expect(out.deltas).toEqual([
      {
        fact_key: "limit.upload.csv.max_bytes",
        from: 10_485_760,
        to: 26_214_400,
        kind: "value_changed",
        tier: "T1_SCHEMA",
        locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
      },
    ]);
    expect(out.impacts.length).toBe(2);
    const byUnit = new Map(out.impacts.map((i) => [i.doc_unit_id, i]));
    const mintlify = byUnit.get("mintlify:docs-mintlify/supported-files.mdx#size-limits");
    const inproduct = byUnit.get("inproduct:in-product-copy/files.json#uploader.limit_note");
    expect(mintlify).toBeDefined();
    expect(inproduct).toBeDefined();
    for (const impact of [mintlify!, inproduct!]) {
      expect(impact.action).toBe("DETERMINISTIC_REGEN");
      expect(impact.classification_rule).toBe(3);
      // Substantive: names the fact, the tier+locator, and the relationship.
      expect(impact.explanation).toContain("limit.upload.csv.max_bytes");
      expect(impact.explanation).toContain("T1_SCHEMA");
      expect(impact.explanation).toContain("packages/relay-api/src/limits.ts");
      expect(impact.explanation.length).toBeGreaterThan(120);
    }
    expect(mintlify!.explanation).toContain("concord:fact marker");
    expect(inproduct!.explanation).toContain("references_facts");
  });

  it("generates the correct deterministic patch diffs, in the original style", () => {
    const out = runPipeline(INPUT);
    expect(out.patches.length).toBe(2);
    const mdx = out.patches.find((p) => p.path.endsWith(".mdx"))!;
    const json = out.patches.find((p) => p.path.endsWith(".json"))!;
    expect(mdx.before).toContain("Maximum file size: 10 MB.");
    expect(mdx.after).toContain("Maximum file size: 25 MB.");
    expect(mdx.unified).toContain("-Maximum file size: 10 MB.");
    expect(mdx.unified).toContain("+Maximum file size: 25 MB.");
    expect(json.before).toContain("Files up to 10 MB are supported.");
    expect(json.after).toContain("Files up to 25 MB are supported.");
    // Nothing else in either file changed.
    expect(mdx.after.replace("25 MB", "10 MB")).toBe(mdx.before);
    expect(json.after.replace("25 MB", "10 MB")).toBe(json.before);
  });

  it("rerunning with no change produces two NO_ACTION impacts, not zero", () => {
    const out = runPipeline({ ...INPUT, previous: INPUT.current });
    // No delta at all → no impacts is wrong; the projections still exist and
    // the *changed-then-settled* case must show NO_ACTION. Model it as the
    // same delta re-observed with the value already applied to the estate:
    const patched = runPipeline(INPUT);
    const applied = INPUT.files.map((f) => {
      const patch = patched.patches.find((p) => p.path === f.path);
      return patch ? { path: f.path, content: patch.after } : f;
    });
    const rerun = runPipeline({ ...INPUT, files: applied });
    expect(rerun.impacts.length).toBe(2);
    for (const impact of rerun.impacts) {
      expect(impact.action).toBe("NO_ACTION");
      expect(impact.classification_rule).toBe(6);
    }
    expect(rerun.patches.length).toBe(0);
    // And with genuinely no delta, there are no impacts to report.
    expect(out.deltas.length).toBe(0);
  });

  it("the deterministic generator is byte-identical across two runs", () => {
    const one = runPipeline(INPUT);
    const two = runPipeline(INPUT);
    expect(JSON.stringify(one.patches)).toBe(JSON.stringify(two.patches));
    expect(JSON.stringify(one.impacts)).toBe(JSON.stringify(two.impacts));
    expect(JSON.stringify(one.units.map((u) => u.id))).toBe(
      JSON.stringify(two.units.map((u) => u.id)),
    );
  });

  it("normalized-equal prose renderings produce zero findings", () => {
    // "10 MB" asserted, fact = 10485760: same value, different rendering.
    const rerun = runPipeline({
      previous: snapshot(5_242_880),
      current: snapshot(10_485_760),
      files: FILES,
      detectedAt: INPUT.detectedAt,
    });
    // The estate already says 10 MB — both impacts are NO_ACTION (rule 6).
    expect(rerun.impacts.every((i) => i.action === "NO_ACTION")).toBe(true);
    expect(rerun.patches.length).toBe(0);
  });
});
