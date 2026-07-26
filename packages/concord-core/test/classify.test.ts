// Phase 13 — the full §6.1 classification table: all six rules fire on
// crafted inputs; the I5 guard is code, not convention; terminology closure
// routes anchors/URLs to EDITORIAL_REVIEW and prose to a patchable class.
import { describe, expect, it } from "vitest";
import type { FactClaim } from "@relay/contracts";
import { arbitrate, expandClaims } from "../src/authority.js";
import { classify, dispositionFor } from "../src/classify.js";
import { runExtractors } from "../src/extractors.js";
import { sha256Hex } from "../src/hash.js";
import type { DocUnit, FactDelta, FactProjection } from "../src/types.js";

const NOW = "2026-07-26T00:00:00.000Z";

function unit(overrides: Partial<DocUnit> = {}): DocUnit {
  const body = overrides.body ?? "Maximum file size: 10 MB.";
  return {
    id: "mintlify:docs-mintlify/x.mdx#s",
    surface: "mintlify",
    path: "docs-mintlify/x.mdx",
    anchor: "s",
    title: "X",
    body,
    body_sha256: sha256Hex(body),
    audience: "developer",
    editorial_register: "technical_reference",
    owner: "docs",
    generated: false,
    frontmatter: {},
    ...overrides,
  };
}

function projection(overrides: Partial<FactProjection> = {}): FactProjection {
  return {
    id: "proj:x",
    fact_key: "limit.upload.csv.max_bytes",
    doc_unit_id: "mintlify:docs-mintlify/x.mdx#s",
    mode: "mechanical_value",
    asserted_value: "10 MB",
    span: { start: 19, end: 24 },
    extractor: "declared_reference",
    confidence: 1,
    detected_at: NOW,
    normalized_value: 10_485_760,
    ...overrides,
  };
}

function delta(overrides: Partial<FactDelta> = {}): FactDelta {
  return {
    fact_key: "limit.upload.csv.max_bytes",
    from: 10_485_760,
    to: 26_214_400,
    kind: "value_changed",
    tier: "T1_SCHEMA",
    locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
    ...overrides,
  };
}

function claim(key: string, value: unknown, tier: FactClaim["tier"]): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator: "t", observed_at: NOW, confidence: 1 };
}

const CLEAN_ARBITRATION = arbitrate(
  "limit.upload.csv.max_bytes",
  expandClaims([claim("limit.upload.csv.max_bytes", 26_214_400, "T1_SCHEMA")]),
);

