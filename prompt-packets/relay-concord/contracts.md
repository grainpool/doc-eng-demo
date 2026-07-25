# contracts.md — Implementation contracts the agent must honor

These are binding. Names, shapes, and enum values are not suggestions. Where a shape is shown as Zod, the Zod schema in
`@relay/contracts` is the single source of truth and JSON Schema for structured outputs is **generated from it**
(`z.toJSONSchema()`), never hand-written twice.

Section index: §1 conventions · §2 IDs · §3 fact keys & product truth · §4 analysis kernel · §5 NL translation ·
§6 artifacts & provenance · §7 CLI · §8 copy registry · §9 releases · §10 Relay HTTP API · §11 doc units & adapters ·
§12 fact graph · §13 actions · §14 patches · §15 conflicts · §16 defect taxonomy · §17 Change Lab · §18 invariants

---

## §1 Conventions

- **Language:** TypeScript, `"strict": true`, ES2022 modules. No `any` in exported signatures. No `as` casts across a
  package boundary.
- **Validation:** Zod v4. Every HTTP boundary parses with `schema.safeParse`. A route that reads `c.req.json()` without
  a schema parse is a defect.
- **Errors:** one shape everywhere.
  ```ts
  { error: { code: ErrorCode, copy_id: string, detail?: string, field?: string } }
  ```
  `ErrorCode` is a closed enum in `@relay/contracts`. `copy_id` points into the copy registry (§8). **HTTP responses
  never contain a hand-written user-facing sentence.**
- **Time:** ISO 8601 UTC strings everywhere. Never epoch numbers in payloads.
- **Naming:** `snake_case` in JSON and D1 columns; `camelCase` in TypeScript identifiers; `kebab-case` file names;
  `SCREAMING_SNAKE` for enum member values that appear in JSON.
- **Product names:** `RELAY_NAME` / `CONCORD_NAME` constants in `@relay/contracts/src/branding.ts`. No literal
  `"Relay"` / `"Concord"` string in any other package.
- **Model:** `MODEL_ID = "claude-opus-5"` in `@relay/contracts/src/model.ts`. Referenced nowhere else as a literal.

## §2 Identifiers

Prefixed, sortable, URL-safe. `{prefix}_{ulid}` lowercase.

| Entity | Prefix |
|---|---|
| project | `prj` |
| file | `fil` |
| analysis session | `ses` |
| session turn | `trn` |
| artifact | `art` |
| release | `rel` |
| doc unit | `du` — but see below |
| reconciliation run | `run` |
| finding / impact | `imp` |
| patch | `pat` |
| conflict | `cfl` |

**Doc-unit ids are NOT random.** They are deterministic and stable across runs:
`{surface}:{path}#{anchor}` — e.g. `mintlify:docs-mintlify/supported-files.mdx#file-size-limits`,
`inproduct:in-product-copy/errors.json#error.upload.too_large`,
`clidocs:docs-mintlify/generated/cli/projects.mdx#relay-projects-list`.
Stability matters more than prettiness: a run must be able to say "this same unit changed" across weeks.

**`path` is relative to the ESTATE REPO ROOT, never to the checkout location.** The estate is mounted at `estate/` in
repo 1 via submodule, but that prefix must never appear in an id — otherwise ids would break if the mount point moved,
and they would not match the paths Concord sends to the GitHub API (which are also estate-relative). Strip the mount
prefix at the adapter boundary and assert it in the golden-file tests.

---

## §3 Fact keys and product truth

### 3.1 Fact key grammar
`{family}.{subject}[.{qualifier}]*` — lowercase, dot-separated, no spaces. Registered in
`@relay/contracts/src/facts.ts` as a **frozen record**, because Concord's authority arbitration reads it.

