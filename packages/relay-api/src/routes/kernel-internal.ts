import { Hono } from "hono";
import {
  OPERATION_IDS,
  OPERATION_PARAMS_SCHEMAS,
  KernelResultSchema,
  apiError,
  type DatasetRef,
  type OperationId,
} from "@relay/contracts";
import { LIMIT_UPLOAD_CSV_MAX_BYTES } from "../limits.js";
import { containerKernel } from "../kernel/container-kernel.js";
import { signDatasetUrl, verifyDatasetUrl } from "../kernel/presign.js";
import type { KernelOpResponse } from "../kernel/types.js";
import type { Env } from "../env.js";
import type { FileRow } from "./files.js";

const OP_ID_SET: ReadonlySet<string> = new Set(OPERATION_IDS);

/**
 * Maps a kernel response to the Worker's contract shape. Exported for unit
 * tests: the vitest pool cannot run the container, so the sha-mismatch and
 * oversized-dataset mappings are asserted against stubbed kernel responses
 * (the kernel behaviors themselves are covered by relay-kernel's pytest
 * suite against the real image).
 */
export function mapKernelResponse(res: KernelOpResponse): {
  status: 200 | 400 | 503;
  body: unknown;
} {
  if (res.status === 200) {
    const parsed = KernelResultSchema.safeParse(res.body);
    if (!parsed.success) {
      // A malformed 200 means the kernel and contract have drifted — that is
      // an availability problem, not a caller error.
      return {
        status: 503,
        body: apiError(
          "KERNEL_UNAVAILABLE",
          "error.analysis.kernel_unavailable",
          "kernel result did not match contract",
        ),
      };
    }
    return { status: 200, body: parsed.data };
  }
  const errorBody = res.body as { error?: { code?: string; detail?: string } };
  const code = errorBody?.error?.code ?? "unknown";
  const detail = errorBody?.error?.detail ?? "";
  // Kernel 400s (sha256_mismatch, dataset_too_large, unknown_column, …) are
  // deterministic rejections of this request — surface as 400 with the
  // kernel's code+detail (they never carry secrets or URLs).
  return {
    status: 400,
    body: apiError(
      "VALIDATION_FAILED",
      "error.analysis.kernel_rejected",
      `${code}: ${detail}`.slice(0, 200),
    ),
  };
}

export const kernelInternal = new Hono<{ Bindings: Env }>();

/**
 * GET /api/dataset — the signed capability URL the kernel fetches. GET only,
 * single key, ≤ 60 s (all inside the HMAC). 404 for anything invalid: no
 * oracle distinguishing expired / tampered / absent.
 */
kernelInternal.get("/dataset", async (c) => {
  const secret = c.env.RELAY_DATASET_URL_SECRET;
  if (!secret) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const r2Key = await verifyDatasetUrl(secret, new URL(c.req.url));
  if (!r2Key) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const object = await c.env.relay_artifacts.get(r2Key);
  if (!object) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "no-store",
    },
  });
});

/** Thin proxy for Phase-04 verification: 8 s timeout + one retry live in
 *  ContainerKernel; the model/NL layer does NOT exist yet (Phase 05). */
