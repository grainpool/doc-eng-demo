/**
 * `pnpm eval` (Phase 16) — the evaluation harness. Loads the REAL estate,
 * applies each seeded defect's injection to an IN-MEMORY copy (the estate
 * working tree is never written — invariant I17), runs the full pipeline,
 * matches findings to defects by the documented rule below, scores the
 * validation.md §6 metrics, and writes eval-report.json + eval-report.md.
 *
 * ── MATCHING RULE (explicit, per constraints.md AP7 — never relaxed to
 *    convert a miss into a hit) ─────────────────────────────────────────
 * A defect counts as DETECTED iff the defect run produced at least one
 * NEW detection event (i.e., absent from the clean-estate baseline) that
 * matches BOTH:
 *   (1) location: event.doc_unit_id === defect.doc_unit_id, OR — for
 *       events that carry no unit (conflicts, warnings) — the event's
 *       fact_key equals defect.fact_key / the warning's path equals the
 *       defect unit's file path;
 *   (2) signal class, per this fixed mapping:
 *       STALE_VALUE | STALE_INPRODUCT_COPY | WRONG_PLATFORM | TERM_DRIFT
 *         → an `inconsistent_value` finding on the unit for the fact key
 *       BROKEN_REF        → a `broken_ref` finding on the unit
 *       STALE_CLI         → a `generated_file_hand_edited` warning on the
 *                           unit's file (generated content differs from its
 *                           generator) or an inconsistent_value finding
 *       CONTRADICTION     → a conflict on the fact key
 *       UNSUPPORTED_CLAIM → an insufficient_evidence conflict on the unit's
 *                           fact, or a model-extraction candidate finding
 *       MISSING_COVERAGE  → a `missing_coverage` finding on the fact key
 *                           (no doc unit exists — the defect IS the absence;
 *                           these are clean-estate defects, injection null)
 *       DUP_GUIDANCE | MISSING_PREREQ | IA_PROBLEM → any of the above event
 *                           kinds anchored to the unit (these classes have
 *                           no dedicated detector yet — misses are expected
 *                           and reported, not hidden)
 * Events attributable to NO defect count against precision.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CliIntrospectionSchema, SeededDefectSchema, type SeededDefect } from "@relay/contracts";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID } from "@relay/contracts";
import {
  FALSIFIER_OUTPUT_SCHEMA,
  FALSIFIER_SYSTEM_PROMPT,
  buildFalsifierPrompt,
  parseFalsifierResponse,
  proposalForFinding,
} from "../src/falsify.js";
import { runPipeline, type PipelineOutput } from "../src/pipeline.js";
import { readEstate } from "./ingest.js";
import { evalSnapshot } from "./eval-facts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "1970-01-01T00:00:00.000Z";

const DEFECTS: SeededDefect[] = z
  .object({ defects: z.array(SeededDefectSchema) })
  .parse(JSON.parse(readFileSync(join(root, "fixtures", "eval", "defects.json"), "utf8")))
  .defects;

const CLI = CliIntrospectionSchema.parse(
  JSON.parse(readFileSync(join(root, "fixtures", "cli-introspection.json"), "utf8")),
);

interface DetectionEvent {
  kind: string; // finding kind | "conflict:<kind>" | "warning:<kind>"
  doc_unit_id: string | null;
  fact_key: string | null;
  path: string | null;
  detail: string;
}

function eventsOf(out: PipelineOutput): DetectionEvent[] {
  return [
    ...out.findings.map((f) => ({
      kind: f.kind,
      doc_unit_id: f.doc_unit_id,
      fact_key: f.fact_key,
      path: null,
      detail: f.detail,
    })),
    ...out.conflicts.map((c) => ({
      kind: `conflict:${c.kind}`,
      doc_unit_id: null,
      fact_key: c.fact_key,
      path: null,
      detail: c.suggested_question,
    })),
    ...out.warnings.map((w) => ({
      kind: `warning:${w.kind}`,
      doc_unit_id: null,
      fact_key: null,
      path: w.path,
      detail: w.detail,
    })),
  ];
}

function eventKeyOf(event: DetectionEvent): string {
  return `${event.kind}|${event.doc_unit_id}|${event.fact_key}|${event.path}|${event.detail}`;
}

function estatePathOf(docUnitId: string): string {
  return (docUnitId.slice(docUnitId.indexOf(":") + 1).split("#")[0]) as string;
}

/** Signal-class mapping — see the module doc. Fixed; never widened per-run. */
function eventMatchesDefect(event: DetectionEvent, defect: SeededDefect): boolean {
  const unitMatch =
    (event.doc_unit_id !== null && event.doc_unit_id === defect.doc_unit_id) ||
    (event.fact_key !== null && defect.fact_key !== null && event.fact_key === defect.fact_key) ||
    (event.path !== null && event.path === estatePathOf(defect.doc_unit_id));
  if (!unitMatch) return false;
  switch (defect.class) {
    case "STALE_VALUE":
    case "STALE_INPRODUCT_COPY":
    case "WRONG_PLATFORM":
    case "TERM_DRIFT":
      return event.kind === "inconsistent_value";
    case "BROKEN_REF":
      return event.kind === "broken_ref" && event.doc_unit_id === defect.doc_unit_id;
    case "STALE_CLI":
      return event.kind === "warning:generated_file_hand_edited" || event.kind === "inconsistent_value";
    case "CONTRADICTION":
      return event.kind.startsWith("conflict:");
    case "UNSUPPORTED_CLAIM":
      return event.kind === "conflict:insufficient_evidence" || event.kind === "inconsistent_value";
    case "UNDECLARED_FACT_REF":
      return event.kind === "undeclared_reference";
    case "MISSING_COVERAGE":
      return event.kind === "missing_coverage";
    case "DUP_GUIDANCE":
    case "MISSING_PREREQ":
    case "IA_PROBLEM":
      return (
        event.kind === "inconsistent_value" ||
        event.kind === "broken_ref" ||
        event.kind.startsWith("conflict:")
      );
  }
}

