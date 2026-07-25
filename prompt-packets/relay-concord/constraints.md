# constraints.md — Non-goals, anti-patterns, and guardrails

Read this before every phase. If a phase prompt and this file appear to disagree, this file wins — and say so in your
response rather than resolving it silently.

---

## 1. Non-goals — do not build these, in any phase

| Not building | If you feel the urge |
|---|---|
| Real user authentication / signup / sessions for Relay | One fixed demo workspace. A signed cookie identifies "the demo user". That is the whole auth model. |
| Multi-tenancy, org/team hierarchies, RBAC | One workspace. `plan` and `role` exist as *product facts to document*, not as enforced authorization. |
| Billing, subscriptions, usage metering as a product feature | `plan.feature.*.min_plan` is a documentation fact. There is no checkout. |
| Generalized RAG, vector stores, embeddings, chunking | Relay chat gets the project's file list + schema summary in the prompt. That is sufficient and it is the point. |
| Arbitrary code execution anywhere | Eight named operations. No `eval`, `exec`, `DataFrame.query()`, Jupyter, notebook kernels, or user-supplied expressions. |
| Notebook infrastructure, distributed compute, job schedulers, HPC | One container, synchronous, per-request. |
| A connector ecosystem | **At most one** mock connector (`connector_drive`), and only if Phase 08 finishes early. It exists to create availability/permission/troubleshooting docs. It does not connect to anything. |
| A CMS, an editor, a WYSIWYG, a docs theme | Mintlify renders docs. Concord writes files. Concord's UI is read-only except the Change Lab's two allowlisted mutations. |
| Reimplementing Mintlify or Intercom | Adapters read and patch files. That is all. |
| An agent framework, orchestration DSL, plugin system, microservices | Two Workers, one container, one queue. Direct function calls inside packages. |
| SSR, React Server Components, Next.js, Remix | Vite + React SPA + Workers static assets. |
| An ORM | D1 with `.prepare()` and numbered `.sql` migrations. The schema is small; every query should be readable in the file that runs it. |
| A real Intercom integration | `HelpCenterAdapter` + local fixture. Documented as a deliberate non-goal in the README, not as a gap. |
| Hand-authored `llms.txt` | Mintlify generates it. See §G7. |
| Infrastructure whose purpose is looking sophisticated | If you cannot name the specific documentation state a component makes possible, delete it. |

## 2. Anti-patterns — specific things that will break this project

### AP1 — One magical YAML that controls all product truth
The most tempting mistake, and it destroys the demo. Product truth **must** originate from six structurally different
places (`architecture.md` §4). If all facts came from one file, there could be no authority arbitration, no conflicts,
no escalation, and Concord would be a template renderer. When adding a fact, ask *which kind of source is authoritative
for it* and put it there.

### AP2 — Making textual uniformity the goal
The objective is **semantic** consistency. `"10 MB"`, `"up to 10 MB per file"`, and a table cell reading `10485760` are
all correct simultaneously. Never write a check that compares doc strings to each other. Compare **normalized asserted
values** (`contracts.md` §12). A "make all surfaces say the same words" feature is a regression.

### AP3 — Letting the model decide the action class
Classification is deterministic rules (`architecture.md` §6.1). The model writes prose and extracts candidates; it never
chooses between "auto-apply" and "escalate". If you find yourself prompting "decide whether this needs review", stop.

### AP4 — Optimistic provenance
Provenance recorded *after the fact* by looking values up is fake provenance. `KernelResult.versions` is captured in the
same response as the numbers it produced, and stored verbatim. Never re-query `/versions` when writing an artifact row.

### AP5 — Patches without mechanical anti-hallucination checks
"The prompt says not to invent facts" is not a control. The control is: run the extractors over the patch body and reject
any fact key not present in the evidence set (`contracts.md` §14 gate 2).

### AP6 — Silent drops
Any impact detected in trace must reach a terminal disposition. Never `continue` past an impact you cannot handle;
record `unresolved` with a reason. Same for findings suppressed by falsification — they are stored and displayed, not
deleted.

### AP7 — Manufacturing eval numbers
Do not tune the fixture until the score looks good. Do not delete a defect the system misses. The eval fixture is
authored **before** the detector for that class, and misses become entries in "What the system gets wrong". A phase that
reports 100% precision and 100% recall has a broken harness, and should be treated as a failing phase.

