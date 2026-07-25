import { Hono } from "hono";
import { z } from "zod";
import { apiError, newId } from "@relay/contracts";
import type { Env } from "../env.js";

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  state: "active" | "archived";
  created_at: string;
  updated_at: string;
}

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const projects = new Hono<{ Bindings: Env }>();

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
      "INSERT INTO project (id, name, description, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.name, row.description, row.state, row.created_at, row.updated_at)
    .run();
  return c.json(row, 201);
});

projects.get("/", async (c) => {
  const { results } = await c.env.relay_db
    .prepare(
      "SELECT id, name, description, state, created_at, updated_at FROM project ORDER BY created_at DESC",
    )
    .all<ProjectRow>();
  return c.json({ projects: results });
});

projects.get("/:id", async (c) => {
  const row = await c.env.relay_db
    .prepare(
      "SELECT id, name, description, state, created_at, updated_at FROM project WHERE id = ?",
    )
    .bind(c.req.param("id"))
    .first<ProjectRow>();
  if (!row) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(row);
});
