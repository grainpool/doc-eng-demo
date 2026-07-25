// Phase 01 acceptance test (validation.md §2): all five dependency checks pass,
// and the response body contains no secret-shaped string.
//
// Two layers:
//  1. In-worker (SELF, real local D1/R2 simulators in workerd): response shape,
//     D1 + R2 round-trips, no secret leakage. The container binding and the
//     Anthropic secret do not exist in the test pool (see COMPAT.md), so those
//     two checks are only shape-asserted here.
//  2. Deployed (the real https://relay.otonieltrejo.com): ALL FIVE checks green
//     with real observed values. This is the authoritative walking-skeleton
//     assertion and needs no secret — CI can run it.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MODEL_ID } from "@relay/contracts";

const DEPLOYED_ORIGIN = "https://relay.otonieltrejo.com";
const CHECK_NAMES = ["worker_assets", "d1", "r2", "kernel", "anthropic"];
const SECRET_SHAPES = [/sk-ant-/, /-----BEGIN/, /ghp_/, /github_pat_/];

interface HealthCheck {
  ok: boolean;
  value: string;
  duration_ms: number;
}

interface HealthReport {
  request_id: string;
  all_ok: boolean;
  checks: Record<string, HealthCheck>;
}

describe("GET /api/health — workerd with local bindings", () => {
  it("runs the five checks, D1 and R2 round-trip for real, no secret shapes", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    const body = await res.text();

    for (const pattern of SECRET_SHAPES) {
      expect(body).not.toMatch(pattern);
    }

    const report = JSON.parse(body) as HealthReport;
    expect(Object.keys(report.checks)).toEqual(CHECK_NAMES);
    expect(report.request_id).toBeTruthy();

    expect(report.checks.d1?.ok).toBe(true);
    expect(report.checks.d1?.value).toMatch(/^probe-/);
    expect(report.checks.r2?.ok).toBe(true);
    expect(report.checks.r2?.value).toMatch(/^probe-/);
  });

  it("returns the contract error shape for unknown API routes", async () => {
    const res = await SELF.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
    const json = (await res.json()) as {
      error: { code: string; copy_id: string };
    };
    expect(json.error.code).toBe("NOT_FOUND");
    expect(json.error.copy_id).toBeTruthy();
  });
});

describe("GET /api/health — deployed", () => {
  it(
    "all five checks pass with real observed values and no secret shapes",
    { timeout: 150_000, retry: 1 },
    async () => {
      const res = await fetch(`${DEPLOYED_ORIGIN}/api/health`);
      const body = await res.text();

      for (const pattern of SECRET_SHAPES) {
        expect(body).not.toMatch(pattern);
      }

      const report = JSON.parse(body) as HealthReport;
      expect(Object.keys(report.checks)).toEqual(CHECK_NAMES);

      for (const name of CHECK_NAMES) {
        expect(report.checks[name]?.ok, `check ${name} not ok`).toBe(true);
      }

      // Real values, not placeholders.
      expect(report.checks.kernel?.value).toMatch(/^\d+\.\d+\.\d+/); // pandas semver
      expect(report.checks.anthropic?.value).toContain(MODEL_ID);
      expect(report.all_ok).toBe(true);
    },
  );
});
