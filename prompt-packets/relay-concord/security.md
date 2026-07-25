# security.md — Threat model and required controls

The system uses the owner's Anthropic credentials and lets authenticated visitors trigger changes that can open pull
requests. Security is therefore a build requirement, not a hardening pass. Every control below has a named phase and a
verification step in `validation.md` §8.

---

## 1. Threat model

**Adversary A — anonymous public visitor.** Can reach `relay.<domain>`, `concord.<domain>`, `docs.<domain>` and any
public API. Goal: read secrets, cause spend, execute code, or write to the repo.

**Adversary B — authenticated privileged visitor** (holds an `@anthropic.com` address, therefore passes Access). Not
assumed malicious, but not trusted with arbitrary capability. Goal (if malicious): escalate a narrow mutation into
arbitrary repo writes, arbitrary code execution, or unbounded spend.

**Adversary C — the model itself**, i.e. model output treated as untrusted input. Prompt injection via an uploaded CSV,
a doc-unit body, or a crafted Change Lab edit could try to steer a patch, an operation, or a URL fetch.

Explicitly out of scope: a compromised Cloudflare account, a compromised GitHub account, and Anthropic-side compromise.

### Requirement → control map (your specification's list, answered)

| A visitor must not be able to… | Primary control | Phase |
|---|---|---|
| Obtain the Anthropic API key | Secret only in Worker secret store; never in `vars`, client bundle, health output, error body, or log. No endpoint echoes env. | 01 |
| Obtain GitHub credentials | GitHub App private key in Worker secret store. Installation tokens minted per run, repo-scoped, short-lived, never returned in a response. | 19 |
| Modify CI/CD workflows | The demo repo **contains no `.github/workflows/` directory**, and `.github/**` is on the path denylist. Deploys run from the primary repo, where the App is not installed. | 19 |
| Modify arbitrary repository files | Path allowlist (§4) checked in `concord-core` before any GitHub call; branch protection on `main`; PR-only. | 19 |
| Execute arbitrary shell commands | No component shells out. No `child_process` in any Worker. The CLI runs on the developer's machine only. | all |
| Execute arbitrary server-side code | Kernel exposes a closed enum of 8 operations; `filter_rows` uses structured predicates, never `query()`/`eval()`. Model output is a validated `{operation_id, params}` pair. | 04, 05 |
| Supply arbitrary URLs for server-side fetching | **No endpoint accepts a URL.** The kernel fetches only presigned R2 URLs it is handed by the Worker, host-checked. No link-checker fetches external URLs — reference validation is repo-internal only. | 04, 11 |
| Exfiltrate environment variables or secrets | No endpoint returns `env`. Health checks return booleans and version strings only. Errors return codes and copy ids, never stack traces or config. Log redaction list in §6. | 01, 20 |
| Trigger unlimited model/API spend | Public path makes **zero** model calls (I11). Privileged path: ≤ 20 calls/run, ≤ $5/day, ≤ 5 runs/identity/hour, 1 concurrent run. Checked before each call. | 14, 18, 20 |

---

## 2. Cloudflare Access — the identity gate (Phase 18)

### Configuration (you do this in the dashboard; the agent documents it)
1. Zero Trust → Access → Applications → **Self-hosted**.
2. Application domain: `concord.<domain>` with path `/api/admin` **and** a second app for `/admin` (the UI route).
3. Policy: **Action `Allow`** · rule type **`Include`** · selector **"Emails ending in"** · value `@anthropic.com`.
4. Login method: **One-time PIN** enabled. The PIN expires 10 minutes after request.
5. **Do not add "One-time PIN" as an Include rule under Login Methods** — that would admit every OTP user. OTP is the
   *authentication method*; the email-domain rule is the *authorization*.
6. Record the **AUD tag** and the team domain (`<team>.cloudflareaccess.com`). These become
   `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (plain `vars`, not secrets — they are not sensitive).

### Backend verification — mandatory, independent of the edge
`packages/concord-api/src/middleware/access.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
);

