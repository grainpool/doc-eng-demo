# implementation-plan.md — 20 phases

Ordering principle: **prove the riskiest external chain first, then build to a frozen contract, then reason over a
fixture that cannot move.** Each phase has an objective, a scope fence, acceptance criteria, and an explicit "wait until
later" list. The "wait" lists are the most important part — they are what keep any single phase debuggable.

Blocks: **0** walking skeleton (01) · **A** Relay (02–09) · **FREEZE** (gate) · **B** Concord (10–20).

---

# Block 0 — Walking skeleton

## Phase 01 — Prove every dependency, deployed, with no product logic
- **Objective** Confirm that Workers + static assets + D1 + R2 + Container + Anthropic all work together on the real
  domain, before a single feature exists.
- **Scope** pnpm monorepo skeleton; `relay-api` Worker with Vite/React page; `relay_db` + `relay-artifacts`;
  `relay-kernel` container with only `/health` and `/versions`; one `/api/health` route exercising all five; the
  structured log helper; the error shape; `.gitignore` + secret scan; CI (typecheck, lint, test, build).
- **Dependencies** Cloudflare account, Workers Paid, domain, `ANTHROPIC_API_KEY`.
- **Outputs** Live URL. `GET /api/health` → five checks with real values (including `pandas.__version__` from the
  container). `COMPAT.md` recording observed versions, limits, and any deviation. Green CI.
- **Acceptance** Every check green from the public URL, not just locally. `pnpm typecheck && pnpm lint && pnpm test`
  passes. No secret appears in the built client bundle (grep it). `COMPAT.md` exists and is non-trivial.
- **Wait until later** Any product model, any UI beyond one page, any Concord package, any auth, any real analysis op.
- **Risk** Highest of any phase, deliberately. If Containers or the Vite plugin misbehave, you learn now with nothing
  invested.

---

# Block A — Relay product fixture

## Phase 02 — Contracts, fact registry, schema
- **Objective** Establish the freeze surface and the six product-truth tiers as code.
- **Scope** `@relay/contracts`: ids, error codes, `FACT_REGISTRY`, `FactClaim`/`ProductTruthSnapshot`, operation
  enum + param schemas, `MODEL_ID`, branding constants, plan/platform enums. D1 migration `0001` for Relay tables.
  Tier-resolver stubs for T0–T5 (real values wired in later phases). `zodToJsonSchema` helper for structured outputs.
- **Dependencies** 01.
- **Outputs** `packages/contracts` with tests. `/api/product-truth` returning T1 + T3 facts for real, T0/T2/T4/T5 as
  empty arrays with a `pending` marker.
- **Acceptance** Every key in `contracts.md` §3.1 resolves to exactly one authoritative tier. A test asserts no key maps
  to two tiers. `ProductTruthSnapshot` round-trips through Zod. `pnpm --filter @relay/contracts test` green.
- **Wait until later** Actual T0 values (Phase 04), T2 (07), T4/T5 (08). Any Concord consumption.

## Phase 03 — Projects, files, limits, UI shell
- **Objective** The workspace surface, with limits enforced in exactly one place and rejection text sourced from copy.
- **Scope** Projects CRUD (create/list/show, `state` field), file upload to R2 with sha256 + row/column counting,
  supported-type and size validation in `relay-api/src/limits.ts`, demo-user signed cookie, React shell with project
  list / project detail / file list / uploader. First copy entries (informal JSON, formalized in Phase 08).
- **Dependencies** 02.
- **Outputs** Working create-project → upload-CSV → see-file flow, deployed.
- **Acceptance** Over-limit upload returns `{error:{code, copy_id}}` and the UI renders the message from the registry —
  grep confirms no literal size string in `relay-web`. Unsupported extension rejected with a distinct code. File row
  carries sha256, byte size, row/column counts.
- **Wait until later** Analysis, artifacts, CLI, chat.

## Phase 04 — Analysis kernel container (riskiest product component)
- **Objective** Eight bounded operations in a container, with runtime introspection, and no code path.
- **Scope** `packages/relay-kernel`: Dockerfile with pinned `requirements.txt`; FastAPI app; the eight operations
  (`contracts.md` §4.1); `filter_rows` structured predicates; `/versions`, `/operations`, `/health`. Worker-side
  `AnalysisKernel` interface + `ContainerKernel` implementation; presigned R2 URL generation with ≤ 60 s TTL; sha256
  verification; `POST /api/internal/kernel/op/:id` proxy for testing.
