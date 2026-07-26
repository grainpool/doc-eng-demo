// Phase 19 — the GitHub publish path and cleanup. Verified here, with a
// scripted GitHub and a spy on EVERY GitHub call (token minting included):
// a write outside the allowlist is refused with ZERO GitHub invocations; a
// failure injected after branch creation deletes the branch (no orphan
// refs); a GitHub failure never fails the run (failure isolation); the
// cleanup cron closes PRs and deletes stale concord/run-* branches
// idempotently; and no result, response, or recorded row ever contains the
// installation token or the private key.
import { env } from "cloudflare:test";
import { exportPKCS8, generateKeyPair } from "jose";
import { beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupStaleRuns,
  publishRun,
  type GitHubEnv,
  type PublishInput,
} from "../src/github.js";
import { executeRun, type RunEnv } from "../src/run.js";

const SENTINEL_TOKEN = "ghs_test-sentinel-token-never-real";
const BASE_SHA = "a".repeat(40);

let ghEnv: GitHubEnv;
let privateKeyPem: string;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  privateKeyPem = await exportPKCS8(keys.privateKey);
  ghEnv = {
    GITHUB_APP_ID: "12345",
    GITHUB_INSTALLATION_ID: "678",
    GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    GITHUB_REPO: "grainpool/doc-eng-demo-estate",
  };
});

type Script = (
  method: string,
  url: string,
  body: unknown,
) => { status: number; data: unknown } | null;

/** Records every GitHub invocation; unscripted calls throw. */
function spyFetch(script: Script) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
    calls.push({ method, url, body });
    const result = script(method, url, body);
    if (!result) throw new Error(`unscripted GitHub call: ${method} ${url}`);
    return new Response(result.status === 204 ? null : JSON.stringify(result.data), {
      status: result.status,
    });
  };
  return { calls, fetchImpl };
}

/** The happy path: mint → branch → base commit → tree → commit → ref → PR. */
const happyScript: Script = (method, url) => {
  if (method === "POST" && url.includes("/access_tokens"))
    return { status: 201, data: { token: SENTINEL_TOKEN } };
  if (method === "POST" && url.endsWith("/git/refs")) return { status: 201, data: {} };
  if (method === "GET" && /\/git\/commits\/[0-9a-f]{40}$/.test(url))
    return { status: 200, data: { tree: { sha: "basetree" } } };
  if (method === "DELETE" && url.includes("/git/refs/heads/")) return { status: 204, data: {} };
  if (method === "POST" && url.endsWith("/git/trees"))
    return { status: 201, data: { sha: "newtree" } };
  if (method === "POST" && url.endsWith("/git/commits"))
    return { status: 201, data: { sha: "b".repeat(40) } };
  if (method === "PATCH" && url.includes("/git/refs/heads/"))
    return { status: 200, data: {} };
  if (method === "POST" && url.endsWith("/pulls"))
    return {
      status: 201,
      data: { html_url: "https://github.com/grainpool/doc-eng-demo-estate/pull/7", number: 7 },
    };
  return null;
};

function input(paths: string[]): PublishInput {
  return {
    runId: "run_test123",
    estateSha: BASE_SHA,
    patches: paths.map((p) => ({
      path: p,
      content: `content of ${p}\n`,
      origin: "deterministic" as const,
      evidence: [],
    })),
    factDeltas: [
      {
        fact_key: "retention.artifact.days",
        from: 30,
        to: 90,
        tier: "T3_CONFIG",
        locator: "packages/contracts/src/product-config.ts#retention.artifact_days",
      },
    ],
    escalations: [],
    inspectorUrl: "https://concord.example/?run=run_test123",
  };
}

