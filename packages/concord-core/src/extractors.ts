import { matchFactKey, type FactClaim } from "@relay/contracts";
import type { DocUnit, FactProjection } from "./types.js";
import { extractDeclaredReferences } from "./extract.js";
import {
  normalizeForFact,
  unitOfFactKey,
  type FactUnit,
} from "./normalize-value.js";
import { slugify } from "./adapters/mintlify.js";

/**
 * Phase 12 — the full deterministic extractor suite (contracts.md §12).
 * Every projection records mode, asserted_value, span, extractor,
 * confidence, detected_at, and (Phase 12) its normalized comparison value.
 *
 * Deterministic refusals are FIRST-CLASS OUTPUT: when an attribution or a
 * normalization is ambiguous the extractor refuses and records why, rather
 * than guessing (constraints.md AP2). `model_extraction` is not here — it
 * is a candidate generator that runs out-of-core (network) and is capped at
 * 0.7 in model-extract.ts.
 */

export interface ExtractionRefusal {
  doc_unit_id: string;
  text: string;
  reason: string;
}

export interface ExtractionOutput {
  projections: FactProjection[];
  refusals: ExtractionRefusal[];
}

/** Dedupe priority per (unit, fact): lower wins. */
const EXTRACTOR_PRIORITY: Record<FactProjection["extractor"], number> = {
  declared_reference: 0,
  frontmatter_field: 1,
  generated_marker: 2,
  availability_table: 3,
  term_occurrence: 4,
  numeric_pattern: 5,
  model_extraction: 6,
};

function projId(
  unitId: string,
  factKey: string,
  extractor: FactProjection["extractor"],
): string {
  return `proj:${unitId}:${factKey}:${extractor}`;
}

/** frontmatter_field (1.0): a `facts:` map in MDX frontmatter. Emitted once
 * per page (frontmatter is page-level; adapters copy it onto every section). */
export function extractFrontmatterFields(
  units: DocUnit[],
  detectedAt: string,
): FactProjection[] {
  const projections: FactProjection[] = [];
  const seenPaths = new Set<string>();
  for (const unit of units) {
    if (seenPaths.has(unit.path)) continue;
    const facts = unit.frontmatter.facts;
    if (!facts || typeof facts !== "object" || Array.isArray(facts)) continue;
    seenPaths.add(unit.path);
    for (const [factKey, value] of Object.entries(facts as Record<string, unknown>)) {
      if (matchFactKey(factKey) === null) continue;
      projections.push({
        id: projId(unit.id, factKey, "frontmatter_field"),
        fact_key: factKey,
        doc_unit_id: unit.id,
        mode: unit.generated ? "generated" : "mechanical_value",
        asserted_value: value,
        span: null, // frontmatter is outside the unit body
        extractor: "frontmatter_field",
        confidence: 1,
        detected_at: detectedAt,
      });
    }
  }
  return projections;
}

/** generated_marker (1.0): `| <registered fact key> | <value> |` rows inside
 * generated content. Generated blocks state facts by key, mechanically. */
const FACT_ROW = /^\|\s*([a-z0-9_.]+)\s*\|\s*([^|\n]+?)\s*\|\s*$/gm;

export function extractGeneratedMarkers(
  units: DocUnit[],
  detectedAt: string,
): FactProjection[] {
  const projections: FactProjection[] = [];
  for (const unit of units) {
    if (!unit.generated) continue;
    for (const match of unit.body.matchAll(FACT_ROW)) {
      const factKey = match[1] as string;
      if (matchFactKey(factKey) === null) continue;
      const cell = match[2] as string;
      const cellStart = match.index + match[0].lastIndexOf(cell);
      projections.push({
        id: projId(unit.id, factKey, "generated_marker"),
        fact_key: factKey,
        doc_unit_id: unit.id,
        mode: "generated",
        asserted_value: cell,
        span: { start: cellStart, end: cellStart + cell.length },
        extractor: "generated_marker",
        confidence: 1,
        detected_at: detectedAt,
      });
    }
  }
  return projections;
}

