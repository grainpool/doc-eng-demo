/**
 * Spend attribution and caps (security.md §5, Phase 14): a model_call row
 * for EVERY call, and both caps enforced in code BEFORE the call. On
 * exhaustion the run ends `partial` with reason "budget_exhausted" —
 * remaining impacts stay visible as unresolved (AP6).
 */

export const MAX_MODEL_CALLS_PER_RUN = 20;
export const DAILY_SPEND_CAP_USD = 5;

/** claude-opus-5: $5/M input, $25/M output; cache write 1.25×, read 0.1×. */
export function estimateCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return (
    (usage.input_tokens * 5 +
      (usage.cache_creation_input_tokens ?? 0) * 6.25 +
      (usage.cache_read_input_tokens ?? 0) * 0.5 +
      usage.output_tokens * 25) /
    1_000_000
  );
}

export interface SpendState {
  callsThisRun: number;
  maxCallsPerRun: number;
  spentTodayUsd: number;
  dailyCapUsd: number;
}

export async function loadSpendState(
  db: D1Database,
  overrides?: { maxCallsPerRun?: number; dailyCapUsd?: number },
): Promise<SpendState> {
  const utcDayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const row = await db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM model_call WHERE created_at >= ?")
    .bind(utcDayStart)
    .first<{ spent: number }>();
  return {
    callsThisRun: 0,
    maxCallsPerRun: overrides?.maxCallsPerRun ?? MAX_MODEL_CALLS_PER_RUN,
    spentTodayUsd: row?.spent ?? 0,
    dailyCapUsd: overrides?.dailyCapUsd ?? DAILY_SPEND_CAP_USD,
  };
}

/** Checked BEFORE each call. Null = allowed; string = exhaustion reason. */
export function spendGate(state: SpendState): string | null {
  if (state.callsThisRun >= state.maxCallsPerRun) return "budget_exhausted";
  if (state.spentTodayUsd >= state.dailyCapUsd) return "budget_exhausted";
  return null;
}

export async function recordModelCall(
  db: D1Database,
  state: SpendState,
  runId: string,
  purpose: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): Promise<void> {
  const cost = estimateCostUsd(usage);
  // The call slot was reserved BEFORE the call (guardedCall) — only the
  // spent amount accrues here.
  state.spentTodayUsd += cost;
  await db
    .prepare(
      "INSERT INTO model_call (id, run_id, purpose, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      `mc_${crypto.randomUUID()}`,
      runId,
      purpose,
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_creation_input_tokens ?? 0,
      usage.cache_read_input_tokens ?? 0,
      cost,
      new Date().toISOString(),
    )
    .run();
}
