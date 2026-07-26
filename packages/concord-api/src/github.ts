import { importPKCS8, SignJWT } from "jose";
import { pathAllowlisted } from "@concord/core";

/**
 * Phase 19 — the GitHub publish path, under four independent restrictions
 * (security.md §4.3/§8): least-privilege App installed on the estate repo
 * only; a per-run installation token additionally scoped by repository;
 * branch protection on main forcing the PR path (operator-configured,
 * verified by an attempted direct push); and the path allowlist/denylist
 * checked HERE, immediately before any GitHub call, independently of the
 * concord-core check that already ran.
 *
 * The installation token and the private key never appear in a return
 * value, an error message, a log line, or a response body. Errors carry
 * HTTP statuses and GitHub's `message` field only.
 */

export interface GitHubEnv {
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  /** "owner/repo" — the estate repo. Plain var, not a secret. */
  GITHUB_REPO?: string;
}

/** All GitHub traffic — token minting included — flows through this, so a
 * test spy on it proves "zero GitHub calls" claims. */
export type GitHubFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const API = "https://api.github.com";
const STALE_MS = 48 * 3_600_000;

export function githubConfigured(env: GitHubEnv): boolean {
  return Boolean(
    env.GITHUB_APP_ID &&
      env.GITHUB_INSTALLATION_ID &&
      env.GITHUB_APP_PRIVATE_KEY &&
      env.GITHUB_REPO,
  );
}

interface GhResponse {
  status: number;
  data: Record<string, unknown>;
}

async function gh(
  fetchImpl: GitHubFetch,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<GhResponse> {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "concord-publisher",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // 204s and other empty bodies
  }
  return { status: res.status, data };
}

/** Compact, secret-free failure text: status + GitHub's message field. */
function failText(what: string, res: GhResponse): string {
  const message = typeof res.data.message === "string" ? res.data.message : "";
  return `${what}: HTTP ${res.status}${message ? ` ${message.slice(0, 140)}` : ""}`;
}

/**
 * Mint a per-run installation access token, scoped with `repositories` to
 * the one estate repo. Short-lived (GitHub caps it at 1 hour); never cached
 * beyond the run, never returned to a caller outside this module's flows.
 */
export async function mintInstallationToken(
  env: GitHubEnv,
  fetchImpl: GitHubFetch,
): Promise<string> {
  const key = await importPKCS8(env.GITHUB_APP_PRIVATE_KEY as string, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 540)
    .setIssuer(env.GITHUB_APP_ID as string)
    .sign(key);
  const repoName = (env.GITHUB_REPO as string).split("/")[1];
  const res = await gh(
    fetchImpl,
    jwt,
    "POST",
    `/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
    { repositories: [repoName] },
  );
  if (res.status !== 201 || typeof res.data.token !== "string") {
    throw new Error(failText("installation token mint failed", res));
  }
  return res.data.token;
}

/** Final file contents for one estate-relative path. */
export interface PublishPatch {
  path: string;
  content: string;
  /** Structured provenance for the PR body — never model prose. */
  origin: "deterministic" | "model_grounded" | "model_editorial_draft";
  evidence: ReadonlyArray<{
    fact_key: string;
    tier: string;
    locator: string;
    value: unknown;
  }>;
}

export interface PublishInput {
  runId: string;
  /** The estate commit the run was built against — the branch base. */
  estateSha: string;
  patches: ReadonlyArray<PublishPatch>;
  factDeltas: ReadonlyArray<{
    fact_key: string;
    from: unknown;
    to: unknown;
    tier: string;
    locator: string;
  }>;
  /** Impacts escalated rather than patched — template text, never model output. */
  escalations: ReadonlyArray<{ doc_unit_id: string; action: string; explanation: string }>;
  inspectorUrl: string;
}

export type PublishResult =
  | {
      published: true;
      pr_url: string;
      pr_number: number;
      branch: string;
      committed_paths: string[];
      refused_paths: string[];
    }
  | {
      published: false;
      reason: string;
      refused_paths: string[];
      /** Present when a branch had been created: was the orphan removed? */
      branch_deleted?: boolean;
    };

function prBody(input: PublishInput, committed: PublishPatch[], refused: string[]): string {
  const lines: string[] = [
    "Opened by **Concord**, an automated documentation-reconciliation demo.",
    "Every patch below was validated against the mechanical gates (evidence resolution,",
    "anti-hallucination extraction, path allowlist) before publishing. Review before merging.",
    "",
    "## Fact deltas",
    "",
    "| fact key | from | to | tier | locator |",
    "|---|---|---|---|---|",
    ...input.factDeltas.map(
      (d) =>
        `| \`${d.fact_key}\` | \`${JSON.stringify(d.from)}\` | \`${JSON.stringify(d.to)}\` | ${d.tier} | \`${d.locator}\` |`,
    ),
    "",
    "## Patches and evidence",
    "",
  ];
  for (const patch of committed) {
    lines.push(`- \`${patch.path}\` (${patch.origin})`);
    if (patch.evidence.length === 0) {
      lines.push(
        "  - evidence: deterministic regeneration/substitution from the snapshot facts above",
      );
    }
    for (const e of patch.evidence) {
      lines.push(
        `  - evidence: \`${e.fact_key}\` = \`${JSON.stringify(e.value)}\` (${e.tier} @ \`${e.locator}\`)`,
      );
    }
  }
  if (refused.length > 0) {
    lines.push("", "## Refused paths (outside the write allowlist — not committed)", "");
    for (const path of refused) lines.push(`- \`${path}\``);
  }
  if (input.escalations.length > 0) {
    lines.push("", "## Escalated rather than patched", "");
    for (const esc of input.escalations) {
      lines.push(`- \`${esc.doc_unit_id}\` → ${esc.action}: ${esc.explanation}`);
    }
  }
  lines.push(
    "",
    "## Provenance",
    "",
    `Built against estate \`${input.estateSha}\`.`,
    `Run inspector: ${input.inspectorUrl}`,
  );
  return lines.join("\n");
}

