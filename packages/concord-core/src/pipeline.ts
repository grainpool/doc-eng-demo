import type { ProductTruthSnapshot } from "@relay/contracts";
import { classify } from "./classify.js";
import { runExtractors, type ExtractionRefusal } from "./extractors.js";
import {
  authorityConflictFindings,
  consistencyFindings,
  undocumentedFactFindings,
} from "./consistency.js";
import { parseEstate } from "./select.js";
import { makeDiff } from "./diff.js";
import { formatValue, parseValue, styleOf } from "./normalize-value.js";
import type {
  DocUnit,
  FactDelta,
  FactProjection,
  FileDiff,
  Finding,
  Impact,
} from "./types.js";

/**
 * The reconciliation pipeline (architecture.md §6):
 * DETECT → NORMALIZE → PROJECT → TRACE → CLASSIFY → patch.
 * Pure functions over plain data; no I/O, no env, no network (G2).
 *
 * Phase 12: NORMALIZE/PROJECT run all six adapters and the full
 * deterministic extractor suite; findings (I9 value inconsistencies,
 * undocumented facts, authority conflicts) are first-class output.
 * CLASSIFY still fires only for confidence-1.0 projections — rules 4/5 and
 * the grounded pipeline arrive in Phase 13, and a sub-1.0 projection must
 * not reach a deterministic action path in the meantime.
 */

export interface PipelineInput {
  previous: ProductTruthSnapshot;
  current: ProductTruthSnapshot;
  /** Estate-relative files for all adapters. */
  files: ReadonlyArray<{ path: string; content: string }>;
  /** Deterministic timestamp injected by the caller (runs record it). */
  detectedAt: string;
}

export interface PipelineOutput {
  deltas: FactDelta[];
  units: DocUnit[];
  projections: FactProjection[];
  impacts: Impact[];
  patches: FileDiff[];
  findings: Finding[];
  refusals: ExtractionRefusal[];
}

/** DETECT: diff two snapshots on authoritative current-value tiers. */
export function detectDeltas(
  previous: ProductTruthSnapshot,
  current: ProductTruthSnapshot,
): FactDelta[] {
  // T4 is temporal and T5 is a record — neither carries current values.
  const CURRENT_VALUE_TIERS = new Set(["T0_RUNTIME", "T1_SCHEMA", "T2_CLI", "T3_CONFIG"]);
  const before = new Map(
    previous.facts
      .filter((f) => CURRENT_VALUE_TIERS.has(f.tier))
      .map((f) => [f.key, f]),
  );
  const deltas: FactDelta[] = [];
  for (const fact of current.facts) {
    if (!CURRENT_VALUE_TIERS.has(fact.tier)) continue;
    const prior = before.get(fact.key);
    if (!prior) continue; // fact appearance surfaces as a finding, not a delta
    if (JSON.stringify(prior.value) !== JSON.stringify(fact.value)) {
      deltas.push({
        fact_key: fact.key,
        from: prior.value,
        to: fact.value,
        kind: "value_changed",
        tier: fact.tier,
        locator: fact.locator,
      });
    }
  }
  return deltas;
}

/** Replace a span inside the unit's body wherever that body sits in its file. */
function replaceSpan(
  fileContent: string,
  unitBody: string,
  span: { start: number; end: number },
  replacement: string,
): string {
  const bodyIndex = fileContent.indexOf(unitBody);
  if (bodyIndex < 0) {
    throw new Error("unit body not found in file — adapter and file disagree");
  }
  const absoluteStart = bodyIndex + span.start;
  const absoluteEnd = bodyIndex + span.end;
  return (
    fileContent.slice(0, absoluteStart) +
    replacement +
    fileContent.slice(absoluteEnd)
  );
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const deltas = detectDeltas(input.previous, input.current);

  // NORMALIZE: all six adapters over the files they own.
  const units = parseEstate(input.files);

  // PROJECT: the full deterministic extractor suite (model_extraction is a
  // network concern — its candidates are merged by the caller, never here).
  const { projections, refusals } = runExtractors(
    units,
    input.current.facts,
    input.detectedAt,
  );

  // Findings: value inconsistencies (I9), undocumented facts, authority
  // conflicts — recorded now, acted on in Phases 13/15.
  const findings: Finding[] = [
    ...consistencyFindings(input.current.facts, projections),
    ...undocumentedFactFindings(input.current.facts, projections),
    ...authorityConflictFindings(input.current.facts),
  ];

  // TRACE + CLASSIFY + patch, per delta × projection. Only confidence-1.0
  // projections classify in Phase 12 (see module doc).
  const impacts: Impact[] = [];
  const patches: FileDiff[] = [];
  const unitById = new Map(units.map((u) => [u.id, u]));

  for (const delta of deltas) {
    for (const projection of projections.filter(
      (p) =>
        p.fact_key === delta.fact_key &&
        p.confidence === 1 &&
        // TODO(phase-13): span-less mechanical projections (frontmatter
        // fields) need a frontmatter-aware patcher; until then they are
        // recorded but not classified — never a silent rule-5 crash.
        (p.mode === "generated" || (p.mode === "mechanical_value" && p.span !== null)),
    )) {
      const unit = unitById.get(projection.doc_unit_id);
      if (!unit) continue;
      const { action, rule } = classify(projection, delta);
      const mechanism =
        projection.extractor === "declared_reference"
          ? unit.surface === "inproduct"
            ? "a references_facts declaration"
            : "a concord:fact marker"
          : projection.extractor === "frontmatter_field"
            ? "a frontmatter facts field"
            : "a generated fact-table row";
      const explanation =
        `${unit.id} projects fact ${delta.fact_key} via ${mechanism} ` +
        `and currently renders it as ${JSON.stringify(projection.asserted_value)}. ` +
        `${delta.fact_key} changed from ${JSON.stringify(delta.from)} to ${JSON.stringify(delta.to)} ` +
        `in ${delta.tier} at ${delta.locator}` +
        (action === "NO_ACTION"
          ? "; the rendered value already equals the new value after normalization, so nothing needs to change."
          : `; the rendered value no longer matches and is substituted mechanically (extractor ${projection.extractor}, confidence 1.0).`);
      impacts.push({
        fact_key: delta.fact_key,
        delta: { from: delta.from, to: delta.to, kind: delta.kind },
        doc_unit_id: projection.doc_unit_id,
        projection_id: projection.id,
        action,
        classification_rule: rule,
        explanation,
      });

      if (
        action === "DETERMINISTIC_REGEN" &&
        projection.span &&
        typeof projection.asserted_value === "string"
      ) {
        const file = input.files.find((f) => f.path === unit.path);
        if (!file) continue;
        const style = styleOf(projection.asserted_value);
        const numeric =
          typeof delta.to === "number"
            ? delta.to
            : (parseValue(String(delta.to)) ?? Number(delta.to));
        const rendered = formatValue(numeric, style);
        const after = replaceSpan(
          file.content,
          unit.body,
          projection.span,
          rendered,
        );
        patches.push(makeDiff(unit.path, file.content, after));
      }
    }
  }

  return { deltas, units, projections, impacts, patches, findings, refusals };
}