```ts
export const FACT_REGISTRY = {
  "limit.upload.csv.max_bytes":              { tier: "T1_SCHEMA",  valueType: "integer", owner: "eng-platform" },
  "limit.upload.csv.max_rows":               { tier: "T1_SCHEMA",  valueType: "integer", owner: "eng-platform" },
  "support.file_type.csv":                   { tier: "T1_SCHEMA",  valueType: "boolean", owner: "eng-platform" },
  "support.file_type.tsv":                   { tier: "T1_SCHEMA",  valueType: "boolean", owner: "eng-platform" },
  "support.file_type.xlsx":                  { tier: "T1_SCHEMA",  valueType: "boolean", owner: "eng-platform" },
  "runtime.package.pandas.version":          { tier: "T0_RUNTIME", valueType: "semver",  owner: "eng-platform" },
  "runtime.package.scipy.version":           { tier: "T0_RUNTIME", valueType: "semver",  owner: "eng-platform" },
  "runtime.package.statsmodels.version":     { tier: "T0_RUNTIME", valueType: "semver",  owner: "eng-platform" },
  "runtime.package.matplotlib.version":      { tier: "T0_RUNTIME", valueType: "semver",  owner: "eng-platform" },
  "runtime.python.version":                  { tier: "T0_RUNTIME", valueType: "semver",  owner: "eng-platform" },
  "term.canonical.task":                     { tier: "T3_CONFIG",  valueType: "term",    owner: "product-content" },
  "term.canonical.project":                  { tier: "T3_CONFIG",  valueType: "term",    owner: "product-content" },
  "term.canonical.artifact":                 { tier: "T3_CONFIG",  valueType: "term",    owner: "product-content" },
  "availability.feature.analysis_sessions.platform.web":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.ios":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.android": { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.cli":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.connector_drive.platform.web":       { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "plan.feature.analysis_sessions.min_plan":  { tier: "T3_CONFIG",  valueType: "enum:plan", owner: "product" },
  "plan.feature.connector_drive.min_plan":    { tier: "T3_CONFIG",  valueType: "enum:plan", owner: "product" },
  "retention.artifact.days":                  { tier: "T3_CONFIG",  valueType: "integer", owner: "product" },
  "retention.uploaded_file.days":             { tier: "T3_CONFIG",  valueType: "integer", owner: "product" },
  "flag.analysis.regression_enabled":         { tier: "T3_CONFIG",  valueType: "boolean", owner: "eng-analysis" },
  "analysis.operation.<op_id>.enabled":       { tier: "T0_RUNTIME", valueType: "boolean", owner: "eng-analysis" },
  "cli.command.<command_path>.flags":         { tier: "T2_CLI",     valueType: "json",    owner: "eng-platform" },
  "cli.command.<command_path>.summary":       { tier: "T2_CLI",     valueType: "string",  owner: "eng-platform" },
} as const;
```
Entries with `<...>` are **templated families**; the registry exports a matcher, not 40 literal keys.

`tier` values: `T0_RUNTIME | T1_SCHEMA | T2_CLI | T3_CONFIG | T4_RELEASE | T5_HUMAN`.
`owner` is a role string, not a person, and appears in escalations.

### 3.2 `ProductTruthSnapshot`
```ts
const FactClaim = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown())]),
  tier: FactTier,
  locator: z.string(),          // file#Lnn, "kernel:/versions", "cli:introspect", "decision:<id>"
  observed_at: z.string(),
  confidence: z.number().min(0).max(1),   // 1.0 for T0/T1/T2; may be < 1 for extracted claims
});

const ProductTruthSnapshot = z.object({
  snapshot_id: z.string(),
  generated_at: z.string(),
  relay_contracts_version: z.string(),
  facts: z.array(FactClaim),
});
```
`GET /api/product-truth` returns this. It is the **only** interface Concord uses for Relay's product facts.

---

## §4 Analysis kernel contract

