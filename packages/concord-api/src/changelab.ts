import {
  ChangeLabRunSchema,
  ProductTruthSnapshotSchema,
  type AllowedMutation,
  type ChangeLabRun,
} from "@relay/contracts";

/**
 * Phase 17 — ChangeLabRun assembly from persisted run rows. ONE shape for
 * replay and live (contracts.md §17): the replay endpoint serves committed
 * recordings of REAL runs through the exact renderer live mode uses.
 */

interface RunRow {
  id: string;
  status: string;
  reason: string | null;
  started_at: string;
  finished_at: string | null;
  snapshot_id: string | null;
}

export async function assembleChangeLabRun(
  db: D1Database,
  runId: string,
): Promise<ChangeLabRun | null> {
  const run = await db
    .prepare("SELECT * FROM run WHERE id = ?")
    .bind(runId)
    .first<RunRow>();
  if (!run) return null;
  const [steps, impacts, patches, conflicts, findings, usage, snapshotRow] = await Promise.all([
    db.prepare("SELECT step, detail_json, created_at FROM run_step WHERE run_id = ? ORDER BY created_at").bind(runId).all<{ step: string; detail_json: string; created_at: string }>(),
    db.prepare("SELECT * FROM impact WHERE run_id = ?").bind(runId).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM patch WHERE run_id = ?").bind(runId).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM conflict WHERE run_id = ?").bind(runId).all<Record<string, unknown>>(),
    db.prepare("SELECT kind, fact_key, doc_unit_id, detail, owner, disposition, refutation FROM finding WHERE run_id = ?").bind(runId).all<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cost_usd),0) AS cost FROM model_call WHERE run_id = ?").bind(runId).first<{ calls: number; input_tokens: number; output_tokens: number; cost: number }>(),
    run.snapshot_id
      ? db.prepare("SELECT snapshot_json FROM snapshot WHERE id = ?").bind(run.snapshot_id).first<{ snapshot_json: string }>()
      : Promise.resolve(null),
  ]);

  const impactRecords = impacts.results.map((r) => ({
    id: String(r.id),
    run_id: runId,
    fact_key: String(r.fact_key),
    delta: JSON.parse(String(r.delta_json)) as { from: unknown; to: unknown; kind: string },
    doc_unit_id: String(r.doc_unit_id),
    projection_id: String(r.projection_id),
    action: String(r.action),
    classification_rule: Number(r.classification_rule),
    explanation: String(r.explanation),
    disposition: String(r.disposition ?? "unresolved"),
    resolution_note: (r.resolution_note as string | null) ?? null,
    patch_id: (r.patch_id as string | null) ?? null,
    conflict_id: (r.conflict_id as string | null) ?? null,
  }));

  // The mutation that drove the run, reconstructed from its first delta.
  const first = impactRecords[0];
  const mutation: AllowedMutation = first
    ? { kind: "fact_value", fact_key: first.fact_key, value: first.delta.to }
    : { kind: "fact_value", fact_key: "(no delta this run)", value: null };

  const snapshot = snapshotRow
    ? ProductTruthSnapshotSchema.parse(JSON.parse(snapshotRow.snapshot_json))
    : null;
  const impactedKeys = new Set(impactRecords.map((i) => i.fact_key));
  const detectedFacts = (snapshot?.facts ?? []).filter((f) => impactedKeys.has(f.key));

  const impactsByPatch = new Map<string, string[]>();
  for (const impact of impactRecords) {
    if (impact.patch_id) {
      impactsByPatch.set(impact.patch_id, [
        ...(impactsByPatch.get(impact.patch_id) ?? []),
        impact.id,
      ]);
    }
  }
  const patchRecords = patches.results.map((r) => {
    const id = String(r.id);
    const explicit = r.impact_ids_json ? (JSON.parse(String(r.impact_ids_json)) as string[]) : null;
    const evidence = r.evidence_json ? (JSON.parse(String(r.evidence_json)) as unknown[]) : [];
    const linked = explicit ?? impactsByPatch.get(id) ?? [];
    // §14: evidence min(1) is load-bearing. Deterministic regen patches
    // carry the driving delta's fact as evidence.
    const synthesized =
      evidence.length === 0 && linked.length > 0
        ? linked
            .map((impactId) => impactRecords.find((i) => i.id === impactId))
            .filter((i): i is NonNullable<typeof i> => Boolean(i))
            .map((impact) => {
              const claim = snapshot?.facts.find((f) => f.key === impact.fact_key);
              return {
                fact_key: impact.fact_key,
                tier: claim?.tier ?? "T3_CONFIG",
                locator: claim?.locator ?? "(snapshot)",
                value: impact.delta.to,
                observed_at: snapshot?.generated_at ?? run.started_at,
              };
            })
        : [];
    return {
      id,
      run_id: runId,
      impact_ids: linked,
      doc_unit_id: (r.doc_unit_id as string | null) ?? null,
      diff: {
        path: String(r.path),
        before: String(r.before_text ?? ""),
        after: String(r.after_text ?? ""),
        unified: String(r.unified),
      },
      origin: String(r.origin ?? "deterministic"),
      evidence: evidence.length > 0 ? evidence : synthesized,
      model_call_id: (r.model_call_id as string | null) ?? null,
      requires_review: Boolean(Number(r.requires_review ?? 0)),
      validation: r.validation_json ? JSON.parse(String(r.validation_json)) : null,
      changed_because: (r.changed_because as string | null) ?? null,
      needs_human_because: (r.needs_human_because as string | null) ?? null,
    };
  });

  const conflictRecords = conflicts.results.map((r) => ({
    id: String(r.id),
    run_id: runId,
    fact_key: String(r.fact_key),
    kind: String(r.kind),
    claims: JSON.parse(String(r.claims_json)),
    missing_information: JSON.parse(String(r.missing_information_json)),
    likely_owner: String(r.likely_owner),
    suggested_question: String(r.suggested_question),
    resolution: null,
  }));

  const changelogPatch = patchRecords.find((p) => p.diff.path.endsWith("changelog.mdx"));

  const stepRows = steps.results;
  const stepRecords = stepRows.map((r, i) => ({
    name: r.step,
    status: "completed",
    started_at: r.created_at,
    duration_ms:
      i + 1 < stepRows.length
        ? Math.max(0, Date.parse(stepRows[i + 1]!.created_at) - Date.parse(r.created_at))
        : 0,
    detail: JSON.parse(r.detail_json) as Record<string, unknown>,
  }));

  return ChangeLabRunSchema.parse({
    run_id: runId,
    mode: "live",
    status: run.status,
    mutation,
    detected_facts: detectedFacts,
    impacts: impactRecords,
    patches: patchRecords,
    conflicts: conflictRecords,
    findings: findings.results.map((r) => ({
      kind: String(r.kind),
      fact_key: String(r.fact_key),
      doc_unit_id: (r.doc_unit_id as string | null) ?? null,
      detail: String(r.detail),
      owner: (r.owner as string | null) ?? null,
      disposition: String(r.disposition ?? "active"),
      refutation: (r.refutation as string | null) ?? null,
    })),
    generated_release_entry: changelogPatch?.diff.unified ?? null,
    pull_request_url: null,
    model_usage: {
      calls: usage?.calls ?? 0,
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      estimated_usd: Number((usage?.cost ?? 0).toFixed(4)),
    },
    steps: stepRecords,
  });
}
