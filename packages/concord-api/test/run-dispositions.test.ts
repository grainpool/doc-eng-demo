// Phase 14 — invariant I10: every impact detected in trace reaches a
// terminal disposition, including on the budget-exhaustion path; the forced
// per-run cap ends the run `partial` with reason budget_exhausted; fan-out
// never exceeds 5 concurrent model calls; requires_review is stamped on
// every model-origin patch.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ProductTruthSnapshot } from "@relay/contracts";
import { executeRun, mapConcurrent, type MessageLike, type RunDeps } from "../src/run.js";

const LOCATOR = "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES";
const NOW = "2026-07-26T00:00:00.000Z";

function snapshot(id: string, limit: number): ProductTruthSnapshot {
  return {
    snapshot_id: id,
    generated_at: NOW,
    relay_contracts_version: "1.1.0",
    facts: [
      {
        key: "limit.upload.csv.max_bytes",
        value: limit,
        tier: "T1_SCHEMA",
        locator: LOCATOR,
        observed_at: NOW,
        confidence: 1,
      },
    ],
  };
}

/** A well-formed wire proposal the stub model returns for every impact. */
const WIRE_PROPOSAL = JSON.stringify({
  new_body: "Maximum file size: 25 MB.",
  evidence: [
    {
      fact_key: "limit.upload.csv.max_bytes",
      tier: "T1_SCHEMA",
      locator: LOCATOR,
      value_json: "26214400",
      observed_at: NOW,
    },
  ],
  changed_because: "limit.upload.csv.max_bytes rose to 25 MB.",
  editorial_risk: "none",
  needs_human_because: null,
});

/** Stubbed Relay endpoints (deps-injected — no network in tests). */
async function stubFetchJson(url: string): Promise<unknown> {
  if (url.endsWith("/api/product-truth")) return snapshot("snap_cur", 26_214_400);
  if (url.endsWith("/api/copy-registry")) return { entries: [] };
  throw new Error(`unexpected fetch in test: ${url}`);
}

function stubMessage(): MessageLike {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: WIRE_PROPOSAL }],
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 },
  };
}

let seq = 0;
async function newQueuedRun(): Promise<string> {
  seq += 1;
  const runId = `run_test_${Date.now()}_${seq}`;
  await env.concord_db
    .prepare("INSERT INTO run (id, started_at, status) VALUES (?, ?, 'queued')")
    .bind(runId, NOW)
    .run();
  return runId;
}

/** Seed the previous snapshot (10 MB) so the current (25 MB) is a delta. */
async function seedPreviousSnapshot(): Promise<void> {
  await env.concord_db.prepare("DELETE FROM snapshot").run();
  await env.concord_db
    .prepare("INSERT INTO snapshot (id, taken_at, snapshot_json) VALUES (?, ?, ?)")
    .bind(`snap_prev_${Date.now()}_${seq}`, NOW, JSON.stringify(snapshot("snap_prev", 10_485_760)))
    .run();
}

describe("run dispositions (I10)", () => {
  it("every traced impact reaches a terminal disposition; model patches require review", async () => {
    await seedPreviousSnapshot();
    const runId = await newQueuedRun();
    const deps: RunDeps = { createMessage: async () => stubMessage(), fetchJson: stubFetchJson };
    await executeRun(env, deps, runId, {});

    const run = await env.concord_db
      .prepare("SELECT status, reason FROM run WHERE id = ?")
      .bind(runId)
      .first<{ status: string; reason: string | null }>();
    expect(run?.status).toBe("completed");

    const impacts = await env.concord_db
      .prepare("SELECT action, disposition, resolution_note FROM impact WHERE run_id = ?")
      .bind(runId)
      .all<{ action: string; disposition: string | null; resolution_note: string | null }>();
    expect(impacts.results.length).toBeGreaterThanOrEqual(4);
    for (const impact of impacts.results) {
      expect(impact.disposition, JSON.stringify(impact)).toBeTruthy();
      expect(["proposed", "unresolved", "escalated", "no_action"]).toContain(impact.disposition);
    }
    // The AI buckets got model patches, all review-required.
    const patches = await env.concord_db
      .prepare("SELECT origin, requires_review, evidence_json FROM patch WHERE run_id = ? AND origin != 'deterministic'")
      .bind(runId)
      .all<{ origin: string; requires_review: number; evidence_json: string }>();
    expect(patches.results.length).toBeGreaterThanOrEqual(1);
    for (const patch of patches.results) {
      expect(patch.requires_review).toBe(1); // gate (c): structural
      expect(JSON.parse(patch.evidence_json).length).toBeGreaterThanOrEqual(1); // I6
    }
    // Spend attribution exists for every call.
    const calls = await env.concord_db
      .prepare("SELECT COUNT(*) AS n, SUM(cost_usd) AS cost FROM model_call WHERE run_id = ?")
      .bind(runId)
      .first<{ n: number; cost: number }>();
    expect(calls!.n).toBeGreaterThanOrEqual(patches.results.length);
    expect(calls!.cost).toBeGreaterThan(0);
  });

  it("forcing the per-run cap ends the run partial with reason budget_exhausted — remaining impacts stay visible", async () => {
    await seedPreviousSnapshot();
    const runId = await newQueuedRun();
    const deps: RunDeps = { createMessage: async () => stubMessage(), fetchJson: stubFetchJson };
    await executeRun(env, deps, runId, { maxCallsPerRun: 1 });

    const run = await env.concord_db
      .prepare("SELECT status, reason FROM run WHERE id = ?")
      .bind(runId)
      .first<{ status: string; reason: string | null }>();
    expect(run?.status).toBe("partial");
    expect(run?.reason).toBe("budget_exhausted");

    const impacts = await env.concord_db
      .prepare("SELECT disposition, resolution_note FROM impact WHERE run_id = ?")
      .bind(runId)
      .all<{ disposition: string; resolution_note: string | null }>();
    const starved = impacts.results.filter((i) => i.resolution_note === "budget_exhausted");
    expect(starved.length).toBeGreaterThanOrEqual(1);
    for (const impact of starved) expect(impact.disposition).toBe("unresolved"); // visible, not dropped
    // Exactly one call was allowed through.
    const calls = await env.concord_db
      .prepare("SELECT COUNT(*) AS n FROM model_call WHERE run_id = ?")
      .bind(runId)
      .first<{ n: number }>();
    expect(calls!.n).toBe(1);
  });

  it("a model refusal reroutes the impact to EDITORIAL_REVIEW / escalated (nothing dropped)", async () => {
    await seedPreviousSnapshot();
    const runId = await newQueuedRun();
    const deps: RunDeps = {
      fetchJson: stubFetchJson,
      createMessage: async () => ({
        stop_reason: "refusal",
        content: [],
        usage: { input_tokens: 100, output_tokens: 0 },
      }),
    };
    await executeRun(env, deps, runId, {});
    const impacts = await env.concord_db
      .prepare("SELECT action, disposition, resolution_note FROM impact WHERE run_id = ? AND resolution_note = 'model_refusal'")
      .bind(runId)
      .all<{ action: string; disposition: string }>();
    expect(impacts.results.length).toBeGreaterThanOrEqual(1);
    for (const impact of impacts.results) {
      expect(impact.action).toBe("EDITORIAL_REVIEW");
      expect(impact.disposition).toBe("escalated");
    }
  });
});

describe("fan-out bound (G9)", () => {
  it("mapConcurrent never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 17 }, (_, i) => i);
    await mapConcurrent(items, 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // it actually ran concurrently
  });
});