### 4.1 The eight operations — closed enum, no more, no fewer
```ts
export const OPERATION_IDS = [
  "inspect_schema",     // dtypes, null counts, cardinality, head(n)
  "summary_statistics", // describe() over selected numeric/categorical columns
  "filter_rows",        // structured predicates only (see 4.2) — never a query string
  "group_aggregate",    // group_by[] × {column, agg}[] where agg ∈ sum|mean|median|min|max|count|std
  "correlation_matrix", // method ∈ pearson|spearman|kendall
  "linear_regression",  // statsmodels OLS: 1 dependent, ≥1 independent; returns coefs, p-values, r², CIs
  "distribution_test",  // shapiro | normaltest | ttest_ind | mannwhitneyu
  "plot",               // kind ∈ histogram|scatter|line|bar|box|heatmap → PNG
] as const;
```

### 4.2 `filter_rows` predicate shape — this is the arbitrary-code firewall
```ts
const Predicate = z.object({
  column: z.string(),
  op: z.enum(["eq","neq","gt","gte","lt","lte","in","not_in","is_null","not_null","contains"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});
const FilterRowsParams = z.object({
  predicates: z.array(Predicate).max(10),
  combine: z.enum(["and","or"]).default("and"),
  limit: z.number().int().min(1).max(5000).default(1000),
});
```
`column` is validated against the dataset's actual column list **before** reaching the kernel. The kernel builds a
boolean mask with pandas comparison operators — it does **not** call `DataFrame.query()`, `eval()`, or any string-to-code
path. State this in a comment in the kernel source; it is a security property, not a style choice.

### 4.3 Kernel HTTP surface
```
POST /op/{operation_id}     body: { dataset: DatasetRef, params: <op-specific> }
                            200:  KernelResult
                            400:  { error: { code, detail } }   404: unknown operation_id
GET  /versions              200:  { python, pandas, numpy, scipy, statsmodels, matplotlib, image_digest }
GET  /operations            200:  { operations: [{ id, summary, params_schema, returns, enabled }] }
GET  /health                200:  { ok: true }
```
```ts
const DatasetRef = z.object({
  presigned_url: z.string().url(),   // R2 presigned GET, ≤ 60 s TTL
  format: z.enum(["csv","tsv"]),
  sha256: z.string(),                 // kernel verifies; mismatch → 400
  max_bytes: z.number().int(),
});
const KernelResult = z.object({
  operation_id: z.string(),
  scalar_result: z.record(z.unknown()).nullable(),
  tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()),
                             rows: z.array(z.array(z.unknown())), truncated: z.boolean() })),
  plots: z.array(z.object({ name: z.string(), mime: z.literal("image/png"),
                            base64: z.string(), width: z.number(), height: z.number() })),
  versions: z.record(z.string()),
  duration_ms: z.number(),
});
```
**Kernel hard rules:** stateless; no writes outside `/tmp`; no outbound network except the presigned URL host; refuses
any dataset over `max_bytes`; `matplotlib` uses the `Agg` backend; every response echoes `versions` so provenance is
captured at the moment of computation, not looked up later.

---

## §5 NL → operation translation

```ts
const TranslationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operation"),
             operation_id: z.enum(OPERATION_IDS),
             params: z.record(z.unknown()),
             rationale: z.string().max(280) }),
  z.object({ kind: z.literal("unsupported"),
             reason: z.string().max(280),
             supported_alternatives: z.array(z.enum(OPERATION_IDS)).max(3) }),
]);
```
Sent as `output_config.format` (JSON Schema derived from this Zod schema). The prompt receives: the dataset schema from
`inspect_schema`, the `/operations` catalog, and the user's text. **`params` is then re-validated against the specific
operation's Zod schema; a mismatch is a 422 and no kernel call is made.** The model is a *router*, never an executor.

The system prompt must state: "If the request cannot be expressed as one of the listed operations, return
`kind: "unsupported"`. Do not approximate with a different operation." A model that quietly substitutes an operation is
the single worst failure mode of this feature, and the Phase-05 acceptance test checks for it explicitly.

---

## §6 Artifacts and provenance

