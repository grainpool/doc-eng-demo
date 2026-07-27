import { matchFactKey, type FactClaim } from "@relay/contracts";
import type { DocUnit, Finding } from "./types.js";

/**
 * MISSING_COVERAGE — the absence detector. Concord's extractors project
 * registered facts onto EXISTING text, so a shipped surface that no page
 * mentions produces no projection, no impact, and no signal (the gap
 * recorded by dec_prose_coverage_deferral). This check asks the inverse
 * question: for every ENABLED feature in the availability family, does at
 * least one hand-authored documentation unit mention it at all?
 *
 * Deliberately weak, in the codebase's precision-over-recall tradition:
 *  - The unit of coverage is the FEATURE (availability.feature.<f>.*), not
 *    the fact — a handful of checks, never one per registered key.
 *  - "Mentions" means one vocabulary hit anywhere in a hand-authored,
 *    non-inproduct unit. One hit satisfies the check; depth of coverage is
 *    not measured. In-product UI strings are product copy, not
 *    documentation — a "New conversation" button is not a docs page.
 *  - Single-word vocabulary requires the capitalized product noun, the same
 *    deliberate choice as the term extractor's wordOccurrence: "from your
 *    terminal" (the shell) must not count as coverage of Terminal (the
 *    surface). The known cost — a capitalized incidental use masking a real
 *    gap — mirrors def_term_drift_lowercase and is accepted.
 *  - Zero mentions is a FINDING that names the fact owner, never a patch:
 *    writing the missing page is prose authorship, which is always human.
 *
 * Purely deterministic; no model call.
 */

/** Matching vocabulary per feature id. Aliases are detector heuristics —
 *  matcher tuning like the extractors' regexes — NOT product truth; extend
 *  this map when a match is missed rather than loosening the rules. */
const EXPLICIT_VOCAB: Record<string, RegExp[]> = {
  chat: [/(?<![A-Za-z0-9])Chat(s)?(?![A-Za-z0-9])/],
  terminal: [/(?<![A-Za-z0-9])Terminal(s)?(?![A-Za-z0-9])/],
  analysis_sessions: [/(?<![A-Za-z0-9])analysis[ -]sessions?(?![A-Za-z0-9])/i],
  connector_drive: [
    /(?<![A-Za-z0-9])Google Drive(?![A-Za-z0-9])/,
    /(?<![A-Za-z0-9])drive[ -]connector(s)?(?![A-Za-z0-9])/i,
  ],
};

/** Fallback for feature ids the map does not know: multi-word ids match as
 *  a case-insensitive phrase (collisions are implausible); single-word ids
 *  get the capitalized-noun rule. */
function vocabularyFor(feature: string): RegExp[] {
  const explicit = EXPLICIT_VOCAB[feature];
  if (explicit) return explicit;
  const words = feature.split("_").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length > 1) {
    const last = words[words.length - 1]!.replace(/s$/, "");
    const phrase = [...words.slice(0, -1), `${last}s?`].join("[ -]");
    return [new RegExp(`(?<![A-Za-z0-9])${phrase}(?![A-Za-z0-9])`, "i")];
  }
  const word = words[0]!;
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  return [new RegExp(`(?<![A-Za-z0-9])${capitalized}(s)?(?![A-Za-z0-9])`)];
}

const AVAILABILITY_KEY = /^availability\.feature\.([a-z0-9_]+)\.platform\.[a-z0-9_]+$/;
/** Same authoritative current-value tiers as detectDeltas — T4 is temporal
 *  history and must not resurrect a rolled-back feature here. */
const CURRENT_VALUE_TIERS = new Set(["T0_RUNTIME", "T1_SCHEMA", "T2_CLI", "T3_CONFIG"]);

/** A unit that can satisfy coverage: hand-authored documentation. */
function isDocumentationUnit(unit: DocUnit): boolean {
  return !unit.generated && unit.surface !== "inproduct";
}

/** Enabled features → the sorted availability keys that enable them. */
export function enabledFeatures(facts: readonly FactClaim[]): Map<string, string[]> {
  const features = new Map<string, string[]>();
  for (const fact of facts) {
    if (!CURRENT_VALUE_TIERS.has(fact.tier) || fact.value !== true) continue;
    const match = AVAILABILITY_KEY.exec(fact.key);
    if (!match) continue;
    const feature = match[1]!;
    const keys = features.get(feature) ?? [];
    keys.push(fact.key);
    features.set(feature, keys);
  }
  for (const keys of features.values()) keys.sort();
  return features;
}

/** One finding per enabled feature with ZERO hand-authored doc mentions. */
export function missingCoverageFindings(
  facts: readonly FactClaim[],
  units: readonly DocUnit[],
): Finding[] {
  const docUnits = units.filter(isDocumentationUnit);
  const findings: Finding[] = [];
  for (const [feature, enabledKeys] of [...enabledFeatures(facts).entries()].sort()) {
    const vocabulary = vocabularyFor(feature);
    const mentioned = docUnits.some((unit) => {
      const haystack = `${unit.title}\n${unit.body}`;
      return vocabulary.some((re) => re.test(haystack));
    });
    if (mentioned) continue;
    const factKey = enabledKeys[0]!;
    findings.push({
      kind: "missing_coverage",
      fact_key: factKey,
      doc_unit_id: null,
      projection_id: null,
      owner: matchFactKey(factKey)?.owner ?? null,
      detail:
        `feature "${feature}" is enabled (${enabledKeys.join(", ")}) but none of the ` +
        `${docUnits.length} hand-authored documentation units mentions it ` +
        `(vocabulary: ${vocabulary.map((re) => String(re)).join(", ")}). ` +
        `Writing the missing page is prose authorship — routed to the owner, never patched.`,
    });
  }
  return findings;
}