/** availability_table (0.9): `| feature | web | ios | … |` matrices parsed
 * structurally. A `—` cell claims nothing. */
export function extractAvailabilityTables(
  units: DocUnit[],
  detectedAt: string,
): FactProjection[] {
  const projections: FactProjection[] = [];
  for (const unit of units) {
    const lines = unit.body.split("\n");
    let offset = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] as string;
      const header = /^\|\s*feature\s*\|(.+)\|\s*$/i.exec(line);
      if (!header) {
        offset += line.length + 1;
        continue;
      }
      const platforms = (header[1] as string)
        .split("|")
        .map((c) => c.trim().toLowerCase());
      // Skip the |---|---| separator, then consume data rows.
      let rowOffset = offset + line.length + 1 + (lines[i + 1]?.length ?? 0) + 1;
      for (let j = i + 2; j < lines.length; j += 1) {
        const row = lines[j] as string;
        const cells = /^\|(.+)\|\s*$/.exec(row);
        if (!cells) break;
        const parts = (cells[1] as string).split("|").map((c) => c.trim());
        const feature = (parts[0] ?? "").toLowerCase().replaceAll(" ", "_");
        for (let k = 1; k < parts.length && k <= platforms.length; k += 1) {
          const cell = parts[k] as string;
          if (cell === "" || cell === "—" || cell === "-") continue;
          const factKey = `availability.feature.${feature}.platform.${platforms[k - 1]}`;
          if (matchFactKey(factKey) === null) continue;
          const cellStart = rowOffset + row.indexOf(cell);
          projections.push({
            id: projId(unit.id, factKey, "availability_table"),
            fact_key: factKey,
            doc_unit_id: unit.id,
            mode: unit.generated ? "generated" : "derived_prose",
            asserted_value: cell,
            span: { start: cellStart, end: cellStart + cell.length },
            extractor: "availability_table",
            confidence: 0.9,
            detected_at: detectedAt,
          });
        }
        rowOffset += row.length + 1;
      }
      offset += line.length + 1;
    }
  }
  return projections;
}

/**
 * term_occurrence (0.9): canonical/non-canonical product-term usage in
 * bodies, titles, and anchors. Non-canonical variants are NOT invented —
 * they are mined from T4 release history (`term_renamed` changes: the `from`
 * value is a known former term). One projection per unit per term fact; a
 * non-canonical occurrence wins over a canonical one (it is the signal).
 */
interface TermSpec {
  factKey: string;
  canonical: string;
  variants: string[];
}

export function termSpecsFromFacts(
  facts: readonly FactClaim[],
  priorTerms?: ReadonlyMap<string, string>,
): TermSpec[] {
  const canonicals = new Map<string, string>();
  for (const fact of facts) {
    if (fact.key.startsWith("term.canonical.") && typeof fact.value === "string") {
      canonicals.set(fact.key, fact.value);
    }
  }
  const variants = new Map<string, string[]>();
  for (const fact of facts) {
    if (!/^release\.[a-z0-9_-]+\.changes$/.test(fact.key)) continue;
    const value = fact.value as { changes?: { fact_key: string; from: unknown; kind: string }[] };
    for (const change of value.changes ?? []) {
      if (change.kind === "term_renamed" && typeof change.from === "string") {
        variants.set(change.fact_key, [
          ...(variants.get(change.fact_key) ?? []),
          change.from,
        ]);
      }
    }
  }
  return [...canonicals.entries()].map(([factKey, canonical]) => {
    const fromHistory = variants.get(factKey) ?? [];
    // Terminology closure (Phase 13): a just-renamed fact's PREVIOUS value
    // is a known variant even before a release record exists for it.
    const prior = priorTerms?.get(factKey);
    const all =
      prior !== undefined && prior !== canonical && !fromHistory.includes(prior)
        ? [prior, ...fromHistory]
        : fromHistory;
    return { factKey, canonical, variants: all.filter((v) => v !== canonical) };
  });
}