```ts
const Provenance = z.object({
  source_file_id: z.string(),
  source_file_sha256: z.string(),
  operation_id: z.enum(OPERATION_IDS),
  params: z.record(z.unknown()),
  params_hash: z.string(),
  runtime_versions: z.record(z.string()),   // verbatim from KernelResult.versions
  kernel_image_digest: z.string(),
  session_id: z.string(), turn_id: z.string(),
  generated_at: z.string(),
  duration_ms: z.number(),
  derived_from_artifact_ids: z.array(z.string()),   // lineage: artifact → artifact
});
const Artifact = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: z.enum(["plot","table_csv","summary_json","operation_record"]),
  name: z.string(),
  r2_key: z.string(),
  byte_size: z.number(),
  provenance: Provenance,
  retention_expires_at: z.string().nullable(),   // derived from retention.artifact.days
});
```
**Invariant:** an artifact row cannot be inserted without a complete `Provenance`. Enforce with a Zod parse at the
insert site *and* `NOT NULL` columns — not with a comment. The lineage view walks `derived_from_artifact_ids`.

---

## §7 CLI contract

Commands (`commander`, program name `relay`):
```
relay projects list|create|show
relay files list|upload|show
relay sessions list|create|run
relay artifacts list|show|download
relay config show|status
relay introspect [--json]
```
Global flags: `--json`, `--api-url`, `--token`, `--no-color`, `--verbose`.

Exit codes are contractual: `0` ok · `1` unexpected · `2` usage error · `3` auth failure · `4` not found ·
`5` validation failure · `6` remote unavailable.

### 7.1 `relay introspect --json` — the T2_CLI authority source
```ts
const CliIntrospection = z.object({
  cli_version: z.string(),
  generated_at: z.string(),
  commands: z.array(z.object({
    path: z.string(),                 // "projects list"
    summary: z.string(),
    usage: z.string(),                // exactly what --help prints
    flags: z.array(z.object({ name: z.string(), alias: z.string().nullable(),
                              type: z.string(), required: z.boolean(),
                              default: z.unknown().nullable(), description: z.string() })),
    exit_codes: z.array(z.object({ code: z.number(), meaning: z.string() })),
    examples: z.array(z.string()),
  })),
});
```
**This must be derived by walking the live `commander` tree at runtime — never hand-maintained.** If the introspection
can drift from `--help`, the entire "CLI is authoritative for mechanical facts" claim is a lie, and Concord's
`clidocs` generator will produce confidently wrong docs. The Phase-07 test asserts
`introspect.commands[i].usage === helpOutput(command)` for every command.

---

## §8 Copy registry (in-product information surface)

`estate/in-product-copy/*.json` (i.e. `in-product-copy/*.json` in repo 2), typed and validated at build. `relay-web`
imports it through the submodule path — build-time, no network. This is also why a merged copy patch does not reach the
running app until the submodule pin is bumped (`architecture.md` §11).
```ts
const CopyEntry = z.object({
  id: z.string(),                    // "error.upload.too_large"
  kind: z.enum(["tooltip","empty_state","onboarding","error","validation",
                "setting_description","feature_availability","label"]),
  text: z.string(),
  surface_location: z.string(),      // "FileUploader/rejection banner"
  references_facts: z.array(z.string()),   // fact keys this copy asserts — DRIVES RECONCILIATION
  owner: z.string(),
  editorial_register: z.enum(["terse_ui","friendly_help","technical_reference"]),
  interpolations: z.array(z.string()).default([]),   // e.g. ["max_size_human"]
});
```
`references_facts` is the mechanism that makes UI strings part of the documentation estate. A copy entry claiming
`limit.upload.csv.max_bytes` is a doc unit that Concord reconciles exactly like an MDX page. **A copy entry that hardcodes
a number without declaring the fact key is a seeded defect class (§16 `UNDECLARED_FACT_REF`) — the lint rule for it is
built in Phase 08 and deliberately left with known gaps that the eval measures.**