describe("publish path (security.md §4.3/§8, I16)", () => {
  it("a write outside the allowlist is refused BEFORE any GitHub call — zero invocations", async () => {
    const { calls, fetchImpl } = spyFetch(happyScript);
    const result = await publishRun(
      ghEnv,
      fetchImpl,
      input([".github/workflows/pwn.yml", "packages/relay-api/src/limits.ts", "estate/docs-mintlify/a.mdx"]),
    );
    expect(result.published).toBe(false);
    expect(result.refused_paths).toEqual([
      ".github/workflows/pwn.yml",
      "packages/relay-api/src/limits.ts",
      "estate/docs-mintlify/a.mdx",
    ]);
    expect(calls.length).toBe(0);
  });

  it("a refused path in a mixed set never reaches the committed tree", async () => {
    const { calls, fetchImpl } = spyFetch(happyScript);
    const result = await publishRun(
      ghEnv,
      fetchImpl,
      input(["docs-mintlify/generated/availability-matrix.mdx", ".github/workflows/pwn.yml"]),
    );
    expect(result.published).toBe(true);
    if (!result.published) throw new Error("unreachable");
    expect(result.committed_paths).toEqual(["docs-mintlify/generated/availability-matrix.mdx"]);
    expect(result.refused_paths).toEqual([".github/workflows/pwn.yml"]);
    const treeCall = calls.find((c) => c.url.endsWith("/git/trees"));
    const treePaths = (treeCall?.body as { tree: { path: string }[] }).tree.map((t) => t.path);
    expect(treePaths).toEqual(["docs-mintlify/generated/availability-matrix.mdx"]);
    // The refusal is REPORTED, not silent (PR body lists it).
    const prCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/pulls"));
    expect((prCall?.body as { body: string }).body).toContain(".github/workflows/pwn.yml");
  });

  it("a failure injected after branch creation deletes the branch — no orphan refs", async () => {
    const { calls, fetchImpl } = spyFetch((method, url, body) => {
      if (method === "POST" && url.endsWith("/pulls"))
        return { status: 422, data: { message: "Validation Failed" } };
      if (method === "DELETE" && url.includes("/git/refs/heads/"))
        return { status: 204, data: {} };
      return happyScript(method, url, body);
    });
    const result = await publishRun(
      ghEnv,
      fetchImpl,
      input(["docs-mintlify/generated/availability-matrix.mdx"]),
    );
    expect(result.published).toBe(false);
    if (result.published) throw new Error("unreachable");
    expect(result.reason).toContain("pull request creation failed");
    expect(result.branch_deleted).toBe(true);
    const deletion = calls.find((c) => c.method === "DELETE");
    expect(deletion?.url).toContain("concord%2Frun-run_test123");
  });

  it("no result — success or failure — contains the token or the private key", async () => {
    const happy = spyFetch(happyScript);
    const success = await publishRun(
      ghEnv,
      happy.fetchImpl,
      input(["docs-mintlify/generated/availability-matrix.mdx"]),
    );
    const failing = spyFetch((method, url, body) => {
      if (method === "POST" && url.endsWith("/git/refs"))
        return { status: 422, data: { message: "Repository rule violations found" } };
      return happyScript(method, url, body);
    });
    const failure = await publishRun(
      ghEnv,
      failing.fetchImpl,
      input(["docs-mintlify/generated/availability-matrix.mdx"]),
    );
    for (const result of [success, failure]) {
      const text = JSON.stringify(result);
      expect(text).not.toContain(SENTINEL_TOKEN);
      expect(text).not.toContain("BEGIN");
      expect(text).not.toContain(privateKeyPem.slice(30, 60));
    }
  });
});

