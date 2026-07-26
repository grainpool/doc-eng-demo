// Phase 12 — invariant I9, the heart of the project: one product fact may
// have multiple valid representations without having multiple truths. Four
// DIFFERENTLY-WORDED projections with equal normalized values produce ZERO
// findings; change one value and exactly one finding appears. The check
// compares normalized asserted values — never document text to document
// text (constraints.md AP2).
import { describe, expect, it } from "vitest";
import type { FactClaim } from "@relay/contracts";
import { consistencyFindings } from "../src/consistency.js";
import { normalizeProjections, runExtractors } from "../src/extractors.js";
import { parseEstate } from "../src/select.js";
import type { DocUnit, FactProjection } from "../src/types.js";
import { readEstate } from "../cli/ingest.js";

const FACTS: FactClaim[] = [
  {
    key: "limit.upload.csv.max_bytes",
    value: 10_485_760,
    tier: "T1_SCHEMA",
    locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
    observed_at: "2026-07-26T00:00:00.000Z",
    confidence: 1,
  },
];

/** Four renderings of ONE truth, worded differently on four surfaces. */
function projection(
  n: number,
  surface: string,
  asserted: string,
  extractor: FactProjection["extractor"],
  mode: FactProjection["mode"],
): FactProjection {
  return {
    id: `proj:${surface}:u${n}:limit.upload.csv.max_bytes:${extractor}`,
    fact_key: "limit.upload.csv.max_bytes",
    doc_unit_id: `${surface}:u${n}`,
    mode,
    asserted_value: asserted,
    span: null,
    extractor,
    confidence: extractor === "numeric_pattern" ? 0.85 : 1,
    detected_at: "2026-07-26T00:00:00.000Z",
  };
}

const FOUR_RENDERINGS: FactProjection[] = [
  projection(1, "mintlify", "10 MB", "declared_reference", "mechanical_value"),
  projection(2, "inproduct", "10,485,760 bytes", "declared_reference", "mechanical_value"),
  projection(3, "generated", "10485760", "generated_marker", "generated"),
  projection(4, "helpcenter", "10240 KB", "numeric_pattern", "derived_prose"),
];

describe("semantic consistency (I9)", () => {
  it("four differently-worded projections with equal normalized values → ZERO findings", () => {
    const { projections } = normalizeProjections(FOUR_RENDERINGS);
    // Sanity: the four renderings share nothing textually…
    expect(new Set(projections.map((p) => p.asserted_value)).size).toBe(4);
    // …but normalize to ONE value.
    expect(new Set(projections.map((p) => p.normalized_value)).size).toBe(1);
    expect(projections[0]!.normalized_value).toBe(10_485_760);
    expect(consistencyFindings(FACTS, projections)).toEqual([]);
  });

  it("changing ONE projection to a different value → exactly one finding, naming it", () => {
    const mutated = [
      ...FOUR_RENDERINGS.slice(0, 3),
      projection(4, "helpcenter", "5 MB", "numeric_pattern", "derived_prose"),
    ];
    const { projections } = normalizeProjections(mutated);
    const findings = consistencyFindings(FACTS, projections);
    expect(findings.length).toBe(1);
    expect(findings[0]).toMatchObject({
      kind: "inconsistent_value",
      fact_key: "limit.upload.csv.max_bytes",
      doc_unit_id: "helpcenter:u4",
    });
    expect(findings[0]!.detail).toContain("5 MB");
    expect(findings[0]!.detail).toContain("10485760");
  });

  it("an unknown-normalized projection can neither confirm nor deny — no finding either way", () => {
    const withUnknown = [
      ...FOUR_RENDERINGS,
      projection(5, "helpcenter", "roughly a month of uploads", "numeric_pattern", "derived_prose"),
    ];
    const { projections } = normalizeProjections(withUnknown);
    const unknown = projections.find((p) => p.doc_unit_id === "helpcenter:u5")!;
    expect(unknown.normalized_value).toBeNull();
    expect(consistencyFindings(FACTS, projections)).toEqual([]);
  });

  it("LIVE ESTATE: limit.upload.csv.max_bytes has ≥4 projections across ≥4 surfaces, differently worded, zero findings", () => {
    const files = readEstate();
    const units: DocUnit[] = parseEstate(files);
    const { projections } = runExtractors(units, FACTS, "2026-07-26T00:00:00.000Z");
    const limit = projections.filter(
      (p) => p.fact_key === "limit.upload.csv.max_bytes" && p.normalized_value !== null,
    );
    const surfaces = new Set(limit.map((p) => p.doc_unit_id.split(":")[0]));
    expect(limit.length).toBeGreaterThanOrEqual(4);
    expect(surfaces.size).toBeGreaterThanOrEqual(4);
    // Different wording, identical normalized value.
    expect(new Set(limit.map((p) => String(p.asserted_value))).size).toBeGreaterThanOrEqual(3);
    for (const p of limit) expect(p.normalized_value).toBe(10_485_760);
    const findings = consistencyFindings(FACTS, projections).filter(
      (f) => f.fact_key === "limit.upload.csv.max_bytes",
    );
    expect(findings).toEqual([]);
  });
});