/** Spans of markdown link TARGETS (the URL half) within a body. */
function linkTargetSpans(body: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const start = match.index + 2;
    spans.push({ start, end: start + (match[1] as string).length });
  }
  return spans;
}

function wordOccurrence(
  body: string,
  word: string,
  excluded: { start: number; end: number }[] = [],
): { index: number; text: string } | null {
  // Capitalized whole-word match (plural allowed): product nouns, not prose
  // coincidences ("the task at hand" stays out; "Task" and "Tasks" count).
  const re = new RegExp(`(?<![A-Za-z0-9])${word}(s)?(?![A-Za-z0-9])`, "g");
  for (const match of body.matchAll(re)) {
    const end = match.index + match[0].length;
    if (excluded.some((s) => match.index < s.end && end > s.start)) continue;
    return { index: match.index, text: match[0] };
  }
  return null;
}

/** Does the term (as a slug or word) occur in a URL, anchor, or heading? */
function editorialOccurrence(
  unit: DocUnit,
  words: string[],
): string | null {
  for (const word of words) {
    const slug = slugify(word);
    if (unit.anchor?.includes(slug)) return word;
    for (const span of linkTargetSpans(unit.body)) {
      const target = unit.body.slice(span.start, span.end).toLowerCase();
      if (target.includes(slug)) return word;
    }
    if (wordOccurrence(unit.title, word) !== null) return word;
  }
  return null;
}

export function extractTermOccurrences(
  units: DocUnit[],
  facts: readonly FactClaim[],
  detectedAt: string,
  priorTerms?: ReadonlyMap<string, string>,
): FactProjection[] {
  const specs = termSpecsFromFacts(facts, priorTerms);
  const projections: FactProjection[] = [];
  for (const unit of units) {
    // Release/changelog content QUOTES history ("'Job' renamed to 'Task'").
    // T4 is temporal: an old term there is a record, not a current-term
    // assertion — extracting it would flag every historical rename forever.
    if (
      unit.editorial_register === "release_note" ||
      /(^|\/)(changelog\.mdx|release-notes\/)/.test(unit.path)
    ) {
      continue;
    }
    const excluded = linkTargetSpans(unit.body);
    for (const spec of specs) {
      const words = [...spec.variants, spec.canonical]; // drift first
      // PROSE occurrence (body text, never inside a link target): variants
      // first — drift is the signal worth projecting.
      let hit: { index: number; text: string } | null = null;
      for (const word of words) {
        hit = wordOccurrence(unit.body, word, excluded);
        if (hit) break;
      }
      if (hit) {
        projections.push({
          id: projId(unit.id, spec.factKey, "term_occurrence"),
          fact_key: spec.factKey,
          doc_unit_id: unit.id,
          mode: unit.generated ? "generated" : "derived_prose",
          asserted_value: hit.text,
          span: { start: hit.index, end: hit.index + hit.text.length },
          extractor: "term_occurrence",
          confidence: 0.9,
          detected_at: detectedAt,
        });
      }
      // EDITORIAL occurrence — URLs, anchors, headings (terminology closure,
      // Phase 13): rewriting these breaks inbound links, so the projection
      // is editorial-mode and rule 5 routes a rename to EDITORIAL_REVIEW,
      // never a deterministic rewrite (validation.md §7).
      const editorialWord = editorialOccurrence(unit, words);
      if (editorialWord !== null) {
        projections.push({
          id: `${projId(unit.id, spec.factKey, "term_occurrence")}:anchor`,
          fact_key: spec.factKey,
          doc_unit_id: unit.id,
          mode: "editorial",
          asserted_value: wordOccurrence(unit.title, editorialWord)?.text ?? editorialWord,
          span: null,
          extractor: "term_occurrence",
          confidence: 0.9,
          detected_at: detectedAt,
        });
      }
    }
  }
  return projections;
}

