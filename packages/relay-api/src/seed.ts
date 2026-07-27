import { newId, type KernelResult } from "@relay/contracts";
import { scanDelimitedStream } from "./csv-scan.js";
import { persistTurnArtifacts } from "./artifacts/persist.js";
import type { Env } from "./env.js";

/**
 * Phase 09 seed (`pnpm seed:relay`): byte-identical state from an EMPTY
 * D1 + R2 — 3 projects, 5 files (one deliberately awkward), 4 sessions
 * covering five operations, ~12 artifacts including one two-step lineage
 * chain. Deterministic BY CONSTRUCTION: no model call, no kernel call — the
 * turns replay fixed KernelResults committed below, flagged by the seed
 * versions marker. Ids and timestamps vary per run; everything else is
 * fixed (asserted by seed-determinism.test.ts).
 */

const SEED_VERSIONS: Record<string, string> = {
  python: "3.12.13",
  pandas: "3.0.5",
  numpy: "2.5.1",
  scipy: "1.18.0",
  statsmodels: "0.14.6",
  matplotlib: "3.11.1",
  image_digest: "seed0000000000000000000000000000000000000000000000000000000000000",
  seeded: "true",
};

const FILES: { project: number; name: string; content: string }[] = [
  {
    project: 0,
    name: "sales.csv",
    content:
      "region,units,price,score\nA,10,2.5,60.0\nA,12,2.7,64.1\nB,9,3.1,59.3\nB,14,3.4,71.2\nA,11,2.6,62.8\nB,13,3.3,69.9\n",
  },
  {
    project: 0,
    name: "customers.csv",
    content: "id,plan,seats\n1,free,2\n2,team,14\n3,free,1\n4,team,9\n",
  },
  {
    project: 1,
    name: "sensors.tsv",
    content: "ts\ttemp\thum\n2026-01-01\t21.5\t40\n2026-01-02\t22.1\t42\n2026-01-03\t20.9\t39\n",
  },
  {
    // The deliberately awkward one: BOM, CRLF, duplicate + quoted headers,
    // a column named like a pandas method, embedded commas and quotes.
    project: 1,
    name: "awkward.csv",
    content:
      '﻿"name",mean,"name",note\r\n"Ada, L",1,x,"said ""hi"""\r\nGrace,2,y,plain\r\n',
  },
  {
    project: 2,
    name: "trials.csv",
    content:
      "arm,outcome,n\ncontrol,12.1,30\ncontrol,11.8,30\ntreat,14.2,30\ntreat,13.9,30\n",
  },
];

function result(
  operationId: string,
  partial: Partial<KernelResult>,
): KernelResult {
  return {
    operation_id: operationId,
    scalar_result: null,
    tables: [],
    plots: [],
    versions: SEED_VERSIONS,
    duration_ms: 10,
    ...partial,
  };
}

const FILTER_TABLE = {
  name: "rows",
  columns: ["region", "units", "price", "score"],
  rows: [
    ["A", 10, 2.5, 60.0],
    ["A", 12, 2.7, 64.1],
    ["A", 11, 2.6, 62.8],
  ],
  truncated: false,
};

interface SeedTurn {
  session: number;
  prompt: string;
  operationId: string;
  params: Record<string, unknown>;
  result: KernelResult;
  /** index into previously produced table_csv artifacts for chaining */
  chainFromTurn?: number;
}

const TURNS: SeedTurn[] = [
  {
    session: 0,
    prompt: "what does this data look like?",
    operationId: "inspect_schema",
    params: { head_rows: 5 },
    result: result("inspect_schema", {
      tables: [
        {
          name: "schema",
          columns: ["column", "dtype", "null_count", "cardinality"],
          rows: [
            ["region", "str", 0, 2],
            ["units", "int64", 0, 6],
            ["price", "float64", 0, 6],
            ["score", "float64", 0, 6],
          ],
          truncated: false,
        },
      ],
    }),
  },
  {
    session: 0,
    prompt: "show only region A",
    operationId: "filter_rows",
    params: { predicates: [{ column: "region", op: "eq", value: "A" }], combine: "and", limit: 1000 },
    result: result("filter_rows", {
      scalar_result: { matched: 3, returned: 3 },
      tables: [FILTER_TABLE],
    }),
  },
  {
    // Two-step lineage chain: correlate the region-A table from the turn above.
    session: 0,
    prompt: "correlate the numeric columns of that result",
    operationId: "correlation_matrix",
    params: { method: "pearson" },
    chainFromTurn: 1,
    result: result("correlation_matrix", {
      scalar_result: { method: "pearson", columns: 3 },
      tables: [
        {
          name: "correlation",
          columns: ["column", "units", "price", "score"],
          rows: [
            ["units", 1, 0.982, 0.997],
            ["price", 0.982, 1, 0.993],
            ["score", 0.997, 0.993, 1],
          ],
          truncated: false,
        },
      ],
    }),
  },
  {
    session: 1,
    prompt: "summarize seats by plan",
    operationId: "group_aggregate",
    params: { group_by: ["plan"], aggregations: [{ column: "seats", agg: "sum" }] },
    result: result("group_aggregate", {
      tables: [
        {
          name: "groups",
          columns: ["plan", "seats_sum"],
          rows: [["free", 3], ["team", 23]],
          truncated: false,
        },
      ],
    }),
  },
  {
    session: 3,
    prompt: "summary statistics for the outcome",
    operationId: "summary_statistics",
    params: { columns: ["outcome"] },
    result: result("summary_statistics", {
      tables: [
        {
          name: "summary",
          columns: ["statistic", "outcome"],
          rows: [["count", 4], ["mean", 13.0], ["std", 1.2], ["min", 11.8], ["max", 14.2]],
          truncated: false,
        },
      ],
    }),
  },
];

