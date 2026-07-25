# research-findings.md — Platform reality as verified 2026-07-25

This file exists so the coding agent does not re-derive platform facts, and so that when reality disagrees with this
packet the disagreement is visible rather than silent. **Every architectural choice below is already decided.** The
agent's job is to confirm the observed behavior in Phase 01 and record it in `COMPAT.md` — not to reopen the choice.

**Rule for the agent:** if a fact here is wrong at build time, preserve the *objective* (see the "Objective" line for
each section), pick the simplest currently-supported alternative, and write the deviation to `COMPAT.md` with the
observed evidence. Never silently substitute an unsupported architecture.

---

## 1. Cloudflare runtime and deployment model — DECIDED

**Objective:** simplest stable deployment of a React UI + TypeScript API + persistence, on Cloudflare.

**Decision: Workers with Static Assets, built by `@cloudflare/vite-plugin`. One Worker per app (Relay, Concord).
Not Pages. No SSR framework.**

Verified:
- Workers with static assets deploy the front-end **and** the Worker as a single unit; assets are configured in
  `wrangler.jsonc` as `assets: { directory, binding, not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`.
  `env.ASSETS.fetch(request)` is available for programmatic serving.
- `@cloudflare/vite-plugin` runs the dev server against `workerd` (the real runtime), and a single `deploy` ships
  both halves. Cloudflare documents a "React SPA with an API in the same Worker" path explicitly.