kernelInternal.post("/internal/kernel/op/:id", async (c) => {
  const id = c.req.param("id");
  // Unknown operation: 404 before anything else — closed enum, no side effect.
  if (!OP_ID_SET.has(id)) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const operationId = id as OperationId;

  const body = (await c.req.json().catch(() => null)) as {
    file_id?: unknown;
    params?: unknown;
  } | null;
  if (!body || typeof body.file_id !== "string") {
    return c.json(
      apiError("VALIDATION_FAILED", "error.validation.required_field", undefined, "file_id"),
      422,
    );
  }

  // Worker-side validation BEFORE the kernel call (security.md §3 — the
  // kernel re-validates independently; it does not trust this).
  const parsed = OPERATION_PARAMS_SCHEMAS[operationId].safeParse(
    body.params ?? {},
  );
  if (!parsed.success) {
    return c.json(
      apiError("VALIDATION_FAILED", "error.analysis.invalid_params", undefined, "params"),
      422,
    );
  }

  const file = await c.env.relay_db
    .prepare("SELECT id, r2_key, sha256, mime FROM file WHERE id = ?")
    .bind(body.file_id)
    .first<Pick<FileRow, "id" | "r2_key" | "sha256" | "mime">>();
  if (!file) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }

  const kernel = containerKernel(c.env);
  if (!kernel) {
    return c.json(
      apiError("KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable"),
      503,
    );
  }
  const secret = c.env.RELAY_DATASET_URL_SECRET;
  if (!secret) {
    return c.json(apiError("INTERNAL", "error.generic.internal"), 500);
  }

  // Dataset URLs are signed for the workers.dev origin, NOT the custom
  // domain: the zone's bot protection intermittently 403s the container's
  // fetches (Phase 04, COMPAT.md). workers.dev bypasses zone security.
  const datasetOrigin =
    c.env.RELAY_DATASET_ORIGIN ?? new URL(c.req.url).origin;
  const dataset: DatasetRef = {
    presigned_url: await signDatasetUrl(secret, datasetOrigin, file.r2_key),
    format: file.mime === "text/tab-separated-values" ? "tsv" : "csv",
    sha256: file.sha256,
    max_bytes: LIMIT_UPLOAD_CSV_MAX_BYTES,
  };

  try {
    const res = await kernel.op(operationId, dataset, parsed.data);
    const mapped = mapKernelResponse(res);
    return c.json(mapped.body as Record<string, unknown>, mapped.status);
  } catch {
    return c.json(
      apiError("KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable"),
      503,
    );
  }
});

/** Phase-09 seed hook. DISABLED unless RELAY_SEED_ENABLED="1" (test config
 *  and local dev only — the production deploy does not set it). */
kernelInternal.post("/internal/seed", async (c) => {
  if (c.env.RELAY_SEED_ENABLED !== "1") {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const { seedRelay } = await import("../seed.js");
  return c.json(await seedRelay(c.env));
});

/**
 * Maintenance reset (expansion Phase 2, architecture.md §3): wipe every
 * content table and its R2 objects — NEVER model_call, the spend-cap record —
 * then run the deterministic seed (owner 'seed'). Gated by the
 * RELAY_MAINTENANCE_TOKEN secret; unset secret or wrong bearer is the same
 * generic 404 as a missing route. Operator entrypoint: scripts/reset-relay.mjs.
 */
kernelInternal.post("/internal/reset", async (c) => {
  const token = c.env.RELAY_MAINTENANCE_TOKEN;
  const auth = c.req.header("authorization") ?? "";
  if (!token || auth !== `Bearer ${token}`) {
    return c.json(apiError("NOT_FOUND", "error.generic.not_found"), 404);
  }
  const db = c.env.relay_db;
  const keyRows = await db
    .prepare(
      `SELECT r2_key FROM file
       UNION ALL SELECT r2_key FROM artifact
       UNION ALL SELECT result_r2_key FROM session_turn WHERE result_r2_key IS NOT NULL`,
    )
    .all<{ r2_key: string }>();
  await db.batch([
    db.prepare("DELETE FROM conversation_message"),
    db.prepare("DELETE FROM conversation"),
    db.prepare("DELETE FROM artifact_provenance"),
    db.prepare("DELETE FROM artifact"),
    db.prepare("DELETE FROM session_turn"),
    db.prepare("DELETE FROM analysis_session"),
    db.prepare("DELETE FROM file"),
    db.prepare("DELETE FROM project"),
  ]);
  const keys = keyRows.results.map((r) => r.r2_key);
  for (let i = 0; i < keys.length; i += 1000) {
    await c.env.relay_artifacts.delete(keys.slice(i, i + 1000));
  }
  const { seedRelay } = await import("../seed.js");
  const report = await seedRelay(c.env);
  return c.json({ wiped_r2_objects: keys.length, ...report });
});

/** Pass-through of the kernel's /health — carries the Phase-04 egress-probe
 *  observation (the container has no shell; this is how it is read). */
kernelInternal.get("/internal/kernel/health", async (c) => {
  const kernel = containerKernel(c.env);
  if (!kernel) {
    return c.json(
      apiError("KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable"),
      503,
    );
  }
  try {
    return c.json((await kernel.health()) as Record<string, unknown>);
  } catch {
    return c.json(
      apiError("KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable"),
      503,
    );
  }
});