Rule enforced by lint: no JSX text node in `relay-web` contains a user-visible literal. All text renders via `t("id")`.

---

## §9 Release / change records

`product-truth/releases/YYYY-MM-DD-slug.yaml` — **repo 1, not the estate.** These are product truth, and Concord cannot
write them.
```yaml
id: rel_01j...
version: "1.4.0"
released_at: "2026-05-02T00:00:00Z"
summary: "Analysis sessions available on iOS"
changes:
  - fact_key: availability.feature.analysis_sessions.platform.ios
    from: false
    to: true
    kind: availability_added
  - fact_key: limit.upload.csv.max_bytes
    from: 5242880
    to: 10485760
    kind: limit_increased
notes_md: |
  Free-form editorial notes. Human-authored. Concord CANNOT patch this file — it lives in repo 1, outside the
  GitHub App's reach. If a run concludes these notes should change, it escalates to the owner (EDITORIAL_REVIEW).
  What Concord does generate is the changelog PAGE in repo 2, derived from these records.
```
`kind` enum: `limit_increased | limit_decreased | availability_added | availability_removed | term_renamed |
capability_added | capability_removed | cli_changed | plan_changed | retention_changed`.

**T4 is temporal, not factual.** A release record is authoritative for *when* something changed and never for the
current value. If a release says `to: true` and T3 config says `false`, that is a `CONTRADICTION` conflict, not a
correction. The Phase-15 fixture uses exactly this.

---

## §10 Relay HTTP API (the surface Concord may touch)

Concord may call **only** these two:
```
GET /api/product-truth            → ProductTruthSnapshot      (§3.2)
GET /api/copy-registry            → { entries: CopyEntry[] }  (§8)
```
Everything else (`/api/projects`, `/api/files`, `/api/sessions`, `/api/artifacts`, `/api/chat`) is Relay-internal and
off-limits to Concord. Enforced by lint (`constraints.md` §G4) and by an integration test that asserts
`concord-*` source contains no other `/api/` string literal.

---

## §11 Doc units and adapters

```ts
const DocUnit = z.object({
  id: z.string(),                    // deterministic, §2
  surface: z.enum(["mintlify","helpcenter","inproduct","clidocs","release","generated"]),
  path: z.string(),
  anchor: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  body_sha256: z.string(),
  audience: z.enum(["developer","end_user","operator","agent","mixed"]),
  editorial_register: z.enum(["terse_ui","friendly_help","technical_reference","release_note"]),
  owner: z.string(),
  generated: z.boolean(),            // true ⇒ never hand-patch
  frontmatter: z.record(z.unknown()).default({}),
});

interface SurfaceAdapter {
  readonly surface: DocUnit["surface"];
  /** Pure: files in, doc units out. No I/O. */
  parse(files: ReadonlyArray<{ path: string; content: string }>): DocUnit[];
  /** Pure: produce a file diff. Throws if unit.generated is true. */
  patch(unit: DocUnit, newBody: string): FileDiff;
  /** Which ESTATE-relative paths this adapter owns. Used for the write allowlist. */
  readonly ownedGlobs: readonly string[];
}
const FileDiff = z.object({ path: z.string(), before: z.string(), after: z.string(), unified: z.string() });
```
Six adapters, one file each in `concord-core/src/adapters/`. Each ships a **golden-file test**: a fixture directory in,
a committed `expected-units.json` out. Adapter changes that alter unit ids must update the golden file in the same
commit — this is how id stability is defended.

---

## §12 Fact graph