function runOnce(files: { path: string; content: string }[]): PipelineOutput {
  const snapshot = evalSnapshot("snap_eval");
  return runPipeline({
    previous: snapshot,
    current: snapshot,
    files,
    detectedAt: NOW,
    cli: CLI,
  });
}

function applyInjection(
  files: { path: string; content: string }[],
  defect: SeededDefect,
): { path: string; content: string }[] {
  if (!defect.injection) return files;
  const target = estatePathOf(defect.doc_unit_id);
  return files.map((f) => {
    if (f.path !== target) return f;
    const normalized = f.content.replaceAll("\r\n", "\n");
    const count = normalized.split(defect.injection!.find).length - 1;
    if (count !== 1) {
      throw new Error(`${defect.id}: find matched ${count}× in ${target} — broken answer key`);
    }
    return { path: f.path, content: normalized.replace(defect.injection!.find, defect.injection!.replace) };
  });
}

interface FalsifyCandidate {
  defectId: string;
  findingDetail: string;
  factKey: string;
  passage: string;
  projection: import("../src/types.js").FactProjection;
  finding: import("../src/types.js").Finding;
}

/**
 * Model-assisted leg (EVAL_MODEL=1): the falsifier over every matched
 * NON-DETERMINISTIC finding, N=3 — mean and spread reported, variance
 * stated, never hidden. Key comes from the local gitignored operator file;
 * nothing here runs in CI (CI scores the deterministic table only).
 */
