// Phase 09: the spend cap blocks the call BEFORE it is made, and the per-IP
// rate limit answers 429 with the contract error shape.
import { env } from "cloudflare:test";
import { visitorClient } from "./client.js";
const vfetch = visitorClient();
import { beforeEach, describe, expect, it } from "vitest";
import { MODEL_ID, newId } from "@relay/contracts";
import {
  DAILY_SPEND_CAP_USD,
  MODEL_RATE_LIMIT_PER_HOUR,
  estimatedSpendTodayUsd,
  guardModelCall,
} from "../src/analysis/limits-guard.js";
import { runTurn } from "../src/analysis/turn.js";
import type { FileRow } from "../src/routes/files.js";

async function insertSpend(outputTokens: number): Promise<void> {
  await env.relay_db
    .prepare(
      `INSERT INTO model_call (id, purpose, model, input_tokens, output_tokens, created_at)
       VALUES (?, 'nl_translation', ?, 0, ?, ?)`,
    )
    .bind(newId("run"), MODEL_ID, outputTokens, new Date().toISOString())
    .run();
}

beforeEach(async () => {
  await env.relay_db.prepare("DELETE FROM model_call").run();
  await env.relay_db.prepare("DELETE FROM request_rate").run();
});

describe("daily spend cap", () => {
  it("blocks BEFORE the model call — the client is never invoked", async () => {
    // 250k output tokens ≈ $6.25 > $5 cap.
    await insertSpend(250_000);
    expect(await estimatedSpendTodayUsd(env)).toBeGreaterThan(DAILY_SPEND_CAP_USD);

    const rejection = await guardModelCall(env, "1.2.3.4", "turns");
    expect(rejection?.http).toBe(429);
    expect(rejection?.body.error.code).toBe("BUDGET_EXHAUSTED");

    // End-to-end through the route: a turn request is refused up front.
    const projectRes = await vfetch("https://example.com/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "spend cap" }),
    });
    const project = (await projectRes.json()) as { id: string };
    const form = new FormData();
    form.set("file", new File(["a,b\n1,2\n"], "s.csv", { type: "text/csv" }));
    const fileRes = await vfetch(
      `https://example.com/api/projects/${project.id}/files`,
      { method: "POST", body: form },
    );
    const file = (await fileRes.json()) as FileRow;
    const sessionRes = await vfetch(
      `https://example.com/api/projects/${project.id}/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id: file.id }),
      },
    );
    const session = (await sessionRes.json()) as { id: string };
    const turnRes = await vfetch(
      `https://example.com/api/sessions/${session.id}/turns`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "summarize" }),
      },
    );
    expect(turnRes.status).toBe(429);
    const body = (await turnRes.json()) as { error: { code: string; copy_id: string } };
    expect(body.error.code).toBe("BUDGET_EXHAUSTED");
    expect(body.error.copy_id).toBe("error.analysis.budget_exhausted");
    // No turn row was created and no model_call rows were added:
    // the block happened before the pipeline, not after a failed call.
    const calls = await env.relay_db
      .prepare("SELECT COUNT(*) AS n FROM model_call")
      .first<{ n: number }>();
    expect(calls?.n).toBe(1); // only the seeded spend row

    // Direct pipeline check with a throwing client: never invoked.
    let created = 0;
    await expect(
      (async () => {
        const rejectionAgain = await guardModelCall(env, "1.2.3.4", "turns");
        if (rejectionAgain) return rejectionAgain;
        return runTurn(
          env,
          {
            client: {
              create: () => {
                created += 1;
                throw new Error("must not be called");
              },
            },
            kernel: null,
          },
          session,
          file,
          "x",
          "https://example.com",
        );
      })(),
    ).resolves.toMatchObject({ http: 429 });
    expect(created).toBe(0);
  });
});

describe("per-IP rate limit", () => {
  it(`blocks after ${MODEL_RATE_LIMIT_PER_HOUR} requests within the hour`, async () => {
    for (let i = 0; i < MODEL_RATE_LIMIT_PER_HOUR; i++) {
      expect(await guardModelCall(env, "9.9.9.9", "turns")).toBeNull();
    }
    const rejection = await guardModelCall(env, "9.9.9.9", "turns");
    expect(rejection?.http).toBe(429);
    expect(rejection?.body.error.code).toBe("RATE_LIMITED");
    // A different IP is unaffected.
    expect(await guardModelCall(env, "8.8.8.8", "turns")).toBeNull();
  });
});

describe("malformed multipart upload", () => {
  it("garbage multipart body is a 422, not a 500", async () => {
    const projectRes = await vfetch("https://example.com/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "multipart" }),
    });
    const project = (await projectRes.json()) as { id: string };
    const res = await vfetch(
      `https://example.com/api/projects/${project.id}/files`,
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=nope" },
        body: "this is not multipart at all",
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});
