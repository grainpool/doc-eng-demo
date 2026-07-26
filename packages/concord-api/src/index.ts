import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { ProductTruthSnapshotSchema, newId, type ProductTruthSnapshot } from "@relay/contracts";
import { arbitrateAll, ownerOfFact } from "@concord/core";
import {
  ChangeLabRequestSchema,
  ChangeLabRunSchema,
} from "@relay/contracts";
import { validateMutation } from "@concord/core";
import editableUnits from "../../../fixtures/changelab/editable-units.json";
import { assembleChangeLabRun } from "./changelab.js";
import { requireAccessIdentity, type AccessIdentity } from "./middleware/access.js";
import { REPLAY_RUNS } from "./runs.generated.js";
import { executeRun, type MessageLike, type RunDeps, type RunEnv, type RunOptions } from "./run.js";

interface Env extends RunEnv {
  ASSETS: Fetcher;
  RUN_QUEUE?: Queue<QueuedRun>;
  /** Phase 17: admin surface is unreachable unless EXPLICITLY enabled;
   * unset in the deployed public configuration until Phase 18's Access. */
  DEMO_ADMIN_ENABLED?: string;
}

interface QueuedRun {
  run_id: string;
  options: RunOptions;
}

const app = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

// Phase 18: the ENTIRE admin surface sits behind verified Access identity.
// Default-off (404 when DEMO_ADMIN_ENABLED unset — invariant I12); missing
// or invalid Cf-Access-Jwt-Assertion → 403; iss+aud+exp+domain all checked.
app.use("/api/admin/*", requireAccessIdentity as never);

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
  admin: boolean,
): Promise<{ run_id: string; status: string }> {
  const runId = newId("run");
  const options: RunOptions = {
    // The PUBLIC path makes ZERO model calls (invariant I11, security §5):
    // public runs are deterministic-only; AI paths require the admin
    // surface, which Phase 18 puts behind Access.
    ai: admin,
    modelExtraction: admin && c.req.query("model_extraction") === "1",
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
    const deps = options.ai ? realDeps(c.env) : { createMessage: null };
    executionCtx.waitUntil(executeRun(c.env, deps, runId, options));
  }
  return { run_id: runId, status: "queued" };
}

app.post("/api/admin/runs", async (c) => c.json(await enqueueRun(c, c.executionCtx, true)));

/** Phase 18 — live Change-Lab run: validated mutation → working copy →
 * real queued run, watched through THE SAME renderer as replay. */
