# SECURITY.md — operational security notes (Phases 18–19)

The full threat model lives in the prompt packet (`security.md`); this file
records the OPERATED configuration and the steps a reader needs to
reproduce or audit it.

## Cloudflare Access — the identity gate

Team domain: `grainpool.cloudflareaccess.com` · Application AUD:
`be136ff79ded93a44ad0b615f810999d6128adcfbf86112a2e9daab09b599278`
(both are verification targets, not secrets — they ship as plain `vars`).

### Dashboard setup (operator-performed; reproduce as follows)
1. Zero Trust → Access → Applications → **Self-hosted**.
2. Application domain `concord.otonieltrejo.com`, paths `/api/admin` and
   `/admin` (two apps or two path entries covering both).
3. Policy: Action **Allow** · rule type **Include** · selector
   **"Emails ending in"** · value `@anthropic.com`.
4. Login method: **One-time PIN** (PINs expire 10 minutes after request).
5. Record the AUD tag → `ACCESS_AUD`; team domain → `ACCESS_TEAM_DOMAIN`.

### The misconfiguration to avoid
Do **not** add "One-time PIN" as an *Include rule* under Login Methods.
That policy reads as restrictive while admitting **every OTP user on the
internet**: OTP is the *authentication method*; the email-domain Include
rule is the *authorization*. If the only Include rule is the login method
itself, the app is wide open.

### Backend verification (independent of the edge)
`packages/concord-api/src/middleware/access.ts`:
- `DEMO_ADMIN_ENABLED !== "true"` → **404** — the privileged surface does
  not exist by default (invariant I12). The committed `wrangler.jsonc`
  deliberately does not set it; enabling is an explicit
  `wrangler deploy --var DEMO_ADMIN_ENABLED:true`.
- Missing `Cf-Access-Jwt-Assertion` → 403. No bypass branch exists
  (grep-asserted in `concord-core/test/no-dev-bypass.test.ts`).
- `jwtVerify` against `https://grainpool.cloudflareaccess.com/cdn-cgi/access/certs`
  with **issuer AND audience AND expiry** checked — signature-only
  verification would accept any Access team's token.
- The `@anthropic.com` email check is repeated in code. Two independent
  gates: the edge policy and the backend.