export async function requireAccessIdentity(c, next) {
  if (c.env.DEMO_ADMIN_ENABLED !== "true") return c.notFound();     // default-off
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return forbid(c, "ACCESS_MISSING_ASSERTION");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${c.env.ACCESS_TEAM_DOMAIN}`,
      audience: c.env.ACCESS_AUD,
    }));
  } catch { return forbid(c, "ACCESS_INVALID_ASSERTION"); }
  const email = String(payload.email ?? "");
  if (!email.toLowerCase().endsWith("@anthropic.com")) return forbid(c, "ACCESS_DOMAIN_DENIED");
  c.set("identity", { email, sub: payload.sub });
  await next();
}
```

Non-negotiable properties:
- **Missing header is a 403, never a bypass.** No "if not in production, skip" branch. Local development uses a
  separate `dev-only` middleware selected by build target, and the production bundle must not contain it.
- `aud` and `iss` are both checked. Signature-only verification is insufficient — any Access team's token would pass.
- The domain check is repeated in code even though the policy enforces it. Two independent gates.
- `DEMO_ADMIN_ENABLED` defaults to unset/false, so a misconfigured Access application cannot expose a live mutation
  path — the routes simply do not exist.
- The identity email is stored in `audit_log` but the **public** run view shows only the domain.

---

## 3. Analysis kernel isolation (Phase 04)

- Container network policy: outbound to the R2 presigned-URL host only. No general egress. Verified by attempting a
  fetch to a third-party host from inside the container during Phase 04 and confirming failure.
- Runs as a non-root user. Read-only filesystem except `/tmp`. No volume mounts.
- `matplotlib` uses the `Agg` backend (no display, no font-cache writes outside `/tmp`).
- Reachable **only** through the Worker's Durable Object binding. There is no public hostname for the container.
- Every request body is validated against the operation's schema in the *Worker* first and again in the kernel. Two
  independent validations; the kernel does not trust the Worker.
- Dataset integrity: the Worker supplies `sha256`; the kernel verifies after download and 400s on mismatch. This blocks
  a swapped-object attack against a presigned URL.
- Presigned URL TTL ≤ 60 s, method `GET` only, single object key.
- Row/column caps enforced on read (`max_bytes` in `DatasetRef`), not after parsing — a 2 GB CSV must not be loaded to
  discover it is too big.
- No endpoint accepts a filesystem path, a module name, an expression, or a format string.

## 4. Mutation and path allowlists (Phases 17–19)

### 4.1 Fact mutation allowlist — exhaustive
Defined in `packages/contracts/src/change-lab.ts` as a frozen table. A mutation whose key is absent is rejected with
`MUTATION_NOT_ALLOWED` **before** validation of the value.

| Fact key | Allowed values |
|---|---|
| `term.canonical.task` | `"Job"` \| `"Task"` \| `"Run"` |
| `limit.upload.csv.max_bytes` | `5242880` \| `10485760` \| `26214400` |
| `availability.feature.analysis_sessions.platform.ios` | `true` \| `false` |
| `availability.feature.analysis_sessions.platform.android` | `true` \| `false` |
| `availability.feature.connector_drive.platform.web` | `true` \| `false` |
| `retention.artifact.days` | `7` \| `30` \| `90` |
| `plan.feature.analysis_sessions.min_plan` | `"free"` \| `"pro"` \| `"team"` |
| `flag.analysis.regression_enabled` | `true` \| `false` |
| `analysis.operation.distribution_test.enabled` | `true` \| `false` |

Nine keys, closed value sets. **No free-text fact values.** No key patterns, no wildcards, no "any boolean fact".

### 4.2 Doc-body mutation allowlist
- Only `doc_unit_id`s present in `fixtures/changelab/editable-units.json` (a committed list of ≤ 12 fixture units).
- Body ≤ 8192 bytes, UTF-8, Markdown/MDX text only.
- Rejected content: HTML `<script>`, `<iframe>`, `<object>`, `<embed>`, `on*=` attributes, `javascript:` URIs,
  MDX expression braces `{...}`, `import`/`export` statements, and any JSX component tag not in an allowlist of the
  handful used by the docs. MDX is executable — treat a body edit as untrusted code input, not as prose.
- Never editable: any unit with `generated: true`, anything under `.github/`, any `wrangler.jsonc`, any `package.json`,
  any `.ts`/`.tsx`/`.py`/`.sql`/`.sh`/`.ps1`, any lockfile, any dotfile.

### 4.3 Repository path allowlist for PRs
Writes permitted **only** under:
```
surfaces/docs-mintlify/**/*.mdx
surfaces/docs-mintlify/docs.json
surfaces/docs-mintlify/generated/**
surfaces/help-center/**/*.md
surfaces/help-center/index.json
surfaces/releases/*.yaml
packages/relay-web/src/copy/*.json
```
Denylist checked **first** and independently (a bug in the allowlist must not open a hole):
```
.github/**   **/wrangler.jsonc   **/package.json   **/pnpm-lock.yaml   **/*.ts   **/*.tsx
**/*.js      **/*.py            **/*.sql          **/Dockerfile      **/.env*   **/*.pem
**/*.sh      **/*.ps1           **/.gitignore     **/*.yml (except surfaces/releases/*.yaml)
```
Path checks run in `concord-core` (pure, unit-tested with traversal cases: `..`, URL-encoded `%2e%2e`, absolute paths,
backslashes, symlink-looking names, unicode normalization tricks) **and** again in `concord-api` immediately before the
Octokit call.

## 5. Model-call safety and spend (Phases 05, 14, 20)

**Injection defenses — model output is untrusted input:**
- Untrusted content (CSV cell values, doc bodies, user prompts) is wrapped in clearly delimited blocks and the system
  prompt states that content inside them is data, never instructions.
- The NL translator's output is constrained to a **closed enum** of operation ids by the output schema. Even a fully
  successful injection cannot name an operation that does not exist.
- Patch bodies pass the mechanical anti-hallucination gate (`contracts.md` §14 gate 2) and the MDX content filter
  (§4.2) before they can reach a diff.
- **No model output is ever used as a URL, a file path, a shell argument, a SQL fragment, or a repo path.** Paths come
  from the `DocUnit` id, which the model does not author.

**Spend controls, all enforced in code before the call:**
| Control | Value | Where |
|---|---|---|
| Public path model calls | 0 | Route separation + test I11 |
| Model calls per run | ≤ 20 | Counter in `run` row |
| Model spend per UTC day | ≤ $5 | Aggregate over `model_call` rows |
| Live runs per identity per hour | ≤ 5 | `audit_log` count |
| Concurrent live runs | 1 | D1 lock row |
| Request body size (admin) | ≤ 16 KB | Middleware |
| Fan-out concurrency | ≤ 5 | Workers 6-connection limit |

On cap exhaustion the run ends `partial` with `reason: "budget_exhausted"` and unresolved impacts stay visible. It never
silently truncates or fails open.

**Replay mode is the abuse-resistance strategy for the public demo:** the interesting output is precomputed and
committed, so the public experience costs nothing and cannot be used as a free inference proxy.

## 6. Logging and redaction (Phase 01, audited Phase 20)

**Never logged:** `ANTHROPIC_API_KEY`, GitHub App private key or installation tokens, any header starting `Cf-Access-`,
full JWTs, full model prompts or completions, raw uploaded file contents, presigned URLs (they are capability URLs).

**Logged:** `request_id`, `run_id`, route, status, `duration_ms`, model `purpose` + token counts + prompt **hash**,
fact keys, doc unit ids, allowlist decisions (including rejections — a rejection log is a security signal).

**Audit log** (`audit_log`, append-only): timestamp, Access email, mutation, run id, PR url, outcome. Public view
redacts the local part of the email to the domain.

## 7. Secrets inventory

| Secret | Where | Phase |
|---|---|---|
| `ANTHROPIC_API_KEY` | `wrangler secret put` on both Workers | 01 |
| `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID` | `wrangler secret put` on concord-api | 19 |
| `RELAY_DEMO_COOKIE_SECRET` | `wrangler secret put` on relay-api | 03 |
| `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN` | plain `vars` (not sensitive) | 18 |
| `DEMO_ADMIN_ENABLED` | plain `var`, default absent | 18 |

`.dev.vars` is gitignored from Phase 01. A pre-commit secret scan (`gitleaks` or an equivalent grep for
`sk-ant-`, `-----BEGIN`, `ghp_`, `github_pat_`) is added in Phase 01, not Phase 20.

## 8. Branch hygiene and cleanup (Phase 19)

- Branch name: `concord/run-{run_id}` — never visitor-controlled text.
- Create branch → commit → open PR. On any failure, **delete the branch** so no orphan refs accumulate.
- A cron-triggered cleanup Worker closes PRs and deletes `concord/run-*` branches older than 48 h.
- PR body states: opened by an automated demo, lists the fact deltas and evidence, and links the public run inspector.
- PR bodies and branch names never interpolate model output.
