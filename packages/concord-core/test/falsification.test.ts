// Phase 15 — adversarial verification (architecture §6.2): a refuted
// finding is retained as `suppressed` with its refutation text and does not
// appear as an active finding; the falsifier defaults to refuted under
// uncertainty; only non-deterministic findings are falsified.
import { describe, expect, it } from "vitest";
import {
  buildFalsifierPrompt,
  needsFalsification,
  parseFalsifierResponse,
  proposalForFinding,
} from "../src/falsify.js";
import type { FactProjection, Finding } from "../src/types.js";

const NOW = "2026-07-26T00:00:00.000Z";

function projection(overrides: Partial<FactProjection>): FactProjection {
  return {
    id: "proj:x",
    fact_key: "limit.upload.csv.max_bytes",
    doc_unit_id: "helpcenter:h#article",
    mode: "derived_prose",
    asserted_value: "5 MB",
    span: null,
    extractor: "numeric_pattern",
    confidence: 0.85,
    detected_at: NOW,
    normalized_value: 5_242_880,
    ...overrides,
  };
}

function finding(projectionId: string): Finding {
  return {
    kind: "inconsistent_value",
    fact_key: "limit.upload.csv.max_bytes",
    doc_unit_id: "helpcenter:h#article",
    projection_id: projectionId,
    detail: "asserts 5 MB but T1 holds 10485760",
    owner: "eng-platform",
  };
}

describe("falsification scope", () => {
  it("non-deterministic findings (confidence < 1) are falsified; deterministic ones are not", () => {
    const soft = projection({ id: "p1", confidence: 0.85 });
    const hard = projection({ id: "p2", confidence: 1, extractor: "declared_reference" });
    const byId = new Map([["p1", soft], ["p2", hard]]);
    expect(needsFalsification(finding("p1"), byId)).toBe(true);
    expect(needsFalsification(finding("p2"), byId)).toBe(false);
    // Non-value findings (undocumented facts) are mechanical — never falsified.
    expect(
      needsFalsification(
        { ...finding("p1"), kind: "undocumented_fact", projection_id: null },
        byId,
      ),
    ).toBe(false);
  });

  it("the proposal is structured — claim, evidence, proposed_action — with no reasoning attached", () => {
    const proposal = proposalForFinding(finding("p1"), projection({ id: "p1" }), {
      fact_key: "limit.upload.csv.max_bytes",
      tier: "T1_SCHEMA",
      locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
      value: 10_485_760,
      observed_at: NOW,
    });
    expect(proposal.claim).toContain("limit.upload.csv.max_bytes");
    expect(proposal.evidence.length).toBe(1);
    expect(proposal.proposed_action).toBe("surface_inconsistent_value_finding");
    // The falsifier prompt carries the claim and evidence — and wraps the
    // passage as DATA. It never includes proposer reasoning (there is none).
    const prompt = buildFalsifierPrompt(proposal, "Files up to 5 MB are supported.");
    expect(prompt).toContain("===BEGIN DOC===");
    expect(prompt).toContain("CLAIM to refute");
    expect(prompt).not.toContain("reasoning");
  });
});

describe("falsifier verdict parsing — refuted under uncertainty", () => {
  it("a clean refutation is preserved verbatim", () => {
    const verdict = parseFalsifierResponse(
      JSON.stringify({ refuted: true, refutation: "The passage quotes a historical limit, not a current claim." }),
    );
    expect(verdict).toEqual({
      refuted: true,
      refutation: "The passage quotes a historical limit, not a current claim.",
    });
  });

  it("a survived claim passes through", () => {
    const verdict = parseFalsifierResponse(JSON.stringify({ refuted: false, refutation: null }));
    expect(verdict).toEqual({ refuted: false, refutation: null });
  });

  it("garbage, empty, or schema-violating responses default to REFUTED", () => {
    for (const bad of [null, "", "not json", JSON.stringify({ refuted: "maybe" }), JSON.stringify({})]) {
      const verdict = parseFalsifierResponse(bad);
      expect(verdict.refuted, String(bad)).toBe(true);
      expect(verdict.refutation).toBeTruthy(); // the suppression is explained
    }
  });
});
