// Phase 09: seeding twice from EMPTY state produces identical
// ProductTruthSnapshot and identical artifact/provenance rows, modulo
// timestamps and ids.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { seedRelay } from "../src/seed.js";
import { buildProductTruth } from "../src/truth/index.js";

const TABLES = [
  "artifact_provenance",
  "artifact",
  "session_turn",
  "analysis_session",
  "model_call",
  "request_rate",
  "file",
  "project",
];

async function wipe(): Promise<void> {
  for (const table of TABLES) {
    await env.relay_db.prepare(`DELETE FROM ${table}`).run();
  }
  const list = await env.relay_artifacts.list({ limit: 1000 });
  for (const object of list.objects) {
    await env.relay_artifacts.delete(object.key);
  }
}

/** Strips run-varying parts (ids, timestamps, keys embedding ids). */
function normalize(rows: Record<string, unknown>[]): unknown[] {
  const ID_LIKE = /\b(?:prj|fil|ses|trn|art|run)_[0-9a-hjkmnp-tv-z]{26}\b/g;
  const ISO = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;
  return rows.map((row) =>
    JSON.parse(
      JSON.stringify(row).replaceAll(ID_LIKE, "<id>").replaceAll(ISO, "<ts>"),
    ),
  );
}

async function dump(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const table of ["artifact", "artifact_provenance", "file", "project"]) {
    const orderBy =
      table === "artifact" ? "name, kind" : table === "artifact_provenance" ? "operation_id, params_json" : "name";
    const { results } = await env.relay_db
      .prepare(
        `SELECT * FROM ${table} ORDER BY ${table === "artifact_provenance" ? orderBy : orderBy}`,
      )
      .all<Record<string, unknown>>();
    out[table] = normalize(results);
  }
  const snapshot = await buildProductTruth(env);
  out.snapshot = JSON.parse(
    JSON.stringify({ ...snapshot, snapshot_id: "<id>", generated_at: "<ts>" })
      .replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>"),
  );
  return out;
}

describe("pnpm seed:relay determinism", () => {
  it("two seeds from empty produce identical normalized state", async () => {
    await wipe();
    const first = await seedRelay(env);
    expect(first).toEqual({ projects: 3, files: 5, sessions: 4, turns: 5, artifacts: 12 });
    const dumpOne = await dump();

    await wipe();
    const second = await seedRelay(env);
    expect(second).toEqual(first);
    const dumpTwo = await dump();

    expect(JSON.stringify(dumpTwo)).toBe(JSON.stringify(dumpOne));

    // The chain is present: exactly one artifact derives from another.
    const provenance = dumpTwo.artifact_provenance as {
      derived_from_artifact_ids_json: string;
    }[];
    const chained = provenance.filter(
      (p) => p.derived_from_artifact_ids_json !== "[]",
    );
    expect(chained.length).toBe(3); // all 3 artifacts of the chained turn
  });
});