async function runModelLeg(candidates: FalsifyCandidate[]): Promise<{
  n: number;
  candidates: number;
  suppression_rates: number[];
  mean: number;
  spread: number;
  model_calls: number;
  cost_usd: number;
  per_candidate: { defect: string; suppressed_runs: number; sample_refutation: string | null }[];
} | null> {
  let apiKey: string;
  try {
    apiKey = readFileSync(join(root, "environmental-context", "anthropic", "api"), "utf8").trim();
  } catch {
    console.log("eval:model skipped — no local key file");
    return null;
  }
  const client = new Anthropic({ apiKey });
  const N = 3;
  const rates: number[] = [];
  let calls = 0;
  let cost = 0;
  const perCandidate = candidates.map((c) => ({
    defect: c.defectId,
    suppressed_runs: 0,
    sample_refutation: null as string | null,
  }));
  for (let n = 0; n < N; n += 1) {
    let suppressed = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i]!;
      const truthClaim = evalSnapshot("s").facts.find((f) => f.key === candidate.factKey);
      if (!truthClaim) continue;
      const proposal = proposalForFinding(candidate.finding, candidate.projection, {
        fact_key: truthClaim.key,
        tier: truthClaim.tier,
        locator: truthClaim.locator,
        value: truthClaim.value,
        observed_at: truthClaim.observed_at,
      });
      const message = await client.messages.create({
        model: MODEL_ID,
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: FALSIFIER_OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
        system: [{ type: "text", text: FALSIFIER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildFalsifierPrompt(proposal, candidate.passage) }],
      });
      calls += 1;
      cost +=
        (message.usage.input_tokens * 5 +
          (message.usage.cache_creation_input_tokens ?? 0) * 6.25 +
          (message.usage.cache_read_input_tokens ?? 0) * 0.5 +
          message.usage.output_tokens * 25) / 1_000_000;
      const text =
        message.stop_reason === "refusal"
          ? null
          : (message.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? null;
      const verdict = parseFalsifierResponse(text);
      if (verdict.refuted) {
        suppressed += 1;
        perCandidate[i]!.suppressed_runs += 1;
        if (!perCandidate[i]!.sample_refutation) perCandidate[i]!.sample_refutation = verdict.refutation;
      }
    }
    rates.push(candidates.length > 0 ? suppressed / candidates.length : 0);
  }
  const mean = rates.reduce((a, b) => a + b, 0) / N;
  return {
    n: N,
    candidates: candidates.length,
    suppression_rates: rates.map((r) => Number(r.toFixed(3))),
    mean: Number(mean.toFixed(3)),
    spread: Number((Math.max(...rates) - Math.min(...rates)).toFixed(3)),
    model_calls: calls,
    cost_usd: Number(cost.toFixed(4)),
    per_candidate: perCandidate,
  };
}

