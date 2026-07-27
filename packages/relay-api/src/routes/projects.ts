import { Hono, type Context } from "hono";
import { z } from "zod";
import { apiError, newId } from "@relay/contracts";
import {
  READ_SCOPE_SQL,
  projectForWrite,
} from "../workspace.js";
import { log } from "../log.js";
import type { Env } from "../env.js";

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  state: "active" | "archived";
  created_at: string;
  updated_at: string;
}

type Variables = { requestId: string; visitorId: string };

const PROJECT_COLUMNS = "id, name, description, state, created_at, updated_at";

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

const PatchProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "nothing to update",
  });

/** Uniform mapping from a projectForWrite refusal to the HTTP response. */
function accessError(
  kind: "not_found" | "seed_read_only" | "archived",
): { http: 403 | 404 | 409; body: ReturnType<typeof apiError> } {
  if (kind === "seed_read_only") {
    return { http: 403, body: apiError("SEED_READ_ONLY", "error.workspace.seed_read_only") };
  }
  if (kind === "archived") {
    return { http: 409, body: apiError("PROJECT_ARCHIVED", "error.project.archived") };
  }
  return { http: 404, body: apiError("NOT_FOUND", "error.generic.not_found") };
}

export const projects = new Hono<{ Bindings: Env; Variables: Variables }>();

projects.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "name";
    return c.json(
      apiError("VALIDATION_FAILED", "error.validation.required_field", undefined, field),
      422,
    );
  }
  const now = new Date().toISOString();
  const row: ProjectRow = {
    id: newId("prj"),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    state: "active",
    created_at: now,
    updated_at: now,
  };
  await c.env.relay_db
    .prepare(
      "INSERT INTO project (id, name, description, state, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id,
      row.name,
      row.description,
      row.state,
      c.get("visitorId"),
      row.created_at,
      row.updated_at,
    )
    .run();
  return c.json(row, 201);
});

projects.get("/", async (c) => {
  const { results } = await c.env.relay_db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM project WHERE ${READ_SCOPE_SQL} ORDER BY created_at DESC`,
    )
    .bind(c.get("visitorId"))
    .all<ProjectRow>();
  return c.json({ projects: results });
});

projects.get("/:id", async (c) => {
  const row = await c.env.relay_db
    .prepare(
      `SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ? AND ${READ_SCOPE_SQL}`,
    )
    .bind(c.req.param("id"), c.get("visitorId"))
    .first<ProjectRow>();
  if (!row) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(row);
});

projects.patch("/:id", async (c) => {
  const access = await projectForWrite(c.env.relay_db, c.req.param("id"), c.get("visitorId"));
  if (access.kind !== "ok") {
    const { http, body } = accessError(access.kind);
    return c.json(body, http);
  }
  const parsed = PatchProjectSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      apiError("VALIDATION_FAILED", "error.validation.required_field", undefined, "name"),
      422,
    );
  }
  const current = await c.env.relay_db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ?`)
    .bind(access.project.id)
    .first<ProjectRow>();
  const next = {
    name: parsed.data.name ?? current!.name,
    description:
      parsed.data.description !== undefined ? parsed.data.description : current!.description,
    updated_at: new Date().toISOString(),
  };
  await c.env.relay_db
    .prepare("UPDATE project SET name = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(next.name, next.description, next.updated_at, access.project.id)
    .run();
  return c.json({ ...current!, ...next });
});

async function setState(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  projectId: string,
  state: "active" | "archived",
) {
  const access = await projectForWrite(
    c.env.relay_db,
    projectId,
    c.get("visitorId"),
    { requireActive: false }, // unarchive must reach archived projects
  );
  if (access.kind !== "ok") {
    const { http, body } = accessError(access.kind as "not_found" | "seed_read_only");
    return c.json(body, http);
  }
  const updatedAt = new Date().toISOString();
  await c.env.relay_db
    .prepare("UPDATE project SET state = ?, updated_at = ? WHERE id = ?")
    .bind(state, updatedAt, access.project.id)
    .run();
  const row = await c.env.relay_db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ?`)
    .bind(access.project.id)
    .first<ProjectRow>();
  return c.json(row);
}

projects.post("/:id/archive", (c) => setState(c, c.req.param("id"), "archived"));
projects.post("/:id/unarchive", (c) => setState(c, c.req.param("id"), "active"));

/**
 * Cascade delete (expansion architecture.md §4): every child row and R2
 * object goes with the project. D1 rows first (batched, FK-safe order), R2
 * after — a failed R2 delete logs `r2_orphan` with the keys rather than
 * leaving a half-deleted database.
 */
projects.delete("/:id", async (c) => {
  const access = await projectForWrite(
    c.env.relay_db,
    c.req.param("id"),
    c.get("visitorId"),
    { requireActive: false }, // archived projects can be deleted
  );
  if (access.kind !== "ok") {
    const { http, body } = accessError(access.kind as "not_found" | "seed_read_only");
    return c.json(body, http);
  }
  const id = access.project.id;
  const db = c.env.relay_db;

  const keyRows = await db
    .prepare(
      `SELECT r2_key FROM file WHERE project_id = ?1
       UNION ALL SELECT r2_key FROM artifact WHERE project_id = ?1
       UNION ALL SELECT st.result_r2_key FROM session_turn st
         JOIN analysis_session s ON s.id = st.session_id
         WHERE s.project_id = ?1 AND st.result_r2_key IS NOT NULL`,
    )
    .bind(id)
    .all<{ r2_key: string }>();
  const r2Keys = keyRows.results.map((r) => r.r2_key);

  const counts = await db.batch([
    db.prepare(
      "DELETE FROM conversation_message WHERE conversation_id IN (SELECT id FROM conversation WHERE project_id = ?)",
    ).bind(id),
    db.prepare("DELETE FROM conversation WHERE project_id = ?").bind(id),
    db.prepare(
      "DELETE FROM artifact_provenance WHERE artifact_id IN (SELECT id FROM artifact WHERE project_id = ?)",
    ).bind(id),
    db.prepare("DELETE FROM artifact WHERE project_id = ?").bind(id),
    db.prepare(
      "DELETE FROM session_turn WHERE session_id IN (SELECT id FROM analysis_session WHERE project_id = ?)",
    ).bind(id),
    db.prepare("DELETE FROM analysis_session WHERE project_id = ?").bind(id),
    db.prepare("DELETE FROM file WHERE project_id = ?").bind(id),
    db.prepare("DELETE FROM project WHERE id = ?").bind(id),
  ]);

  if (r2Keys.length > 0) {
    try {
      // R2 delete accepts up to 1000 keys per call; chunk defensively.
      for (let i = 0; i < r2Keys.length; i += 1000) {
        await c.env.relay_artifacts.delete(r2Keys.slice(i, i + 1000));
      }
    } catch {
      log("r2_orphan", { request_id: c.get("requestId"), project_id: id, keys: r2Keys });
    }
  }

  return c.json({
    deleted: true,
    counts: {
      conversations: counts[1]?.meta.changes ?? 0,
      artifacts: counts[3]?.meta.changes ?? 0,
      sessions: counts[5]?.meta.changes ?? 0,
      files: counts[6]?.meta.changes ?? 0,
      r2_objects: r2Keys.length,
    },
  });
});
