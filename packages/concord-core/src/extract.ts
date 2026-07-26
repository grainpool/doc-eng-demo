import type { DocUnit, FactProjection } from "./types.js";
import { parseValue } from "./normalize-value.js";

/**
 * Phase 10: ONE extractor — declared_reference, confidence 1.0.
 *  - mintlify: an MDX comment marker `{/* concord:fact key=... *\/}`; the
 *    asserted value is the first parseable value rendering AFTER the marker
 *    within the unit body (span recorded for mechanical substitution).
 *  - inproduct: the copy entry's `references_facts`; the asserted value is
 *    the first parseable value in the text (null for interpolated copy,
 *    which renders the live fact and asserts nothing statically).
 * No pattern matching, no model extraction — those are later phases.
 */

const MARKER = /\{\/\*\s*concord:fact\s+key=([a-z0-9_.]+)\s*\*\/\}/g;
/** Value renderings the normalizer understands, found inside prose. */
const VALUE_IN_PROSE = /([\d,]+(?:\.\d+)?\s*(?:MB|KB|bytes?)|(?<![\w,.])\d{4,}(?![\w,]))/i;

function projectionId(unitId: string, factKey: string): string {
  return `proj:${unitId}:${factKey}`;
}

export function extractDeclaredReferences(
  units: DocUnit[],
  detectedAt: string,
): FactProjection[] {
  const projections: FactProjection[] = [];
  for (const unit of units) {
    if (unit.surface === "mintlify" || unit.surface === "generated") {
      for (const match of unit.body.matchAll(MARKER)) {
        const factKey = match[1] as string;
        const afterMarker = unit.body.slice(match.index + match[0].length);
        const value = VALUE_IN_PROSE.exec(afterMarker);
        const span =
          value?.index !== undefined
            ? {
                start: match.index + match[0].length + value.index,
                end:
                  match.index + match[0].length + value.index + value[0].length,
              }
            : null;
        projections.push({
          id: projectionId(unit.id, factKey),
          fact_key: factKey,
          doc_unit_id: unit.id,
          mode: unit.generated ? "generated" : "mechanical_value",
          asserted_value: value ? value[0] : null,
          span,
          extractor: "declared_reference",
          confidence: 1,
          detected_at: detectedAt,
        });
      }
    }
    if (unit.surface === "inproduct") {
      const declared = (unit.frontmatter.references_facts ?? []) as string[];
      for (const factKey of declared) {
        const value = VALUE_IN_PROSE.exec(unit.body);
        const parseable = value !== null && parseValue(value[0]) !== null;
        // TODO(phase-12): copy whose text interpolates the fact at render
        // time ({max_size_human}) asserts nothing statically — it cannot
        // drift and there is nothing to substitute. Those declarations
        // become derived_prose projections when rule 4 exists; in Phase 10
        // they would only reach an unreachable-rule branch, so they are
        // deliberately not projected.
        if (!parseable) continue;
        projections.push({
          id: projectionId(unit.id, factKey),
          fact_key: factKey,
          doc_unit_id: unit.id,
          mode: "mechanical_value",
          asserted_value: value[0],
          span: { start: value.index, end: value.index + value[0].length },
          extractor: "declared_reference",
          confidence: 1,
          detected_at: detectedAt,
        });
      }
    }
  }
  return projections;
}
