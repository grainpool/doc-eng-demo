import { Hono } from "hono";
import { apiError } from "@relay/contracts";
import type { Env } from "../env.js";

export interface ArtifactRow {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  r2_key: string;
  byte_size: number;
  retention_expires_at: string | null;
  created_at: string;
}

export interface ProvenanceRow {
  artifact_id: string;
  source_file_id: string;
  source_file_sha256: string;
  operation_id: string;
  params_json: string;
  params_hash: string;
  runtime_versions_json: string;
  kernel_image_digest: string;
  session_id: string;
  turn_id: string;
  generated_at: string;
  duration_ms: number;
  derived_from_artifact_ids_json: string;
}

const ARTIFACT_COLUMNS =
  "id, project_id, kind, name, r2_key, byte_size, retention_expires_at, created_at";

function toDetail(artifact: ArtifactRow, prov: ProvenanceRow) {
  return {
    id: artifact.id,
    project_id: artifact.project_id,
    kind: artifact.kind,
    name: artifact.name,
    byte_size: artifact.byte_size,
    retention_expires_at: artifact.retention_expires_at,
    created_at: artifact.created_at,
    provenance: {
      source_file_id: prov.source_file_id,
      source_file_sha256: prov.source_file_sha256,
      operation_id: prov.operation_id,
      params: JSON.parse(prov.params_json) as Record<string, unknown>,
      params_hash: prov.params_hash,
      runtime_versions: JSON.parse(prov.runtime_versions_json) as Record<string, string>,
      kernel_image_digest: prov.kernel_image_digest,
      session_id: prov.session_id,
      turn_id: prov.turn_id,
      generated_at: prov.generated_at,
      duration_ms: prov.duration_ms,
      derived_from_artifact_ids: JSON.parse(
        prov.derived_from_artifact_ids_json,
      ) as string[],
    },
  };
}

async function loadDetail(env: Env, id: string) {
  const artifact = await env.relay_db
    .prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifact WHERE id = ?`)
    .bind(id)
    .first<ArtifactRow>();
  if (!artifact) return null;
  const prov = await env.relay_db
    .prepare("SELECT * FROM artifact_provenance WHERE artifact_id = ?")
    .bind(id)
    .first<ProvenanceRow>();
  if (!prov) return null; // impossible by construction (I2); still no lie
  return toDetail(artifact, prov);
}

export const artifacts = new Hono<{ Bindings: Env }>();

artifacts.get("/projects/:id/artifacts", async (c) => {
  const { results } = await c.env.relay_db
    .prepare(
      `SELECT ${ARTIFACT_COLUMNS} FROM artifact WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .bind(c.req.param("id"))
    .all<ArtifactRow>();
  return c.json({ artifacts: results });
});

artifacts.get("/artifacts/:id", async (c) => {
  const detail = await loadDetail(c.env, c.req.param("id"));
  if (!detail) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(detail);
});

const CONTENT_TYPES: Record<string, string> = {
  plot: "image/png",
  table_csv: "text/csv",
  summary_json: "application/json",
  operation_record: "application/json",
};

artifacts.get("/artifacts/:id/download", async (c) => {
  const artifact = await c.env.relay_db
    .prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifact WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<ArtifactRow>();
  if (!artifact) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const object = await c.env.relay_artifacts.get(artifact.r2_key);
  if (!object) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const filename = artifact.r2_key.split("/").pop() ?? artifact.name;
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[artifact.kind] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(object.size),
    },
  });
});

/** Lineage: walk derived_from_artifact_ids up the chain (depth-capped). */
artifacts.get("/artifacts/:id/lineage", async (c) => {
  interface LineageNode {
    artifact: NonNullable<Awaited<ReturnType<typeof loadDetail>>>;
    derived_from: LineageNode[];
  }
  const seen = new Set<string>();
  const walk = async (id: string, depth: number): Promise<LineageNode | null> => {
    if (depth > 10 || seen.has(id)) return null;
    seen.add(id);
    const detail = await loadDetail(c.env, id);
    if (!detail) return null;
    const parents: LineageNode[] = [];
    for (const parentId of detail.provenance.derived_from_artifact_ids) {
      const node = await walk(parentId, depth + 1);
      if (node) parents.push(node);
    }
    return { artifact: detail, derived_from: parents };
  };
  const root = await walk(c.req.param("id"), 0);
  if (!root) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(root);
});
