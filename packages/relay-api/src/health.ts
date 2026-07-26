import Anthropic from "@anthropic-ai/sdk";
import { getContainer } from "@cloudflare/containers";
import { MODEL_ID } from "@relay/contracts";
import { redactString } from "./log.js";
import type { Env } from "./env.js";

export interface HealthCheck {
  ok: boolean;
  value: string;
  duration_ms: number;
  detail?: Record<string, string>;
}

export interface HealthReport {
  request_id: string;
  generated_at: string;
  all_ok: boolean;
  checks: {
    worker_assets: HealthCheck;
    d1: HealthCheck;
    r2: HealthCheck;
    kernel: HealthCheck;
    anthropic: HealthCheck;
  };
  duration_ms: number;
}

/** Failure values must never carry a stack trace, env value, or secret. */
function failureValue(e: unknown): string {
  if (e instanceof Error) {
    return redactString(`${e.name}: ${e.message}`.slice(0, 160));
  }
  return "unknown_error";
}

async function timed(
  fn: () => Promise<Omit<HealthCheck, "duration_ms">>,
): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const result = await fn();
    return { ...result, duration_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, value: failureValue(e), duration_ms: Date.now() - start };
  }
}

/** Link 1 — the Worker serving the Vite/React page as static assets. */
function checkWorkerAssets(env: Env, origin: string): Promise<HealthCheck> {
  return timed(async () => {
    const res = await env.ASSETS.fetch(new Request(`${origin}/`));
    const contentType = res.headers.get("content-type") ?? "";
    return {
      ok: res.status === 200 && contentType.includes("text/html"),
      value: `index.html ${res.status}`,
    };
  });
}

/** Link 2 — D1: a write followed by a read of the same value. */
function checkD1(env: Env): Promise<HealthCheck> {
  return timed(async () => {
    const probe = `probe-${crypto.randomUUID()}`;
    await env.relay_db
      .prepare(
        "CREATE TABLE IF NOT EXISTS health_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL, created_at TEXT NOT NULL)",
      )
      .run();
    await env.relay_db
      .prepare("INSERT INTO health_probe (value, created_at) VALUES (?, ?)")
      .bind(probe, new Date().toISOString())
      .run();
    const row = await env.relay_db
      .prepare("SELECT value FROM health_probe WHERE value = ?")
      .bind(probe)
      .first<{ value: string }>();
    await env.relay_db
      .prepare("DELETE FROM health_probe WHERE value = ?")
      .bind(probe)
      .run();
    return { ok: row?.value === probe, value: row?.value ?? "read_miss" };
  });
}

/** Link 3 — R2: a put followed by a get of the same object. */
function checkR2(env: Env): Promise<HealthCheck> {
  return timed(async () => {
    const key = "health/probe";
    const payload = `probe-${crypto.randomUUID()}`;
    await env.relay_artifacts.put(key, payload);
    const object = await env.relay_artifacts.get(key);
    const readBack = object === null ? "read_miss" : await object.text();
    await env.relay_artifacts.delete(key);
    return { ok: readBack === payload, value: readBack };
  });
}

interface KernelVersions {
  python: string;
  pandas: string;
  numpy: string;
  scipy: string;
  statsmodels: string;
  matplotlib: string;
  fastapi: string;
  image_digest: string;
}

/** Link 4 — the container: round-trip returning the real installed pandas version. */
function checkKernel(env: Env): Promise<HealthCheck> {
  return timed(async () => {
    if (!env.KERNEL) {
      return { ok: false, value: "kernel_binding_unavailable" };
    }
    // Same instance id as the op proxy: with max_instances=1, a second DO id
    // ("health") could not schedule a container and 500'd (COMPAT.md).
    const container = getContainer(env.KERNEL, "kernel");
    // Generous timeout: first hit of the day pays the container cold start.
    const res = await container.fetch("http://kernel/versions", {
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      return { ok: false, value: `kernel_status_${res.status}` };
    }
    const versions = (await res.json()) as KernelVersions;
    const ok = typeof versions.pandas === "string" && versions.pandas.length > 0;
    // The startup egress probe (security.md §3 instrument): surfaced here so
    // the open-egress platform fact (COMPAT.md Phase 04) stays observable
    // rather than buried — "open:http_200" is the honest current state.
    let egressProbe: unknown = "unavailable";
    try {
      const healthRes = await container.fetch("http://kernel/health", {
        signal: AbortSignal.timeout(10_000),
      });
      if (healthRes.ok) {
        egressProbe = ((await healthRes.json()) as { egress_probe?: unknown }).egress_probe;
      }
    } catch {
      // versions succeeded; a probe-read failure should not fail the check
    }
    return {
      ok,
      value: versions.pandas ?? "missing_pandas_version",
      detail: {
        python: versions.python,
        numpy: versions.numpy,
        scipy: versions.scipy,
        statsmodels: versions.statsmodels,
        matplotlib: versions.matplotlib,
        image_digest: versions.image_digest,
        egress_probe: egressProbe,
      },
    };
  });
}

/** Link 5 — one successful live Anthropic call; value is the response model id. */
function checkAnthropic(env: Env): Promise<HealthCheck> {
  return timed(async () => {
    if (!env.ANTHROPIC_API_KEY) {
      return { ok: false, value: "api_key_not_configured" };
    }
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: MODEL_ID,
      max_tokens: 64,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    // stop_reason is checked BEFORE reading content, on every call (G11).
    if (message.stop_reason === "refusal") {
      return { ok: false, value: "refusal" };
    }
    return { ok: message.model.length > 0, value: message.model };
  });
}

export async function runHealthChecks(
  env: Env,
  origin: string,
  requestId: string,
): Promise<HealthReport> {
  const start = Date.now();
  const [workerAssets, d1, r2, kernel, anthropic] = await Promise.all([
    checkWorkerAssets(env, origin),
    checkD1(env),
    checkR2(env),
    checkKernel(env),
    checkAnthropic(env),
  ]);
  const checks = { worker_assets: workerAssets, d1, r2, kernel, anthropic };
  return {
    request_id: requestId,
    generated_at: new Date().toISOString(),
    all_ok: Object.values(checks).every((c) => c.ok),
    checks,
    duration_ms: Date.now() - start,
  };
}