app.post("/api/admin/changelab", async (c) => {
  const identity = c.get("identity");
  const raw = await c.req.text();
  if (raw.length > 16_384) return c.json({ error: "BODY_TOO_LARGE" }, 413);
  const parsed = ChangeLabRequestSchema.safeParse(JSON.parse(raw || "null"));
  if (!parsed.success || parsed.data.mode !== "live") {
    return c.json({ error: "bad_request" }, 400);
  }
  const auditBase = {
    email: identity.email,
    mutation: JSON.stringify(parsed.data.mutation),
  };
  async function audit(outcome: string, runId: string | null): Promise<void> {
    await c.env.concord_db
      .prepare(
        "INSERT INTO audit_log (id, ts, access_email, mutation_json, run_id, outcome, pr_url) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(`aud_${crypto.randomUUID()}`, new Date().toISOString(), auditBase.email, auditBase.mutation, runId, outcome)
      .run();
  }
  const verdict = validateMutation(
    parsed.data.mutation,
    (editableUnits as { editable_doc_unit_ids: string[] }).editable_doc_unit_ids,
  );
  if (!verdict.ok) {
    await audit(`rejected:${verdict.code}`, null);
    return c.json({ error: verdict.code, detail: verdict.detail }, 400);
  }
  // One concurrent live run — a second request names the in-flight run.
  const inFlight = await c.env.concord_db
    .prepare("SELECT id FROM run WHERE mode = 'live' AND status IN ('queued','running') LIMIT 1")
    .first<{ id: string }>();
  if (inFlight) {
    await audit("rejected:LIVE_RUN_IN_FLIGHT", inFlight.id);
    return c.json({ error: "LIVE_RUN_IN_FLIGHT", in_flight_run_id: inFlight.id }, 409);
  }
  // ≤ 5 live runs per identity per hour.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await c.env.concord_db
    .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE access_email = ? AND ts >= ? AND outcome NOT LIKE 'rejected:%'")
    .bind(identity.email, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) {
    await audit("rejected:RATE_LIMITED", null);
    return c.json({ error: "RATE_LIMITED", detail: "≤ 5 live runs per identity per hour" }, 429);
  }
  const runId = newId("run");
  const options: RunOptions = { ai: true, mutation: parsed.data.mutation };
  await c.env.concord_db
    .prepare("INSERT INTO run (id, started_at, status, mode, mutation_json) VALUES (?, ?, 'queued', 'live', ?)")
    .bind(runId, new Date().toISOString(), auditBase.mutation)
    .run();
  await audit("queued", runId);
  if (c.env.RUN_QUEUE) {
    await c.env.RUN_QUEUE.send({ run_id: runId, options });
  } else {
    c.executionCtx.waitUntil(executeRun(c.env, realDeps(c.env), runId, options));
  }
  return c.json({ run_id: runId, status: "queued", mode: "live" });
});

/** Public audit view — email redacted to its domain (security.md §2). */
app.get("/api/public/audit", async (c) => {
  const rows = await c.env.concord_db
    .prepare("SELECT ts, access_email, mutation_json, run_id, outcome, pr_url FROM audit_log ORDER BY ts DESC LIMIT 50")
    .all<{ ts: string; access_email: string; mutation_json: string; run_id: string | null; outcome: string; pr_url: string | null }>();
  return c.json({
    entries: rows.results.map((r) => ({
      ts: r.ts,
      identity_domain: r.access_email.includes("@") ? `@${r.access_email.split("@")[1]}` : "(unknown)",
      mutation: JSON.parse(r.mutation_json),
      run_id: r.run_id,
      outcome: r.outcome,
      pr_url: r.pr_url,
    })),
  });
});
// The public start button: deterministic-only run, zero model calls (I11).
app.post("/api/runs", async (c) => c.json(await enqueueRun(c, c.executionCtx, false)));

/** Phase 17 — public replay: serve a committed recording of a REAL run
 * matching the requested mutation. No auth, no model calls, same
 * ChangeLabRun shape live mode uses. */
app.post("/api/public/changelab/replay", async (c) => {
  const parsed = ChangeLabRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.mode !== "replay") {
    return c.json({ error: "bad_request" }, 400);
  }
  const mutation = parsed.data.mutation;
  const recording = REPLAY_RUNS.map((r) => ChangeLabRunSchema.parse(r.run)).find((run) => {
    if (mutation.kind !== "fact_value" || run.mutation.kind !== "fact_value") return false;
    return (
      run.mutation.fact_key === mutation.fact_key &&
      JSON.stringify(run.mutation.value) === JSON.stringify(mutation.value)
    );
  });
  if (!recording) return c.json({ error: "no_recording_for_mutation" }, 404);
  return c.json({ ...recording, mode: "replay" });
});

/** The five available replay scenarios (for the picker UI). */
app.get("/api/public/changelab/scenarios", (c) =>
  c.json({
    scenarios: REPLAY_RUNS.map((r) => {
      const run = ChangeLabRunSchema.parse(r.run);
      return { scenario: r.scenario, mutation: run.mutation, status: run.status };
    }),
  }),
);

app.get("/api/public/runs/:id", async (c) => {
  const runId = c.req.param("id");
  // ?verbose=1 → the full ChangeLabRun record (Phase 17).
  if (c.req.query("verbose") === "1") {
    const record = await assembleChangeLabRun(c.env.concord_db, runId);
    return record ? c.json(record) : c.json({ error: "not_found" }, 404);
  }
  const run = await c.env.concord_db
    .prepare("SELECT * FROM run WHERE id = ?")
    .bind(runId)
    .first();
  if (!run) return c.json({ error: "not_found" }, 404);
  const [steps, impacts, patches, findings, warnings, modelCalls, conflicts] = await Promise.all([
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
      .prepare("SELECT kind, fact_key, doc_unit_id, projection_id, detail, owner, disposition, refutation, proposal_json FROM finding WHERE run_id = ?")
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
    c.env.concord_db
      .prepare("SELECT * FROM conflict WHERE run_id = ?")
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
    conflicts: conflicts.results,
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
      // I11: only admin-enqueued runs get a model client.
      const deps = message.body.options.ai ? realDeps(env) : { createMessage: null };
      await executeRun(env, deps, message.body.run_id, message.body.options);
      message.ack();
    }
  },
};