### AP8 — Hardcoded strings in the UI
Every user-visible string comes from the copy registry, because the copy registry is a documentation surface Concord
reconciles. A hardcoded string is invisible to the whole system.

### AP9 — Introspection that can drift from behavior
`relay introspect --json` must be derived from the live `commander` tree. A hand-written manifest makes the "CLI is
authoritative" claim false and will generate confidently wrong docs.

### AP10 — Trusting the Access header
`Cf-Access-Jwt-Assertion` present ≠ authorized. Verify signature, `aud`, `iss`, expiry, and email domain. A hidden
route is not authorization.

### AP11 — Doing later phases early
If Phase 05 tempts you to add the fact graph "since it's related", don't. The phase boundaries are the debugging
strategy. Note the idea in `NOTES.md` and move on.

### AP12 — Deferring the log helper, error shape, or copy registry
These are cross-cutting and retrofitting them is expensive. The log helper and error shape land in Phase 01, the copy
registry in Phase 03 (used, formalized in Phase 08).

---

## 3. Guardrails

**G1 — Do not restructure packages.** The package list and dependency directions in `architecture.md` §2 are fixed.
Adding a package requires stating why in your response.

**G2 — `concord-core` imports nothing from Cloudflare.** No `@cloudflare/workers-types` in its runtime code, no `env`,
no `fetch` of remote resources. Pure functions over plain data. This is what makes the reconciliation logic testable
and readable, and it is non-negotiable.

**G3 — `@relay/contracts` depends only on `zod`.** It is the freeze surface; every dependency added to it is a
dependency both apps inherit.

**G4 — Coupling boundary.** `concord-*` may import `@relay/contracts` and may call exactly two Relay HTTP endpoints
(`contracts.md` §10). Add an ESLint `no-restricted-imports` rule plus a test asserting no other `/api/` literal appears
in `concord-*` source. Concord must never import from `relay-api`, `relay-web`, or `relay-cli`.

**G5 — After Phase 09, `@relay/contracts` is frozen.** Changes need a minor version bump, an entry in
`CONTRACTS-FROZEN.md`, and an explicit note in your response. Do not casually reshape a schema Concord depends on.

**G6 — Forward-only migrations.** Add a new numbered `.sql` file. Never edit an applied one.

**G7 — Never author `llms.txt` or `llms-full.txt`.** Mintlify generates and hosts them. Concord's agent-facing work is
to reconcile the *inputs*: page frontmatter `description`, `docs.json` `description`, and `markdown.instructions`.
Producing a hand-written `llms.txt` would create a second artifact that immediately drifts from the served one.

**G8 — Never hand-patch a file with the generated marker.** `DocUnit.generated === true` ⇒ `adapter.patch()` throws.
Regenerate instead. If a generated file was hand-edited, overwrite it and record a warning in the run.

**G9 — Respect the 6-concurrent-outgoing-connection Workers limit.** Batch model fan-out in groups of ≤ 5. A
`Promise.all` over 20 impacts will stall.

**G10 — Structured outputs, always, for machine-consumed model results.** `output_config.format` with a JSON Schema
derived from Zod. Never regex or JSON-parse prose into a decision.

**G11 — `stop_reason: "refusal"` is checked before reading `content` on every single model call.** No exceptions.

**G12 — One model constant.** `MODEL_ID` in `@relay/contracts/src/model.ts`. Do not scatter model ids. Do not
substitute a cheaper model on your own initiative — cost is controlled by `effort`, caps, and replay mode.

**G13 — Do not send `temperature`, `top_p`, `top_k`, or `thinking.budget_tokens`.** All rejected with 400 on
`claude-opus-5`. Do not use assistant prefill. Use `output_config.effort` as the cost/quality lever.

**G14 — No secret ever reaches the client or the repo.** `wrangler secret put` only. No secret in `wrangler.jsonc`
`vars`, no secret in a build output, no secret echoed by any endpoint including health checks. `.dev.vars` is
gitignored and referenced in `.gitignore` from Phase 01.

**G15 — The kernel makes no outbound request except to the presigned R2 URL host.** No user-supplied URL is ever
fetched by any server component. There is no "fetch this URL for me" feature anywhere in this project.