```ts
const FactProjection = z.object({
  id: z.string(),
  fact_key: z.string(),
  doc_unit_id: z.string(),
  mode: z.enum(["generated","mechanical_value","derived_prose","editorial"]),
  asserted_value: z.unknown().nullable(),   // what this unit currently claims; null if qualitative
  span: z.object({ start: z.number(), end: z.number() }).nullable(),
  extractor: z.enum(["declared_reference","frontmatter_field","generated_marker",
                     "numeric_pattern","term_occurrence","availability_table","model_extraction"]),
  confidence: z.number().min(0).max(1),
  detected_at: z.string(),
});
```
**Extractor confidence is not decorative.** `declared_reference` (a copy entry's `references_facts`, or an MDX
`<!-- concord:fact key=... -->` marker) is `1.0` and may drive `DETERMINISTIC_REGEN`. `model_extraction` is capped at
`0.7` and **may never drive a deterministic action** — it can only produce `GROUNDED_PATCH` or
`EDITORIAL_REVIEW`. Enforce this as a guard in `classify.ts`, not as a convention.

The core rule the graph exists to express:

> **One product fact may have multiple valid representations without having multiple truths.**

A fact with four projections whose bodies read *"10 MB"*, *"up to 10 MB per file"*, *"file too large — the limit is
10 MB"*, and a generated table cell *`10485760`* is **consistent**. The same four where one says *"5 MB"* is
**inconsistent**. Semantic consistency is checked on `asserted_value` after normalization
(`concord-core/src/normalize-value.ts` handles `10 MB` ⇄ `10485760` ⇄ `10,485,760 bytes`), never on string equality.
A test asserts that differing prose with equal normalized values produces **zero** findings.

---

## §13 Actions

```ts
const ActionClass = z.enum(["DETERMINISTIC_REGEN","GROUNDED_PATCH","EDITORIAL_REVIEW",
                            "UNRESOLVED_CONFLICT","NO_ACTION"]);
const Impact = z.object({
  id: z.string(),
  run_id: z.string(),
  fact_key: z.string(),
  delta: z.object({ from: z.unknown(), to: z.unknown(), kind: z.string() }),
  doc_unit_id: z.string(),
  projection_id: z.string(),
  action: ActionClass,
  classification_rule: z.number().int(),          // which rule in architecture.md §6.1 fired
  explanation: z.string(),                        // human-readable "why this unit is affected"
  disposition: z.enum(["applied","proposed","escalated","unresolved",
                       "suppressed","no_action","abandoned_budget"]),
  patch_id: z.string().nullable(),
  conflict_id: z.string().nullable(),
});
```
`classification_rule` exists so a reviewer can audit *why* the system chose an action class without reading code. It is
displayed in the UI. `explanation` must name the fact, the source, and the relationship — not restate the action.

Deterministic generators live in `concord-core/src/generators/` and must be **pure and idempotent**:
`generate(facts, adapterInputs) → FileDiff[]`. A test runs each generator twice and asserts byte equality.
Generated files carry a header:
```
{/* GENERATED BY CONCORD — do not edit. Source facts: limit.upload.csv.max_bytes, support.file_type.* */}
```

---

## §14 Patches and evidence

```ts
const Evidence = z.object({
  fact_key: z.string(),
  tier: FactTier,
  locator: z.string(),
  value: z.unknown(),
  observed_at: z.string(),
});
const Patch = z.object({
  id: z.string(),
  run_id: z.string(),
  impact_ids: z.array(z.string()).min(1),
  doc_unit_id: z.string(),
  diff: FileDiff,
  origin: z.enum(["deterministic","model_grounded","model_editorial_draft"]),
  evidence: z.array(Evidence).min(1),          // ← min(1) is load-bearing
  model_call_id: z.string().nullable(),
  requires_review: z.boolean(),
  validation: z.object({
    evidence_resolvable: z.boolean(),
    introduces_no_new_facts: z.boolean(),
    respects_editorial_register: z.boolean(),
    path_allowlisted: z.boolean(),
    falsification: z.object({ attempted: z.boolean(), refuted: z.boolean(),
                              refutation: z.string().nullable() }),
  }),
});
```
**Validation gates, all mandatory before a patch is offered:**
1. `evidence.length >= 1` and every `locator` resolves in the current snapshot. Unresolvable → discard the patch and
   re-classify the impact as `UNRESOLVED_CONFLICT`.
