import { MODEL_ID, apiError, type ApiError } from "@relay/contracts";
import type { Env } from "../env.js";

/**
 * Spend controls for Relay's model paths (security.md §5), enforced from
 * `model_call` rows BEFORE any Anthropic call is made. On exhaustion the
 * response is a clear 429 — never a silent fallback.
 */

/** Per-UTC-day model spend cap in USD. */
export const DAILY_SPEND_CAP_USD = 5;
/** claude-opus-5 list pricing per million tokens. */
const USD_PER_M_INPUT = 5;
const USD_PER_M_OUTPUT = 25;
/** Per-IP requests per hour on each model route. */
export const MODEL_RATE_LIMIT_PER_HOUR = 20;

export interface GuardRejection {
  http: 429;
  body: ApiError;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function estimatedSpendTodayUsd(env: Env): Promise<number> {
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const row = await env.relay_db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM model_call WHERE model = ? AND created_at >= ?`,
    )
    .bind(MODEL_ID, dayStart)
    .first<{ input_tokens: number; output_tokens: number }>();
  const input = row?.input_tokens ?? 0;
  const output = row?.output_tokens ?? 0;
  return (input * USD_PER_M_INPUT + output * USD_PER_M_OUTPUT) / 1_000_000;
}

/**
 * Returns null when the call may proceed; a 429 rejection otherwise.
 * Order matters: the budget is checked first (global), then the per-IP rate
 * (local), and the rate row is only recorded for requests that pass — a
 * blocked request must not consume rate quota.
 */
export async function guardModelCall(
  env: Env,
  clientIp: string,
  route: string,
): Promise<GuardRejection | null> {
  if ((await estimatedSpendTodayUsd(env)) >= DAILY_SPEND_CAP_USD) {
    return {
      http: 429,
      body: apiError("BUDGET_EXHAUSTED", "error.analysis.budget_exhausted"),
    };
  }

  const ipHash = await sha256Hex(clientIp || "unknown");
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const count = await env.relay_db
    .prepare(
      "SELECT COUNT(*) AS n FROM request_rate WHERE ip_hash = ? AND route = ? AND created_at >= ?",
    )
    .bind(ipHash, route, hourAgo)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MODEL_RATE_LIMIT_PER_HOUR) {
    return {
      http: 429,
      body: apiError("RATE_LIMITED", "error.analysis.rate_limited"),
    };
  }

  await env.relay_db
    .prepare(
      "INSERT INTO request_rate (ip_hash, route, created_at) VALUES (?, ?, ?)",
    )
    .bind(ipHash, route, new Date().toISOString())
    .run();
  // Opportunistic prune so the table cannot grow unbounded.
  await env.relay_db
    .prepare("DELETE FROM request_rate WHERE created_at < ?")
    .bind(new Date(Date.now() - 86_400_000).toISOString())
    .run();
  return null;
}
