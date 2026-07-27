// Phase 06: no artifact without complete provenance (invariant I2),
// provenance captured at computation time, lineage chains resolve.
import { env } from "cloudflare:test";
import { visitorClient } from "./client.js";
const vfetch = visitorClient();
import { beforeAll, describe, expect, it } from "vitest";
import type { DatasetRef, KernelResult, OperationId } from "@relay/contracts";
import {
  insertArtifact,
  persistTurnArtifacts,
  retentionExpiry,
  artifactRetentionDays,
  tableToCsv,
} from "../src/artifacts/persist.js";
import { runTurn } from "../src/analysis/turn.js";
import type { MessageLike, MessagesClient } from "../src/analysis/translator.js";
import type { AnalysisKernel, KernelOpResponse } from "../src/kernel/types.js";
import type { FileRow } from "../src/routes/files.js";
import type { Artifact } from "@relay/contracts";

const MOCK_VERSIONS = {
  python: "3.12.99-test",
  pandas: "9.9.9-test",
  numpy: "1.0.0",
  image_digest: "t".repeat(64),
};

function kernelResult(
  operationId: string,
  overrides: Partial<KernelResult> = {},
): KernelResult {
  return {
    operation_id: operationId,
    scalar_result: { matched: 2 },
    tables: [
      {
        name: "rows",
        columns: ["a", "b"],
        rows: [[1, 2], [3, 4]],
        truncated: false,
      },
    ],
    plots: [],
    versions: MOCK_VERSIONS,
    duration_ms: 42,
    ...overrides,
  };
}

class StubKernel implements AnalysisKernel {
  calls: { operationId: OperationId; dataset: DatasetRef; params: unknown }[] = [];
  constructor(private readonly makeResult: (op: OperationId) => KernelResult) {}

  op(
    operationId: OperationId,
    dataset: DatasetRef,
    params: unknown,
  ): Promise<KernelOpResponse> {
    this.calls.push({ operationId, dataset, params });
    return Promise.resolve({ status: 200, body: this.makeResult(operationId) });
  }
  versions(): never {
    throw new Error("unused");
  }
  operations(): never {
    throw new Error("unused");
  }
  health(): never {
    throw new Error("unused");
  }
}

function operationMessage(
  operationId: string,
  params: Record<string, unknown>,
): MessageLike {
  return {
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          kind: "operation",
          operation_id: operationId,
          params_json: JSON.stringify(params),
          rationale: "test",
        }),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function clientFor(...messages: MessageLike[]): MessagesClient {
  let i = 0;
  return {
    create: () =>
      Promise.resolve(messages[Math.min(i++, messages.length - 1)] as MessageLike),
  };
}

let file: FileRow;
let session: { id: string };
let projectId: string;

