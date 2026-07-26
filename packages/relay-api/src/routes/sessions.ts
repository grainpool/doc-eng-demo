import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { apiError, newId, KernelResultSchema } from "@relay/contracts";
import { containerKernel } from "../kernel/container-kernel.js";
import { datasetPreview } from "../analysis/dataset-preview.js";
import { runTurn } from "../analysis/turn.js";
import { narrateResult } from "../analysis/narration.js";
import { guardModelCall } from "../analysis/limits-guard.js";
import type { MessagesClient } from "../analysis/translator.js";
import type { Env } from "../env.js";
import type { FileRow } from "./files.js";

export interface SessionRow {
  id: string;
  project_id: string;
  file_id: string | null;
  title: string;
  created_at: string;
}

export interface TurnListRow {
  id: string;
  session_id: string;
  prompt: string;
  operation_id: string | null;
  params_json: string | null;
  status: string;
  error_code: string | null;
  result_r2_key: string | null;
  created_at: string;
  completed_at: string | null;
}

const SESSION_COLUMNS = "id, project_id, file_id, title, created_at";
const TURN_COLUMNS =
  "id, session_id, prompt, operation_id, params_json, status, error_code, result_r2_key, created_at, completed_at";

function messagesClient(env: Env): MessagesClient | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return {
    create: (params) =>
      anthropic.messages.create(
        params as unknown as Parameters<typeof anthropic.messages.create>[0],
      ) as unknown as ReturnType<MessagesClient["create"]>,
  };
}

export const sessions = new Hono<{ Bindings: Env }>();

// POST /api/projects/:id/sessions — a session binds one project + one file.
sessions.post("/projects/:id/sessions", async (c) => {
  const projectId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as {
    file_id?: unknown;
    title?: unknown;
  } | null;
  if (!body || typeof body.file_id !== "string") {
    return c.json(
      apiError("VALIDATION_FAILED", "error.validation.required_field", undefined, "file_id"),
      422,
    );
  }
  const file = await c.env.relay_db
    .prepare("SELECT id, project_id, name FROM file WHERE id = ? AND project_id = ?")
    .bind(body.file_id, projectId)
    .first<{ id: string; project_id: string; name: string }>();
  if (!file) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const row: SessionRow = {
    id: newId("ses"),
    project_id: projectId,
    file_id: file.id,
    title:
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.trim().slice(0, 120)
        : file.name,
    created_at: new Date().toISOString(),
  };
  await c.env.relay_db
    .prepare(
      `INSERT INTO analysis_session (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.project_id, row.file_id, row.title, row.created_at)
    .run();
  return c.json(row, 201);
});

sessions.get("/projects/:id/sessions", async (c) => {
  const { results } = await c.env.relay_db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM analysis_session WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .bind(c.req.param("id"))
    .all<SessionRow>();
  return c.json({ sessions: results });
});

sessions.get("/sessions/:id", async (c) => {
  const session = await c.env.relay_db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM analysis_session WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<SessionRow>();
  if (!session) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const { results: turns } = await c.env.relay_db
    .prepare(
      `SELECT ${TURN_COLUMNS} FROM session_turn WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .bind(session.id)
    .all<TurnListRow>();
  return c.json({ session, turns });
});

// POST /api/sessions/:id/turns — prompt in, translation + result out.
sessions.post("/sessions/:id/turns", async (c) => {
  const session = await c.env.relay_db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM analysis_session WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<SessionRow>();
  if (!session) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const body = (await c.req.json().catch(() => null)) as {
    prompt?: unknown;
    input_artifact_id?: unknown;
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length === 0 || prompt.length > 2000) {
    return c.json(
      apiError("VALIDATION_FAILED", "error.validation.required_field", undefined, "prompt"),
      422,
    );
  }
  if (!session.file_id) {
    return c.json(apiError("VALIDATION_FAILED", "error.generic.not_found", undefined, "file_id"), 422);
  }
  const file = await c.env.relay_db
    .prepare("SELECT * FROM file WHERE id = ?")
    .bind(session.file_id)
    .first<FileRow>();
  if (!file) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }

  // Spend controls BEFORE anything that could reach the model (security.md
  // §5): daily budget from model_call rows, then per-IP rate.
  const rejection = await guardModelCall(
    c.env,
    c.req.header("cf-connecting-ip") ?? "unknown",
    "turns",
  );
  if (rejection) {
    return c.json(rejection.body, rejection.http);
  }

  // Optional lineage input: a previous turn's derived table becomes this
  // turn's dataset (must be a table_csv artifact of the same project).
  let inputArtifact: { id: string; r2_key: string } | undefined;
  if (body?.input_artifact_id !== undefined) {
    if (typeof body.input_artifact_id !== "string") {
      return c.json(
        apiError("VALIDATION_FAILED", "error.analysis.invalid_params", undefined, "input_artifact_id"),
        422,
      );
    }
    const artifact = await c.env.relay_db
      .prepare(
        "SELECT id, r2_key FROM artifact WHERE id = ? AND project_id = ? AND kind = 'table_csv'",
      )
      .bind(body.input_artifact_id, session.project_id)
      .first<{ id: string; r2_key: string }>();
    if (!artifact) {
      return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
    }
    inputArtifact = artifact;
  }

  const outcome = await runTurn(
    c.env,
    { client: messagesClient(c.env), kernel: containerKernel(c.env) },
    { id: session.id },
    file,
    prompt,
    new URL(c.req.url).origin,
    inputArtifact,
  );
  return c.json(outcome.body, outcome.http as 200);
});

sessions.get("/turns/:id/result", async (c) => {
  const turn = await c.env.relay_db
    .prepare(`SELECT ${TURN_COLUMNS} FROM session_turn WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<TurnListRow>();
  if (!turn?.result_r2_key) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const object = await c.env.relay_artifacts.get(turn.result_r2_key);
  if (!object) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return new Response(object.body, {
    headers: { "content-type": "application/json" },
  });
});

// Optional narration: streams plain text; prompt receives ONLY the result.
sessions.post("/turns/:id/narration", async (c) => {
  const rejection = await guardModelCall(
    c.env,
    c.req.header("cf-connecting-ip") ?? "unknown",
    "narration",
  );
  if (rejection) {
    return c.json(rejection.body, rejection.http);
  }
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json(
      apiError("UPSTREAM_UNAVAILABLE", "error.analysis.model_unavailable"),
      503,
    );
  }
  const turn = await c.env.relay_db
    .prepare(`SELECT ${TURN_COLUMNS} FROM session_turn WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<TurnListRow>();
  if (!turn?.result_r2_key) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const object = await c.env.relay_artifacts.get(turn.result_r2_key);
  if (!object) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const parsed = KernelResultSchema.safeParse(await object.json());
  if (!parsed.success) {
    return c.json(apiError("INTERNAL", "error.generic.internal"), 500);
  }
  const stream = narrateResult(
    c.env,
    c.env.ANTHROPIC_API_KEY,
    { sessionId: turn.session_id, turnId: turn.id },
    parsed.data,
  );
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

// Dataset preview for the session UI — a bounded R2 read, not a kernel call.
sessions.get("/files/:id/preview", async (c) => {
  const file = await c.env.relay_db
    .prepare("SELECT * FROM file WHERE id = ?")
    .bind(c.req.param("id"))
    .first<FileRow>();
  if (!file) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const preview = await datasetPreview(c.env, file);
  if (!preview) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return c.json(preview);
});