2. **`introduces_no_new_facts`**: run the projection extractors over `diff.after`; if a fact key appears that is not in
   the evidence set, reject. This is the anti-hallucination gate and it is mechanical, not model-judged.
3. `requires_review` is `true` for every `model_grounded` and `model_editorial_draft` patch. There is no path by which
   a model-authored patch is applied without review. `deterministic` patches may auto-apply.
4. `path_allowlisted` against `security.md` §4.

Structured-output schema for the proposal call is derived from:
```ts
const PatchProposal = z.object({
  new_body: z.string(),
  evidence: z.array(Evidence).min(1),
  changed_because: z.string().max(400),
  editorial_risk: z.enum(["none","tone","structure","meaning"]),
  needs_human_because: z.string().nullable(),
});
```
An `editorial_risk` of `structure` or `meaning` forces `EDITORIAL_REVIEW` regardless of the original classification.

---

## §15 Conflicts

```ts
const Conflict = z.object({
  id: z.string(),
  run_id: z.string(),
  fact_key: z.string(),
  kind: z.enum(["authority_disagreement","insufficient_evidence","ambiguous_ownership",
                "temporal_contradiction","circular_reference"]),
  claims: z.array(Evidence).min(2),           // the disagreeing claims, verbatim
  missing_information: z.array(z.string()),   // what would resolve it
  likely_owner: z.string(),                   // from FACT_REGISTRY.owner
  suggested_question: z.string(),             // the question to put to that owner
  resolution: z.null(),                       // ALWAYS null. Concord never resolves.
});
```
`resolution` is typed `z.null()` deliberately: **the type system forbids Concord from inventing a resolution.** If a
future phase adds human resolution, it adds a separate `ConflictResolution` record authored by a human — it does not
widen this field.

A conflict blocks every impact on its fact key in that run. Those impacts get `disposition: "unresolved"` and appear
in the run report with the conflict attached.

---

## §16 Seeded defect taxonomy (eval fixture)

```ts
const DefectClass = z.enum([
  "STALE_VALUE",            // doc states a superseded number
  "WRONG_PLATFORM",         // claims availability that config denies
  "TERM_DRIFT",             // uses a non-canonical term
  "BROKEN_REF",             // link/anchor/CLI-command reference that does not resolve
  "DUP_GUIDANCE",           // same instruction in two surfaces, diverging
  "MISSING_PREREQ",         // procedure omits a required precondition
  "STALE_CLI",              // documented flag/default differs from introspection
  "CONTRADICTION",          // two surfaces assert incompatible values
  "UNSUPPORTED_CLAIM",      // asserts a fact with no authoritative source
  "IA_PROBLEM",             // content in the wrong surface/audience
  "STALE_INPRODUCT_COPY",   // copy entry disagrees with its declared fact
  "UNDECLARED_FACT_REF",    // hardcoded value with no references_facts declaration
]);
const SeededDefect = z.object({
  id: z.string(),
  class: DefectClass,
  doc_unit_id: z.string(),
  fact_key: z.string().nullable(),
  description: z.string(),
  /** How to introduce the defect, applied IN MEMORY at eval time. Null for expected_detection:false
   *  items, which assert something about the CLEAN estate and must not modify it. */
  injection: z.object({ find: z.string(), replace: z.string() }).nullable(),
  expected_detection: z.boolean(),          // false ⇒ deliberately out of scope; a hit here is a false positive
  expected_action: ActionClass,
  notes: z.string(),
});
```
**Defects are injected in memory, never committed into the estate.** The harness loads the real estate, applies each
`injection` to an in-memory copy, runs the pipeline, and scores. Three reasons this matters and it is not merely tidy:
the published documentation site never serves known-wrong information; there is no duplicate copy of the estate to
drift out of sync; and the answer key lives in repo 1 while the content lives in repo 2, so the system being evaluated
does not contain its own marking scheme. An eval run must leave `git status` clean inside `estate/` — assert it.

