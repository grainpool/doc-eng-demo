import {
  CliIntrospectionSchema,
  MODEL_ID,
  ProductTruthSnapshotSchema,
  newId,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import {
  EDITORIAL_SYSTEM_PROMPT,
  FALSIFIER_OUTPUT_SCHEMA,
  FALSIFIER_SYSTEM_PROMPT,
  buildFalsifierPrompt,
  insufficientEvidenceConflict,
  needsFalsification,
  parseFalsifierResponse,
  proposalForFinding,
  PATCH_PROPOSAL_OUTPUT_SCHEMA,
  PATCH_SYSTEM_PROMPT,
  buildPatchUserPrompt,
  consistencyFindings,
  evidenceFromDelta,
  makeDiff,
  parsePatchProposal,
  runPipeline,
  unitsNeedingModelExtraction,
  validatePatch,
  type DocUnit,
  type FactProjection,
  type Finding,
  type Impact,
} from "@concord/core";
import type { ConflictDraft, Evidence } from "@relay/contracts";
import type { AllowedMutation } from "@relay/contracts";
import { parseEstate } from "@concord/core";
import cliIntrospection from "../../../fixtures/cli-introspection.json";
import { ESTATE_FILES } from "./estate.generated.js";
import { runModelExtraction } from "./model-extract.js";
import {
  loadSpendState,
  recordModelCall,
  spendGate,
  type SpendState,
} from "./spend.js";

/**
 * Phase 14 run executor — invoked by the Queue consumer (15-minute CPU
 * budget; a run makes 5–15 model calls, research-findings §1). All model
 * calls go through the spend gate FIRST; nothing is silently dropped: every
 * impact leaves with a terminal disposition (invariant I10).
 */

export interface RunEnv {
  concord_db: D1Database;
  RELAY_BASE_URL: string;
  ANTHROPIC_API_KEY?: string;
}

/** The minimal Messages surface — injectable in tests. */
export interface MessageLike {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

export interface RunDeps {
  /** Null → AI paths are skipped (no key configured). */
  createMessage: ((params: Record<string, unknown>) => Promise<MessageLike>) | null;
  /** Injectable Relay HTTP (tests stub it; default is global fetch). */
  fetchJson?: (url: string) => Promise<unknown>;
}

export interface RunOptions {
  /** AI paths (grounded/editorial/falsifier/extraction) run only when true
   * — public runs are deterministic-only (I11). */
  ai?: boolean;
  modelExtraction?: boolean;
  maxCallsPerRun?: number;
  dailyCapUsd?: number;
  /** Change-Lab live mutation (Phase 18): applied to a WORKING COPY of the
   * snapshot/estate — never to deployed Relay config. Validated by the
   * admin route before it reaches here. */
  mutation?: AllowedMutation;
}

/** Bounded fan-out (G9): never more than `limit` tasks in flight. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

const MODEL_EXTRACTION_MAX_UNITS = 10;

interface ImpactRecord extends Impact {
  id: string;
  resolution_note: string | null;
  patch_id: string | null;
  conflict_id: string | null;
}

interface ModelPatchRow {
  id: string;
  path: string;
  before: string;
  after: string;
  unified: string;
  origin: "model_grounded" | "model_editorial_draft";
  doc_unit_id: string;
  impact_ids: string[];
  evidence_json: string;
  requires_review: true;
  validation_json: string;
  changed_because: string;
  needs_human_because: string | null;
}

async function step(env: RunEnv, runId: string, name: string, detail: unknown): Promise<void> {
  await env.concord_db
    .prepare(
      "INSERT INTO run_step (id, run_id, step, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(newId("run"), runId, name, JSON.stringify(detail), new Date().toISOString())
    .run();
}

async function batchAll(env: RunEnv, statements: D1PreparedStatement[]): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await env.concord_db.batch(statements.slice(i, i + CHUNK));
  }
}

/** One guarded model call; returns null when the budget gate closed. */
async function guardedCall(
  env: RunEnv,
  deps: RunDeps,
  spend: SpendState,
  runId: string,
  purpose: string,
  params: Record<string, unknown>,
): Promise<MessageLike | "exhausted" | null> {
  if (!deps.createMessage) return null;
  const gateReason = spendGate(spend);
  if (gateReason) return "exhausted";
  // Reserve the call slot BEFORE the call so a concurrent batch cannot
  // overshoot the per-run cap.
  spend.callsThisRun += 1;
  const message = await deps.createMessage(params);
  await recordModelCall(env.concord_db, spend, runId, purpose, message.usage);
  return message;
}

function textOf(message: MessageLike): string | null {
  return message.content.find((b) => b.type === "text")?.text ?? null;
}

export async function executeRun(
  env: RunEnv,
  deps: RunDeps,
  runId: string,
  options: RunOptions = {},
): Promise<void> {
  const startedAt = new Date().toISOString();
  await env.concord_db
    .prepare("UPDATE run SET status = 'running' WHERE id = ?")
    .bind(runId)
    .run();

  try {
    const fetchJson =
      deps.fetchJson ?? (async (url: string) => (await fetch(url)).json());
    const current: ProductTruthSnapshot = ProductTruthSnapshotSchema.parse(
      await fetchJson(`${env.RELAY_BASE_URL}/api/product-truth`),
    );
    const registry = (await fetchJson(
      `${env.RELAY_BASE_URL}/api/copy-registry`,
    )) as { entries: { id: string }[] };
    await step(env, runId, "fetch", {
      facts: current.facts.length,
      registry_entries: registry.entries.length,
    });

    const previousRow = await env.concord_db
      .prepare("SELECT snapshot_json FROM snapshot ORDER BY taken_at DESC LIMIT 1")
      .first<{ snapshot_json: string }>();
    await env.concord_db
      .prepare("INSERT INTO snapshot (id, taken_at, snapshot_json) VALUES (?, ?, ?)")
      .bind(current.snapshot_id, new Date().toISOString(), JSON.stringify(current))
      .run();
    await env.concord_db
      .prepare("UPDATE run SET snapshot_id = ? WHERE id = ?")
      .bind(current.snapshot_id, runId)
      .run();
    const previous: ProductTruthSnapshot = previousRow
      ? ProductTruthSnapshotSchema.parse(JSON.parse(previousRow.snapshot_json))
      : current;

    // Change-Lab live mutation: a WORKING COPY only. The base (unmutated)
    // snapshot was stored above, so the mutation never poisons the next
    // run's `previous`.
    let effectiveCurrent = current;
    let effectiveFiles: ReadonlyArray<{ path: string; content: string }> = ESTATE_FILES;
    if (options.mutation?.kind === "fact_value") {
      const mutation = options.mutation;
      effectiveCurrent = {
        ...current,
        facts: current.facts.map((f) =>
          f.key === mutation.fact_key
            ? { ...f, value: mutation.value as (typeof f)["value"], observed_at: startedAt }
            : f,
        ),
      };
    } else if (options.mutation?.kind === "doc_body") {
      const mutation = options.mutation;
      const unit = parseEstate(ESTATE_FILES).find((u) => u.id === mutation.doc_unit_id);
      if (unit) {
        effectiveFiles = ESTATE_FILES.map((f) =>
          f.path === unit.path
            ? { ...f, content: f.content.replace(unit.body, mutation.body) }
            : f,
        );
      }
    }

    const out = runPipeline({
      previous,
      current: effectiveCurrent,
      files: effectiveFiles,
      detectedAt: startedAt,
      cli: CliIntrospectionSchema.parse(cliIntrospection),
    });
    await step(env, runId, "pipeline", {
      deltas: out.deltas.length,
      units: out.units.length,
      projections: out.projections.length,
      impacts: out.impacts.length,
      patches: out.patches.length,
      findings: out.findings.length,
      warnings: out.warnings.length,
      generated_paths: out.generated_paths,
      refusals: out.refusals,
    });

    const spend = await loadSpendState(env.concord_db, {
      maxCallsPerRun: options.maxCallsPerRun,
      dailyCapUsd: options.dailyCapUsd,
    });

    // model_extraction (opt-in, guarded, candidates only).
    let modelProjections: FactProjection[] = [];
    if (options.modelExtraction && env.ANTHROPIC_API_KEY && deps.createMessage) {
      const eligible = unitsNeedingModelExtraction(out.units, out.projections);
      const budgetLeft = Math.max(0, spend.maxCallsPerRun - spend.callsThisRun);
      const selected = eligible.slice(0, Math.min(MODEL_EXTRACTION_MAX_UNITS, budgetLeft));
      const extraction = await runModelExtraction(
        env.ANTHROPIC_API_KEY,
        selected,
        startedAt,
        async (usage) => recordModelCall(env.concord_db, spend, runId, "model_extraction", usage),
      );
      modelProjections = extraction.projections;
      await step(env, runId, "model_extraction", {
        eligible: eligible.length,
        attempted: extraction.attempted,
        skipped: eligible.length - selected.length,
        refused: extraction.refused,
        failed: extraction.failed,
        first_error: extraction.first_error,
        candidates: modelProjections.length,
      });
    }

    // Assign ids; impacts become mutable records the AI phase resolves.
    // Conflicts (Phase 15): snapshot-derived ones from the pipeline, plus
    // insufficient_evidence events from patch validation as they occur.
    const conflicts: (ConflictDraft & { id: string })[] = out.conflicts.map((c) => ({
      ...c,
      id: newId("cfl"),
    }));
    const conflictIdByKey = new Map(conflicts.map((c) => [c.fact_key, c.id]));
    const impacts: ImpactRecord[] = out.impacts.map((impact) => ({
      ...impact,
      id: newId("imp"),
      resolution_note: null,
      patch_id: null,
      conflict_id: conflictIdByKey.get(impact.fact_key) ?? null,
    }));
    const unitById = new Map(out.units.map((u) => [u.id, u]));
    const fileByPath = new Map(ESTATE_FILES.map((f) => [f.path, f.content]));
    const deltaByKey = new Map(out.deltas.map((d) => [d.fact_key, d]));
    const modelPatches: ModelPatchRow[] = [];
    let exhausted = false;

    // GROUNDED_PATCH path first, then EDITORIAL_REVIEW drafts — both in
    // batches of ≤ 5 concurrent (G9), every call behind the spend gate.
    const aiWork = [
      ...impacts.filter((i) => i.action === "GROUNDED_PATCH" && i.conflict_id === null),
      ...impacts.filter((i) => i.action === "EDITORIAL_REVIEW" && i.conflict_id === null),
    ];
    if (deps.createMessage && aiWork.length > 0) {
      await mapConcurrent(aiWork, 5, async (impact) => {
        const unit = unitById.get(impact.doc_unit_id);
        const delta = deltaByKey.get(impact.fact_key);
        if (!unit || !delta) {
          impact.resolution_note = "internal: unit or delta missing";
          return;
        }
        const isGrounded = impact.action === "GROUNDED_PATCH";
        const evidence = [evidenceFromDelta(delta, effectiveCurrent.generated_at)];
        const message = await guardedCall(env, deps, spend, runId,
          isGrounded ? "grounded_patch" : "editorial_draft",
          {
            model: MODEL_ID,
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            output_config: {
              effort: "medium",
              format: { type: "json_schema", schema: PATCH_PROPOSAL_OUTPUT_SCHEMA },
            },
            // Prompt caching: the system prompt is the STABLE prefix; the
            // cache_control breakpoint sits on it, and every volatile value
            // (run id, timestamps, the unit body) is strictly after it.
            system: [
              {
                type: "text",
                text: isGrounded ? PATCH_SYSTEM_PROMPT : EDITORIAL_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: [
              { role: "user", content: buildPatchUserPrompt(unit, delta, evidence) },
            ],
          },
        );
        if (message === "exhausted" || message === null) {
          exhausted = exhausted || message === "exhausted";
          impact.resolution_note = message === "exhausted" ? "budget_exhausted" : "no model client";
          return; // disposition stays "unresolved" — visible, not dropped
        }
        // stop_reason BEFORE content, on every call (G11).
        if (message.stop_reason === "refusal") {
          impact.action = "EDITORIAL_REVIEW";
          impact.disposition = "escalated";
          impact.resolution_note = "model_refusal";
          return;
        }
        const text = textOf(message);
        if (!text) {
          impact.resolution_note = "empty model response";
          return;
        }
        let proposal;
        try {
          proposal = parsePatchProposal(text);
        } catch (e) {
          impact.resolution_note = `proposal failed schema re-validation: ${e instanceof Error ? e.message.slice(0, 120) : "parse error"}`;
          return;
        }
        const verdict = validatePatch({
          proposal,
          unit,
          facts: effectiveCurrent.facts,
          detectedAt: startedAt,
        });
        const draftAcceptable =
          !isGrounded && !verdict.ok && verdict.force_editorial;
        if (!verdict.ok && !draftAcceptable) {
          if (verdict.reclassify_to) {
            impact.action = verdict.reclassify_to;
            // Gate (a): the required evidence cannot be resolved — that is
            // an insufficient_evidence conflict, recorded and attached.
            const badLocator =
              proposal.evidence.find(
                (e) => !effectiveCurrent.facts.some((f) => f.key === e.fact_key && f.locator === e.locator),
              )?.locator ?? "(unknown locator)";
            const draft = insufficientEvidenceConflict(impact.fact_key, badLocator, effectiveCurrent.facts);
            const conflictId = newId("cfl");
            conflicts.push({ ...draft, id: conflictId });
            impact.conflict_id = conflictId;
          } else if (verdict.force_editorial) {
            impact.action = "EDITORIAL_REVIEW";
          }
          impact.resolution_note = verdict.reason;
          return; // rejected — disposition remains "unresolved", visible
        }
        // Accepted: a review-required patch. Paths come from the DocUnit —
        // the model never authors one.
        const before = fileByPath.get(unit.path) ?? unit.body;
        const after = before.includes(unit.body)
          ? before.replace(unit.body, proposal.new_body)
          : proposal.new_body;
        const diff = makeDiff(unit.path, before, after);
        const patchId = newId("pat");
        modelPatches.push({
          id: patchId,
          path: unit.path,
          before,
          after,
          unified: diff.unified,
          origin: isGrounded ? "model_grounded" : "model_editorial_draft",
          doc_unit_id: unit.id,
          impact_ids: [impact.id],
          evidence_json: JSON.stringify(proposal.evidence),
          requires_review: true, // gate (c): structural, no apply path exists
          validation_json: JSON.stringify(
            verdict.ok
              ? verdict.validation
              : {
                  evidence_resolvable: true,
                  introduces_no_new_facts: true,
                  respects_editorial_register: false,
                  path_allowlisted: true,
                  falsification: { attempted: false, refuted: false, refutation: null },
                },
          ),
          changed_because: proposal.changed_because,
          needs_human_because:
            proposal.needs_human_because ??
            (isGrounded ? null : "editorial change — review the draft"),
        });
        impact.patch_id = patchId;
        impact.disposition = "proposed";
      });
    }
    const modelFindings: Finding[] =
      modelProjections.length > 0 ? consistencyFindings(effectiveCurrent.facts, modelProjections) : [];

    // ── Adversarial verification (Phase 15, architecture §6.2) ──────────
    // Every non-deterministic finding faces a FALSIFIER — a separate call
    // with no shared context, defaulting to refuted under uncertainty. A
    // refuted finding is recorded suppressed WITH its refutation text.
    interface VerifiedFinding extends Finding {
      disposition: "active" | "suppressed";
      refutation: string | null;
      proposal_json: string | null;
    }
    const projectionsById = new Map(
      [...out.projections, ...modelProjections].map((p) => [p.id, p]),
    );
    const unitByIdForDoc = new Map(out.units.map((u) => [u.id, u]));
    const allRawFindings = [...out.findings, ...modelFindings];
    const verifiedFindings: VerifiedFinding[] = [];
    const toFalsify: { finding: Finding; index: number }[] = [];
    for (const finding of allRawFindings) {
      const record: VerifiedFinding = {
        ...finding,
        disposition: "active",
        refutation: null,
        proposal_json: null,
      };
      verifiedFindings.push(record);
      if (deps.createMessage && needsFalsification(finding, projectionsById)) {
        toFalsify.push({ finding, index: verifiedFindings.length - 1 });
      }
    }
    if (toFalsify.length > 0) {
      await mapConcurrent(toFalsify, 5, async ({ finding, index }) => {
        const record = verifiedFindings[index] as VerifiedFinding;
        const projection = projectionsById.get(finding.projection_id ?? "");
        const truthClaim = effectiveCurrent.facts.find((f) => f.key === finding.fact_key);
        if (!projection || !truthClaim) return;
        const truth: Evidence = {
          fact_key: truthClaim.key,
          tier: truthClaim.tier,
          locator: truthClaim.locator,
          value: truthClaim.value,
          observed_at: truthClaim.observed_at,
        };
        const proposal = proposalForFinding(finding, projection, truth);
        record.proposal_json = JSON.stringify(proposal);
        const passage = unitByIdForDoc.get(finding.doc_unit_id ?? "")?.body ?? "";
        const message = await guardedCall(env, deps, spend, runId, "falsifier", {
          model: MODEL_ID,
          max_tokens: 1024,
          thinking: { type: "adaptive" },
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: FALSIFIER_OUTPUT_SCHEMA },
          },
          system: [
            { type: "text", text: FALSIFIER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: buildFalsifierPrompt(proposal, passage) }],
        });
        if (message === "exhausted" || message === null) {
          exhausted = exhausted || message === "exhausted";
          // Unverified under budget pressure → suppressed under uncertainty.
          record.disposition = "suppressed";
          record.refutation = "falsification budget exhausted — suppressed under uncertainty";
          return;
        }
        if (message.stop_reason === "refusal") {
          record.disposition = "suppressed";
          record.refutation = "falsifier refused — suppressed under uncertainty";
          return;
        }
        const verdict = parseFalsifierResponse(textOf(message));
        if (verdict.refuted) {
          record.disposition = "suppressed";
          record.refutation = verdict.refutation;
        }
      });
    }

    // ── Persist everything ──────────────────────────────────────────────
    const statements: D1PreparedStatement[] = [];
    for (const unit of out.units) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO doc_unit (id, run_id, surface, path, anchor, title, body_sha256, owner, generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(unit.id, runId, unit.surface, unit.path, unit.anchor, unit.title, unit.body_sha256, unit.owner, unit.generated ? 1 : 0),
      );
    }
    for (const projection of [...out.projections, ...modelProjections]) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO fact_projection (id, run_id, fact_key, doc_unit_id, mode, asserted_value_json, extractor, confidence, span_start, span_end, detected_at, normalized_value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            projection.id, runId, projection.fact_key, projection.doc_unit_id, projection.mode,
            JSON.stringify(projection.asserted_value), projection.extractor, projection.confidence,
            projection.span?.start ?? null, projection.span?.end ?? null, projection.detected_at,
            JSON.stringify(projection.normalized_value ?? null),
          ),
      );
    }
    for (const finding of verifiedFindings) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO finding (id, run_id, kind, fact_key, doc_unit_id, projection_id, detail, owner, disposition, refutation, proposal_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(`fnd_${crypto.randomUUID()}`, runId, finding.kind, finding.fact_key, finding.doc_unit_id, finding.projection_id, finding.detail, finding.owner, finding.disposition, finding.refutation, finding.proposal_json, startedAt),
      );
    }
    for (const conflict of conflicts) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO conflict (id, run_id, fact_key, kind, claims_json, missing_information_json, likely_owner, suggested_question, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
          )
          .bind(conflict.id, runId, conflict.fact_key, conflict.kind, JSON.stringify(conflict.claims), JSON.stringify(conflict.missing_information), conflict.likely_owner, conflict.suggested_question),
      );
    }
    for (const warning of out.warnings) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO run_warning (id, run_id, kind, path, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(`wrn_${crypto.randomUUID()}`, runId, warning.kind, warning.path, warning.detail, startedAt),
      );
    }
    // Deterministic pipeline patches (by path), then model patches (by impact).
    const deterministicPatchIdByPath = new Map<string, string>();
    for (const patch of out.patches) {
      const id = newId("pat");
      deterministicPatchIdByPath.set(patch.path, id);
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO patch (id, run_id, path, before_text, after_text, unified, origin, requires_review) VALUES (?, ?, ?, ?, ?, ?, 'deterministic', 0)",
          )
          .bind(id, runId, patch.path, patch.before, patch.after, patch.unified),
      );
    }
    for (const patch of modelPatches) {
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO patch (id, run_id, path, before_text, after_text, unified, origin, doc_unit_id, impact_ids_json, evidence_json, requires_review, validation_json, changed_because, needs_human_because) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
          )
          .bind(
            patch.id, runId, patch.path, patch.before, patch.after, patch.unified, patch.origin,
            patch.doc_unit_id, JSON.stringify(patch.impact_ids), patch.evidence_json,
            patch.validation_json, patch.changed_because, patch.needs_human_because,
          ),
      );
    }
    for (const impact of impacts) {
      const unit = unitById.get(impact.doc_unit_id);
      const patchId =
        impact.patch_id ??
        (impact.action === "DETERMINISTIC_REGEN" && unit
          ? (deterministicPatchIdByPath.get(unit.path) ?? null)
          : null);
      statements.push(
        env.concord_db
          .prepare(
            "INSERT INTO impact (id, run_id, fact_key, delta_json, doc_unit_id, projection_id, action, classification_rule, explanation, disposition, resolution_note, patch_id, conflict_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            impact.id, runId, impact.fact_key, JSON.stringify(impact.delta), impact.doc_unit_id,
            impact.projection_id, impact.action, impact.classification_rule, impact.explanation,
            impact.disposition, impact.resolution_note, patchId, impact.conflict_id,
          ),
      );
    }
    await batchAll(env, statements);
    await step(env, runId, "resolve", {
      impacts: impacts.length,
      model_patches: modelPatches.length,
      model_calls: spend.callsThisRun,
      conflicts: conflicts.length,
      findings_active: verifiedFindings.filter((f) => f.disposition === "active").length,
      findings_suppressed: verifiedFindings.filter((f) => f.disposition === "suppressed").length,
      falsified: toFalsify.length,
      exhausted,
    });

    const finalStatus = exhausted ? "partial" : "completed";
    await env.concord_db
      .prepare("UPDATE run SET status = ?, reason = ?, finished_at = ? WHERE id = ?")
      .bind(finalStatus, exhausted ? "budget_exhausted" : null, new Date().toISOString(), runId)
      .run();
    await env.concord_db
      .prepare("UPDATE audit_log SET outcome = ? WHERE run_id = ?")
      .bind(finalStatus, runId)
      .run();
  } catch (e) {
    await env.concord_db
      .prepare("UPDATE run SET status = 'failed', reason = ?, finished_at = ? WHERE id = ?")
      .bind(e instanceof Error ? e.message.slice(0, 200) : "failed", new Date().toISOString(), runId)
      .run();
    await env.concord_db
      .prepare("UPDATE audit_log SET outcome = 'failed' WHERE run_id = ?")
      .bind(runId)
      .run();
  }
}

/** Which DocUnit fields the executor relies on (documentation aid). */
export type { DocUnit };
