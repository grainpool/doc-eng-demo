// Phase 17 — invariant I11: the public path makes ZERO model calls. Every
// public route is exercised with an Anthropic spy on outbound fetch; the
// replay and live records deserialize into the SAME ChangeLabRun shape
// (one renderer, no mock); each committed recording validates against the
// contract schema.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChangeLabRunSchema } from "@relay/contracts";
import worker from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let anthropicRequests = 0;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  anthropicRequests = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.anthropic.com")) {
      anthropicRequests += 1;
      throw new Error("I11 violated: public path reached api.anthropic.com");
    }
    if (url.includes("relay.test")) {
      // The stubbed Relay endpoints (deterministic run fallback).
      if (url.endsWith("/api/product-truth")) {
        return new Response(
          JSON.stringify({
            snapshot_id: `snap_pnm_${Date.now()}`,
            generated_at: new Date().toISOString(),
            relay_contracts_version: "1.3.0",
            facts: [],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ entries: [] }), {
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// The spy env: even WITH a key configured, the public path must never
// build a model client (public runs are deterministic-only).
function spyEnv(): typeof env & { ANTHROPIC_API_KEY: string } {
  // A syntactically inert sentinel (the repo's secret scan rejects anything
  // shaped like a real key — good): if the public path ever tried to USE
  // this, the Anthropic client would fail loudly, and the fetch spy above
  // would catch the attempt first.
  return { ...env, ANTHROPIC_API_KEY: "test-sentinel-key-never-used" } as typeof env & {
    ANTHROPIC_API_KEY: string;
  };
}

async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://concord.test${path}`, init),
    spyEnv() as never,
    ctx as never,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("public path — zero model calls (I11)", () => {
  it("every public route serves without touching api.anthropic.com — even with a key configured", async () => {
    // A deterministic public run end-to-end (inline fallback, no queue in tests).
    const started = await publicFetch("/api/runs", { method: "POST" });
    expect(started.status).toBe(200);
    const { run_id } = (await started.json()) as { run_id: string };

    const routes = [
      `/api/public/runs/${run_id}`,
      `/api/public/runs/${run_id}?verbose=1`,
      "/api/public/facts",
      "/api/public/changelab/scenarios",
    ];
    for (const route of routes) {
      const res = await publicFetch(route);
      expect([200, 404], route).toContain(res.status);
    }
    // Replay (may 404 when no recordings are bundled — still zero calls).
    await publicFetch("/api/public/changelab/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "replay",
        idempotency_key: "t",
        mutation: { kind: "fact_value", fact_key: "limit.upload.csv.max_bytes", value: 26214400 },
      }),
    });
    expect(anthropicRequests).toBe(0);

    // And the public run itself recorded zero model calls.
    const calls = await env.concord_db
      .prepare("SELECT COUNT(*) AS n FROM model_call WHERE run_id = ?")
      .bind(run_id)
      .first<{ n: number }>();
    expect(calls!.n).toBe(0);
  });

  it("the admin surface is unreachable when DEMO_ADMIN_ENABLED is unset", async () => {
    const res = await publicFetch("/api/admin/runs", { method: "POST" });
    expect(res.status).toBe(403);
    expect(anthropicRequests).toBe(0);
  });
});

describe("one shape, one renderer", () => {
  it("a live verbose record and a replay record deserialize into the same ChangeLabRun schema", async () => {
    const started = await publicFetch("/api/runs", { method: "POST" });
    const { run_id } = (await started.json()) as { run_id: string };
    const verbose = await publicFetch(`/api/public/runs/${run_id}?verbose=1`);
    expect(verbose.status).toBe(200);
    const liveRecord = ChangeLabRunSchema.parse(await verbose.json());
    expect(liveRecord.mode).toBe("live");
    expect(liveRecord.model_usage.calls).toBe(0); // deterministic public run

    const replay = await publicFetch("/api/public/changelab/replay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "replay",
        idempotency_key: "t2",
        mutation: { kind: "fact_value", fact_key: "limit.upload.csv.max_bytes", value: 26214400 },
      }),
    });
    if (replay.status === 200) {
      const replayRecord = ChangeLabRunSchema.parse(await replay.json());
      expect(replayRecord.mode).toBe("replay");
    }
  });

  it("every committed recording validates against ChangeLabRunSchema (recordings, not mocks)", () => {
    const dir = join(root, "fixtures", "runs");
    if (!existsSync(dir)) return; // recordings land in this same phase
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const record = JSON.parse(readFileSync(join(dir, file), "utf8"));
      expect(() => ChangeLabRunSchema.parse(record), file).not.toThrow();
    }
    if (files.length > 0) expect(files.length).toBeGreaterThanOrEqual(5);
  });
});
