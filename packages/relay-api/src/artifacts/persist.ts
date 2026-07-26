import {
  ArtifactSchema,
  PRODUCT_CONFIG,
  newId,
  type Artifact,
  type KernelResult,
  type OperationId,
  type Provenance,
} from "@relay/contracts";
import type { Env } from "../env.js";

/**
 * Artifact persistence (contracts.md §6). Everything a completed turn
 * produced becomes a durable artifact with COMPLETE provenance captured at
 * computation time: runtime_versions and kernel_image_digest come verbatim
 * from the KernelResult that produced the numbers — never re-queried
 * (constraints.md AP4).
 */

/** The retention FACT (T3) drives the displayed expiry. Deletion is NOT
 *  implemented on purpose — the fact and the display are the product. */
export function artifactRetentionDays(): number {
  return PRODUCT_CONFIG.retention.artifact_days;
}

export function retentionExpiry(generatedAt: string, days: number): string {
  return new Date(
    new Date(generatedAt).getTime() + days * 86_400_000,
  ).toISOString();
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** RFC-4180 CSV for derived tables: quote when a field needs it. */
export function tableToCsv(columns: string[], rows: unknown[][]): string {
  const field = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    columns.map(field).join(","),
    ...rows.map((row) => row.map(field).join(",")),
  ].join("\r\n");
}

/**
 * THE single insert site (invariant I2): the full Artifact — provenance
 * included — is Zod-parsed before any row is written, and the two rows are
 * written in one D1 batch so an artifact row can never land without its
 * provenance row. Throws on anything incomplete.
 */
export async function insertArtifact(env: Env, artifact: Artifact): Promise<void> {
  const parsed = ArtifactSchema.parse(artifact);
  const p = parsed.provenance;
  await env.relay_db.batch([
    env.relay_db
      .prepare(
        `INSERT INTO artifact (id, project_id, kind, name, r2_key, byte_size,
         retention_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        parsed.id,
        parsed.project_id,
        parsed.kind,
        parsed.name,
        parsed.r2_key,
        parsed.byte_size,
        parsed.retention_expires_at,
        p.generated_at,
      ),
    env.relay_db
      .prepare(
        `INSERT INTO artifact_provenance (artifact_id, source_file_id,
         source_file_sha256, operation_id, params_json, params_hash,
         runtime_versions_json, kernel_image_digest, session_id, turn_id,
         generated_at, duration_ms, derived_from_artifact_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        parsed.id,
        p.source_file_id,
        p.source_file_sha256,
        p.operation_id,
        JSON.stringify(p.params),
        p.params_hash,
        JSON.stringify(p.runtime_versions),
        p.kernel_image_digest,
        p.session_id,
        p.turn_id,
        p.generated_at,
        p.duration_ms,
        JSON.stringify(p.derived_from_artifact_ids),
      ),
  ]);
}

export interface TurnArtifactContext {
  projectId: string;
  sessionId: string;
  turnId: string;
  sourceFileId: string;
  sourceFileSha256: string;
  operationId: OperationId;
  params: Record<string, unknown>;
  result: KernelResult;
  derivedFromArtifactIds: string[];
  /** Injectable for the retention test; defaults to the T3 fact source. */
  retentionDays?: number;
}

export interface PersistedArtifact {
  id: string;
  kind: Artifact["kind"];
  name: string;
}

export async function persistTurnArtifacts(
  env: Env,
  ctx: TurnArtifactContext,
): Promise<PersistedArtifact[]> {
  const generatedAt = new Date().toISOString();
  const days = ctx.retentionDays ?? artifactRetentionDays();
  const expiresAt = retentionExpiry(generatedAt, days);
  const provenance: Provenance = {
    source_file_id: ctx.sourceFileId,
    source_file_sha256: ctx.sourceFileSha256,
    operation_id: ctx.operationId,
    params: ctx.params,
    params_hash: await sha256Hex(JSON.stringify(ctx.params)),
    // Verbatim from THIS turn's KernelResult — the same response that
    // produced the numbers (AP4). image_digest travels inside versions.
    runtime_versions: ctx.result.versions,
    kernel_image_digest: ctx.result.versions.image_digest ?? "unknown",
    session_id: ctx.sessionId,
    turn_id: ctx.turnId,
    generated_at: generatedAt,
    duration_ms: ctx.result.duration_ms,
    derived_from_artifact_ids: ctx.derivedFromArtifactIds,
  };

  const persisted: PersistedArtifact[] = [];
  const store = async (
    kind: Artifact["kind"],
    name: string,
    body: string | Uint8Array,
    contentType: string,
    extension: string,
  ): Promise<void> => {
    const id = newId("art");
    const r2Key = `artifacts/${ctx.projectId}/${id}/${name}.${extension}`;
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : body;
    await env.relay_artifacts.put(r2Key, bytes, {
      httpMetadata: { contentType },
    });
    await insertArtifact(env, {
      id,
      project_id: ctx.projectId,
      kind,
      name,
      r2_key: r2Key,
      byte_size: bytes.byteLength,
      provenance,
      retention_expires_at: expiresAt,
    });
    persisted.push({ id, kind, name });
  };

  // The recorded operation definition — what ran, NOT generated code.
  await store(
    "operation_record",
    `${ctx.operationId}_record`,
    JSON.stringify(
      { operation_id: ctx.operationId, params: ctx.params },
      null,
      2,
    ),
    "application/json",
    "json",
  );
  if (ctx.result.scalar_result !== null) {
    await store(
      "summary_json",
      `${ctx.operationId}_summary`,
      JSON.stringify(ctx.result.scalar_result, null, 2),
      "application/json",
      "json",
    );
  }
  for (const table of ctx.result.tables) {
    await store(
      "table_csv",
      table.name,
      tableToCsv(table.columns, table.rows),
      "text/csv",
      "csv",
    );
  }
  for (const plot of ctx.result.plots) {
    const binary = Uint8Array.from(atob(plot.base64), (c) => c.charCodeAt(0));
    await store("plot", plot.name, binary, plot.mime, "png");
  }
  return persisted;
}
