import type { CliIntrospection, ProductTruthSnapshot } from "@relay/contracts";
import { classify, dispositionFor } from "./classify.js";
import { runExtractors, type ExtractionRefusal } from "./extractors.js";
import {
  authorityConflictFindings,
  consistencyFindings,
  undocumentedFactFindings,
} from "./consistency.js";
import { arbitrateAll, type Arbitration } from "./authority.js";
import { runGenerators } from "./generators/index.js";
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
  Warning,
} from "./types.js";

/**
 * The reconciliation pipeline (architecture.md §6):
 * DETECT → NORMALIZE → PROJECT → TRACE → CLASSIFY → patch/escalate.
 * Pure functions over plain data; no I/O, no env, no network (G2).
 *
 * Phase 13: the full §6.1 classification table is live — every impact gets
 * an action, a rule number, and a disposition (AP6: nothing silently
 * dropped). Deterministic generators regenerate every generated surface
 * with hand-edit detection. GROUNDED_PATCH and EDITORIAL_REVIEW impacts are
 * recorded `unresolved` — the AI paths are Phase 14 and are NOT invoked.
 * No model call happens anywhere in this pipeline (AP3).
 */

export interface PipelineInput {
  previous: ProductTruthSnapshot;
  current: ProductTruthSnapshot;
  /** Estate-relative files for all adapters. */
  files: ReadonlyArray<{ path: string; content: string }>;
  /** Deterministic timestamp injected by the caller (runs record it). */
  detectedAt: string;
  /** CLI introspection capture; when present, generators run. */
  cli?: CliIntrospection;
}