- **Dependencies** 03.
- **Outputs** All eight ops callable and correct. `/operations` matches the contract. T0 facts now real in
  `/api/product-truth`.
- **Acceptance** `curl` each of the eight through the Worker proxy against a fixture CSV; results are numerically
  correct (compare against a checked-in expected-output fixture). A test enumerates kernel routes and asserts none
  accepts code, an expression, or a path. Outbound fetch to a non-R2 host from inside the container fails.
  `runtime.package.*` facts appear with real versions and the image digest.
- **Wait until later** Any NL layer. Any session concept. Any UI. Artifact persistence.

## Phase 05 — Analysis sessions + NL translation
- **Objective** The user-facing analysis loop, with a router-not-executor NL layer that refuses cleanly.
- **Scope** Session + turn models; session UI (dataset preview, prompt box, result rendering for scalars/tables/plots);
  NL→operation translation via structured output with the closed enum; re-validation of `params` against the operation
  schema; optional streamed narration constrained to returned numbers; refusal and error handling
  (`kernel_unavailable`, `unsupported_request`, schema-invalid retry-once).
- **Dependencies** 04.
- **Outputs** End-to-end: upload CSV → "which columns correlate?" → correlation table rendered.
- **Acceptance** Happy path works for at least four distinct natural-language prompts mapping to four different
  operations. A prompt for something unsupported (e.g. "train a random forest") returns `kind: "unsupported"` with
  alternatives and makes **no** kernel call. A 422 is returned when `params` fail operation-schema validation.
  `stop_reason === "refusal"` is handled before `content` is read.
- **Wait until later** Artifact persistence and lineage (06). Chat outside a session.

## Phase 06 — Artifacts, provenance, lineage
- **Objective** Every output is a durable artifact whose origin is fully answerable.
- **Scope** `Artifact` + `Provenance` persistence (plots and tables to R2, rows to D1); provenance captured verbatim
  from `KernelResult.versions` at computation time; `derived_from_artifact_ids` for artifact→artifact lineage; artifact
  list + detail + lineage view in the UI; retention expiry derived from `retention.artifact.days`; download endpoints.
- **Dependencies** 05.
- **Outputs** Artifact detail page answering: which source file, which operation, which params, which package versions,
  when.
- **Acceptance** Insert without complete provenance is impossible (schema `NOT NULL` + Zod parse; test asserts the
  failure). Lineage renders for a two-step chain (filter → correlate). Provenance versions equal the kernel response
  captured in that turn, not a later lookup.
- **Wait until later** CLI. Copy formalization. Releases.

## Phase 07 — CLI + introspection
- **Objective** A second real product surface, and the authoritative source for CLI mechanics.
- **Scope** `packages/relay-cli` with `commander`: the seven command groups (`contracts.md` §7), global flags, real
  `--help` at every level, contractual exit codes, real error behavior against a live API. `introspect --json` derived
  by walking the live command tree. Wire T2 facts into `/api/product-truth` (introspection captured in CI and committed
  as `fixtures/cli-introspection.json`).
- **Dependencies** 06.
- **Outputs** Installable CLI; committed introspection fixture; T2 facts live.
- **Acceptance** For every command, `introspect --json`'s `usage` string equals what `--help` prints (asserted in a
  test). Wrong token → exit 3. Unknown project → exit 4. Bad flag → exit 2. `--json` output validates against the
  contract schema.
- **Wait until later** Generated CLI docs — that is Concord's job (Phase 13).

## Phase 08 — In-product copy registry, releases, product-truth completion
- **Objective** Make UI copy a first-class documentation surface, and give Concord temporal data.
- **Scope** Formal copy registry (`CopyEntry` with `references_facts`, `kind`, `editorial_register`, `owner`); migrate
  every string in `relay-web` to `t("id")`; lint rule against literal JSX text; `GET /api/copy-registry`.
  `surfaces/releases/*.yaml` with ≥ 6 historical records; `surfaces/decisions/*.yaml` with ≥ 3 T5 records. T4 + T5
  wired into `/api/product-truth`. Optional (only if time remains): the mock `connector_drive` feature — availability
  facts, settings copy, a troubleshooting-worthy failure state. No real integration.
- **Dependencies** 07.
- **Outputs** Complete `ProductTruthSnapshot` across all six tiers. `/api/copy-registry` live.
- **Acceptance** Lint fails on a deliberately added literal string. Every copy entry that states a number declares the
  corresponding `references_facts` key — **except** the 3–4 deliberately left undeclared as `UNDECLARED_FACT_REF` eval
  seeds, which are listed in `fixtures/eval/defects.json`. Six tiers all return non-empty.
