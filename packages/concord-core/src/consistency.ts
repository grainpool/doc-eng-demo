import { matchFactKey, type FactClaim } from "@relay/contracts";
import type { FactProjection, Finding } from "./types.js";
import { normalizeForFact, unitOfFactKey } from "./normalize-value.js";
import { arbitrateAll } from "./authority.js";

/**
 * Semantic consistency (invariant I9): one product fact may have multiple
 * valid representations without having multiple truths. Checks compare
 * NORMALIZED asserted values against the authoritative normalized value —
 * never document text against document text (constraints.md AP2).
 *
 * A projection whose normalization is unknown (normalized_value null) can
 * neither confirm nor deny — it produces no value finding here; it is
 * derived_prose and Phase 13's grounded pipeline owns it.
 */

/** Value findings: a projection asserting a different value than truth. */
export function consistencyFindings(
  facts: readonly FactClaim[],
  projections: readonly FactProjection[],
): Finding[] {
  const findings: Finding[] = [];
  const arbitrations = arbitrateAll(facts);
  for (const projection of projections) {
    const entry = matchFactKey(projection.fact_key);
    if (!entry || entry.valueType === "json") continue;
    if (projection.normalized_value === null || projection.normalized_value === undefined) {
      continue;
    }
    const arbitration = arbitrations.get(projection.fact_key);
    const truth = arbitration?.authoritative;
    if (!truth) continue;
    const normalizedTruth = normalizeForFact(
      truth.value,
      entry.valueType,
      unitOfFactKey(projection.fact_key),
    );
    if (!normalizedTruth.ok) continue;
    if (projection.normalized_value !== normalizedTruth.value) {
      findings.push({
        kind: "inconsistent_value",
        fact_key: projection.fact_key,
        doc_unit_id: projection.doc_unit_id,
        projection_id: projection.id,
        owner: entry.owner,
        detail:
          `asserts ${JSON.stringify(projection.asserted_value)} ` +
          `(normalized ${JSON.stringify(projection.normalized_value)}) but ` +
          `${truth.tier} holds ${JSON.stringify(truth.value)} ` +
          `(normalized ${JSON.stringify(normalizedTruth.value)})`,
      });
    }
  }
  return findings;
}

/** A registered current-value fact with ZERO projections anywhere. */
export function undocumentedFactFindings(
  facts: readonly FactClaim[],
  projections: readonly FactProjection[],
): Finding[] {
  const projected = new Set(projections.map((p) => p.fact_key));
  const findings: Finding[] = [];
  for (const fact of facts) {
    if (fact.tier === "T4_RELEASE" || fact.tier === "T5_HUMAN") continue;
    if (projected.has(fact.key)) continue;
    findings.push({
      kind: "undocumented_fact",
      fact_key: fact.key,
      doc_unit_id: null,
      projection_id: null,
      owner: matchFactKey(fact.key)?.owner ?? null,
      detail: `no documentation surface projects ${fact.key} (${fact.tier}, value ${JSON.stringify(fact.value)})`,
    });
  }
  return findings;
}

/**
 * UNDECLARED_FACT_REF (Phase 16): an in-product copy entry that RENDERS a
 * registered fact's value without declaring it in references_facts. The
 * value may be correct today — the missing declaration is what breaks the
 * reconciliation contract (the entry will silently go stale on change).
 */
export function undeclaredReferenceFindings(
  units: readonly { id: string; surface: string; owner: string; frontmatter: Record<string, unknown> }[],
  projections: readonly FactProjection[],
): Finding[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const findings: Finding[] = [];
  for (const projection of projections) {
    if (projection.extractor === "declared_reference") continue;
    const unit = unitById.get(projection.doc_unit_id);
    if (!unit || unit.surface !== "inproduct") continue;
    const declared = (unit.frontmatter.references_facts ?? []) as string[];
    if (declared.includes(projection.fact_key)) continue;
    if (matchFactKey(projection.fact_key) === null) continue;
    if (projection.fact_key.startsWith("term.canonical.")) continue; // term usage ≠ value rendering
    findings.push({
      kind: "undeclared_reference",
      fact_key: projection.fact_key,
      doc_unit_id: projection.doc_unit_id,
      projection_id: projection.id,
      detail:
        `${projection.doc_unit_id} renders ${projection.fact_key} ` +
        `(${JSON.stringify(projection.asserted_value)}, via ${projection.extractor}) ` +
        `without declaring it in references_facts — it will silently go stale when the fact changes`,
      owner: unit.owner,
    });
  }
  return findings;
}

/** Authority conflicts surfaced as findings (Phase 15 acts on them). */
export function authorityConflictFindings(facts: readonly FactClaim[]): Finding[] {
  const findings: Finding[] = [];
  for (const [, arbitration] of arbitrateAll(facts)) {
    for (const conflict of arbitration.conflicts) {
      findings.push({
        kind: "authority_conflict",
        fact_key: conflict.fact_key,
        doc_unit_id: null,
        projection_id: null,
        owner: matchFactKey(conflict.fact_key)?.owner ?? null,
        detail: conflict.detail,
      });
    }
  }
  return findings;
}
