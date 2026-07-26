import { Hono } from "hono";
import {
  ProductTruthSnapshotSchema,
  newId,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import { runPipeline } from "@concord/core";
import { ESTATE_FILES } from "./estate.js";

interface Env {
  ASSETS: Fetcher;
  concord_db: D1Database;
  RELAY_BASE_URL: string;
}

/** The only two Relay endpoints Concord may call (CONTRACTS-FROZEN.md §1). */
const RELAY_PRODUCT_TRUTH = "/api/product-truth";
const RELAY_COPY_REGISTRY = "/api/copy-registry";

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

app.post("/api/runs", async (c) => {
  const runId = newId("run");
  const startedAt = new Date().toISOString();
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
    });
    await step(c.env, runId, "pipeline", {
      deltas: out.deltas.length,
      units: out.units.length,
      projections: out.projections.length,
      impacts: out.impacts.length,
      patches: out.patches.length,
    });

    for (const unit of out.units) {
      await c.env.concord_db
        .prepare(
          "INSERT INTO doc_unit (id, run_id, surface, path, anchor, title, body_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(unit.id, runId, unit.surface, unit.path, unit.anchor, unit.title, unit.body_sha256)
        .run();
    }
    for (const projection of out.projections) {
      await c.env.concord_db
        .prepare(
          "INSERT INTO fact_projection (id, run_id, fact_key, doc_unit_id, mode, asserted_value_json, extractor, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
        )
        .run();
    }
    const patchIds = new Map<string, string>();
    for (const patch of out.patches) {
      const id = newId("pat");
      patchIds.set(patch.path, id);
      await c.env.concord_db
        .prepare(
          "INSERT INTO patch (id, run_id, path, before_text, after_text, unified) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, runId, patch.path, patch.before, patch.after, patch.unified)
        .run();
    }
    for (const impact of out.impacts) {
      const unit = out.units.find((u) => u.id === impact.doc_unit_id);
      await c.env.concord_db
        .prepare(
          "INSERT INTO impact (id, run_id, fact_key, delta_json, doc_unit_id, projection_id, action, classification_rule, explanation, patch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
          (unit && patchIds.get(unit.path)) ?? null,
        )
        .run();
    }
    await c.env.concord_db
      .prepare("UPDATE run SET status = 'completed', finished_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), runId)
      .run();
    return c.json({ run_id: runId, ...outSummary(out) });
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

function outSummary(out: {
  deltas: unknown[];
  units: unknown[];
  projections: unknown[];
  impacts: unknown[];
  patches: unknown[];
}): Record<string, number> {
  return {
    deltas: out.deltas.length,
    doc_units: out.units.length,
    projections: out.projections.length,
    impacts: out.impacts.length,
    patches: out.patches.length,
  };
}

app.get("/api/public/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const run = await c.env.concord_db
    .prepare("SELECT * FROM run WHERE id = ?")
    .bind(runId)
    .first();
  if (!run) return c.json({ error: "not_found" }, 404);
  const [steps, impacts, patches] = await Promise.all([
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
  ]);
  return c.json({
    run,
    steps: steps.results,
    impacts: impacts.results,
    patches: patches.results,
  });
});

export default app;