- **Wait until later** Reconciling any of it. That is Block B.

## Phase 09 — Relay hardening + CONTRACT FREEZE ⛔ gate
- **Objective** Turn Relay into a stable fixture and make the stability contractual.
- **Scope** Test coverage for every route and every kernel operation; `pnpm seed:relay` producing byte-identical state
  from an empty D1 (3 projects, 5 files, 4 sessions, ~12 artifacts); rate limits and per-day model spend cap on Relay's
  chat/NL paths; error-path tests; README for each Relay package; `CONTRACTS-FROZEN.md`; `git tag relay-contracts-v1`.
- **Dependencies** 08.
- **Outputs** Tagged, seeded, tested Relay. `CONTRACTS-FROZEN.md` enumerating exactly what Concord may rely on.
- **Acceptance** `pnpm test` green. Seed run twice from empty → identical `ProductTruthSnapshot` (ignoring timestamps).
  Tag exists. `CONTRACTS-FROZEN.md` lists the two Concord-visible endpoints, the fact registry, and the version.
- **Wait until later** Everything Concord.

## ⛔ FREEZE GATE
Do not start Phase 10 until: the tag exists; the seed is reproducible; `/api/product-truth` returns all six tiers; and
`/api/copy-registry` and `fixtures/cli-introspection.json` are stable. From here, a `@relay/contracts` change requires a
version bump and a `CONTRACTS-FROZEN.md` entry.

---

# Block B — Concord

## Phase 10 — The tiny milestone: one fact, two surfaces, one deterministic result
- **Objective** Prove the fact→projection→impact→action chain end to end with the smallest possible system.
- **Scope** `concord-core` skeleton (pure); **two** adapters only (`mintlify`, `inproduct`); **one** fact
  (`limit.upload.csv.max_bytes`); the `declared_reference` extractor only; the classification rule table with only
  rules 2, 3, and 6 reachable; one deterministic generator; `concord-api` Worker + `concord_db` migration `0001` +
  synchronous run endpoint; a minimal run-report page.
- **Dependencies** FREEZE.
- **Outputs** Change the limit in Relay's config → run Concord → it names both affected doc units, explains why each is
  affected, and produces the correct deterministic patch for each.
- **Acceptance** Run output contains exactly two impacts, both correctly classified, each with an `explanation` naming
  the fact, the source tier, and the relationship. Rerunning with no change yields two `NO_ACTION` impacts. Patch diffs
  are correct and idempotent.
- **Wait until later** Every other adapter, fact, extractor, action class, AI, conflict, eval, UI, auth. **This phase is
  the project's most important gate — do not proceed while any part of it is shaky.**

## Phase 11 — Remaining adapters
- **Objective** Complete the estate ingestion.
- **Scope** `helpcenter`, `clidocs`, `release`, `generated` adapters. Author the actual surface content: ~14 Mintlify
  pages (getting started, projects, analysis sessions, artifacts, supported files, CLI, configuration,
  security/privacy, availability, troubleshooting, terminology, changelog, agents-notes, index); ~10 help-center
  articles (upload failed, how to run an analysis, platform availability, managing the connector, troubleshooting,
  plan/permission questions, retention, terminology, artifacts, CLI basics). `docs.json` with `$ref` splitting and
  `markdown.instructions`. Golden-file tests per adapter. `concord ingest --dry-run`.
- **Dependencies** 10.
- **Outputs** Six adapters; a real, readable documentation estate; stable doc unit ids.
- **Acceptance** Golden files committed and passing. `--dry-run` lists every unit per surface with a deterministic id;
  running twice gives identical ids. `adapter.patch()` on a `generated: true` unit throws. Deliberate register
  differences exist between surfaces (help center is friendlier than the reference) — this is required, not incidental.
- **Wait until later** The fact graph proper. Reconciliation beyond the one fact.

## Phase 12 — Fact graph, provenance, authority
- **Objective** Model the estate as a graph and make "multiple representations, one truth" mechanical.
- **Scope** All projection extractors (`declared_reference`, `frontmatter_field`, `generated_marker`,
  `numeric_pattern`, `term_occurrence`, `availability_table`, `model_extraction`) with confidence ceilings;
  `normalize-value.ts` (`"10 MB"` ⇄ `10485760`); authority arbitration across T0–T5; ownership resolution; a
  fact-graph explorer UI and `GET /api/public/facts/:key`.