Rejected: **Pages** (the Workers+assets model is where Cloudflare's full-stack investment is, and it gives us
`run_worker_first` routing plus first-class bindings in one config). **Next.js/OpenNext** (adds an adapter layer whose
only purpose here would be SSR we do not need — the spec's scope-discipline section forbids exactly this).

Limits that shaped the design (Workers Paid):
| Limit | Value | Consequence for us |
|---|---|---|
| CPU time / request | 5 min max, **30 s default** | Must raise `limits.cpu_ms` for AI paths; still not enough for a 15-call reconciliation run → Queues at Phase 14. |
| Wall clock | unlimited while client connected; `waitUntil` +30 s | Streaming chat is fine. Background work is not — hence Queues. |
| Subrequests / request | 10,000 | Non-issue. |
| Simultaneous outgoing connections | **6** | Fan-out (adversarial verification, Phase 15) must be batched ≤ 6 concurrent. This is a real constraint — respect it. |
| Request body | 100 MB (Free/Pro zone) | CSV upload cap of 10 MB is far below it. Non-issue. |
| Queue consumer / DO alarm wall time | 15 min | Comfortably covers a full reconciliation run. |

---

## 2. Python / data-analysis execution — DECIDED (this is the deviation that matters)

**Objective:** real `pandas`/`scipy`/`statsmodels`/`matplotlib` analysis, a *bounded* operation set, and package
versions that are (a) pinned by us and (b) readable at runtime as authoritative product truth.

**Decision: a Cloudflare Container (`packages/relay-kernel`) running a small FastAPI app that exposes exactly eight
named operations. No code-execution endpoint of any kind.**

Verified:
- Cloudflare Containers are **available on the Workers Paid plan**, invoked from a Worker via
  `getContainer(env.MY_CONTAINER, sessionId).fetch(request)`. Config requires a `[[containers]]` block plus a Durable
  Object binding and a `new_sqlite_classes` migration. `sleepAfter` (e.g. `"10m"`) stops idle instances; billing is per
  10 ms of active runtime with an allowance included in the $5/mo plan.
- Python Workers exist and use Pyodide; package support is "pure and PyEmscripten packages on PyPI plus packages
  included in Pyodide," and Cloudflare's own docs state **"WebAssembly support for Python packages is still in early
  stages, and some packages may not yet be available as PyEmscripten wheels."** The docs page does not list
  `pandas`, `scipy`, `statsmodels`, or `matplotlib`.

**Why Pyodide is rejected**, in order of importance:
1. **It breaks a product requirement, not just convenience.** "Runtime/package versions" is one of the product truths
   Concord must treat as authoritative, and a later product change is "a new analysis package/capability becomes
   available." Under Pyodide those versions are the *platform's*, not yours — you cannot bump `pandas` to create a
   documentation-relevant change. Under a container, `requirements.txt` is a first-class product-truth source.
2. Wheel coverage for that four-package combination is explicitly early-stage. `matplotlib` rendering to PNG under
   Emscripten is the most fragile part.
3. Cold-start and bundle-size risk on the exact path a demo visitor exercises.

**Why not the Anthropic code-execution server tool** (which does ship pandas/scipy/statsmodels/matplotlib): it is
*arbitrary code execution*, which your spec rules out; it charges per analysis; and it relocates the provenance-critical
runtime outside your control. It remains a legitimate *optional* later extension, and is explicitly out of scope.

Kernel contract essentials (full spec in `contracts.md` §4):
- `POST /op/{operation_id}` with a validated JSON body. **Operation ids are a closed enum.** Unknown id → 404.
- `GET /versions` → `{python, pandas, numpy, scipy, statsmodels, matplotlib, image_digest}`. This is the T0 RUNTIME
  authority source.
- `GET /operations` → the operation catalog with parameter schemas. Feeds generated docs.
- No `eval`, no `exec`, no user-supplied expressions, no `pandas.query()` on raw user strings, no file paths from the
  request. Data arrives as a presigned R2 URL fetched by the kernel, or as a request-body blob under 10 MB.

**Contingency (documented, not built):** all eight operations sit behind an `AnalysisKernel` TypeScript interface in
`packages/relay-api`. If Containers are unavailable to you, a `JsKernel` implementing five of the eight ops in
TypeScript is a ~400-line swap that keeps Phases 05–09 viable, at the cost of the `runtime.package.*` fact family.
Do not build both.

---

## 3. Cloudflare Access — OTP + email-domain policy + JWT validation — DECIDED

**Objective:** only `@anthropic.com` addresses can reach the privileged mutation environment; the backend, not the UI,
enforces it.

Verified:
- Access can send a **one-time PIN** to approved email addresses with no IdP integration; the PIN **expires after
  10 minutes**. If the address matches no Allow policy, **Access does not send a PIN at all**.
- The correct policy shape is: **Action `Allow`**, rule type **`Include`**, selector **"Emails ending in"**, value
  `@anthropic.com`.
- **Critical misconfiguration to avoid:** do **not** put "One-time PIN" in an `Include` rule under *Login Methods* —
  that admits everyone who can use OTP. OTP is the *login method*; the domain rule is the *authorization*.
- Access injects a signed JWT in the **`Cf-Access-Jwt-Assertion`** header. Cloudflare's docs are explicit that
  **presence of the header is not sufficient** — the origin must verify the signature against the team's JWKS at
  `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`, and check `aud` against the application's AUD tag
  and `iss` against the team domain. Skipping this permits identity spoofing.

**Decision:** verify with `jose` (`jwtVerify` + `createRemoteJWKSet`), which runs on WebCrypto in `workerd`. Cache the
JWKS in-process. Reject on: missing header, bad signature, `aud` mismatch, `iss` mismatch, expiry, **and** an email
claim not ending in `@anthropic.com` (belt-and-braces — the policy is the gate, the code re-checks). Details:
`security.md` §2.

---

## 4. Mintlify — DECIDED

**Objective:** a real Git-backed developer docs site that Concord can read and patch, with machine-readable output.

Verified:
- Current config file is **`docs.json`** (not `mint.json`). Minimum viable keys: `theme`, `name`, `colors.primary`,
  `navigation`. `$ref` is supported **at any level** to split config across files — we use this so Concord can patch a
  small generated fragment without rewriting the whole config.
- Mintlify **automatically generates and hosts `/llms.txt` and `/llms-full.txt`** (also served under
  `/.well-known/`), and advertises them via `Link: </llms.txt>; rel="llms-txt"` and an `X-Llms-Txt` header. Page links
  in `llms.txt` carry a **`.md`** extension so agents can fetch the Markdown of any page directly. `llms.txt` content
  is driven by page frontmatter `description` and the site `description` in `docs.json`.
- Agent-facing instructions are configured via **`markdown.instructions`** in `docs.json`, and are appended to every
  page's generated Markdown *and* to `llms.txt` / `llms-full.txt`.

**Where it lives:** the Mintlify project is `docs-mintlify/` in the **estate repo (repo 2)**, connected to Mintlify's
GitHub app directly. Mintlify builds from repo 2 on merge; repo 1 mounts repo 2 at `estate/` as a submodule only so
that builds and ingestion can read it from disk.

**Consequences — these are hard rules for Concord (`constraints.md` §G7):**
- Concord **must not** hand-author `llms.txt`. It is generated. Instead, Concord treats **page frontmatter
  `description`** and **`docs.json` `description` / `markdown.instructions`** as the doc units that *control* agent-facing
  output, and reconciles those. This is the honest answer to "documentation for agents": improve the inputs, don't forge
  the artifact.
- Concord's Mintlify adapter reads `.mdx` files + frontmatter + `docs.json` navigation. Patches are file diffs.
- No Mintlify write API is used. Publishing is Mintlify's GitHub integration reacting to a merged PR.

---

## 5. Intercom — DECIDED: adapter contract now, integration later (optional)

Verified: Intercom's Help Center REST API supports creating/updating articles and collections; creating an article
requires an `author_id` (fetched from `GET /me`); **developer workspaces are free and available to non-customers**.

**Decision: build `HelpCenterAdapter` against a local fixture (`help-center/` in the estate repo) and do not build the
Intercom integration.** Rationale: a real Intercom instance introduces OAuth setup, external mutable state, and an article model
the demo must then mirror — against your explicit requirement that the project be reproducible from a public repo and
not blocked on external SaaS. The adapter interface (`contracts.md` §11) is shaped so an `IntercomHelpCenterAdapter` is
a drop-in later; note that as an explicit non-goal in the README rather than a gap.

---

## 6. GitHub App — least-privilege ephemeral PRs — DECIDED

**Objective:** a privileged visitor-triggered run can open a PR on the documentation estate repo and nothing more.

Verified:
- Opening a PR requires the app to reference commits and branches, so the minimum useful permission set is
  **Contents: write + Pull requests: write + Metadata: read**. `Pull requests: write` alone cannot create the branch.
- When minting an **installation access token**, you may pass `repositories` / `repository_ids` to scope that specific
  token to a subset of the installation's repos.
- **Branch protection on `main` forces a Contents-write token through the PR path** — it cannot push to the protected
  branch directly.

**Decision, all four layers required:**
1. A **GitHub App installed on the estate repo only** (repo 2), permissions above and nothing else. No PAT. Repo 1 —
   code, CI, product truth — has no installation, so it is outside the App's reach entirely.
2. Every installation token minted **per-run**, scoped to that one repo id, short-lived.
3. **Branch protection on `main`** of repo 2: require PR, no force push, no deletions.
4. **Repo 2 contains no `.github/` directory at all**, and `.github/**` is denied by the path filter. Since all CI lives
   in repo 1 where the App is not installed, there is no privileged workflow a visitor-authored branch can introduce or
   trigger. This is a structural property, not a reliance on GitHub's workflow-trigger semantics — which do protect
   `pull_request` runs by using the base branch's workflow definition, but with enough nuance around `pull_request_target`
   and `push` that it is the wrong thing to rest an argument on.

---

## 7. Anthropic API usage — DECIDED

- Model: **`claude-opus-5`** from one constant (`packages/contracts/src/model.ts`). Adaptive thinking is on by default
  on this model; set `thinking: {type: "adaptive"}` explicitly for clarity. Use `output_config: {effort: "..."}` as the
  cost/latency lever — **not** model downgrade. Do not send `temperature`/`top_p`/`top_k` or `budget_tokens`; both are
  rejected (400) on this model. Do not use assistant prefill (400).
- **Structured outputs everywhere a machine consumes the result**: `output_config.format` with a JSON Schema generated
  from the Zod contract. Used for (a) NL→analysis-op translation, (b) grounded patch proposals, (c) conflict
  classification, (d) adversarial falsification verdicts. Never parse prose into a decision.
- `stop_reason: "refusal"` must be handled before reading `content` on every call. Opt into server-side fallbacks
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on Concord's proposal path.
- Streaming for Relay chat. Non-streaming + structured output for everything Concord does.
- Prompt caching on the large stable prefixes (fact-graph context, style guides). Keep volatile content — timestamps,
  run ids — strictly *after* the last `cache_control` breakpoint. Verify with `usage.cache_read_input_tokens`.

## 8. Persistence — DECIDED

**D1 for relational state, R2 for blobs.** D1 caps at 10 GB/database on Paid; billing is `rows_read`/`rows_written`, so
index the hot paths and never full-scan the fact tables. Session/read-replication APIs are Worker-binding-only — not
needed here. Two databases: `relay_db` and `concord_db`, so the freeze boundary is also a storage boundary. Two buckets:
`relay-artifacts` (uploads, plots, derived CSVs) and `concord-runs` (patch bodies, run reports).

**Queues** (Phase 14+) for reconciliation runs: one producer (privileged API), one consumer Worker, run/step state in
D1 so any past run is publicly inspectable. **Workflows rejected** — it would own the run state we deliberately keep in
D1 for the demo's inspectability, for no gain at this scale.

---

## Deviations from the original specification

| Spec statement | What we do instead | Reason |
|---|---|---|
| "Python-backed analysis using ordinary libraries… research the current Cloudflare execution options" | Cloudflare **Container**, not Python Workers | Pyodide wheel coverage is early-stage for the pandas+scipy+statsmodels+matplotlib set, and it removes your control over package versions — which the product-truth model depends on. §2. |
| "A help/support knowledge base conceptually similar to an Intercom Help Center" | `HelpCenterAdapter` + local Markdown/JSON fixture; Intercom not built | Your own fallback clause. Keeps the project reproducible from `git clone`. §5. |
| "queues or workflows only if genuinely useful" | Queues, introduced at Phase 14 | Worker CPU default is 30 s; a run makes 5–15 model calls. Queue consumers get 15 min. Workflows rejected as redundant with D1 run records. §1, §8. |
| "`llms.txt` … agent-readable documentation" | Do **not** author `llms.txt`; reconcile the frontmatter and `docs.json` fields that generate it | Mintlify generates and hosts it automatically. Hand-writing it would create a fake artifact that drifts from the real one. §4. |
| Cloudflare Free tier implied nowhere but worth stating | **Workers Paid required** | Containers need it; Free caps CPU at 10 ms, which cannot host an AI call. §1. |
| "public, inspectable source code" (repo count unspecified) | **Two public repos**: a code monorepo and a separate documentation estate, joined by a submodule | The GitHub App needs `Contents: write` and a visitor can trigger a run. Installing it where CI lives would make safety depend on GitHub's workflow-trigger semantics. Splitting makes it structural. §6. |

## Sources

- [Cloudflare Workers — Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers — Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare Workers — Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Containers — Overview](https://developers.cloudflare.com/containers/) · [Pricing](https://developers.cloudflare.com/containers/pricing/)
- [Cloudflare Workers — Python packages](https://developers.cloudflare.com/workers/languages/python/packages/) · [How Python Workers work](https://developers.cloudflare.com/workers/languages/python/how-python-workers-work/)
- [Cloudflare One — Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) · [Common policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/) · [One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) · [Application token / JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- [Cloudflare D1 — Limits](https://developers.cloudflare.com/d1/platform/limits) · [Pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Mintlify — docs.json schema reference](https://www.mintlify.com/docs/organize/settings-reference) · [AI ingestion](https://mintlify.com/docs/ai-ingestion)
- [Intercom — Create an Article](https://developers.intercom.com/docs/guides/help-center/create-an-article) · [Create a developer workspace](https://www.intercom.com/help/en/articles/9086429-create-a-developer-workspace-in-intercom)
- [GitHub — Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
