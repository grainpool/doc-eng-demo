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
  authenticates as `trejootoniel@gmail.com`, and the first live-run
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