- **Dependencies** 11.
- **Outputs** Full projection set persisted; graph explorer.
- **Acceptance** Query `limit.upload.csv.max_bytes` → projections across ≥ 4 surfaces with different wording and
  identical normalized values, producing **zero** findings (invariant I9). `model_extraction` projections are capped at
  0.7 confidence. T4 claims never override a current value.
- **Wait until later** Actions beyond the three from Phase 10. Any AI proposal.

## Phase 13 — Deterministic reconciliation + generators
- **Objective** Everything mechanically resolvable resolves mechanically, and only then.
- **Scope** Full classification rule table (all six rules); generators for the feature-availability matrix, the CLI
  reference pages, the platform/plan tables, structured metadata fragments, and the frontmatter `description` fields
  that feed Mintlify's `llms.txt`; generated-file markers; hand-edit detection; run report showing
  `classification_rule` per impact.
- **Dependencies** 12.
- **Outputs** A change to any fact produces correct deterministic outcomes across every generated surface.
- **Acceptance** Generators are byte-idempotent (I8). A `model_extraction` projection never yields
  `DETERMINISTIC_REGEN` (I5). Hand-edit a generated file → next run overwrites it and records
  `generated_file_hand_edited`. `llms.txt` is **not** authored — verify no generator writes it (G7).
- **Wait until later** All AI paths.

## Phase 14 — Grounded AI patches + Queues
- **Objective** Evidence-bound prose updates that always require review, executed durably.
- **Scope** Cloudflare Queue producer/consumer; `run_step` persistence; the `GROUNDED_PATCH` path with `PatchProposal`
  structured output; the four validation gates including the mechanical anti-hallucination check; `model_call`
  attribution and spend caps; `editorial_risk` escalation to `EDITORIAL_REVIEW`; `EDITORIAL_REVIEW` drafts marked
  review-required; prompt caching on the stable fact-graph prefix; patch diff viewer with evidence panel.
- **Dependencies** 13.
- **Outputs** Async runs; grounded patches with citations; per-run cost visible.
- **Acceptance** Every patch has ≥ 1 resolvable evidence item (I6). Removing an evidence item causes **rejection**, not
  a warning. A patch introducing an undeclared fact key is rejected mechanically. `requires_review` is `true` for all
  model-origin patches, with no code path that applies one. Every detected impact reaches a terminal disposition (I10).
  `cache_read_input_tokens > 0` on the second run.
- **Wait until later** Conflicts and falsification.

## Phase 15 — Conflicts, escalation, adversarial verification
- **Objective** Make refusing to edit a designed, visible behavior.
- **Scope** Conflict detection (all five kinds); `Conflict` records with verbatim claims, missing information, likely
  owner, and a suggested question; conflict blocking of dependent impacts; proposer/falsifier adversarial pass on all
  non-deterministic findings with ≤ 5 concurrency; suppressed findings retained with their refutation; escalation UI.
- **Dependencies** 14.
- **Outputs** Planted contradictions escalate correctly; suppressed findings visible.
- **Acceptance** A T3-vs-T4 contradiction produces an `UNRESOLVED_CONFLICT`, no patch, a named owner, and a stated
  information gap. `Conflict.resolution` is always `null` (I7). At least one suppressed finding appears in the run with
  its refutation text. Fan-out never exceeds 5 concurrent calls.
- **Wait until later** Quantitative evaluation.

## Phase 16 — Evaluation harness
- **Objective** Replace claims with measurements, including measured failures.
- **Scope** `fixtures/eval/` — a defect corpus of ≥ 36 seeded defects covering all 12 classes, including ≥ 4 with
  `expected_detection: false`; `pnpm eval` runner; metrics (detection precision, recall by class, remediation
  correctness, false-positive rate, escalation appropriateness, **unsafe autofix count**, provenance completeness);
  a committed `eval-report.md` + JSON; the "What the system gets wrong" page built from real misses.
- **Dependencies** 15.
- **Outputs** Reproducible scorecard; an honest failures page.
- **Acceptance** `pnpm eval` runs deterministically for deterministic classes. `unsafe_autofix_count === 0` or the phase
  fails (I14). The report shows per-class recall with **at least two classes below 100%**, and those appear on the
  failures page with analysis. No defect was deleted or weakened to improve a number (AP7).
- **Wait until later** Change Lab UI, auth, GitHub.

