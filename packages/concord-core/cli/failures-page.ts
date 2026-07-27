/**
 * Pure renderer for "What the system gets wrong" — split out of
 * gen-failures.ts so the page (including the production-blind-spots section)
 * is unit-testable without filesystem side effects.
 *
 * Two evidence classes, deliberately kept apart on the page:
 *  - MISSES: seeded, measured, reproducible (eval-report.json + the committed
 *    per-defect ANALYSIS below);
 *  - BLIND SPOTS OBSERVED IN PRODUCTION: human-attested T5 decision records
 *    (`kind: coverage_observation`) — dated, owned, and rendered from product
 *    truth rather than from prose committed here.
 */

export interface EvalReport {
  generated_at: string;
  corpus_size: number;
  metrics: Record<string, unknown> & {
    detection_recall_per_class: Record<
      string,
      { recall: number; detected: number; total: number }
    >;
  };
  misses: { id: string; class: string; expected_action: string; notes: string }[];
  false_positives: { id: string; class: string; matched_events: string[] }[];
  model_leg?: {
    mean: number;
    spread: number;
    per_candidate: {
      defect: string;
      suppressed_runs: number;
      sample_refutation: string | null;
    }[];
  };
  results: { id: string }[];
}

export interface DecisionRecord {
  source_file: string;
  id: string;
  decided_at: string;
  decided_by: string;
  kind: string;
  claims_fact_keys: string[];
  statement: string;
}