const SESSIONS: { project: number; file: number; title: string }[] = [
  { project: 0, file: 0, title: "sales analysis" },
  { project: 0, file: 1, title: "customer plans" },
  { project: 1, file: 2, title: "sensor review" },
  { project: 2, file: 4, title: "trial outcomes" },
];

export interface SeedReport {
  projects: number;
  files: number;
  sessions: number;
  turns: number;
  artifacts: number;
}

export async function seedRelay(env: Env): Promise<SeedReport> {
  const now = () => new Date().toISOString();

  const projectIds: string[] = [];
  for (const name of ["Quarterly Sales", "Operations", "Research Trials"]) {
    const id = newId("prj");
    projectIds.push(id);
    await env.relay_db
      .prepare(
        // Seeded demo content is owned by the reserved 'seed' workspace:
        // globally readable, immutable through the API (workspace.ts).
        "INSERT INTO project (id, name, state, owner_id, created_at, updated_at) VALUES (?, ?, 'active', 'seed', ?, ?)",
      )
      .bind(id, name, now(), now())
      .run();
  }

  const fileIds: string[] = [];
  const fileShas: string[] = [];
  for (const file of FILES) {
    const id = newId("fil");
    fileIds.push(id);
    const projectId = projectIds[file.project] as string;
    const key = `files/${projectId}/${id}/${file.name}`;
    const bytes = new TextEncoder().encode(file.content);
    await env.relay_artifacts.put(key, bytes);
    const delimiter = file.name.endsWith(".tsv") ? "\t" : ",";
    const scan = await scanDelimitedStream(
      new Blob([bytes]).stream(),
      delimiter,
    );
    fileShas.push(scan.sha256);
    await env.relay_db
      .prepare(
        `INSERT INTO file (id, project_id, name, r2_key, sha256, byte_size, mime,
         column_count, row_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        projectId,
        file.name,
        key,
        scan.sha256,
        scan.byte_size,
        delimiter === "\t" ? "text/tab-separated-values" : "text/csv",
        scan.column_count,
        scan.row_count,
        now(),
      )
      .run();
  }

  const sessionIds: string[] = [];
  for (const session of SESSIONS) {
    const id = newId("ses");
    sessionIds.push(id);
    await env.relay_db
      .prepare(
        "INSERT INTO analysis_session (id, project_id, file_id, title, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, projectIds[session.project], fileIds[session.file], session.title, now())
      .run();
  }

  let artifactCount = 0;
  const turnTableArtifacts: (string | null)[] = [];
  for (const turn of TURNS) {
    const session = SESSIONS[turn.session] as (typeof SESSIONS)[number];
    const sessionId = sessionIds[turn.session] as string;
    const fileIndex = session.file;
    const turnId = newId("trn");
    const resultKey = `sessions/${sessionId}/turns/${turnId}/result.json`;
    await env.relay_artifacts.put(resultKey, JSON.stringify(turn.result));
    await env.relay_db
      .prepare(
        `INSERT INTO session_turn (id, session_id, prompt, operation_id, params_json,
         status, created_at, completed_at, result_r2_key)
         VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      )
      .bind(
        turnId,
        sessionId,
        turn.prompt,
        turn.operationId,
        JSON.stringify(turn.params),
        now(),
        now(),
        resultKey,
      )
      .run();
    const derivedFrom =
      turn.chainFromTurn !== undefined
        ? [turnTableArtifacts[turn.chainFromTurn] as string]
        : [];
    const persisted = await persistTurnArtifacts(env, {
      projectId: projectIds[session.project] as string,
      sessionId,
      turnId,
      sourceFileId: fileIds[fileIndex] as string,
      sourceFileSha256: fileShas[fileIndex] as string,
      operationId: turn.operationId as never,
      params: turn.params,
      result: turn.result,
      derivedFromArtifactIds: derivedFrom,
    });
    artifactCount += persisted.length;
    turnTableArtifacts.push(
      persisted.find((a) => a.kind === "table_csv")?.id ?? null,
    );
  }

  return {
    projects: projectIds.length,
    files: fileIds.length,
    sessions: sessionIds.length,
    turns: TURNS.length,
    artifacts: artifactCount,
  };
}