## Phase 17 — Change Lab + public replay
- **Objective** A public, zero-cost, end-to-end demonstration of the whole pipeline.
- **Scope** Change Lab UI (pick a mutation from the allowlist, watch the pipeline, inspect every stage);
  `fixtures/runs/` with ≥ 5 committed precomputed runs covering rename / limit change / platform enablement /
  retention change / capability addition; `mode: "replay"` serving them through the same `ChangeLabRun` renderer;
  the run inspector, fact-graph explorer, and eval scorecard all public.
- **Dependencies** 16.
- **Outputs** A visitor with no credentials can replay a full change and inspect provenance for every recommendation.
- **Acceptance** In a private window with `DEMO_ADMIN_ENABLED` unset: every replay works, and `model_usage.calls === 0`
  for every public request (I11). The replay renderer and the live renderer are the same component. Each replay shows
  deterministic updates, proposed patches with evidence, at least one conflict, and a generated changelog entry.
- **Wait until later** Live mutation.

## Phase 18 — Cloudflare Access + live privileged runs
- **Objective** Gate mutation on verified identity, at the backend.
- **Scope** `requireAccessIdentity` middleware (JWKS, `aud`, `iss`, expiry, domain); `DEMO_ADMIN_ENABLED` default-off;
  `/api/admin/*` routes; the fact-mutation allowlist and the doc-body allowlist with MDX content filtering; the
  one-concurrent-run lock; per-identity rate limit; `audit_log`; live-mode Change Lab.
- **Dependencies** 17. You must create the Access app and supply `ACCESS_AUD` + `ACCESS_TEAM_DOMAIN`.
- **Outputs** A privileged user can make an allowlisted change and watch a real run.
- **Acceptance** No JWT → 403. Forged/expired/wrong-`aud` JWT → 403 (test with a self-signed token). Wrong email domain
  → 403. `DEMO_ADMIN_ENABLED` unset → admin routes 404 (I12). Off-allowlist fact key → rejected before validation.
  Doc body containing `<script>` or an `import` statement → rejected. Second concurrent run → rejected with the
  in-flight id. `audit_log` row written with the identity.
- **Wait until later** GitHub writes.

## Phase 19 — GitHub App ephemeral branch/PR
- **Objective** Land patches as a real PR, under four independent layers of restriction.
- **Scope** GitHub App (Contents: write, Pull requests: write, Metadata: read) installed on **one** demo repo with no
  `.github/workflows/`; per-run installation tokens scoped by repo id; branch `concord/run-{run_id}`; path allowlist
  and denylist checked in `concord-core` and again immediately before the Octokit call; PR body with fact deltas,
  evidence, and a link to the run inspector; failure cleanup; a cron cleanup Worker reaping branches/PRs older than 48 h;
  branch protection on `main`.
- **Dependencies** 18. You must create the App, install it, and supply credentials.
- **Outputs** A live run opens a real PR touching only allowlisted paths.
- **Acceptance** PR created and correct. An attempted write to `.github/**`, a `.ts` file, or a `..` traversal path is
  refused **before** any GitHub API call (unit tests for each). Failure mid-flow leaves no orphan branch. Cleanup cron
  reaps. `main` cannot be pushed to directly. No token or key appears in any response or log.
- **Wait until later** Final hardening and polish.

## Phase 20 — Hardening, observability, cost controls, public polish
- **Objective** Make the project safe, legible, and runnable by a stranger from the public repo.
- **Scope** Work `validation.md` §8 line by line; verify every redaction rule; confirm caps by forcing exhaustion;
  root `README.md` (what it is, why, architecture diagram, how to run, what it deliberately does not do);
  `ARCHITECTURE.md`; `EVALUATION.md`; `SECURITY.md`; per-package READMEs; `docs.json` `markdown.instructions` and
  frontmatter descriptions finalized so Mintlify's generated `llms.txt` is genuinely useful; accessibility and
  responsive pass on both UIs; empty/error/loading states everywhere; a final `pnpm eval` with the report committed.
- **Dependencies** 19.
- **Outputs** A public repository that proves how the system works.
- **Acceptance** Full security checklist passes. `git clone` into a fresh directory, follow the README, and reach a
  working local instance. Public demo works with `DEMO_ADMIN_ENABLED` unset. `llms.txt` served by Mintlify reflects the
  reconciled descriptions. The failures page is honest and specific.

---

## What is explicitly deferred past Phase 20 (and stated as non-goals in the README)

Real Intercom integration · additional connectors · human conflict-resolution workflow · multi-repo reconciliation ·
translation/localization surfaces · a scheduled drift-detection cron over the whole estate · anything in
`constraints.md` §1.