/**
 * Create branch → commit the allowlisted diffs → open the PR. On ANY
 * failure after branch creation, delete the branch — no orphan refs. The
 * branch name is `concord/run-{run_id}`; the run id is server-generated
 * and re-checked here, so no visitor-controlled text can reach a ref name
 * or the PR title.
 */
export async function publishRun(
  env: GitHubEnv,
  fetchImpl: GitHubFetch,
  input: PublishInput,
): Promise<PublishResult> {
  // Path enforcement, second and independent check (security.md §4.3):
  // BEFORE any GitHub call — minting included — every path must pass the
  // same denylist-first allowlist as concord-core, and the estate/ mount
  // prefix must never appear (I15).
  const refused = input.patches
    .filter((p) => p.path.startsWith("estate/") || !pathAllowlisted(p.path))
    .map((p) => p.path);
  const committed = input.patches.filter((p) => !refused.includes(p.path));
  if (committed.length === 0) {
    return { published: false, reason: "no allowlisted patches to publish", refused_paths: refused };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.runId)) {
    return { published: false, reason: "run id failed shape check", refused_paths: refused };
  }
  if (!/^[0-9a-f]{40}$/.test(input.estateSha)) {
    return { published: false, reason: "estate sha failed shape check", refused_paths: refused };
  }

  const repo = env.GITHUB_REPO as string;
  const branch = `concord/run-${input.runId}`;
  const refPath = `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const token = await mintInstallationToken(env, fetchImpl);

  const created = await gh(fetchImpl, token, "POST", `/repos/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: input.estateSha,
  });
  if (created.status !== 201) {
    return {
      published: false,
      reason: failText("branch creation failed", created),
      refused_paths: refused,
    };
  }

  // Everything after this point must delete the branch on failure.
  try {
    const baseCommit = await gh(
      fetchImpl,
      token,
      "GET",
      `/repos/${repo}/git/commits/${input.estateSha}`,
    );
    const baseTree = (baseCommit.data.tree as { sha?: string } | undefined)?.sha;
    if (baseCommit.status !== 200 || !baseTree) {
      throw new Error(failText("base commit lookup failed", baseCommit));
    }
    const tree = await gh(fetchImpl, token, "POST", `/repos/${repo}/git/trees`, {
      base_tree: baseTree,
      tree: committed.map((p) => ({
        path: p.path,
        mode: "100644",
        type: "blob",
        content: p.content,
      })),
    });
    if (tree.status !== 201 || typeof tree.data.sha !== "string") {
      throw new Error(failText("tree creation failed", tree));
    }
    const commit = await gh(fetchImpl, token, "POST", `/repos/${repo}/git/commits`, {
      message: `concord: run ${input.runId} — ${committed.length} documentation patch(es)`,
      tree: tree.data.sha,
      parents: [input.estateSha],
    });
    if (commit.status !== 201 || typeof commit.data.sha !== "string") {
      throw new Error(failText("commit creation failed", commit));
    }
    const updated = await gh(fetchImpl, token, "PATCH", refPath, { sha: commit.data.sha });
    if (updated.status !== 200) {
      throw new Error(failText("ref update failed", updated));
    }
    const pr = await gh(fetchImpl, token, "POST", `/repos/${repo}/pulls`, {
      title: `Concord run ${input.runId}: ${committed.length} documentation patch(es)`,
      head: branch,
      base: "main",
      body: prBody(input, committed, refused),
    });
    if (pr.status !== 201 || typeof pr.data.html_url !== "string") {
      throw new Error(failText("pull request creation failed", pr));
    }
    return {
      published: true,
      pr_url: pr.data.html_url,
      pr_number: pr.data.number as number,
      branch,
      committed_paths: committed.map((p) => p.path),
      refused_paths: refused,
    };
  } catch (e) {
    const del = await gh(fetchImpl, token, "DELETE", refPath);
    return {
      published: false,
      reason: e instanceof Error ? e.message.slice(0, 300) : "publish failed",
      refused_paths: refused,
      branch_deleted: del.status === 204,
    };
  }
}

