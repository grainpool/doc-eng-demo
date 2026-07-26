import { Hono } from "hono";
import {
  ProductTruthSnapshotSchema,
  newId,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import {
  arbitrateAll,
  ownerOfFact,
  runPipeline,
  unitsNeedingModelExtraction,
  consistencyFindings,
  type FactProjection,
  type Finding,
} from "@concord/core";
import { CliIntrospectionSchema } from "@relay/contracts";
import cliIntrospection from "../../../fixtures/cli-introspection.json";
import { ESTATE_FILES } from "./estate.generated.js";
import { runModelExtraction } from "./model-extract.js";

interface Env {
  ASSETS: Fetcher;
  concord_db: D1Database;
  RELAY_BASE_URL: string;
  ANTHROPIC_API_KEY?: string;
}

/** The only two Relay endpoints Concord may call (CONTRACTS-FROZEN.md §1). */
const RELAY_PRODUCT_TRUTH = "/api/product-truth";
const RELAY_COPY_REGISTRY = "/api/copy-registry";

/** Bound on model_extraction fan-out per run (spend is not a rounding error). */
const MODEL_EXTRACTION_MAX_UNITS = 10;

const app = new Hono<{ Bindings: Env }>();

async function step(
  env: Env,
  runId: string,
  name: string,
  detail: unknown,
): Promise<void> {
  await env.concord_db
    .prepare(
      "INSERT INTO run_step (id, run_id, step, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(newId("run"), runId, name, JSON.stringify(detail), new Date().toISOString())
    .run();
}

async function batchAll(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await env.concord_db.batch(statements.slice(i, i + CHUNK));
  }
}

app.post("/api/runs", async (c) => {
  const runId = newId("run");
  const startedAt = new Date().toISOString();
  const wantModelExtraction = c.req.query("model_extraction") === "1";
  await c.env.concord_db
    .prepare("INSERT INTO run (id, started_at, status) VALUES (?, ?, 'running')")
    .bind(runId, startedAt)
    .run();

  try {
    // DETECT input: the current authoritative snapshot from Relay…
    const truthRes = await fetch(`${c.env.RELAY_BASE_URL}${RELAY_PRODUCT_TRUTH}`);
    const current: ProductTruthSnapshot = ProductTruthSnapshotSchema.parse(
      await truthRes.json(),
    );
    // …and a freshness cross-check of the build-pinned copy against the live
    // registry (the second permitted endpoint).
    const registryRes = await fetch(`${c.env.RELAY_BASE_URL}${RELAY_COPY_REGISTRY}`);
    const registry = (await registryRes.json()) as { entries: { id: string }[] };
    await step(c.env, runId, "fetch", {
      facts: current.facts.length,
      registry_entries: registry.entries.length,
    });

    const previousRow = await c.env.concord_db
      .prepare("SELECT snapshot_json FROM snapshot ORDER BY taken_at DESC LIMIT 1")
      .first<{ snapshot_json: string }>();
    await c.env.concord_db
      .prepare("INSERT INTO snapshot (id, taken_at, snapshot_json) VALUES (?, ?, ?)")
      .bind(current.snapshot_id, new Date().toISOString(), JSON.stringify(current))
      .run();

    const previous: ProductTruthSnapshot = previousRow
      ? ProductTruthSnapshotSchema.parse(JSON.parse(previousRow.snapshot_json))
      : current; // first run: baseline, no deltas by definition

    const out = runPipeline({
      previous,
      current,
      files: ESTATE_FILES,
      detectedAt: startedAt,
      cli: CliIntrospectionSchema.parse(cliIntrospection),
    });
    await step(c.env, runId, "pipeline", {
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

    // model_extraction: candidate generator ONLY, on units where the
    // deterministic extractors found nothing, bounded and opt-in.
    let modelProjections: FactProjection[] = [];
    if (wantModelExtraction && c.env.ANTHROPIC_API_KEY) {
      const eligible = unitsNeedingModelExtraction(out.units, out.projections);
      const selected = eligible.slice(0, MODEL_EXTRACTION_MAX_UNITS);
      const extraction = await runModelExtraction(
        c.env.ANTHROPIC_API_KEY,
        selected,
        startedAt,
      );
      modelProjections = extraction.projections;
      await step(c.env, runId, "model_extraction", {
        eligible: eligible.length,
        attempted: extraction.attempted,
        skipped: eligible.length - selected.length,
        refused: extraction.refused,
        failed: extraction.failed,
        first_error: extraction.first_error,
        candidates: modelProjections.length,
      });
    }
    const allProjections = [...out.projections, ...modelProjections];
    const modelFindings: Finding[] =
      modelProjections.length > 0
        ? consistencyFindings(current.facts, modelProjections)
        : [];
    const allFindings = [...out.findings, ...modelFindings];

    const statements: D1PreparedStatement[] = [];
    for (const unit of out.units) {
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO doc_unit (id, run_id, surface, path, anchor, title, body_sha256, owner, generated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            unit.id,
            runId,
            unit.surface,
            unit.path,
            unit.anchor,
            unit.title,
            unit.body_sha256,
            unit.owner,
            unit.generated ? 1 : 0,
          ),
      );
    }
    for (const projection of allProjections) {
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO fact_projection (id, run_id, fact_key, doc_unit_id, mode, asserted_value_json, extractor, confidence, span_start, span_end, detected_at, normalized_value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            projection.id,
            runId,
            projection.fact_key,
            projection.doc_unit_id,
            projection.mode,
            JSON.stringify(projection.asserted_value),
            projection.extractor,
            projection.confidence,
            projection.span?.start ?? null,
            projection.span?.end ?? null,
            projection.detected_at,
            JSON.stringify(projection.normalized_value ?? null),
          ),
      );
    }
    for (const finding of allFindings) {
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO finding (id, run_id, kind, fact_key, doc_unit_id, projection_id, detail, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            // Findings are not a contract object (ID_PREFIXES is frozen).
            `fnd_${crypto.randomUUID()}`,
            runId,
            finding.kind,
            finding.fact_key,
            finding.doc_unit_id,
            finding.projection_id,
            finding.detail,
            finding.owner,
            startedAt,
          ),
      );
    }
    const patchIds = new Map<string, string>();
    for (const patch of out.patches) {
      const id = newId("pat");
      patchIds.set(patch.path, id);
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO patch (id, run_id, path, before_text, after_text, unified) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(id, runId, patch.path, patch.before, patch.after, patch.unified),
      );
    }
    const unitByIdForPatch = new Map(out.units.map((u) => [u.id, u]));
    for (const impact of out.impacts) {
      const unit = unitByIdForPatch.get(impact.doc_unit_id);
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO impact (id, run_id, fact_key, delta_json, doc_unit_id, projection_id, action, classification_rule, explanation, disposition, patch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            newId("imp"),
            runId,
            impact.fact_key,
            JSON.stringify(impact.delta),
            impact.doc_unit_id,
            impact.projection_id,
            impact.action,
            impact.classification_rule,
            impact.explanation,
            impact.disposition,
            (unit && patchIds.get(unit.path)) ?? null,
          ),
      );
    }
    for (const warning of out.warnings) {
      statements.push(
        c.env.concord_db
          .prepare(
            "INSERT INTO run_warning (id, run_id, kind, path, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(`wrn_${crypto.randomUUID()}`, runId, warning.kind, warning.path, warning.detail, startedAt),
      );
    }
    await batchAll(c.env, statements);
    await c.env.concord_db
      .prepare("UPDATE run SET status = 'completed', finished_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), runId)
      .run();
    return c.json({
      run_id: runId,
      deltas: out.deltas.length,
      doc_units: out.units.length,
      projections: allProjections.length,
      model_candidates: modelProjections.length,
      impacts: out.impacts.length,
      patches: out.patches.length,
      findings: allFindings.length,
      warnings: out.warnings.length,
      refusals: out.refusals.length,
    });
  } catch (e) {
    await c.env.concord_db
      .prepare("UPDATE run SET status = 'failed', finished_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), runId)
      .run();
    return c.json(
      { run_id: runId, error: e instanceof Error ? e.message.slice(0, 200) : "failed" },
      500,
    );
  }
});

app.get("/api/public/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const run = await c.env.concord_db
    .prepare("SELECT * FROM run WHERE id = ?")
    .bind(runId)
    .first();
  if (!run) return c.json({ error: "not_found" }, 404);
  const [steps, impacts, patches, findings, warnings] = await Promise.all([
    c.env.concord_db
      .prepare("SELECT step, detail_json, created_at FROM run_step WHERE run_id = ? ORDER BY created_at")
      .bind(runId)
      .all(),
    c.env.concord_db
      .prepare("SELECT * FROM impact WHERE run_id = ?")
      .bind(runId)
      .all(),
    c.env.concord_db
      .prepare("SELECT id, path, unified FROM patch WHERE run_id = ?")
      .bind(runId)
      .all(),
    c.env.concord_db
      .prepare("SELECT kind, fact_key, doc_unit_id, projection_id, detail, owner FROM finding WHERE run_id = ?")
      .bind(runId)
      .all(),
    c.env.concord_db
      .prepare("SELECT kind, path, detail FROM run_warning WHERE run_id = ?")
      .bind(runId)
      .all(),
  ]);
  return c.json({
    run,
    steps: steps.results,
    impacts: impacts.results,
    patches: patches.results,
    findings: findings.results,
    warnings: warnings.results,
  });
});