- **Documented deviation (Phase 19): the operator identity.** The spec
  assumes an Anthropic-internal operator; this demo's operator
  authenticates via OTP as `otoniel@grainpoolholdings.com`, and the first live-run
  attempt was correctly rejected by the backend gate
  (`ACCESS_DOMAIN_DENIED` — observed 2026-07-26, proof the second gate
  works even when the edge admits an identity). The accommodation is
  `ACCESS_OPERATOR_EMAILS`: a comma-separated list of **exact** email
  addresses admitted in addition to the domain. It is an allowlist of
  named individuals — never a second domain rule (tested: a different
  mailbox on the same domain stays denied; with the var unset, behavior
  is exactly the spec's). The deployed value names the one operator.
- Note the `workers.dev` host: requests there bypass the zone's edge
  Access entirely — which is exactly why backend verification is
  mandatory. Observed behavior: unauthenticated `/api/admin/*` on
  workers.dev → 403 from OUR middleware, not a redirect.

## ⚠ The Zero Trust seat cliff — the one cost with no code-level control

- This account is on **Zero Trust Free: 50 seats included**. The **51st
  distinct authenticator** converts the ENTIRE user count to paid
  (~$7/user/month — roughly **$357/month at seat 51**), with no partial
  billing.
- Access consumes a seat **at the edge, before any of our code runs**.
  Nothing in this repository can cap it. It is the only cost in the whole
  design with no application-level control — which is why it is an
  operator step, not a config value.
- **Before enabling the Access application**, configure a Cloudflare
  **billing / seat-count notification** (Zero Trust → Settings →
  Notifications, or Account Home → Notifications → "Zero Trust seat
  updates").
- **How to check the current seat count**: Zero Trust → My Team → Users —
  each listed user is a consumed seat; remove stale users from the same
  screen. Seat count at time of writing: operator-observed (not visible
  to CI or code); check before and after enabling the app.
- The policy stays `@anthropic.com` domain-wide per the requirement; it is
  NOT narrowed to an email list. If the seat count approaches 50, raise it
  with the operator and let them decide.

## Access logs are ephemeral; the audit log is durable

Zero Trust Free retains Access authentication logs for **24 hours**. The
D1 `audit_log` table (migration 0007) is therefore the durable record of
privileged actions: timestamp, Access email, mutation, run id, outcome,
PR url (null until Phase 19). It is append-only in application code, and
the public view (`GET /api/public/audit`) redacts the email's local part
to the domain.

## Mutation surface (security.md §4, implemented in code)

- Fact mutations: the **nine-key** closed-value allowlist in
  `packages/contracts/src/change-lab.ts` (`FACT_MUTATION_ALLOWLIST`). A key
  not in the table is `MUTATION_NOT_ALLOWED` before value validation.
- Doc-body mutations: only unit ids in
  `fixtures/changelab/editable-units.json` (repo 1 — an estate write can
  never widen the estate-writable set), ≤ 8192 bytes, and the §4.2 content
  filter (script/iframe/object/embed, `on*=`, `javascript:`, MDX
  expression braces, import/export, JSX outside `Note|Warning|Info|Tip`).
  MDX is executable; body edits are treated as untrusted code input.
- Live runs: mutations apply to a WORKING COPY of the snapshot/estate —
  never to deployed Relay configuration. One concurrent live run (D1
  lock; a second request is rejected naming the in-flight run id);
  ≤ 5 live runs per identity per hour; admin bodies ≤ 16 KB.

## GitHub publish path (Phase 19) — four independent restrictions

Live privileged runs land their patches as a real pull request on the
estate repo (`grainpool/doc-eng-demo-estate`). Four layers, each of which
must hold on its own; none is dropped because another covers it.

### 1. The App — least privilege, one repo (operator-configured)

A dedicated GitHub App (**concord-docs-publisher**, App id `4400643`)
created under `grainpool`, with exactly three repository permissions:

- **Contents: Read and write** — `Pull requests: write` alone cannot
  create a branch or a commit, which is why Contents:write is required;
  the scope is deliberate, not lazy.
- **Pull requests: Read and write** — to open (and, from the cleanup
  cron, close) PRs.
- **Metadata: Read-only** — added automatically by GitHub.

Webhooks disabled; installable **only on this account**; installed on
**the estate repo only** (installation id `149214710`). Repo 1 — all
code, all CI, all product truth — has **no installation and is therefore
unreachable, not merely disallowed**. Verified live: the installation
lists exactly one repository, and a write attempt against repo 1 with an
installation token returns `403 Resource not accessible by integration`.
If a run concludes something in repo 1 should change, the correct output
is an escalation naming the owner (constraints.md §G21), never a write
through another mechanism.

**The estate repo contains no `.github/` directory at all.** This is the
structural argument, and it is a property of the repo's *contents*, not
of how many apps are installed: there is no privileged workflow within
reach of a visitor-authored branch, because there are no workflows in the
repo and all CI lives in repo 1, where this App is not installed.
Mintlify's GitHub app is also installed on repo 2 (it publishes the docs
site on merge) — that does not change the argument, and Concord's App
remains the **only** installation on repo 2 we control with
`Contents: write`. The `.github/**` denylist entry (below) keeps Concord
itself from ever introducing a workflows directory.

### 2. Per-run repository-scoped tokens

Every publish mints a fresh installation access token scoped with
`repositories` to the one estate repo (`packages/concord-api/src/github.ts`).
GitHub caps its life at one hour; the code never caches it beyond the
run, never returns it in a response, and never logs it — error text
carries HTTP statuses and GitHub `message` fields only. A test asserts no
result, response body, or recorded row contains the token or the private
key. The key itself (PKCS#8) lives in `wrangler secret put
GITHUB_APP_PRIVATE_KEY`, never in config or the repo.

### 3. Branch protection on `main` — operator-configured, VERIFIED not assumed

A repository ruleset on the estate repo requires a pull request before
merging into `main`, blocks force pushes (`non_fast_forward`), and blocks
branch deletion. **This is a repository setting a human configured in
GitHub's UI. The App does not grant it, installing the App does not
create it, and no code in this repo can set or restore it.** It can be
changed or lost without a single test failing — which is why it is
verified by attempt, not assumed:

> Observed 2026-07-26, direct push to `main` with a live installation
> token: `409 — Repository rule violations found. Changes must be made
> through a pull request.`

It is load-bearing: the App holds `Contents: write`, and without branch
protection that permission could commit straight to `main` — an
AI-proposed patch, triggered by a visitor, landing on the published docs
site with no human in the loop. Branch protection is what forces the
token down the PR path. Re-check it (repeat the push attempt) rather
than trusting this file.

### 4. The path allowlist/denylist — checked twice

All paths are estate-relative; the `estate/` mount prefix never reaches
the API. The **denylist is evaluated first and independently** (a bug in
the allowlist must not open a hole): `.github/**`, any dotfile or
dot-directory, all code/config/credential extensions (`.ts .tsx .js .py
.sql .sh .ps1 .yml .yaml .pem .env*`), `Dockerfile`, `package.json`,
lockfiles. Writes are then permitted only under the six allowed globs of
security.md §4.3. Simplest statement of the rule: **repo 2 holds only
`.md`, `.mdx`, and `.json` documentation files; Concord may write those
and nothing else.**

The check runs in `concord-core` (pure, unit-tested against traversal
variants: `..`, URL-encoded `%2e%2e`, absolute paths, backslashes, NUL
and control characters, unicode-normalization tricks) **and again** in
`concord-api` immediately before any GitHub call. A patch outside the
allowlist is refused and reported — never committed, and never worked
around by widening the list. A test spies on the GitHub client and
asserts a refused write makes **zero** GitHub calls.

### Publish mechanics and hygiene

- Branch `concord/run-{run_id}` — server-generated id, shape-checked;
  no visitor-controlled text in ref names, and no model output in the
  branch name or PR title.
- Create branch → commit allowlisted diffs → open PR. On ANY failure
  after branch creation the branch is deleted — no orphan refs.
- The PR body lists the fact deltas, the evidence for each patch, which
  impacts were escalated rather than patched, the estate SHA the run was
  built against, and a link to the public run inspector.
- A GitHub failure never fails the run: the `publish` step is marked
  failed, patch bodies stay queryable, and the PR url (or the failure)
  is recorded in `audit_log`.
- A cron-triggered cleanup (hourly) closes PRs and deletes
  `concord/run-*` branches older than 48 hours; idempotent, safe to run
  repeatedly.

## Verified security properties (Phase 20 — validation.md §8, executed 2026-07-27)

Every line was **run, not read**. ✔ = observed passing · ✖ = observed failing (reported, with
compensating controls) · ⛔ = operator-configured, verified against the dashboard/account or
recorded as awaiting operator confirmation.

**Secrets**
- ✔ A repo-wide grep for the Anthropic key prefix hits only the redaction pattern, the
  secret-scanner itself, a test assertion, and spec text. No key material.
- ✔ Built bundles: the concord-api worker bundle's only PEM-shaped string is jose's own parser
  constant; the relay worker bundle's only token-shaped strings are the redaction regexes; client
  bundles contain no secret and no ANTHROPIC references beyond a health-page display label.
  **Finding fixed during verification:** the Cloudflare Vite plugin copied `.dev.vars` (a real key)
  into `dist/` — gitignored and never uploaded, but now scrubbed by a post-build step
  (`scripts/scrub-dist-secrets.mjs`), verified by rebuild.
- ✔ `/api/health` (both Workers) and `/api/public/*` return probe results, versions, and ids —
  no environment values.
- ✔ Error responses are coded shapes (`{error:{code, copy_id}}` / `{"error":"code"}`): no stack
  traces, file paths, or config values observed on 404s, malformed JSON, or bad params.
- ✔ Pre-commit scan: a file planted with a fake Anthropic-prefixed key was blocked at commit
  ("Anthropic API key pattern found… commit blocked"), and it fired twice more organically during
  the build (a PEM-armor doc line and a sentinel string were both refused).

**Access / authorization**
- ✔ All six rejection cases re-run LIVE against the deployed Worker on the workers.dev host, which
  bypasses edge Access — the reason backend verification exists: missing header →
  `403 ACCESS_MISSING_ASSERTION`; self-signed, wrong `aud`, wrong `iss`, and expired forged JWTs →
  `403 ACCESS_INVALID_ASSERTION` (for forged tokens the signature fails first; the per-cause
  distinctions are proven by the correctly-signed test matrix).
- ✔ The valid-signature wrong-identity case was observed live on 2026-07-26: a genuine Access token
  the edge had admitted was rejected `ACCESS_DOMAIN_DENIED` by the backend — the second gate
  demonstrably works on its own.
- ✔ `DEMO_ADMIN_ENABLED` unset → admin routes 404 (test-verified; re-checked live after the final
  public deploy, which leaves it unset).
- ✔ No dev-auth bypass in the built bundles (grep of built output for skip/bypass branches finds
  none, alongside the source-level grep test).
- ⛔ Access policy uses "Emails ending in", with one-time PIN as a *login method* rather than an
  Include rule — **operator-verified in the Zero Trust dashboard**. The middleware passing does not
  prove this: its independent re-check would mask a wide-open policy, which is exactly why this line
  requires the dashboard.

**Code execution / SSRF**
- ✔ No `eval`, `new Function`, `child_process`, or process `exec` in any Worker or the kernel: all
  `exec(` hits are `RegExp.exec`, and the only `execFileSync` is a build-time script reading the
  submodule SHA, which never ships.
- ✔ No endpoint accepts a URL to fetch — every `fetch()` target in both Workers is code-derived
  (config vars, fixed API hosts, service bindings).
- ✖ **Kernel outbound fetch to a non-R2 host does NOT fail.** Cloudflare Containers currently have
  no per-container egress policy (COMPAT.md, Phase 04): the hardcoded startup probe observes
  `open:http_200` to an external host. That observation is now surfaced in `/api/health` as
  `kernel.detail.egress_probe` so it stays visible instead of being assumed away. Compensating
  controls, all tested: the kernel accepts no URL from any request (its only fetch is the
  Worker-signed `DatasetRef`, host-pinned via `RELAY_DATASET_HOST`), it sha256-verifies the dataset
  before parsing, and it enforces `max_bytes` on read. Reported as a platform limitation rather than
  softened into a pass.
- ✔ `filter_rows` operators are a closed enum, and no `DataFrame.query()` or `pd.eval` exists
  anywhere in the kernel (asserted by `tests/test_no_code_surface.py`).
- ✔ Unknown `operation_id` → 404 with no side effect (`test_unknown_operation_is_404`).

**Repository writes**
- ✔ Every denylist class is rejected and the denylist is checked before the allowlist — a path in
  BOTH lists is denied (asserted). Every traversal variant is rejected individually: `..`,
  URL-encoded `%2e%2e`, absolute, drive-letter, backslash, NUL/control characters, NFD unicode.
- ✔ The estate repo contains no `.github/` entry at all (`git ls-files` count: 0).
- ⛔ Repo 1 has no App installation — verified against the App's own installation list:
  `/installation/repositories` returns exactly one repository (`grainpool/doc-eng-demo-estate`), and
  a token-authenticated write attempt against repo 1 returned
  `403 Resource not accessible by integration`.
- ⛔ Branch protection on estate `main`: verified by attempting a direct push with a live
  installation token — `409 Repository rule violations found. Changes must be made through a pull
  request.` Re-verified after the ruleset was rescoped from `~ALL` to the default branch.
- ⛔ App permissions: the minted installation token reports exactly
  `{"contents":"write","metadata":"read","pull_requests":"write"}` — nothing more.
- ⛔ Concord's App is the only installation we control holding `Contents: write`. Confirming that
  Mintlify's app (expected, from Phase 11) holds read-only scopes requires the repository's
  installations settings page — the API endpoint is not available to an operator token, so this is
  **awaiting operator confirmation**.
- ✔ No patch, diff, or PR in any recorded run targets a path outside the estate repo (12 paths
  scanned across the five recordings; 0 outside).
- ✔ An eval run leaves `estate/` git-clean — defects are injected in memory only (checked after the
  final eval run).
- ✔ Installation tokens are repository-scoped (observed in the mint response) and never returned in
  a response: tests scan every result, response body, and recorded row for the token sentinel and
  PEM markers.

**Spend / abuse**
- ✔ Public routes make zero model calls — verified in the live database, not only in tests: every
  `model_call` row joins to a `mode='live'` run, except the pre-Phase-18 admin recording sessions in
  the 2026-07-26 05:00–06:22 window. The public path receives a null model client by construction
  (I11 test).
- ✔ Per-run call cap forced (`maxCallsPerRun: 1`) → run `partial`, reason `budget_exhausted`,
  exactly one call recorded, and starved impacts remain visible as `unresolved`.
- ✔ Per-day spend cap forced (`dailyCapUsd: 0`) → `partial` + `budget_exhausted` with **zero**
  calls: the gate closes before the first call rather than after it.
- ✔ Per-identity hourly limit (5) → 429; one concurrent live run → 409 naming the in-flight run id
  (observed live during Phase 18); admin body cap → 413 over 16 KB.
- ⛔ Zero Trust seat count and billing notification: **awaiting operator confirmation** — record the
  current count here; seat 51 converts the entire count to ~$7/user/month (≈ $357/mo, §5 above).
  This is the one cost in the design with no code-side counterpart at all.
- ⛔ An Anthropic Console org-level spend limit: **awaiting operator confirmation**. It is the floor
  beneath the in-app $5/UTC-day cap — the app cap is a product behaviour, the console limit is the
  backstop under it.

**Logging**
- ✔ No `Cf-Access-*` header value can reach a log line: denied-key redaction plus JWT-shape value
  redaction, enforced by `concord-api/test/redaction.test.ts`. That test also covers `ghs_`
  installation tokens — a gap found and fixed during this pass.
- ✔ Prompts are logged as hashes (`model_call.prompt_hash`; `prompt` and `completion` are denied
  keys). Presigned URLs are denied keys (`presigned`, `sig`).
- ✔ `audit_log` records every admin action (observed live: the rejected-mutation, the no-op, and the
  publishing run all present), and the public view redacts identity to the domain (observed:
  `identity_domain: "@grainpoolholdings.com"`).

## Operator-configured controls — real, but not enforced by code

These live in dashboards. They can be changed or lost without a failing test, which is why each has
a code-side counterpart wherever one is possible, and why re-verification means re-observing rather
than re-reading this file.

| Control | Where it lives | Code-side counterpart |
|---|---|---|
| Access application + email Include rule | Cloudflare Zero Trust | Independent domain/allowlist re-check in the middleware — proven live when the edge admitted an identity the backend refused |
| Branch protection on estate `main` | GitHub repo settings | None possible; verified by attempted direct push (409) — re-verify by attempt |
| App scope: three permissions, single-repo installation | GitHub App settings | Path allowlist/denylist checked twice, repository-scoped tokens, zero-GitHub-calls-on-refusal test |
| Zero Trust seat / billing notification | Cloudflare billing | None possible — seats are consumed at the edge before any request reaches code |
| Anthropic Console org spend limit | Anthropic Console | The in-app per-run and per-day caps, both forced in tests, sit above it |