**G16 — Deterministic before AI.** If a change is mechanically resolvable, the AI path must not see it. Ordering is
structural: classification runs before any proposal call.

**G17 — Every model call is attributed and capped.** Write a `model_call` row with purpose, run id, and token counts.
Check the per-run and per-day cap *before* the call, not after.

**G18 — Do not add a dependency without justifying it in your response.** The approved set: `zod`, `hono`, `jose`,
`commander`, `react`, `react-dom`, `vite`, `@cloudflare/vite-plugin`, `wrangler`, `vitest`,
`@cloudflare/vitest-pool-workers`, `@anthropic-ai/sdk`, `ulid`, `gray-matter`, `@octokit/*` (Phase 19),
`fastapi`/`uvicorn`/`pandas`/`numpy`/`scipy`/`statsmodels`/`matplotlib` (kernel). Anything else needs a reason.

**G19 — Windows-friendly.** The developer is on Windows. No shell-specific scripts in `package.json` beyond what runs
under PowerShell and Git Bash. No `&&`-chained POSIX-only commands, no `rm -rf` in scripts — use `rimraf` or a Node
script. Paths in code use `path.join`, never string concatenation with `/`.

**G20 — Tests are part of the phase, not a follow-up.** A phase is not complete without the tests its verification row
requires.

---

## 4. Performance and reliability constraints

| Constraint | Value | Rationale |
|---|---|---|
| Public page TTFB | < 500 ms | Static assets from the edge; no model calls, no cross-region reads. |
| Kernel operation timeout | 8 s hard, 5 s target | Container start + op. Exceeding it is a 503, not a hang. |
| Worker CPU (AI routes) | raise `limits.cpu_ms`; default 30 s is not enough | See `research-findings.md` §1. |
| Reconciliation run (deterministic) | < 5 s | Keeps Phases 10–13 synchronous and debuggable. |
| Reconciliation run (with AI) | < 3 min | Queue consumer; 15 min ceiling gives headroom. |
| Model calls per live run | **≤ 20 hard cap** | Enforced in code; run ends `partial` on exhaustion. |
| Model spend per day | **≤ $5 hard cap** | Enforced from `model_call` rows before each call. |
| Live runs per Access identity per hour | ≤ 5 | Rate limit; replay is unlimited. |
| Upload size | 10 MB | Matches `limit.upload.csv.max_bytes`; the enforcement point *is* the fact. |
| D1 queries | indexed; no full scans on fact/projection tables | D1 bills `rows_read`. |
| Concurrent outgoing model calls | ≤ 5 | Workers allows 6 simultaneous. |
| Concurrent live runs | 1 | A lock row in D1. Second run rejected with the in-flight id. |

## 5. Compatibility constraints

- Node 22+ for tooling and the CLI. `pnpm` 9+.
- Workers runtime — no Node built-ins unless `nodejs_compat` is enabled and the import is verified to work.
- D1 is SQLite: no `RETURNING` assumptions beyond what wrangler's version supports, no stored procedures, JSON via
  `json_extract`. Booleans are `INTEGER 0/1` — normalize at the repository layer, never leak `0`/`1` into contracts.
- Kernel image pins **exact** versions in `requirements.txt` (`pandas==x.y.z`, not `>=`). Version drift would silently
  change a product fact.
- Mintlify config is `docs.json` (not `mint.json`), and `$ref` splitting is used so generated fragments are separate
  files.
- Browser target: last two versions of evergreen browsers. No polyfills, no IE handling.

## 6. What must not be refactored or redesigned without necessity

1. The six product-truth tiers and the fact-key registry (`contracts.md` §3).
2. The action-class rule table (`architecture.md` §6.1).
3. `DocUnit` id format (`contracts.md` §2) — ids must be stable across runs and weeks.
4. `SurfaceAdapter` interface (`contracts.md` §11) — six implementations depend on it.
5. Evidence-mandatory patch validation (`contracts.md` §14).
6. `Conflict.resolution: null` (`contracts.md` §15).
7. The public/privileged split and the `DEMO_ADMIN_ENABLED` default-off flag.
8. The mutation and path allowlists (`security.md` §4).
9. The 18 invariants (`contracts.md` §18).

If a phase genuinely requires changing one of these, say so explicitly, explain the forcing constraint, and propose the
minimal change. Do not change one quietly to make a test pass.