interface LatestContext {
  runId: string;
  snapshot: ProductTruthSnapshot;
}

async function latestContext(env: Env): Promise<LatestContext | null> {
  const run = await env.concord_db
    .prepare(
      "SELECT id FROM run WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1",
    )
    .first<{ id: string }>();
  const snapshotRow = await env.concord_db
    .prepare("SELECT snapshot_json FROM snapshot ORDER BY taken_at DESC LIMIT 1")
    .first<{ snapshot_json: string }>();
  if (!run || !snapshotRow) return null;
  return {
    runId: run.id,
    snapshot: ProductTruthSnapshotSchema.parse(JSON.parse(snapshotRow.snapshot_json)),
  };
}

/** All facts with projection counts and a zero-projection flag. */
app.get("/api/public/facts", async (c) => {
  const ctx = await latestContext(c.env);
  if (!ctx) return c.json({ error: "no_completed_run" }, 404);
  const counts = await c.env.concord_db
    .prepare(
      "SELECT fact_key, COUNT(*) AS n FROM fact_projection WHERE run_id = ? GROUP BY fact_key",
    )
    .bind(ctx.runId)
    .all<{ fact_key: string; n: number }>();
  const countByKey = new Map(counts.results.map((r) => [r.fact_key, r.n]));
  const facts = ctx.snapshot.facts.map((fact) => ({
    key: fact.key,
    tier: fact.tier,
    value: fact.value,
    owner: ownerOfFact(fact.key),
    projection_count: countByKey.get(fact.key) ?? 0,
    undocumented:
      fact.tier !== "T4_RELEASE" &&
      fact.tier !== "T5_HUMAN" &&
      (countByKey.get(fact.key) ?? 0) === 0,
  }));
  return c.json({ run_id: ctx.runId, snapshot_id: ctx.snapshot.snapshot_id, facts });
});

/** One fact: its authoritative claim (arbitrated) and every projection. */
app.get("/api/public/facts/:key", async (c) => {
  const key = c.req.param("key");
  const ctx = await latestContext(c.env);
  if (!ctx) return c.json({ error: "no_completed_run" }, 404);
  const arbitration = arbitrateAll(ctx.snapshot.facts).get(key);
  const projections = await c.env.concord_db
    .prepare(
      "SELECT p.*, u.surface, u.path, u.title, u.owner AS unit_owner FROM fact_projection p " +
        "LEFT JOIN doc_unit u ON u.id = p.doc_unit_id AND u.run_id = p.run_id " +
        "WHERE p.run_id = ? AND p.fact_key = ? ORDER BY p.confidence DESC",
    )
    .bind(ctx.runId, key)
    .all();
  const findings = await c.env.concord_db
    .prepare("SELECT kind, doc_unit_id, projection_id, detail FROM finding WHERE run_id = ? AND fact_key = ?")
    .bind(ctx.runId, key)
    .all();
  if (!arbitration && projections.results.length === 0) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({
    run_id: ctx.runId,
    key,
    owner: ownerOfFact(key),
    arbitration: arbitration ?? null,
    projections: projections.results,
    findings: findings.results,
  });
});

export default app;