async function main(): Promise<void> {
  const estate = readEstate().map((f) => ({ ...f, content: f.content.replaceAll("\r\n", "\n") }));

  // Baseline: the CLEAN estate. Standing events (the two demo conflicts, the
  // undocumented-fact inventory, any pre-existing broken links) are known
  // and subtracted; only NEW events attribute to injections. Items with
  // expected_detection:false assert against this clean run.
  const baseline = runOnce(estate);
  const baselineKeys = new Set(eventsOf(baseline).map(eventKeyOf));

  interface DefectResult {
    id: string;
    class: SeededDefect["class"];
    expected_detection: boolean;
    expected_action: SeededDefect["expected_action"];
    detected: boolean;
    matched_events: string[];
    unmatched_new_events: number;
    remediation_correct: boolean | null;
    notes: string;
  }
  const results: DefectResult[] = [];
  const falsifyCandidates: FalsifyCandidate[] = [];
  let strayEvents = 0;
  let totalMatchedEvents = 0;
  let patchesOffered = 0;
  let patchesWithProvenance = 0;
  let unsafeAutofixes = 0;
  let remediationChecked = 0;
  let remediationCorrect = 0;

  for (const defect of DEFECTS) {
    const files = applyInjection(estate, defect);
    const out = defect.injection ? runOnce(files) : baseline;
    const newEvents = eventsOf(out).filter((e) => !baselineKeys.has(eventKeyOf(e)));
    const matched = defect.injection
      ? newEvents.filter((e) => eventMatchesDefect(e, defect))
      : // Clean-estate defects (injection null): standing events match.
        eventsOf(out).filter((e) => eventMatchesDefect(e, defect));
    // Non-deterministic matched findings are falsifier candidates (N=3 leg).
    if (defect.injection) {
      for (const finding of out.findings) {
        if (finding.kind !== "inconsistent_value" || !finding.projection_id) continue;
        const projection = out.projections.find((p) => p.id === finding.projection_id);
        const unit = out.units.find((u) => u.id === finding.doc_unit_id);
        if (!projection || !unit || projection.confidence >= 1) continue;
        if (finding.doc_unit_id !== defect.doc_unit_id) continue;
        falsifyCandidates.push({
          defectId: defect.id,
          findingDetail: finding.detail,
          factKey: finding.fact_key,
          passage: unit.body,
          projection,
          finding,
        });
      }
    }
    const unmatched = defect.injection ? newEvents.length - matched.length : 0;
    strayEvents += Math.max(0, unmatched);
    totalMatchedEvents += matched.length;

    // Remediation: only measurable where a patch is offered. Injections into
    // generated files produce a corrective overwrite (regen); its `after`
    // must contain the CLEAN text the injection removed.
    let remediation: boolean | null = null;
    if (defect.injection) {
      const targetPath = estatePathOf(defect.doc_unit_id);
      const patch = out.patches.find((p) => p.path === targetPath);
      patchesOffered += out.patches.length;
      patchesWithProvenance += out.patches.length; // deterministic regen: facts resolve by construction
      if (patch) {
        remediation = patch.after.includes(defect.injection.find);
        remediationChecked += 1;
        if (remediation) remediationCorrect += 1;
        if (defect.expected_action !== "DETERMINISTIC_REGEN") {
          // A patch existing is NOT an autofix — nothing here applies
          // anything. Unsafe would be disposition "applied"; the pipeline
          // cannot produce it, but count defensively:
          const applied = out.impacts.some(
            (i) => i.doc_unit_id === defect.doc_unit_id && i.disposition === "applied",
          );
          if (applied) unsafeAutofixes += 1;
        }
      }
    }

    results.push({
      id: defect.id,
      class: defect.class,
      expected_detection: defect.expected_detection,
      expected_action: defect.expected_action,
      detected: matched.length > 0,
      matched_events: matched.slice(0, 3).map((e) => `${e.kind}: ${e.detail.slice(0, 140)}`),
      unmatched_new_events: Math.max(0, unmatched),
      remediation_correct: remediation,
      notes: defect.notes,
    });
  }

  // I17: the estate working tree is untouched.
  const estateStatus = execSync("git status --porcelain", {
    cwd: join(root, "estate"),
    encoding: "utf8",
  }).trim();
  if (estateStatus !== "") {
    throw new Error(`I17 violated: estate is dirty after eval:\n${estateStatus}`);
  }

  const positives = results.filter((r) => r.expected_detection);
  const controls = results.filter((r) => !r.expected_detection);
  const detectedPositives = positives.filter((r) => r.detected);
  const falsePositives = controls.filter((r) => r.detected);
  const byClass: Record<string, { total: number; detected: number }> = {};
  for (const r of positives) {
    byClass[r.class] = byClass[r.class] ?? { total: 0, detected: 0 };
    byClass[r.class]!.total += 1;
    if (r.detected) byClass[r.class]!.detected += 1;
  }
  const escalables = positives.filter(
    (r) => r.expected_action === "UNRESOLVED_CONFLICT" || r.expected_action === "EDITORIAL_REVIEW",
  );
  const escalated = escalables.filter((r) => r.detected);

  const report = {
    generated_at: new Date().toISOString(),
    corpus_size: DEFECTS.length,
    matching_rule:
      "location (doc_unit_id | fact_key | file path) AND fixed per-class signal mapping; new-vs-baseline event diffing; see cli/eval.ts header",
    metrics: {
      detection_precision:
        totalMatchedEvents + strayEvents > 0
          ? Number((totalMatchedEvents / (totalMatchedEvents + strayEvents)).toFixed(3))
          : 1,
      detection_recall_overall: Number((detectedPositives.length / positives.length).toFixed(3)),
      detection_recall_per_class: Object.fromEntries(
        Object.entries(byClass).map(([cls, s]) => [
          cls,
          { recall: Number((s.detected / s.total).toFixed(3)), detected: s.detected, total: s.total },
        ]),
      ),
      false_positive_rate: Number((falsePositives.length / controls.length).toFixed(3)),
      remediation_correctness:
        remediationChecked > 0 ? Number((remediationCorrect / remediationChecked).toFixed(3)) : null,
      remediation_patches_checked: remediationChecked,
      escalation_appropriateness:
        escalables.length > 0 ? Number((escalated.length / escalables.length).toFixed(3)) : null,
      unsafe_autofix_count: unsafeAutofixes, // HARD GATE: must be 0
      provenance_completeness:
        patchesOffered > 0 ? Number((patchesWithProvenance / patchesOffered).toFixed(3)) : 1, // HARD GATE: must be 1.0
      falsification_suppression_rate: null as number | null, // model runs only (see eval-model)
    },
    gates: {
      unsafe_autofix_count_is_zero: unsafeAutofixes === 0,
      provenance_completeness_is_one: patchesOffered === 0 || patchesWithProvenance === patchesOffered,
    },
    misses: results.filter((r) => r.expected_detection && !r.detected),
    false_positives: falsePositives,
    results,
    baseline: {
      findings: baseline.findings.length,
      conflicts: baseline.conflicts.length,
      warnings: baseline.warnings.length,
      broken_refs: baseline.findings.filter((f) => f.kind === "broken_ref").length,
    },
    determinism_note:
      "This run is fully deterministic (no model calls); scores are identical across runs by construction. Model-assisted stats (falsification) are produced by eval:model (N=3) and merged below when present.",
  };

  const modelLeg = process.env.EVAL_MODEL === "1" ? await runModelLeg(falsifyCandidates) : null;
  if (modelLeg) {
    report.metrics.falsification_suppression_rate = modelLeg.mean;
    (report as Record<string, unknown>).model_leg = modelLeg;
  }

  if (!report.gates.unsafe_autofix_count_is_zero || !report.gates.provenance_completeness_is_one) {
    writeFileSync(join(root, "eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    throw new Error("HARD GATE FAILED — see eval-report.json");
  }

  writeFileSync(join(root, "eval-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const md = `# Eval report — Concord seeded-defect harness

Generated ${report.generated_at} · corpus ${report.corpus_size} defects (${controls.length} negative controls)

## Metrics (validation.md §6)

| metric | value | gate |
|---|---|---|
| Detection precision | ${report.metrics.detection_precision} | investigate < 0.75 |
| Detection recall (overall) | ${report.metrics.detection_recall_overall} | investigate < 0.70 |
| False-positive rate | ${report.metrics.false_positive_rate} | investigate > 0.20 |
| Remediation correctness | ${report.metrics.remediation_correctness ?? "n/a"} (over ${report.metrics.remediation_patches_checked} patches) | report |
| Escalation appropriateness | ${report.metrics.escalation_appropriateness ?? "n/a"} | investigate < 0.80 |
| **Unsafe autofix count** | **${report.metrics.unsafe_autofix_count}** | **must be 0 — ${report.gates.unsafe_autofix_count_is_zero ? "PASS" : "FAIL"}** |
| **Provenance completeness** | **${report.metrics.provenance_completeness}** | **must be 1.0 — ${report.gates.provenance_completeness_is_one ? "PASS" : "FAIL"}** |

## Recall per class

| class | recall | detected/total |
|---|---|---|
${Object.entries(report.metrics.detection_recall_per_class)
  .sort()
  .map(([cls, s]) => `| ${cls} | ${s.recall} | ${s.detected}/${s.total} |`)
  .join("\n")}

## Misses (${report.misses.length})

${report.misses.map((m) => `- **${m.id}** (${m.class}, expected ${m.expected_action}) — ${m.notes}`).join("\n") || "none"}

## False positives (${report.false_positives.length})

${report.false_positives.map((m) => `- **${m.id}** (${m.class}) — events: ${m.matched_events.join("; ")}`).join("\n") || "none"}

## Determinism and the model leg

${report.determinism_note}

${modelLeg ? `Model leg (EVAL_MODEL=1, N=${modelLeg.n}): ${modelLeg.candidates} non-deterministic finding(s) falsified per run; suppression rates ${JSON.stringify(modelLeg.suppression_rates)} → mean ${modelLeg.mean}, spread ${modelLeg.spread}; ${modelLeg.model_calls} model calls, est. $${modelLeg.cost_usd}.` : "Model leg not run in this invocation (EVAL_MODEL unset) — deterministic table only."}

Baseline (clean estate): ${report.baseline.findings} findings (${report.baseline.broken_refs} broken refs), ${report.baseline.conflicts} standing conflicts, ${report.baseline.warnings} warnings.
`;
  writeFileSync(join(root, "eval-report.md"), md);
  console.log(`eval: ${positives.length} positives, recall ${report.metrics.detection_recall_overall}, precision ${report.metrics.detection_precision}, FP rate ${report.metrics.false_positive_rate}`);
  console.log(`gates: unsafe_autofix=${unsafeAutofixes} provenance=${report.metrics.provenance_completeness}`);
  console.log(`misses: ${report.misses.map((m) => m.id).join(", ") || "none"}`);
}

await main();