/**
 * numeric_pattern (0.85): a number rendering in prose that normalizes — with
 * unit awareness — to exactly ONE fact's current value. When the same
 * rendering matches two facts (retention.artifact.days and
 * retention.uploaded_file.days are both 30), the extractor REFUSES the
 * attribution and records it, rather than guessing.
 */
const NUMERIC_RENDERING =
  /([\d,]+(?:\.\d+)?\s*(?:MB|KB)\b|[\d,]+\s*bytes\b|[\d,]+\s*days?\b|\d{1,3}(?:,\d{3})+|\d{4,})/gi;

export function extractNumericPatterns(
  units: DocUnit[],
  facts: readonly FactClaim[],
  claimedSpans: ReadonlyMap<string, { start: number; end: number }[]>,
  detectedAt: string,
): ExtractionOutput {
  const numericFacts = facts
    .map((fact) => ({ fact, entry: matchFactKey(fact.key) }))
    .filter(
      (x): x is { fact: FactClaim; entry: NonNullable<ReturnType<typeof matchFactKey>> } =>
        x.entry !== null &&
        x.entry.valueType === "integer" &&
        typeof x.fact.value === "number",
    );
  const projections: FactProjection[] = [];
  const refusals: ExtractionRefusal[] = [];
  for (const unit of units) {
    if (unit.generated) continue; // generated numerics belong to generated_marker
    const taken = claimedSpans.get(unit.id) ?? [];
    const seenFacts = new Set<string>();
    for (const match of unit.body.matchAll(NUMERIC_RENDERING)) {
      const text = match[0];
      const start = match.index;
      const end = start + text.length;
      if (taken.some((s) => start < s.end && end > s.start)) continue;
      const matching = numericFacts.filter(({ fact }) => {
        const unitClass: FactUnit = unitOfFactKey(fact.key);
        // Unit awareness: a "days" rendering may only claim a days fact, a
        // MB/KB/bytes rendering only a bytes fact.
        if (/days?\s*$/i.test(text) && unitClass !== "days") return false;
        if (/(MB|KB|bytes)\s*$/i.test(text) && unitClass !== "bytes") return false;
        const normalized = normalizeForFact(text, "integer", unitClass);
        return normalized.ok && normalized.value === fact.value;
      });
      if (matching.length === 0) continue;
      if (matching.length > 1) {
        refusals.push({
          doc_unit_id: unit.id,
          text,
          reason: `ambiguous attribution: matches ${matching
            .map((m) => m.fact.key)
            .join(", ")} equally — refused rather than guessed`,
        });
        continue;
      }
      const factKey = (matching[0] as { fact: FactClaim }).fact.key;
      if (seenFacts.has(factKey)) continue;
      seenFacts.add(factKey);
      projections.push({
        id: projId(unit.id, factKey, "numeric_pattern"),
        fact_key: factKey,
        doc_unit_id: unit.id,
        mode: "derived_prose",
        asserted_value: text,
        span: { start, end },
        extractor: "numeric_pattern",
        confidence: 0.85,
        detected_at: detectedAt,
      });
    }
  }
  return { projections, refusals };
}

/**
 * Normalization pass: compute each projection's comparison value. An
 * `unknown` DOWNGRADES the projection to derived_prose (it can never drive
 * a deterministic action) and records the refusal reason.
 */
