import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { ProductTruthSnapshotSchema, newId, type ProductTruthSnapshot } from "@relay/contracts";
import { arbitrateAll, ownerOfFact } from "@concord/core";
import { executeRun, type MessageLike, type RunDeps, type RunEnv, type RunOptions } from "./run.js";

interface Env extends RunEnv {
  ASSETS: Fetcher;
  RUN_QUEUE?: Queue<QueuedRun>;
}

interface QueuedRun {
  run_id: string;
  options: RunOptions;
}

const app = new Hono<{ Bindings: Env }>();

function realDeps(env: Env): RunDeps {
  if (!env.ANTHROPIC_API_KEY) return { createMessage: null };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return {
    createMessage: (params) =>
      client.messages.create(
        params as unknown as Parameters<typeof client.messages.create>[0],
      ) as unknown as Promise<MessageLike>,
  };
}

/**
 * Enqueue a run (Phase 14): validate, write a `queued` row, enqueue, return
 * the id immediately. The consumer gets a 15-minute CPU budget for the
 * 5–15 model calls a run makes. Unauthenticated for now — Phase 18 gates it.
 */
async function enqueueRun(
  c: { env: Env; req: { query(name: string): string | undefined } },
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
): Promise<{ run_id: string; status: string }> {
  const runId = newId("run");
  const options: RunOptions = {
    modelExtraction: c.req.query("model_extraction") === "1",
  };
  const cap = Number(c.req.query("max_calls") ?? "");
  if (Number.isInteger(cap) && cap > 0 && cap <= 20) options.maxCallsPerRun = cap;
  await c.env.concord_db
    .prepare("INSERT INTO run (id, started_at, status) VALUES (?, ?, 'queued')")
    .bind(runId, new Date().toISOString())
    .run();
  if (c.env.RUN_QUEUE) {
    await c.env.RUN_QUEUE.send({ run_id: runId, options });
  } else {
    // Local/dev fallback: no queue binding — run inline off the request.
    executionCtx.waitUntil(executeRun(c.env, realDeps(c.env), runId, options));
  }
  return { run_id: runId, status: "queued" };
}

app.post("/api/admin/runs", async (c) => c.json(await enqueueRun(c, c.executionCtx)));
// The public start button uses the same enqueue path.
app.post("/api/runs", async (c) => c.json(await enqueueRun(c, c.executionCtx)));

app.get("/api/public/runs/:id", async (c) => {
  const runId = c.req.param("id");
  const run = await c.env.concord_db
    .prepare("SELECT * FROM run WHERE id = ?")
    .bind(runId)
    .first();
  if (!run) return c.json({ error: "not_found" }, 404);
  const [steps, impacts, patches, findings, warnings, modelCalls] = await Promise.all([
    c.env.concord_db
      .prepare("SELECT step, detail_json, created_at FROM run_step WHERE run_id = ? ORDER BY created_at")
      .bind(runId)
      .all(),
    c.env.concord_db.prepare("SELECT * FROM impact WHERE run_id = ?").bind(runId).all(),
    c.env.concord_db
      .prepare(
        "SELECT id, path, unified, origin, doc_unit_id, impact_ids_json, evidence_json, requires_review, validation_json, changed_because, needs_human_because FROM patch WHERE run_id = ?",
      )
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
    c.env.concord_db
      .prepare(
        "SELECT purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cache_creation_input_tokens) AS cache_creation, SUM(cache_read_input_tokens) AS cache_read, SUM(cost_usd) AS cost_usd FROM model_call WHERE run_id = ? GROUP BY purpose",
      )
      .bind(runId)
      .all(),
  ]);
  const cost = (modelCalls.results as { cost_usd: number }[]).reduce(
    (sum, r) => sum + (r.cost_usd ?? 0),
    0,
  );
  return c.json({
    run,
    steps: steps.results,
    impacts: impacts.results,
    patches: patches.results,
    findings: findings.results,
    warnings: warnings.results,
    model_calls: modelCalls.results,
    estimated_cost_usd: Number(cost.toFixed(4)),
  });
});

interface LatestContext {
  runId: string;
  snapshot: ProductTruthSnapshot;
}

async function latestContext(env: Env): Promise<LatestContext | null> {
  const run = await env.concord_db
    .prepare("SELECT id FROM run WHERE status IN ('completed','partial') ORDER BY started_at DESC LIMIT 1")
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
    .prepare("SELECT fact_key, COUNT(*) AS n FROM fact_projection WHERE run_id = ? GROUP BY fact_key")
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

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueuedRun>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await executeRun(env, realDeps(env), message.body.run_id, message.body.options);
      message.ack();
    }
  },
};
