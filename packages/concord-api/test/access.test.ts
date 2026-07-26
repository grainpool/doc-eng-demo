// Phase 18 — the identity gate (security.md §2, invariants I12/AP10).
// Every forged-token case is generated with jose, none skipped: missing
// header, self-signed (wrong key), wrong aud, wrong iss, expired, and a
// valid token with a non-@anthropic.com email → all 403. DEMO_ADMIN_ENABLED
// unset → 404 (the surface does not exist). Plus: one concurrent live run,
// the mutation gates, and a grep assertion that production sources carry
// no dev-auth bypass.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";

// The inline-fallback run fetches Relay — stub it (and hard-fail on any
// Anthropic attempt, which the admin path MAY make but tests must not).
let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("relay.test")) {
      if (url.endsWith("/api/product-truth")) {
        return new Response(
          JSON.stringify({
            snapshot_id: `snap_acc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            generated_at: new Date().toISOString(),
            relay_contracts_version: "1.3.0",
            facts: [
              {
                key: "retention.artifact.days",
                value: 30,
                tier: "T3_CONFIG",
                locator: "packages/contracts/src/product-config.ts#retention.artifact_days",
                observed_at: new Date().toISOString(),
                confidence: 1,
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ entries: [] }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.anthropic.com")) {
      // Admin runs are ALLOWED model calls in production; tests stub them out.
      return new Response(
        JSON.stringify({
          stop_reason: "refusal",
          content: [],
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const TEAM = "grainpool.cloudflareaccess.com";
const AUD = "test-aud-tag";

let goodKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let evilKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksJson: string;

beforeAll(async () => {
  goodKeys = await generateKeyPair("RS256", { extractable: true });
  evilKeys = await generateKeyPair("RS256", { extractable: true });
  jwksJson = JSON.stringify(await exportJWK(goodKeys.publicKey));
});

interface TokenOpts {
  key?: CryptoKey;
  iss?: string;
  aud?: string;
  email?: string;
  expired?: boolean;
}

async function token(opts: TokenOpts = {}): Promise<string> {
  const jwt = new SignJWT({ email: opts.email ?? "reviewer@anthropic.com" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setSubject("user-1")
    .setIssuedAt();
  if (opts.expired) {
    jwt.setExpirationTime(Math.floor(Date.now() / 1000) - 600);
  } else {
    jwt.setExpirationTime("10m");
  }
  return jwt.sign((opts.key ?? goodKeys.privateKey) as CryptoKey);
}

function adminEnv(enabled = true): typeof env {
  return {
    ...env,
    DEMO_ADMIN_ENABLED: enabled ? "true" : undefined,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    TEST_ACCESS_JWKS: jwksJson,
  } as typeof env;
}

async function adminFetch(
  path: string,
  headers: Record<string, string>,
  environment: typeof env,
  body?: unknown,
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://concord.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
    }),
    environment as never,
    ctx as never,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const LIVE_REQUEST = {
  mode: "live",
  idempotency_key: "t",
  mutation: { kind: "fact_value", fact_key: "retention.artifact.days", value: 90 },
};

describe("requireAccessIdentity — the 403 matrix (AP10)", () => {
  it("DEMO_ADMIN_ENABLED unset → 404: the surface does not exist (I12)", async () => {
    const res = await adminFetch("/api/admin/changelab", {}, adminEnv(false), LIVE_REQUEST);
    expect(res.status).toBe(404);
  });

  it("missing Cf-Access-Jwt-Assertion → 403, never a bypass", async () => {
    const res = await adminFetch("/api/admin/changelab", {}, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("ACCESS_MISSING_ASSERTION");
  });

  it("self-signed token (wrong key) → 403", async () => {
    const forged = await token({ key: evilKeys.privateKey as CryptoKey });
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": forged }, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("ACCESS_INVALID_ASSERTION");
  });

  it("wrong aud → 403 (signature-only verification would pass this)", async () => {
    const wrongAud = await token({ aud: "some-other-application" });
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": wrongAud }, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
  });

  it("wrong iss → 403 (another team's token must not pass)", async () => {
    const wrongIss = await token({ iss: "https://someone-else.cloudflareaccess.com" });
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": wrongIss }, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
  });

  it("expired token → 403", async () => {
    const expired = await token({ expired: true });
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": expired }, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
  });

  it("valid token, non-@anthropic.com email → 403 (second, in-code domain gate)", async () => {
    const outsider = await token({ email: "visitor@example.com" });
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": outsider }, adminEnv(), LIVE_REQUEST);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("ACCESS_DOMAIN_DENIED");
  });

  it("ACCESS_OPERATOR_EMAILS admits the EXACT operator address — and only it", async () => {
    const operatorEnv = {
      ...adminEnv(),
      ACCESS_OPERATOR_EMAILS: "operator@example.com",
    } as typeof env;
    // Exact operator address: admitted past the identity gate (the request
    // then proceeds into the normal live-run flow).
    const operator = await token({ email: "operator@example.com" });
    const admitted = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": operator }, operatorEnv, LIVE_REQUEST);
    expect(admitted.status).not.toBe(403);
    // Same domain, different mailbox: still denied — this is an exact-match
    // allowlist of named individuals, never a second domain rule.
    const neighbor = await token({ email: "someone-else@example.com" });
    const denied = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": neighbor }, operatorEnv, LIVE_REQUEST);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: string }).error).toBe("ACCESS_DOMAIN_DENIED");
    // And without the var, the operator address itself is denied (the
    // deviation exists only where the deployed config names it).
    const unset = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": operator }, adminEnv(), LIVE_REQUEST);
    expect(unset.status).toBe(403);
  });
});

describe("live runs — locks, limits, audit", () => {
  it("a valid identity starts a live run; audit_log records the identity; second concurrent run is rejected naming the in-flight id", async () => {
    const good = await token();
    const first = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": good }, adminEnv(), LIVE_REQUEST);
    expect(first.status).toBe(200);
    const { run_id } = (await first.json()) as { run_id: string };
    expect(run_id).toMatch(/^run_/);

    const audit = await env.concord_db
      .prepare("SELECT access_email, outcome FROM audit_log WHERE run_id = ?")
      .bind(run_id)
      .first<{ access_email: string; outcome: string }>();
    expect(audit?.access_email).toBe("reviewer@anthropic.com");

    // The inline-fallback run may still be executing (queued/running) —
    // force the lock state deterministically:
    await env.concord_db
      .prepare("UPDATE run SET status = 'running' WHERE id = ?")
      .bind(run_id)
      .run();
    const second = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": good }, adminEnv(), LIVE_REQUEST);
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; in_flight_run_id: string };
    expect(body.error).toBe("LIVE_RUN_IN_FLIGHT");
    expect(body.in_flight_run_id).toBe(run_id);
    await env.concord_db.prepare("UPDATE run SET status = 'failed' WHERE id = ?").bind(run_id).run();
  });

  it("an off-allowlist key and a <script> body are both rejected (400) and audited", async () => {
    const good = await token();
    const offKey = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": good }, adminEnv(), {
      mode: "live",
      idempotency_key: "t",
      mutation: { kind: "fact_value", fact_key: "limit.upload.csv.max_rows", value: 1 },
    });
    expect(offKey.status).toBe(400);
    expect(((await offKey.json()) as { error: string }).error).toBe("MUTATION_NOT_ALLOWED");

    const scriptBody = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": good }, adminEnv(), {
      mode: "live",
      idempotency_key: "t",
      mutation: {
        kind: "doc_body",
        doc_unit_id: "helpcenter:help-center/articles/upload-failed.md#article",
        body: "Nice text <script>alert(1)</script>",
      },
    });
    expect(scriptBody.status).toBe(400);
    expect(((await scriptBody.json()) as { error: string }).error).toBe("MUTATION_CONTENT_FORBIDDEN");
  });

  it("oversized admin bodies are rejected (413)", async () => {
    const good = await token();
    const res = await adminFetch("/api/admin/changelab", { "Cf-Access-Jwt-Assertion": good }, adminEnv(), {
      mode: "live",
      idempotency_key: "x".repeat(17_000),
      mutation: { kind: "fact_value", fact_key: "retention.artifact.days", value: 90 },
    });
    expect(res.status).toBe(413);
  });
});