describe("classification table (§6.1) — all six rules", () => {
  it("rule 1: disagreeing authoritative claims → UNRESOLVED_CONFLICT", () => {
    const conflicted = arbitrate(
      "limit.upload.csv.max_bytes",
      expandClaims([
        claim("limit.upload.csv.max_bytes", 26_214_400, "T1_SCHEMA"),
        claim("limit.upload.csv.max_bytes", 5_242_880, "T3_CONFIG"),
      ]),
    );
    const result = classify({
      projection: projection(),
      delta: delta(),
      unit: unit(),
      arbitration: conflicted,
    });
    expect(result).toEqual({ action: "UNRESOLVED_CONFLICT", rule: 1 });
    expect(dispositionFor(result.action)).toBe("unresolved");
  });

  it("rule 1: missing/unresolvable evidence → UNRESOLVED_CONFLICT", () => {
    const noAuthority = arbitrate(
      "limit.upload.csv.max_bytes",
      expandClaims([claim("limit.upload.csv.max_bytes", 1, "T4_RELEASE")]),
    );
    // The only claim is temporal → ignored → no authoritative evidence.
    const result = classify({
      projection: projection(),
      delta: delta(),
      unit: unit(),
      arbitration: noAuthority,
    });
    expect(result.rule).toBe(1);
  });

  it("rule 2: generated mode → DETERMINISTIC_REGEN", () => {
    const result = classify({
      projection: projection({ mode: "generated", asserted_value: "10485760", normalized_value: 10_485_760 }),
      delta: delta(),
      unit: unit({ generated: true, owner: "concord" }),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(result).toEqual({ action: "DETERMINISTIC_REGEN", rule: 2 });
  });

  it("rule 3: mechanical scalar with unambiguous span → DETERMINISTIC_REGEN", () => {
    const result = classify({
      projection: projection(),
      delta: delta(),
      unit: unit(),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(result).toEqual({ action: "DETERMINISTIC_REGEN", rule: 3 });
    expect(dispositionFor(result.action)).toBe("proposed");
  });

  it("rule 4: derived prose over a value change with one source → GROUNDED_PATCH", () => {
    const result = classify({
      projection: projection({ mode: "derived_prose", extractor: "numeric_pattern", confidence: 0.85 }),
      delta: delta(),
      unit: unit(),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(result).toEqual({ action: "GROUNDED_PATCH", rule: 4 });
  });

  it("rule 5: editorial mode / IA delta / human-owned unit → EDITORIAL_REVIEW", () => {
    const editorial = classify({
      projection: projection({ mode: "editorial", span: null, asserted_value: "Job", normalized_value: "Job" }),
      delta: delta({ fact_key: "term.canonical.task", from: "Job", to: "Task" }),
      unit: unit(),
      arbitration: null,
    });
    expect(editorial).toEqual({ action: "EDITORIAL_REVIEW", rule: 5 });

    const iaDelta = classify({
      projection: projection({ mode: "derived_prose" }),
      delta: delta({ kind: "prerequisite_added" }),
      unit: unit(),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(iaDelta).toEqual({ action: "EDITORIAL_REVIEW", rule: 5 });

    const humanOwned = classify({
      // Span-less mechanical (frontmatter) fails rule 3 and lands with the
      // unit's human owner.
      projection: projection({ span: null }),
      delta: delta(),
      unit: unit({ owner: "docs" }),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(humanOwned).toEqual({ action: "EDITORIAL_REVIEW", rule: 5 });
  });

  it("rule 6: asserted value already equals the new value → NO_ACTION", () => {
    const result = classify({
      projection: projection({ asserted_value: "25 MB", normalized_value: 26_214_400 }),
      delta: delta(),
      unit: unit(),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(result).toEqual({ action: "NO_ACTION", rule: 6 });
    expect(dispositionFor(result.action)).toBe("no_action");
  });

  it("I5 guard: a model_extraction projection can NEVER yield DETERMINISTIC_REGEN", () => {
    for (const mode of ["generated", "mechanical_value"] as const) {
      expect(() =>
        classify({
          projection: projection({ extractor: "model_extraction", mode, confidence: 0.7 }),
          delta: delta(),
          unit: unit(),
          arbitration: CLEAN_ARBITRATION,
        }),
      ).toThrow(/I5/);
    }
    // In its ONLY legal mode it classifies to a review path, never regen.
    const legal = classify({
      projection: projection({ extractor: "model_extraction", mode: "derived_prose", confidence: 0.7 }),
      delta: delta(),
      unit: unit(),
      arbitration: CLEAN_ARBITRATION,
    });
    expect(legal.action).not.toBe("DETERMINISTIC_REGEN");
  });
});

describe("terminology closure (validation.md §7)", () => {
  const FACTS: FactClaim[] = [
    claim("term.canonical.task", "Assignment", "T3_CONFIG"),
    claim(
      "release.2026_02_14_task_rename.changes",
      { changes: [{ fact_key: "term.canonical.task", from: "Job", to: "Task", kind: "term_renamed" }] },
      "T4_RELEASE",
    ),
  ];
  const priorTerms = new Map([["term.canonical.task", "Task"]]);

  it("a rename impacts prose AND anchor/URL occurrences of the old term — routed differently", () => {
    const page = unit({
      id: "mintlify:docs-mintlify/tasks.mdx#task-setup",
      path: "docs-mintlify/tasks.mdx",
      anchor: "task-setup",
      title: "Task setup",
      body: "A Task runs one bounded operation. See [tasks](/tasks#task-setup) for details.",
    });
    const { projections } = runExtractors([page], FACTS, NOW, priorTerms);
    const term = projections.filter((p) => p.fact_key === "term.canonical.task");
    const prose = term.find((p) => p.mode === "derived_prose");
    const anchor = term.find((p) => p.mode === "editorial");
    expect(prose).toBeDefined();
    expect(anchor).toBeDefined();
    expect(prose!.asserted_value).toBe("Task");

    const renameDelta = delta({
      fact_key: "term.canonical.task",
      from: "Task",
      to: "Assignment",
      tier: "T3_CONFIG",
    });
    const proseClass = classify({
      projection: prose!,
      delta: renameDelta,
      unit: page,
      arbitration: arbitrate("term.canonical.task", expandClaims(FACTS)),
    });
    const anchorClass = classify({
      projection: anchor!,
      delta: renameDelta,
      unit: page,
      arbitration: arbitrate("term.canonical.task", expandClaims(FACTS)),
    });
    // Prose is patchable (grounded); anchors/URLs are editorial — always.
    expect(["DETERMINISTIC_REGEN", "GROUNDED_PATCH"]).toContain(proseClass.action);
    expect(anchorClass).toEqual({ action: "EDITORIAL_REVIEW", rule: 5 });
  });

  it("the OLD-old term (from T4 history) still projects — full closure", () => {
    const page = unit({
      id: "helpcenter:help-center/articles/old.md#article",
      surface: "helpcenter",
      path: "help-center/articles/old.md",
      anchor: "article",
      body: "Click run to start a Job from the queue page.",
      owner: "support-content",
    });
    const { projections } = runExtractors([page], FACTS, NOW, priorTerms);
    const term = projections.find((p) => p.fact_key === "term.canonical.task");
    expect(term).toBeDefined();
    expect(term!.asserted_value).toBe("Job");
  });
});