`fixtures/eval/defects.json` (repo 1) holds ≥ 36 defects covering all 12 classes, including **at least 4 with
`expected_detection: false`** (things that look wrong but are legitimately fine — differing wording with identical
meaning, an intentional register difference, a deliberately terse tooltip). Without those, a recall-only harness scores
100% for a system that flags everything.

The one exception is the 3–4 `UNDECLARED_FACT_REF` seeds from Phase 08: those are copy entries that omit a
`references_facts` declaration, which is invisible to a reader and harmless in production, so they live in the real
estate with `injection: null` and are excluded from the Phase-08 lint by id.

---

## §17 Change Lab

```ts
const AllowedMutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fact_value"), fact_key: z.string(), value: z.unknown() }),
  z.object({ kind: z.literal("doc_body"),   doc_unit_id: z.string(), body: z.string().max(8192) }),
]);
const ChangeLabRequest = z.object({
  mutation: AllowedMutation,
  mode: z.enum(["replay","live"]),
  idempotency_key: z.string(),
});
const ChangeLabRun = z.object({
  run_id: z.string(),
  mode: z.enum(["replay","live"]),
  status: z.enum(["queued","running","completed","failed","partial"]),
  mutation: AllowedMutation,
  detected_facts: z.array(FactClaim),
  impacts: z.array(Impact),
  patches: z.array(Patch),
  conflicts: z.array(Conflict),
  generated_release_entry: z.string().nullable(),
  pull_request_url: z.string().nullable(),
  model_usage: z.object({ calls: z.number(), input_tokens: z.number(),
                          output_tokens: z.number(), estimated_usd: z.number() }),
  steps: z.array(z.object({ name: z.string(), status: z.string(),
                            started_at: z.string(), duration_ms: z.number(),
                            detail: z.record(z.unknown()) })),
});
```
`mode: "replay"` requires no auth and reads a committed fixture from `fixtures/runs/`. `mode: "live"` requires Access
identity and the mutation must satisfy `security.md` §4. **The same `ChangeLabRun` shape renders both**, so the public
demo is not a mock of the real thing — it is the real thing's recorded output.

---

## §18 Invariants (assert these in tests; violations are defects, not preferences)

| # | Invariant | Where tested |
|---|---|---|
| I1 | No user-visible string exists outside the copy registry. | lint + Phase 08 test |
| I2 | An artifact row cannot exist without complete provenance. | schema NOT NULL + Phase 06 test |
| I3 | `relay introspect --json` matches `--help` for every command. | Phase 07 test |
| I4 | The kernel exposes no endpoint accepting code, expressions, or file paths. | Phase 04 test enumerating routes |
| I5 | A `model_extraction` projection can never produce `DETERMINISTIC_REGEN`. | Phase 13 test |
| I6 | Every patch has ≥ 1 resolvable evidence item. | Phase 14 test |
| I7 | `Conflict.resolution` is always `null`. | type + Phase 15 test |
| I8 | Deterministic generators are byte-idempotent. | Phase 13 test |
| I9 | Differing prose with equal normalized values yields zero findings. | Phase 12 test |
| I10 | Every detected impact reaches a terminal disposition in the run record. | Phase 14 test |
| I11 | The public API makes zero model calls. | Phase 17 test asserting `model_usage.calls === 0` |
| I12 | Admin routes 404 when `DEMO_ADMIN_ENABLED !== "true"`. | Phase 18 test |
| I13 | Concord source references no Relay endpoint other than the two in §10. | lint + Phase 11 test |
| I14 | `unsafe_autofix_count === 0` in the eval report. | Phase 16 gate |
| I15 | Every doc-unit id path is estate-relative — no `estate/` prefix ever appears in an id. | Phase 11 golden tests |
| I16 | No patch, diff, or PR ever targets a path outside the estate repo. | Phase 14 + Phase 19 tests |
| I17 | An eval run leaves `estate/` git-clean — defects are in-memory only. | Phase 16 test |
