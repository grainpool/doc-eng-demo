import { Hono } from "hono";
import { apiError, newId } from "@relay/contracts";
import {
  LIMIT_UPLOAD_CSV_MAX_BYTES,
  SUPPORTED_FILE_TYPES,
} from "../limits.js";
import { scanDelimitedStream } from "../csv-scan.js";
import { READ_SCOPE_JOIN_SQL, projectForWrite } from "../workspace.js";
import type { Env } from "../env.js";

type Variables = { requestId: string; visitorId: string };

export interface FileRow {
  id: string;
  project_id: string;
  name: string;
  r2_key: string;
  sha256: string;
  byte_size: number;
  mime: string;
  column_count: number | null;
  row_count: number | null;
  created_at: string;
}

const FILE_COLUMNS =
  "id, project_id, name, r2_key, sha256, byte_size, mime, column_count, row_count, created_at";

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload";
}

export const files = new Hono<{ Bindings: Env; Variables: Variables }>();

// POST /api/projects/:id/files — the ONLY place upload limits are enforced,
// reading the constants that are simultaneously the T1 fact source (limits.ts).
files.post("/projects/:id/files", async (c) => {
  const projectId = c.req.param("id");
  const access = await projectForWrite(c.env.relay_db, projectId, c.get("visitorId"));
  if (access.kind === "seed_read_only") {
    return c.json(apiError("SEED_READ_ONLY", "error.workspace.seed_read_only"), 403);
  }
  if (access.kind === "archived") {
    return c.json(apiError("PROJECT_ARCHIVED", "error.project.archived"), 409);
  }
  if (access.kind !== "ok") {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }

  // Early reject on declared size before touching the body (multipart adds
  // overhead, so this is a coarse gate; the exact check is on file.size).
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > LIMIT_UPLOAD_CSV_MAX_BYTES + 64 * 1024) {
    return c.json(
      apiError("FILE_TOO_LARGE", "error.upload.too_large", undefined, "file"),
      413,
    );
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return c.json(
      apiError("VALIDATION_FAILED", "error.upload.missing_file", undefined, "file"),
      422,
    );
  }

  const filename = sanitizeFilename(file.name);
  const extension = filename.includes(".")
    ? (filename.split(".").pop() ?? "").toLowerCase()
    : "";
  const supported =
    (SUPPORTED_FILE_TYPES as Record<string, boolean>)[extension] === true;
  if (!supported) {
    return c.json(
      apiError("UNSUPPORTED_FILE_TYPE", "error.upload.unsupported_type", undefined, "file"),
      415,
    );
  }

  if (file.size > LIMIT_UPLOAD_CSV_MAX_BYTES) {
    return c.json(
      apiError("FILE_TOO_LARGE", "error.upload.too_large", undefined, "file"),
      413,
    );
  }

  const fileId = newId("fil");
  const r2Key = `files/${projectId}/${fileId}/${filename}`;
  const delimiter = extension === "tsv" ? "\t" : ",";

  // Two concurrent readers over the same Blob: one hashes + counts in a
  // single streaming pass, the other streams the bytes to R2.
  const [scan] = await Promise.all([
    scanDelimitedStream(file.stream(), delimiter),
    c.env.relay_artifacts.put(r2Key, file),
  ]);

  const row: FileRow = {
    id: fileId,
    project_id: projectId,
    name: filename,
    r2_key: r2Key,
    sha256: scan.sha256,
    byte_size: scan.byte_size,
    mime: extension === "tsv" ? "text/tab-separated-values" : "text/csv",
    column_count: scan.column_count,
    row_count: scan.row_count,
    created_at: new Date().toISOString(),
  };
  await c.env.relay_db
    .prepare(
      `INSERT INTO file (${FILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.project_id,
      row.name,
      row.r2_key,
      row.sha256,
      row.byte_size,
      row.mime,
      row.column_count,
      row.row_count,
      row.created_at,
    )
    .run();
  return c.json(row, 201);
});

const FILE_JOIN_COLUMNS = FILE_COLUMNS.split(", ")
  .map((col) => `f.${col}`)
  .join(", ");

files.get("/projects/:id/files", async (c) => {
  const { results } = await c.env.relay_db
    .prepare(
      `SELECT ${FILE_JOIN_COLUMNS} FROM file f JOIN project p ON p.id = f.project_id
       WHERE f.project_id = ? AND ${READ_SCOPE_JOIN_SQL} ORDER BY f.created_at DESC`,
    )
    .bind(c.req.param("id"), c.get("visitorId"))
    .all<FileRow>();
  return c.json({ files: results });
});

async function scopedFile(c: { env: Env }, fileId: string, visitorId: string) {
  return c.env.relay_db
    .prepare(
      `SELECT ${FILE_JOIN_COLUMNS} FROM file f JOIN project p ON p.id = f.project_id
       WHERE f.id = ? AND ${READ_SCOPE_JOIN_SQL}`,
    )
    .bind(fileId, visitorId)
    .first<FileRow>();
}

files.get("/files/:id", async (c) => {
  const row = await scopedFile(c, c.req.param("id"), c.get("visitorId"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(row);
});

// GET /api/files/:id/download — the uploaded bytes back out (Phase 2).
files.get("/files/:id/download", async (c) => {
  const row = await scopedFile(c, c.req.param("id"), c.get("visitorId"));
  if (!row) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const object = await c.env.relay_artifacts.get(row.r2_key);
  if (!object) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return new Response(object.body, {
    headers: {
      "content-type": row.mime,
      "content-disposition": `attachment; filename="${row.name}"`,
      "content-length": String(object.size),
    },
  });
});

// DELETE /api/files/:id — blocked while a session references the file
// (RESOURCE_IN_USE is more honest than nulling provenance sources).
files.delete("/files/:id", async (c) => {
  const row = await c.env.relay_db
    .prepare(
      `SELECT f.id, f.project_id, f.r2_key FROM file f WHERE f.id = ?`,
    )
    .bind(c.req.param("id"))
    .first<{ id: string; project_id: string; r2_key: string }>();
  if (!row) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const access = await projectForWrite(
    c.env.relay_db,
    row.project_id,
    c.get("visitorId"),
    { requireActive: false },
  );
  if (access.kind === "seed_read_only") {
    return c.json(apiError("SEED_READ_ONLY", "error.workspace.seed_read_only"), 403);
  }
  if (access.kind !== "ok") {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const inUse = await c.env.relay_db
    .prepare("SELECT COUNT(*) AS n FROM analysis_session WHERE file_id = ?")
    .bind(row.id)
    .first<{ n: number }>();
  if ((inUse?.n ?? 0) > 0) {
    return c.json(apiError("RESOURCE_IN_USE", "error.file.in_use"), 409);
  }
  await c.env.relay_db.prepare("DELETE FROM file WHERE id = ?").bind(row.id).run();
  await c.env.relay_artifacts.delete(row.r2_key);
  return c.json({ deleted: true });
});