describe("cleanup cron (security.md §8)", () => {
  const OLD_SHA = "c".repeat(40);
  const NEW_SHA = "d".repeat(40);
  const staleDate = new Date(Date.now() - 72 * 3_600_000).toISOString();
  const freshDate = new Date(Date.now() - 1 * 3_600_000).toISOString();

  const cleanupScript =
    (deleted: { done: boolean }): Script =>
    (method, url) => {
      if (method === "POST" && url.includes("/access_tokens"))
        return { status: 201, data: { token: SENTINEL_TOKEN } };
      if (method === "GET" && url.includes("/git/matching-refs/heads/concord/run-")) {
        const refs = [{ ref: "refs/heads/concord/run-new", object: { sha: NEW_SHA } }];
        if (!deleted.done)
          refs.unshift({ ref: "refs/heads/concord/run-old", object: { sha: OLD_SHA } });
        return { status: 200, data: refs };
      }
      if (method === "GET" && url.includes(`/git/commits/${OLD_SHA}`))
        return { status: 200, data: { committer: { date: staleDate } } };
      if (method === "GET" && url.includes(`/git/commits/${NEW_SHA}`))
        return { status: 200, data: { committer: { date: freshDate } } };
      if (method === "GET" && url.includes("/pulls?state=open"))
        return { status: 200, data: [{ number: 3 }] };
      if (method === "PATCH" && url.endsWith("/pulls/3")) return { status: 200, data: {} };
      if (method === "DELETE" && url.includes("concord%2Frun-old")) {
        deleted.done = true;
        return { status: 204, data: {} };
      }
      return null;
    };

  it("closes PRs and deletes branches older than 48h; fresh branches untouched", async () => {
    const state = { done: false };
    const { calls, fetchImpl } = spyFetch(cleanupScript(state));
    const report = await cleanupStaleRuns(ghEnv, fetchImpl);
    expect(report).toMatchObject({ scanned: 2, closed_prs: 1, deleted_branches: 1, errors: [] });
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("run-new"))).toBe(false);
  });

  it("a second pass over the cleaned state is a no-op (idempotent)", async () => {
    const state = { done: true };
    const { calls, fetchImpl } = spyFetch(cleanupScript(state));
    const report = await cleanupStaleRuns(ghEnv, fetchImpl);
    expect(report).toMatchObject({ scanned: 1, closed_prs: 0, deleted_branches: 0, errors: [] });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("publish inside a run (failure isolation, no leakage into rows)", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("relay.test")) {
        if (url.endsWith("/api/product-truth")) {
          return new Response(
            JSON.stringify({
              snapshot_id: `snap_gh_${Date.now()}_${Math.random().toString(36).slice(2)}`,
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
      return originalFetch(input as RequestInfo, init);
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function runWithGitHub(script: Script): Promise<{
    runId: string;
    status: string;
    publishDetail: Record<string, unknown>;
    allRowsText: string;
  }> {
    const runId = `run_gh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const runEnv = env as unknown as RunEnv;
    await runEnv.concord_db
      .prepare("INSERT INTO run (id, started_at, status, mode) VALUES (?, ?, 'queued', 'live')")
      .bind(runId, new Date().toISOString())
      .run();
    await runEnv.concord_db
      .prepare(
        "INSERT INTO audit_log (id, ts, access_email, mutation_json, run_id, outcome, pr_url) VALUES (?, ?, 'x@anthropic.com', '{}', ?, 'queued', NULL)",
      )
      .bind(`aud_${crypto.randomUUID()}`, new Date().toISOString(), runId)
      .run();
    const { fetchImpl } = spyFetch(script);
    await executeRun(
      { ...runEnv, ...ghEnv, RELAY_BASE_URL: "https://relay.test" },
      { createMessage: null, githubFetch: fetchImpl },
      runId,
      {
        publish: true,
        mutation: { kind: "fact_value", fact_key: "retention.artifact.days", value: 90 },
      },
    );
    const run = await runEnv.concord_db
      .prepare("SELECT status FROM run WHERE id = ?")
      .bind(runId)
      .first<{ status: string }>();
    const steps = await runEnv.concord_db
      .prepare("SELECT step, detail_json FROM run_step WHERE run_id = ?")
      .bind(runId)
      .all<{ step: string; detail_json: string }>();
    const audit = await runEnv.concord_db
      .prepare("SELECT * FROM audit_log WHERE run_id = ?")
      .bind(runId)
      .all();
    const publish = steps.results.find((s) => s.step === "publish");
    return {
      runId,
      status: run?.status ?? "missing",
      publishDetail: publish ? (JSON.parse(publish.detail_json) as Record<string, unknown>) : {},
      allRowsText: JSON.stringify(steps.results) + JSON.stringify(audit.results),
    };
  }

  it("a successful publish records the PR url in audit_log and run_step", async () => {
    const { status, publishDetail, allRowsText, runId } = await runWithGitHub(happyScript);
    expect(status).toBe("completed");
    expect(publishDetail.published).toBe(true);
    expect(publishDetail.pr_url).toBe("https://github.com/grainpool/doc-eng-demo-estate/pull/7");
    expect(allRowsText).toContain("pull/7");
    // No token, no key, anywhere in what the run recorded.
    expect(allRowsText).not.toContain(SENTINEL_TOKEN);
    expect(allRowsText).not.toContain("BEGIN");
    const runEnv = env as unknown as RunEnv;
    const audit = await runEnv.concord_db
      .prepare("SELECT pr_url FROM audit_log WHERE run_id = ?")
      .bind(runId)
      .first<{ pr_url: string | null }>();
    expect(audit?.pr_url).toBe("https://github.com/grainpool/doc-eng-demo-estate/pull/7");
  });

  it("a GitHub failure does NOT fail the run — the publish step is marked failed", async () => {
    const { status, publishDetail, allRowsText } = await runWithGitHub((method, url, body) => {
      if (method === "POST" && url.endsWith("/git/refs"))
        return { status: 422, data: { message: "Repository rule violations found" } };
      return happyScript(method, url, body);
    });
    expect(status).toBe("completed"); // failure isolation
    expect(publishDetail.published).toBe(false);
    expect(String(publishDetail.reason)).toContain("branch creation failed");
    expect(allRowsText).not.toContain(SENTINEL_TOKEN);
  });
});