export interface CleanupReport {
  scanned: number;
  closed_prs: number;
  deleted_branches: number;
  errors: string[];
}

/**
 * Cron cleanup (security.md §8): close PRs and delete `concord/run-*`
 * branches older than 48 hours. Idempotent — every operation tolerates
 * already-gone targets, and a re-run over the same state is a no-op.
 */
export async function cleanupStaleRuns(
  env: GitHubEnv,
  fetchImpl: GitHubFetch,
  now: number = Date.now(),
): Promise<CleanupReport> {
  const repo = env.GITHUB_REPO as string;
  const owner = repo.split("/")[0];
  const report: CleanupReport = { scanned: 0, closed_prs: 0, deleted_branches: 0, errors: [] };
  const token = await mintInstallationToken(env, fetchImpl);

  const refs = await gh(
    fetchImpl,
    token,
    "GET",
    `/repos/${repo}/git/matching-refs/heads/concord/run-`,
  );
  if (refs.status !== 200 || !Array.isArray(refs.data)) {
    // matching-refs returns a bare array; gh() parses it into `data` only
    // when it is an object — re-read defensively.
    if (refs.status !== 200) {
      report.errors.push(failText("ref listing failed", refs));
      return report;
    }
  }
  const list = (Array.isArray(refs.data) ? refs.data : []) as Array<{
    ref: string;
    object: { sha: string };
  }>;
  for (const entry of list) {
    report.scanned += 1;
    const branch = entry.ref.replace(/^refs\/heads\//, "");
    const commit = await gh(fetchImpl, token, "GET", `/repos/${repo}/git/commits/${entry.object.sha}`);
    const dateText = (commit.data.committer as { date?: string } | undefined)?.date;
    if (commit.status !== 200 || !dateText) {
      report.errors.push(failText(`commit lookup failed for ${branch}`, commit));
      continue;
    }
    if (now - Date.parse(dateText) < STALE_MS) continue;

    const prs = await gh(
      fetchImpl,
      token,
      "GET",
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    const openPrs = (Array.isArray(prs.data) ? prs.data : []) as Array<{ number: number }>;
    for (const pr of openPrs) {
      const closed = await gh(fetchImpl, token, "PATCH", `/repos/${repo}/pulls/${pr.number}`, {
        state: "closed",
      });
      if (closed.status === 200) report.closed_prs += 1;
      else report.errors.push(failText(`PR close failed for #${pr.number}`, closed));
    }
    const del = await gh(
      fetchImpl,
      token,
      "DELETE",
      `/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    );
    // 204 deleted; 404/422 already gone — both terminal states are fine.
    if (del.status === 204) report.deleted_branches += 1;
    else if (del.status !== 404 && del.status !== 422) {
      report.errors.push(failText(`branch delete failed for ${branch}`, del));
    }
  }
  return report;
}