beforeAll(async () => {
  const projectRes = await vfetch("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "provenance test" }),
  });
  projectId = ((await projectRes.json()) as { id: string }).id;
  const form = new FormData();
  form.set(
    "file",
    new File(["a,b\n1,2\n3,4\n5,6\n"], "prov.csv", { type: "text/csv" }),
  );
  const fileRes = await vfetch(
    `https://example.com/api/projects/${projectId}/files`,
    { method: "POST", body: form },
  );
  file = (await fileRes.json()) as FileRow;
  const sessionRes = await vfetch(
    `https://example.com/api/projects/${projectId}/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.id }),
    },
  );
  session = (await sessionRes.json()) as { id: string };
});

function completeArtifact(): Artifact {
  const now = new Date().toISOString();
  return {
    id: "art_testcomplete0000000000000",
    project_id: projectId,
    kind: "summary_json",
    name: "test",
    r2_key: "artifacts/x/y/test.json",
    byte_size: 2,
    retention_expires_at: null,
    provenance: {
      source_file_id: file.id,
      source_file_sha256: file.sha256,
      operation_id: "summary_statistics",
      params: {},
      params_hash: "a".repeat(64),
      runtime_versions: { pandas: "9.9.9-test" },
      kernel_image_digest: "t".repeat(64),
      session_id: session.id,
      turn_id: "trn_test",
      generated_at: now,
      duration_ms: 1,
      derived_from_artifact_ids: [],
    },
  };
}

describe("invariant I2 — no artifact without complete provenance", () => {
  it("the insert site throws on incomplete provenance (Zod)", async () => {
    const artifact = completeArtifact();
    // Remove a required provenance field.
    delete (artifact.provenance as Record<string, unknown>).runtime_versions;
    await expect(insertArtifact(env, artifact)).rejects.toThrow();
    // Nothing landed.
    const row = await env.relay_db
      .prepare("SELECT id FROM artifact WHERE id = ?")
      .bind(artifact.id)
      .first();
    expect(row).toBeNull();
  });

  it("the SCHEMA also refuses a provenance row with a NULL column", async () => {
    await expect(
      env.relay_db
        .prepare(
          `INSERT INTO artifact_provenance (artifact_id, source_file_id,
           source_file_sha256, operation_id, params_json, params_hash,
           runtime_versions_json, kernel_image_digest, session_id, turn_id,
           generated_at, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .bind(
          "art_testnullcol000000000000",
          "fil_x",
          "b".repeat(64),
          "plot",
          "{}",
          "c".repeat(64),
          "d".repeat(64),
          "ses_x",
          "trn_x",
          new Date().toISOString(),
          1,
        )
        .run(),
    ).rejects.toThrow(/NOT NULL/i);
  });

  it("a valid artifact inserts and reads back complete", async () => {
    const artifact = completeArtifact();
    artifact.id = "art_testvalid00000000000000";
    await insertArtifact(env, artifact);
    const detail = await vfetch(
      `https://example.com/api/artifacts/${artifact.id}`,
    );
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      provenance: { runtime_versions: Record<string, string> };
    };
    expect(body.provenance.runtime_versions).toEqual({ "pandas": "9.9.9-test" });
  });
});

describe("provenance captured at computation time", () => {
  it("runtime_versions equals the mocked kernel response for that turn", async () => {
    const kernel = new StubKernel(() => kernelResult("summary_statistics"));
    const outcome = await runTurn(
      env,
      {
        client: clientFor(operationMessage("summary_statistics", {})),
        kernel,
      },
      session,
      file,
      "summarize",
      "https://example.com",
    );
    expect(outcome.http).toBe(200);
    const artifacts = outcome.body.artifacts as { id: string }[];
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) {
      const row = await env.relay_db
        .prepare(
          "SELECT runtime_versions_json, kernel_image_digest FROM artifact_provenance WHERE artifact_id = ?",
        )
        .bind(artifact.id)
        .first<{ runtime_versions_json: string; kernel_image_digest: string }>();
      // Verbatim MOCK versions — provably not a later /versions lookup.
      expect(JSON.parse(row?.runtime_versions_json ?? "{}")).toEqual(MOCK_VERSIONS);
      expect(row?.kernel_image_digest).toBe(MOCK_VERSIONS.image_digest);
    }
  });
});

