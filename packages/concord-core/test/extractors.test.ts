// Phase 12 — extractor invariants: the model_extraction confidence cap
// (≤ 0.7, I5's first half), ambiguous normalization → unknown + downgrade,
// and the deliberate refusal of ambiguous numeric attribution.
import { describe, expect, it } from "vitest";
import type { FactClaim } from "@relay/contracts";
import {
  extractNumericPatterns,
  normalizeProjections,
  runExtractors,
  unitsNeedingModelExtraction,
} from "../src/extractors.js";
import {
  MODEL_EXTRACTION_CONFIDENCE_CAP,
  parseModelExtraction,
} from "../src/model-extract.js";
import { normalizeForFact, parseDuration } from "../src/normalize-value.js";
import type { DocUnit, FactProjection } from "../src/types.js";
import { sha256Hex } from "../src/hash.js";

const NOW = "2026-07-26T00:00:00.000Z";

function unit(id: string, body: string, overrides: Partial<DocUnit> = {}): DocUnit {
  return {
    id,
    surface: "helpcenter",
    path: "help-center/articles/x.md",
    anchor: "article",
    title: "Test",
    body,
    body_sha256: sha256Hex(body),
    audience: "end_user",
    editorial_register: "friendly_help",
    owner: "support-content",
    generated: false,
    frontmatter: {},
    ...overrides,
  };
}

function claim(key: string, value: unknown): FactClaim {
  return {
    key,
    value: value as FactClaim["value"],
    tier: "T3_CONFIG",
    locator: "test",
    observed_at: NOW,
    confidence: 1,
  };
}

describe("model_extraction confidence cap", () => {
  it("no model_extraction projection can carry confidence above 0.7 — even when the model claims 0.99", () => {
    const target = unit("helpcenter:help-center/articles/x.md#article", "Uploads are capped at 10 MB per file.");
    const projections = parseModelExtraction(
      target,
      NOW,
      JSON.stringify({
        candidates: [
          { fact_key: "limit.upload.csv.max_bytes", asserted_text: "10 MB", confidence: 0.99 },
        ],
      }),
    );
    expect(projections.length).toBe(1);
    expect(projections[0]!.confidence).toBeLessThanOrEqual(MODEL_EXTRACTION_CONFIDENCE_CAP);
    expect(projections[0]!.extractor).toBe("model_extraction");
    // And it is NEVER a mechanical/generated mode (I5).
    expect(projections[0]!.mode).toBe("derived_prose");
  });

  it("model extraction runs ONLY where the deterministic extractors found nothing", () => {
    const covered = unit("mintlify:a#s", "Maximum file size: 10 MB for every upload today.", {
      surface: "mintlify",
    });
    const uncovered = unit(
      "helpcenter:b#article",
      "Relay keeps your workspace tidy and forgets old uploads automatically after a while.",
    );
    const generated = unit("generated:c#page", "| limit.upload.csv.max_bytes | 10485760 |", {
      surface: "generated",
      generated: true,
    });
    const facts = [claim("limit.upload.csv.max_bytes", 10_485_760)];
    const { projections } = runExtractors([covered, uncovered, generated], facts, NOW);
    const eligible = unitsNeedingModelExtraction([covered, uncovered, generated], projections);
    expect(eligible.map((u) => u.id)).toEqual(["helpcenter:b#article"]);
  });
});

describe("ambiguous normalization → unknown, and downgrade", () => {
  it("'a month' is refused — unknown, never a guess of 30", () => {
    const result = parseDuration("a month");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("month");
    expect(normalizeForFact("a month", "integer", "days")).toMatchObject({ ok: false });
  });

  it("an unknown normalized value downgrades the projection to derived_prose", () => {
    const mechanical: FactProjection = {
      id: "proj:x:retention.artifact.days:frontmatter_field",
      fact_key: "retention.artifact.days",
      doc_unit_id: "mintlify:x#intro",
      mode: "mechanical_value",
      asserted_value: "a month",
      span: null,
      extractor: "frontmatter_field",
      confidence: 1,
      detected_at: NOW,
    };
    const { projections, refusals } = normalizeProjections([mechanical]);
    expect(projections[0]!.mode).toBe("derived_prose"); // downgraded
    expect(projections[0]!.normalized_value).toBeNull();
    expect(refusals.length).toBe(1);
    expect(refusals[0]!.reason).toContain("downgraded to derived_prose");
  });

  it("unambiguous duration renderings normalize cleanly", () => {
    expect(normalizeForFact("30 days", "integer", "days")).toEqual({ ok: true, value: 30 });
    expect(normalizeForFact("30", "integer", "days")).toEqual({ ok: true, value: 30 });
    expect(normalizeForFact("2 weeks", "integer", "days")).toEqual({ ok: true, value: 14 });
  });

  it("availability prose: 'not yet available on iOS' is false; 'coming soon' is unknown", () => {
    expect(normalizeForFact("not yet available on iOS", "boolean")).toEqual({ ok: true, value: false });
    expect(normalizeForFact("available on web", "boolean")).toEqual({ ok: true, value: true });
    expect(normalizeForFact("coming soon", "boolean")).toMatchObject({ ok: false });
  });
});

describe("ambiguous numeric attribution is refused, not guessed", () => {
  it("'30 days' matching two retention facts of equal value attributes to NEITHER and records why", () => {
    const prose = unit(
      "helpcenter:help-center/articles/retention.md#article",
      "Relay deletes old data after 30 days.",
      { path: "help-center/articles/retention.md" },
    );
    const facts = [
      claim("retention.artifact.days", 30),
      claim("retention.uploaded_file.days", 30),
    ];
    const { projections, refusals } = extractNumericPatterns([prose], facts, new Map(), NOW);
    expect(projections).toEqual([]);
    expect(refusals.length).toBe(1);
    expect(refusals[0]!.reason).toContain("retention.artifact.days");
    expect(refusals[0]!.reason).toContain("retention.uploaded_file.days");
    expect(refusals[0]!.reason).toContain("refused");
  });

  it("with unit awareness, a days rendering never claims a bytes fact of the same magnitude", () => {
    const prose = unit("helpcenter:h#article", "We keep things for 10485760 days, allegedly.");
    const facts = [claim("limit.upload.csv.max_bytes", 10_485_760)];
    const { projections } = extractNumericPatterns([prose], facts, new Map(), NOW);
    expect(projections).toEqual([]);
  });
});
