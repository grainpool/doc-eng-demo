import {
  KernelResultSchema,
  OPERATION_PARAMS_SCHEMAS,
  MODEL_ID,
  apiError,
  newId,
  type ErrorCode,
  type KernelResult,
  type OperationId,
  type TranslationResult,
} from "@relay/contracts";
import { datasetPreview } from "./dataset-preview.js";
import {
  promptHash,
  translatePrompt,
  type MessagesClient,
  type TranslationCallRecord,
} from "./translator.js";
import { buildDatasetRef } from "../kernel/dataset-ref.js";
import type { AnalysisKernel } from "../kernel/types.js";
import type { Env } from "../env.js";
import type { FileRow } from "../routes/files.js";

/**
 * One session turn: prompt → translation → re-validation gate → kernel.
 *
 * Dependencies (model client, kernel) are injected so the acceptance tests
 * can drive every path with a kernel SPY and assert the load-bearing
 * property: the kernel receives only a validated {operation_id, params}
 * pair, and unsupported/invalid paths make ZERO kernel calls.
 */

export interface TurnDeps {
  client: MessagesClient | null;
  kernel: AnalysisKernel | null;
}

export interface TurnResponse {
  http: number;
  body: Record<string, unknown>;
}

interface TurnRow {
  id: string;
  session_id: string;
}

async function updateTurn(
  env: Env,
  turnId: string,
  fields: {
    status: string;
    operation_id?: string | null;
    params_json?: string | null;
    error_code?: string | null;
    result_r2_key?: string | null;
  },
): Promise<void> {
  await env.relay_db
    .prepare(
      `UPDATE session_turn SET status = ?, operation_id = ?, params_json = ?,
       error_code = ?, result_r2_key = ?, completed_at = ? WHERE id = ?`,
    )
    .bind(
      fields.status,
      fields.operation_id ?? null,
      fields.params_json ?? null,
      fields.error_code ?? null,
      fields.result_r2_key ?? null,
      new Date().toISOString(),
      turnId,
    )
    .run();
}

async function recordModelCalls(
  env: Env,
  turn: TurnRow,
  purpose: string,
  hash: string,
  calls: TranslationCallRecord[],
): Promise<void> {
  for (const call of calls) {
    await env.relay_db
      .prepare(
        `INSERT INTO model_call (id, session_id, turn_id, purpose, model,
         input_tokens, output_tokens, cache_read_input_tokens,
         cache_creation_input_tokens, prompt_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId("run"),
        turn.session_id,
        turn.id,
        purpose,
        MODEL_ID,
        call.input_tokens,
        call.output_tokens,
        call.cache_read_input_tokens,
        call.cache_creation_input_tokens,
        hash,
        new Date().toISOString(),
      )
      .run();
  }
}

export async function runTurn(
  env: Env,
  deps: TurnDeps,
  session: { id: string },
  file: FileRow,
  prompt: string,
  requestOrigin: string,
): Promise<TurnResponse> {
  const startedAt = Date.now();
  const turnId = newId("trn");
  const turn: TurnRow = { id: turnId, session_id: session.id };
  await env.relay_db
    .prepare(
      `INSERT INTO session_turn (id, session_id, prompt, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`,
    )
    .bind(turnId, session.id, prompt, new Date().toISOString())
    .run();

  const fail = async (
    http: number,
    errorCode: ErrorCode,
    copyId: string,
  ): Promise<TurnResponse> => {
    await updateTurn(env, turnId, { status: "failed", error_code: errorCode });
    return {
      http,
      body: { turn_id: turnId, ...apiError(errorCode, copyId) },
    };
  };

  if (!deps.client) {
    return fail(503, "UPSTREAM_UNAVAILABLE", "error.analysis.model_unavailable");
  }

  const preview = await datasetPreview(env, file);
  if (!preview || preview.columns.length === 0) {
    return fail(500, "INTERNAL", "error.generic.internal");
  }

  // --- Translation (router, never executor) --------------------------------
  const hash = await promptHash(preview, prompt);
  const { result: translation, calls } = await translatePrompt(
    deps.client,
    preview,
    prompt,
  );
  await recordModelCalls(env, turn, "nl_translation", hash, calls);
  const modelUsage = {
    calls: calls.length,
    input_tokens: calls.reduce((n, c) => n + c.input_tokens, 0),
    output_tokens: calls.reduce((n, c) => n + c.output_tokens, 0),
  };

  if (translation.kind === "unsupported") {
    await updateTurn(env, turnId, { status: "refused" });
    return {
      http: 200,
      body: {
        turn_id: turnId,
        status: "refused",
        copy_id: "error.analysis.unsupported_request",
        translation,
        model_usage: modelUsage,
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  // --- Re-validation gate (the reason this feature is safe) ----------------
  // The model's params are untrusted input: parse them against the SPECIFIC
  // operation's Zod schema. On failure: 422 and NO kernel call, ever.
  const operationId: OperationId = translation.operation_id;
  const gate = OPERATION_PARAMS_SCHEMAS[operationId].safeParse(translation.params);
  if (!gate.success) {
    await updateTurn(env, turnId, {
      status: "failed",
      operation_id: operationId,
      error_code: "VALIDATION_FAILED",
    });
    return {
      http: 422,
      body: {
        turn_id: turnId,
        ...apiError(
          "VALIDATION_FAILED",
          "error.analysis.invalid_params",
          undefined,
          "params",
        ),
        translation,
        model_usage: modelUsage,
      },
    };
  }

  // --- Kernel call: only a validated {operation_id, params} pair -----------
  if (!deps.kernel) {
    return fail(503, "KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable");
  }
  const dataset = await buildDatasetRef(env, requestOrigin, file);
  if (!dataset) {
    return fail(500, "INTERNAL", "error.generic.internal");
  }

  let kernelResponse;
  try {
    kernelResponse = await deps.kernel.op(operationId, dataset, gate.data);
  } catch {
    return fail(503, "KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable");
  }

  if (kernelResponse.status !== 200) {
    const errorBody = kernelResponse.body as {
      error?: { code?: string; detail?: string };
    };
    await updateTurn(env, turnId, {
      status: "failed",
      operation_id: operationId,
      params_json: JSON.stringify(gate.data),
      error_code: "VALIDATION_FAILED",
    });
    return {
      http: 400,
      body: {
        turn_id: turnId,
        ...apiError(
          "VALIDATION_FAILED",
          "error.analysis.kernel_rejected",
          `${errorBody?.error?.code ?? "unknown"}: ${errorBody?.error?.detail ?? ""}`.slice(0, 200),
        ),
        translation,
        model_usage: modelUsage,
      },
    };
  }

  const parsed = KernelResultSchema.safeParse(kernelResponse.body);
  if (!parsed.success) {
    return fail(503, "KERNEL_UNAVAILABLE", "error.analysis.kernel_unavailable");
  }
  const result: KernelResult = parsed.data;

  const resultKey = `sessions/${session.id}/turns/${turnId}/result.json`;
  await env.relay_artifacts.put(resultKey, JSON.stringify(result), {
    httpMetadata: { contentType: "application/json" },
  });
  await updateTurn(env, turnId, {
    status: "completed",
    operation_id: operationId,
    params_json: JSON.stringify(gate.data),
    result_r2_key: resultKey,
  });

  return {
    http: 200,
    body: {
      turn_id: turnId,
      status: "completed",
      operation_id: operationId,
      params: gate.data,
      rationale: translation.rationale,
      result,
      model_usage: modelUsage,
      duration_ms: Date.now() - startedAt,
    },
  };
}

export type { TranslationResult };