describe("lineage — filter → correlate chain", () => {
  it("derived_from_artifact_ids records the link and the endpoint resolves it", async () => {
    const kernel = new StubKernel((op) =>
      op === "filter_rows"
        ? kernelResult("filter_rows")
        : kernelResult("correlation_matrix", {
            tables: [
              {
                name: "correlation",
                columns: ["column", "a", "b"],
                rows: [["a", 1, 0.5], ["b", 0.5, 1]],
                truncated: false,
              },
            ],
          }),
    );

    const first = await runTurn(
      env,
      { client: clientFor(operationMessage("filter_rows", {
        predicates: [{ column: "a", op: "gt", value: 1 }],
      })), kernel },
      session,
      file,
      "rows where a > 1",
      "https://example.com",
    );
    expect(first.http).toBe(200);
    const firstArtifacts = first.body.artifacts as {
      id: string;
      kind: string;
    }[];
    const derivedTable = firstArtifacts.find((a) => a.kind === "table_csv");
    expect(derivedTable).toBeDefined();

    const second = await runTurn(
      env,
      { client: clientFor(operationMessage("correlation_matrix", {})), kernel },
      session,
      file,
      "correlate the filtered rows",
      "https://example.com",
      { id: derivedTable!.id, r2_key: await r2KeyOf(derivedTable!.id) },
    );
    expect(second.http).toBe(200);
    // The kernel received the DERIVED table's key in its capability URL.
    const secondCall = kernel.calls[1];
    expect(secondCall?.dataset.presigned_url).toContain(
      encodeURIComponent(await r2KeyOf(derivedTable!.id)),
    );

    const secondArtifacts = second.body.artifacts as { id: string; kind: string }[];
    for (const artifact of secondArtifacts) {
      const row = await env.relay_db
        .prepare(
          "SELECT derived_from_artifact_ids_json FROM artifact_provenance WHERE artifact_id = ?",
        )
        .bind(artifact.id)
        .first<{ derived_from_artifact_ids_json: string }>();
      expect(JSON.parse(row?.derived_from_artifact_ids_json ?? "[]")).toEqual([
        derivedTable!.id,
      ]);
    }

    // The lineage endpoint resolves the two-step chain.
    const corrTable = secondArtifacts.find((a) => a.kind === "table_csv");
    const lineageRes = await vfetch(
      `https://example.com/api/artifacts/${corrTable!.id}/lineage`,
    );
    expect(lineageRes.status).toBe(200);
    const lineage = (await lineageRes.json()) as {
      artifact: { id: string; provenance: { operation_id: string } };
      derived_from: {
        artifact: { id: string; provenance: { operation_id: string } };
        derived_from: unknown[];
      }[];
    };
    expect(lineage.artifact.id).toBe(corrTable!.id);
    expect(lineage.artifact.provenance.operation_id).toBe("correlation_matrix");
    expect(lineage.derived_from.length).toBe(1);
    expect(lineage.derived_from[0]?.artifact.id).toBe(derivedTable!.id);
    expect(lineage.derived_from[0]?.artifact.provenance.operation_id).toBe(
      "filter_rows",
    );
    expect(lineage.derived_from[0]?.derived_from).toEqual([]);
  });
});

describe("retention derives from the fact", () => {
  it("retention_expires_at moves when retention.artifact.days changes", async () => {
    const generatedAt = "2026-07-26T00:00:00.000Z";
    const at30 = retentionExpiry(generatedAt, 30);
    const at90 = retentionExpiry(generatedAt, 90);
    expect(at30).toBe("2026-08-25T00:00:00.000Z");
    expect(at90).not.toBe(at30);
    expect(
      (new Date(at90).getTime() - new Date(at30).getTime()) / 86_400_000,
    ).toBe(60);
    // The default feeding persistTurnArtifacts IS the T3 fact source value.
    expect(artifactRetentionDays()).toBe(30);

    // End-to-end: persisting with a different fact value shifts the stored expiry.
    const persisted = await persistTurnArtifacts(env, {
      projectId,
      sessionId: session.id,
      turnId: "trn_retentiontest",
      sourceFileId: file.id,
      sourceFileSha256: file.sha256,
      operationId: "summary_statistics",
      params: {},
      result: kernelResult("summary_statistics", { tables: [], scalar_result: { n: 1 } }),
      derivedFromArtifactIds: [],
      retentionDays: 90,
    });
    const row = await env.relay_db
      .prepare("SELECT retention_expires_at, created_at FROM artifact WHERE id = ?")
      .bind(persisted[0]!.id)
      .first<{ retention_expires_at: string; created_at: string }>();
    const days =
      (new Date(row!.retention_expires_at).getTime() -
        new Date(row!.created_at).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(90);
  });
});

describe("csv serialization", () => {
  it("quotes fields containing delimiters and preserves nulls as empty", () => {
    expect(tableToCsv(["a", "b"], [['x,"y', null], [1, "line\nbreak"]])).toBe(
      'a,b\r\n"x,""y",\r\n1,"line\nbreak"',
    );
  });
});

async function r2KeyOf(artifactId: string): Promise<string> {
  const row = await env.relay_db
    .prepare("SELECT r2_key FROM artifact WHERE id = ?")
    .bind(artifactId)
    .first<{ r2_key: string }>();
  return row?.r2_key ?? "";
}