export function normalizeProjections(
  projections: FactProjection[],
): { projections: FactProjection[]; refusals: ExtractionRefusal[] } {
  const refusals: ExtractionRefusal[] = [];
  const out = projections.map((projection) => {
    const entry = matchFactKey(projection.fact_key);
    if (!entry || projection.asserted_value === null || projection.asserted_value === undefined) {
      return { ...projection, normalized_value: null };
    }
    const normalized = normalizeForFact(
      projection.asserted_value,
      entry.valueType,
      unitOfFactKey(projection.fact_key),
    );
    if (normalized.ok) {
      return { ...projection, normalized_value: normalized.value };
    }
    refusals.push({
      doc_unit_id: projection.doc_unit_id,
      text: String(projection.asserted_value),
      reason: `normalization unknown (${normalized.reason}) — downgraded to derived_prose`,
    });
    // Editorial stays editorial — the downgrade only strips mechanical modes.
    if (projection.mode === "editorial") {
      return { ...projection, normalized_value: null };
    }
    return { ...projection, mode: "derived_prose" as const, normalized_value: null };
  });
  return { projections: out, refusals };
}

/** One projection per (unit, fact): highest-priority extractor wins. */
export function dedupeProjections(projections: FactProjection[]): FactProjection[] {
  const byKey = new Map<string, FactProjection>();
  for (const projection of projections) {
    // Editorial-mode occurrences (anchors/URLs/headings) are a distinct
    // representation from prose — both survive for the same (unit, fact).
    const key = `${projection.doc_unit_id} ${projection.fact_key}${
      projection.mode === "editorial" ? " editorial" : ""
    }`;
    const existing = byKey.get(key);
    if (
      !existing ||
      EXTRACTOR_PRIORITY[projection.extractor] < EXTRACTOR_PRIORITY[existing.extractor]
    ) {
      byKey.set(key, projection);
    }
  }
  return [...byKey.values()];
}

/** The full deterministic suite in priority order, deduped and normalized. */
export function runExtractors(
  units: DocUnit[],
  facts: readonly FactClaim[],
  detectedAt: string,
  priorTerms?: ReadonlyMap<string, string>,
  previousFacts?: readonly FactClaim[],
): ExtractionOutput {
  const deterministic: FactProjection[] = [
    ...extractDeclaredReferences(units, detectedAt),
    ...extractFrontmatterFields(units, detectedAt),
    ...extractGeneratedMarkers(units, detectedAt),
    ...extractAvailabilityTables(units, detectedAt),
    ...extractTermOccurrences(units, facts, detectedAt, priorTerms),
  ];
  const claimedSpans = new Map<string, { start: number; end: number }[]>();
  for (const projection of deterministic) {
    if (!projection.span) continue;
    claimedSpans.set(projection.doc_unit_id, [
      ...(claimedSpans.get(projection.doc_unit_id) ?? []),
      projection.span,
    ]);
  }
  // A stale rendering matches a fact's PREVIOUS value — without this, a
  // just-changed fact's outdated renderings would stop projecting exactly
  // when they matter most. (Key,value) pairs already current are not
  // duplicated; the ambiguity refusal applies across the union.
  const previousOnly = (previousFacts ?? []).filter(
    (p) =>
      typeof p.value === "number" &&
      !facts.some((f) => f.key === p.key && f.value === p.value),
  );
  const numeric = extractNumericPatterns(
    units,
    [...facts, ...previousOnly],
    claimedSpans,
    detectedAt,
  );
  const deduped = dedupeProjections([...deterministic, ...numeric.projections]);
  const normalized = normalizeProjections(deduped);
  return {
    projections: normalized.projections,
    refusals: [...numeric.refusals, ...normalized.refusals],
  };
}

/**
 * model_extraction eligibility (§scope 1): ONLY units where the
 * deterministic extractors found nothing — and never generated units
 * (generated content is fully mechanical by construction).
 */
export function unitsNeedingModelExtraction(
  units: DocUnit[],
  projections: readonly FactProjection[],
): DocUnit[] {
  const covered = new Set(projections.map((p) => p.doc_unit_id));
  return units.filter(
    (unit) => !unit.generated && !covered.has(unit.id) && unit.body.trim().length >= 80,
  );
}