export interface PipelineOutput {
  deltas: FactDelta[];
  units: DocUnit[];
  projections: FactProjection[];
  impacts: Impact[];
  patches: FileDiff[];
  findings: Finding[];
  refusals: ExtractionRefusal[];
  warnings: Warning[];
  generated_paths: string[];
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
        kind: fact.key.startsWith("availability.")
          ? "availability_changed"
          : "value_changed",
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

/** The relationship half of an explanation, per extractor/mode. */
function describeRelationship(projection: FactProjection, unit: DocUnit): string {
  if (projection.extractor === "declared_reference") {
    return unit.surface === "inproduct"
      ? "declares the fact via references_facts and renders it"
      : "declares the fact via a concord:fact marker and renders it";
  }
  if (projection.extractor === "frontmatter_field") {
    return "asserts the fact in a frontmatter facts field";
  }
  if (projection.extractor === "generated_marker") {
    return "renders the fact in a generated fact-table row";
  }
  if (projection.extractor === "term_occurrence") {
    return projection.mode === "editorial"
      ? "uses the term in a heading, anchor, or link URL"
      : "uses the term in prose";
  }
  if (projection.extractor === "availability_table") {
    return "states the availability in a platform matrix cell";
  }
  if (projection.extractor === "model_extraction") {
    return "asserts the fact in prose (model-proposed candidate, confidence ≤ 0.7)";
  }
  return "restates the fact's value in prose";
}

function explain(
  projection: FactProjection,
  delta: FactDelta,
  unit: DocUnit,
  action: string,
): string {
  const base =
    `${unit.id} (owner ${unit.owner}) ${describeRelationship(projection, unit)} ` +
    `as ${JSON.stringify(projection.asserted_value)}. ` +
    `${delta.fact_key} changed from ${JSON.stringify(delta.from)} to ${JSON.stringify(delta.to)} ` +
    `in ${delta.tier} at ${delta.locator}`;
  switch (action) {
    case "NO_ACTION":
      return `${base}; the rendered value already equals the new value after normalization, so nothing needs to change.`;
    case "DETERMINISTIC_REGEN":
      return `${base}; the rendering is mechanical (extractor ${projection.extractor}, confidence ${projection.confidence}) and is regenerated/substituted without a model.`;
    case "GROUNDED_PATCH":
      return `${base}; the prose must be rewritten to match — a grounded, review-required patch (Phase 14) citing ${delta.tier} ${delta.locator} as evidence.`;
    case "EDITORIAL_REVIEW":
      return `${base}; rewriting this occurrence is an editorial decision (anchors/URLs break inbound links; the unit's owner is ${unit.owner}), so it is routed to a human.`;
    default:
      return `${base}; authoritative claims about this fact disagree or evidence is unresolvable — surfaced as a conflict, no edit.`;
  }
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const deltas = detectDeltas(input.previous, input.current);

  // NORMALIZE: all six adapters over the files they own.
  const units = parseEstate(input.files);

  // PROJECT: the full deterministic extractor suite. Terminology closure:
  // previous term values become known variants so units still using the OLD
  // term project against the renamed fact.
  const priorTerms = new Map<string, string>();
  for (const fact of input.previous.facts) {
    if (fact.key.startsWith("term.canonical.") && typeof fact.value === "string") {
      priorTerms.set(fact.key, fact.value);
    }
  }
  const { projections, refusals } = runExtractors(
    units,
    input.current.facts,
    input.detectedAt,
    priorTerms,
    input.previous.facts,
  );

  // Findings: value inconsistencies (I9), undocumented facts (with owner),
  // authority conflicts — recorded now, acted on in Phases 14/15.
  const findings: Finding[] = [
    ...consistencyFindings(input.current.facts, projections),
    ...undocumentedFactFindings(input.current.facts, projections),
    ...authorityConflictFindings(input.current.facts),
  ];

  // Deterministic generators (Phase 13) with hand-edit detection.
  const generated = input.cli
    ? runGenerators(input.previous.facts, input.current.facts, {
        cli: input.cli,
        files: input.files,
      })
    : { diffs: [], warnings: [], paths: [] };
  const generatedDiffByPath = new Map(generated.diffs.map((d) => [d.path, d]));

  // TRACE + CLASSIFY, per delta × projection — every projection, full table.
  // Patches COMPOSE per path: a generator rewrite and a mechanical span
  // substitution to the same file merge into one diff, span substitutions
  // applying on top of the generator's output.
  const arbitrations: Map<string, Arbitration> = arbitrateAll(input.current.facts);
  const impacts: Impact[] = [];
  const afterByPath = new Map<string, { before: string; after: string }>(
    generated.diffs.map((d) => [d.path, { before: d.before, after: d.after }]),
  );
  const unitById = new Map(units.map((u) => [u.id, u]));

  for (const delta of deltas) {
    for (const projection of projections.filter((p) => p.fact_key === delta.fact_key)) {
      const unit = unitById.get(projection.doc_unit_id);
      if (!unit) continue;
      const { action, rule } = classify({
        projection,
        delta,
        unit,
        arbitration: arbitrations.get(delta.fact_key) ?? null,
      });
      impacts.push({
        fact_key: delta.fact_key,
        delta: { from: delta.from, to: delta.to, kind: delta.kind },
        doc_unit_id: projection.doc_unit_id,
        projection_id: projection.id,
        action,
        classification_rule: rule,
        explanation: explain(projection, delta, unit, action),
        disposition: dispositionFor(action),
      });

      // Patch generation: rule 2 regen is the generator's diff (seeded in
      // afterByPath); rule 3 is a mechanical span substitution applied on
      // top of whatever the file's pending content already is.
      if (
        action === "DETERMINISTIC_REGEN" &&
        !unit.generated &&
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
        const pending = afterByPath.get(unit.path);
        const base = pending?.after ?? file.content;
        const after = replaceSpan(base, unit.body, projection.span, rendered);
        afterByPath.set(unit.path, { before: pending?.before ?? file.content, after });
      }
      // Rule 2 on a generated unit whose generator produced no diff (facts
      // already reflected) needs no patch — the regen is a no-op by content.
      void generatedDiffByPath;
    }
  }
  const patches: FileDiff[] = [...afterByPath.entries()].map(([path, state]) =>
    makeDiff(path, state.before, state.after),
  );

  return {
    deltas,
    units,
    projections,
    impacts,
    patches,
    findings,
    refusals,
    warnings: generated.warnings,
    generated_paths: generated.paths,
  };
}