/** Why each miss happens — committed analysis, keyed by defect id. */
const ANALYSIS: Record<string, string> = {
  def_undeclared_upload_retention:
    "The settings copy renders '30 days', but retention.artifact.days and retention.uploaded_file.days are both 30 — numeric attribution is deliberately REFUSED as ambiguous (AP2), so no projection exists to hang the undeclared-reference finding on. Detection returns when the two values diverge, or when the copy declares its fact.",
  def_stale_artifact_retention:
    "'7 days' matches no current fact value and no previous-snapshot value (the eval runs previous == current), and the retention twins make '30 days' unattributable — numeric_pattern has nothing to project. A drift detector for VALUES NEAR a fact (same unit-class, wrong number, adjacent prose) does not exist yet.",
  def_stale_retention_helpcenter:
    "Same mechanism as def_stale_artifact_retention: '90 days' normalizes cleanly but matches no fact, and the passage carries no declared marker.",
  def_wrong_platform_reference:
    "Prose availability ('available on web, iOS, and the CLI') is not a table — availability_table only parses matrices, and no deterministic extractor reads platform claims out of running text. This is squarely the model_extraction gap; the bounded fan-out did not cover this page.",
  def_wrong_platform_helpcenter:
    "Same as def_wrong_platform_reference, in friendlier words ('work on the web app, iPhone, and the CLI'). 'iPhone' additionally fails any literal platform-name normalization.",
  def_dup_guidance_size_check:
    "No cross-surface divergence detector exists: each unit is checked against product truth, never against sibling prose. Both passages are individually 'consistent enough' to survive.",
  def_dup_guidance_retention:
    "Same gap — the added '90 days' claim matches no fact value, and nothing compares the configuration page's guidance against artifacts-and-provenance.",
  def_missing_prereq_run_analysis:
    "A REMOVED precondition leaves no contradiction to measure. Detection would need procedure modeling (steps, preconditions), which no phase builds.",
  def_missing_prereq_json_flag:
    "Same gap: deleting the '--json first' guidance leaves grammatically clean, factually silent prose.",
  def_contradiction_upload_retention:
    "The injected '90 days' contradicts the fact, but the passage's declared marker sits on retention.uploaded_file.days whose current value ('30 days') no longer appears — the marker's value-after-marker heuristic finds '90 days', normalizes it, mismatches… on the OTHER retention key it cannot disambiguate from. The retention-twins ambiguity again, from the contradiction side.",
  def_unsupported_claim_soc2:
    "'SOC 2 Type II certified' asserts a fact with no registered key — the deterministic extractors only project REGISTERED facts, so unregistered claims are invisible. model_extraction's closed key enum (a security control) means even the model path cannot name an unregistered fact. Detection needs an 'asserts-something-sourceless' heuristic that does not exist.",
  def_unsupported_claim_encryption:
    "Same mechanism as the SOC 2 claim: no fact key, no projection, no finding.",
  def_ia_problem_cli_exit_codes:
    "Content-in-the-wrong-surface needs audience/IA modeling. The exit codes are CORRECT — nothing mechanical is false — so every value-based detector stays silent.",
  def_stale_cli_exit_code:
    "The prose exit-code table on cli-overview is hand-authored (not generated), and T2 cli.command facts are not in the eval snapshot — nothing checks doc prose against introspection. The generated cli-reference page IS protected (hand-edit detection); the hand-written overview is the honest hole.",
  def_conflict_insufficient_evidence:
    "insufficient_evidence conflicts are built at patch-validation gate (a) — which only runs when a DELTA drives a patch attempt. An injected sourceless claim with no fact change never reaches the gate. Detecting it statically is the same unsourced-claim gap as UNSUPPORTED_CLAIM.",
  def_term_drift_lowercase:
    "The term extractor requires the capitalized product noun — deliberately, because lowercase matching floods on prose coincidences ('the task at hand'). Lowercase drift ('each analysis job') slips under it. A smarter heuristic (lowercase + product-noun context) is future work; loosening capitalization wholesale would trade this miss for many false positives.",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The production-observation records the page renders (self-retiring: the
 *  section disappears when no records of this kind exist). */
export function coverageObservations(decisions: DecisionRecord[]): DecisionRecord[] {
  return decisions.filter((d) => d.kind === "coverage_observation");
}

function blindSpotsSection(decisions: DecisionRecord[]): string {
  const observations = coverageObservations(decisions);
  if (observations.length === 0) return "";
  return `
<h2>Blind spots observed in production (${observations.length})</h2>
<p class="muted">A different evidence class from the misses above: those are seeded and measured;
these were observed in the wild and recorded as human-attested product truth (T5 decision records,
<code>kind: coverage_observation</code>). Each renders from its record in the fact snapshot — the
prose lives in <code>product-truth/decisions/</code>, not in this page's generator.</p>
${observations
  .map(
    (d) => `<div class="miss" style="border-left-color:#7a5420"><b>${esc(d.id)}</b> <span class="muted">${esc(
      d.decided_at.slice(0, 10),
    )} · decided_by ${esc(d.decided_by)} · <code>${esc(d.source_file)}</code></span>
<p>${esc(d.statement.trim())}</p></div>`,
  )
  .join("\n")}
`;
}

export function renderFailuresPage(
  report: EvalReport,
  decisions: DecisionRecord[],
): string {
  const perClass = Object.entries(report.metrics.detection_recall_per_class).sort();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Concord — what the system gets wrong</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  code { font-family: ui-monospace, monospace; background: #f4f4f0; }
  .miss { border: 1px solid #ddd; border-left: 4px solid #b30000; border-radius: 6px; padding: .8rem 1rem; margin: 1rem 0; }
  .muted { color: #666; font-size: .92em; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ddd; padding: .3rem .7rem; text-align: left; }
</style>
</head>
<body>
<h1>What the system gets wrong</h1>
<p class="muted">Generated from <code>eval-report.json</code> (${esc(report.generated_at)}), corpus ${report.corpus_size} seeded defects.
This page is a deliverable, not an apology: the misses below are kept in the fixture deliberately (constraints.md AP7).
See the <a href="/">run report</a> and <a href="/facts.html">fact explorer</a>.</p>

<h2>Recall per class</h2>
<table><tr><th>class</th><th>recall</th><th>detected/total</th></tr>
${perClass.map(([cls, s]) => `<tr><td>${esc(cls)}</td><td>${s.recall}</td><td>${s.detected}/${s.total}</td></tr>`).join("\n")}
</table>

<h2>Misses (${report.misses.length})</h2>
${report.misses
  .map(
    (m) => `<div class="miss"><b>${esc(m.id)}</b> <code>${esc(m.class)}</code> <span class="muted">expected ${esc(m.expected_action)}</span>
<p>${esc(ANALYSIS[m.id] ?? m.notes)}</p></div>`,
  )
  .join("\n")}
${blindSpotsSection(decisions)}
<h2>False positives (${report.false_positives.length})</h2>
${report.false_positives.length === 0 ? "<p>None: all negative controls held (false-positive rate 0).</p>" : report.false_positives.map((f) => `<div class="miss"><b>${esc(f.id)}</b> — ${esc(f.matched_events.join("; "))}</div>`).join("\n")}

<h2>Falsifier behavior (model leg)</h2>
${
  report.model_leg
    ? `<p>N=3 over ${report.model_leg.per_candidate.length} non-deterministic findings: mean suppression ${report.model_leg.mean}, spread ${report.model_leg.spread}. Notably, the falsifier consistently suppressed the seeded <code>def_term_drift_inproduct</code> defect ("Run Job" button label) as ambiguous — a REAL defect lost to falsifier aggressiveness:</p>
<div class="miss"><b>def_term_drift_inproduct</b><p class="muted">${esc(report.model_leg.per_candidate.find((c) => c.defect === "def_term_drift_inproduct")?.sample_refutation ?? "")}</p>
<p>The refutation is reasonable on its own terms — a two-word label lacks context — which is exactly the cost of defaulting to refuted under uncertainty. The deterministic detection still catches this defect; the suppression only bites where the deterministic path is silent.</p></div>`
    : "<p>Model leg not present in this report.</p>"
}
</body>
</html>
`;
}
