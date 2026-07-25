# architecture.md — Relay + Concord

Decisive architecture. Where alternatives existed they are named and rejected with a reason. The coding agent builds
what is written here.

---

## 1. System shape

```
                        ┌───────────────────────────────────────────────────────────┐
                        │  Public internet                                          │
                        └───────┬──────────────────┬──────────────────┬─────────────┘
                                │                  │                  │
                  relay.<domain>│    concord.<domain>       docs.<domain>
                                │                  │                  │
                    ┌───────────▼──────┐  ┌────────▼─────────┐  ┌─────▼──────────┐
                    │ RELAY WORKER     │  │ CONCORD WORKER   │  │ Mintlify-hosted│
                    │ Hono + assets    │  │ Hono + assets    │  │ docs site      │
                    │                  │  │                  │  │ (Git-backed)   │
                    │ /api/*           │  │ /api/public/*    │  └─────▲──────────┘
                    │ /api/product-    │  │ /api/admin/*  ◄──┼── Cloudflare Access
                    │      truth       │  │                  │        (@anthropic.com, OTP)
                    └──┬────┬─────┬────┘  └──┬────┬─────┬────┘        │
                       │    │     │          │    │     │             │ publishes on merge
              ┌────────▼┐ ┌─▼──┐ ┌▼────────┐ │  ┌─▼──┐ ┌▼─────────┐   │
              │relay_db │ │ R2 │ │CONTAINER│ │  │ R2 │ │concord_db│   │
              │  (D1)   │ │art.│ │ kernel  │ │  │runs│ │   (D1)   │   │
              └─────────┘ └────┘ │ FastAPI │ │  └────┘ └──────────┘   │
                                 │ pandas  │ │       │                │
                                 │ scipy   │ │  ┌────▼─────┐   ┌──────┴────────┐
                                 │statsmod.│ │  │ QUEUE    │   │ GitHub App    │
                                 │matplotlib│ │  │ recon-   │──▶│ 1 demo repo  │
                                 └─────────┘ │  │ ciliation│   │ ephemeral PR  │
                                             │  │ consumer │   └───────────────┘
                                             │  └────┬─────┘
                                             │       │
                                       ┌─────▼───────▼──────┐
                                       │  Anthropic API     │
                                       │  claude-opus-5     │
                                       └────────────────────┘
```

**Two Workers. One Container. Two D1 databases. Two R2 buckets. One Queue. One external docs host.** Nothing else.

**The Concord Worker never calls the Relay Worker's internal endpoints.** It calls exactly two Relay surfaces —
`GET /api/product-truth` and `GET /api/copy-registry` — plus it reads repo files and runs the CLI's introspection
output. This is the coupling boundary and it is enforced by lint (`constraints.md` §G4).

---

## 2. Package boundaries and responsibilities

| Package | Runtime | Responsibility | May import |
|---|---|---|---|
| `@relay/contracts` | isomorphic | Zod schemas, fact-key registry, enums, error codes, model constant. **The freeze surface.** Zero dependencies beyond `zod`. | nothing internal |
| `packages/relay-api` | Workers | Hono app: projects, files, sessions, artifacts, chat, product-truth, copy-registry. Owns `relay_db` + `relay-artifacts`. Proxies to kernel. | `@relay/contracts` |
| `packages/relay-web` | browser | Vite + React SPA. Built into `relay-api`'s `assets.directory`. Every user-visible string comes from the copy registry. | `@relay/contracts` |
| `packages/relay-cli` | Node | `commander` CLI over the Relay HTTP API. Emits `introspect --json`. | `@relay/contracts` |
| `packages/relay-kernel` | Container (Python) | Eight bounded analysis operations + `/versions` + `/operations`. Stateless. No filesystem writes outside `/tmp`. | — |
| `packages/concord-core` | **pure TS, no Cloudflare imports** | Ingest normalization, fact graph, projection resolution, authority arbitration, action classification, deterministic generators, patch validation, eval scoring. Fully unit-testable in plain Vitest. | `@relay/contracts` |
| `packages/concord-api` | Workers | Hono app: public read API, admin mutation API (Access-gated), queue producer + consumer, GitHub client. Owns `concord_db` + `concord-runs`. | `@relay/contracts`, `concord-core` |
| `packages/concord-web` | browser | Change Lab, run inspector, fact-graph explorer, eval scorecard, "What the system gets wrong". | `@relay/contracts` |

**Why `concord-core` is Cloudflare-free:** the reconciliation logic is the intellectually interesting part and must be
testable and readable without a Worker harness. Adapters take plain data in and return plain data out; I/O lives in
`concord-api`. This is the single most important structural rule in the project.

---

## 3. Relay: request and data flow

### 3.1 File upload
```
Browser → POST /api/projects/:id/files (multipart)
  ├─ validate: extension ∈ supported, size ≤ limit.upload.csv.max_bytes  ← read from config source
  ├─ on reject: return error code + copy-registry id (never a literal string)
  ├─ R2.put(relay-artifacts, files/{project}/{fileId}/{name})
  └─ D1 insert file row (sha256, byte_size, mime, column_count, row_count)
```
The limit is read from `packages/contracts/src/product-config.ts` and enforced in **one** place
(`packages/relay-api/src/limits.ts`). Concord later depends on there being exactly one enforcement point.

### 3.2 Analysis session (the capability-dense path)
```
Browser → POST /api/sessions/:id/turns  { prompt: "which columns correlate?" }
  │
  ├─ (1) NL→OP TRANSLATION  — Anthropic, structured output, closed enum of operation ids
  │        ├─ input: the prompt + the dataset schema + the operation catalog from GET /operations
  │        ├─ output: { operation_id, params } | { refusal: reason, supported_alternatives[] }
  │        └─ the model CANNOT emit an operation id outside the enum (schema-constrained)
  │
  ├─ (2) VALIDATE  — Zod-parse params against that operation's schema. Reject → 422, no kernel call.
  │
  ├─ (3) KERNEL CALL — getContainer(env.KERNEL, sessionId).fetch("/op/{id}", {json})
  │        └─ kernel fetches the CSV from a presigned R2 URL, runs the op, returns
  │           { result, plots[], tables[], versions }
  │
  ├─ (4) PERSIST ARTIFACTS — plots/tables → R2; artifact rows + provenance rows → D1
  │
  └─ (5) NARRATE (optional, streamed) — Anthropic summarizes the *returned numbers only*.
           Prompt forbids introducing values not present in the result payload.
```
Steps 1 and 5 are the only model calls. **Step 3 never receives model-authored code** — only a validated
`{operation_id, params}` pair. That is the whole safety argument for the analysis feature, and it must stay true.

`sessionId` is passed to `getContainer` so a session's turns land on the same container instance, giving warm-start
behavior without any statefulness in the kernel itself.

### 3.3 Product truth exposure
`GET /api/product-truth` returns every fact with its value, source tier, and provenance:
```json
{ "generated_at": "...", "facts": [
  { "key": "limit.upload.csv.max_bytes", "value": 10485760, "source": {
      "tier": "T1_SCHEMA", "locator": "packages/relay-api/src/limits.ts#L12", "observed_at": "..." } },
  { "key": "runtime.package.pandas.version", "value": "2.2.3", "source": {
      "tier": "T0_RUNTIME", "locator": "kernel:/versions", "observed_at": "..." } }
]}
```
This endpoint is **derived, never hand-maintained**: T0 by calling the kernel, T1 by importing the enforcement
constants, T2 by shelling the CLI's introspection in CI, T3 by reading product config, T4 by reading release records,
T5 by reading `decisions/*.yaml`. If a fact can be hand-edited in two places, the design is wrong.

---

## 4. The six product-truth source tiers

Deliberately **not** one YAML file. Authority is per-fact-family, declared in the fact-key registry.

| Tier | Source | Authoritative for | Physically lives in |
|---|---|---|---|
| `T0_RUNTIME` | Kernel `/versions`, deployed config echo | package/runtime versions, actually-deployed values | container image |
| `T1_SCHEMA` | Zod schemas + enforcement constants | file support, size limits, validation behavior | `relay-api/src/limits.ts`, `contracts/` |
| `T2_CLI` | `relay introspect --json` | CLI commands, flags, defaults, usage, error codes | derived from `commander` at runtime |
| `T3_CONFIG` | declared product config | platform availability, plan/role gating, retention policy, canonical terminology, feature flags | `contracts/src/product-config.ts` |
| `T4_RELEASE` | release records | **when** a fact changed — never its current value | `surfaces/releases/*.yaml` |
| `T5_HUMAN` | recorded product decisions | tie-breaking, editorial ownership, deliberate exceptions | `surfaces/decisions/*.yaml` |

**Arbitration rule (implemented in `concord-core/src/authority.ts`):** for a given fact key, the registry names the
authoritative tier. A claim from a *lower* tier that disagrees is a **conflict**, not an override. A claim from T4 about
a *current value* is always ignored (T4 is temporal, not factual). T5 wins only where it explicitly claims the key.
Two T5 records claiming the same key with different values is an unresolvable conflict by design — that is the escalation
demo.

---

## 5. Documentation estate (six surfaces)

| Surface id | Format | Audience | Publishing | Concord write mode |
|---|---|---|---|---|
| `mintlify` | MDX + frontmatter + `docs.json` | developers | Mintlify GitHub app on merge | file patch via PR |
| `helpcenter` | Markdown + `index.json` fixture | end users | static, served by Concord Worker | file patch via PR |
| `inproduct` | copy registry (JSON, typed) | in-app users | shipped with Relay | file patch via PR |
| `clidocs` | MDX pages under `docs-mintlify/cli/` | developers | as `mintlify` | **generated** — regen, never hand-patch |
| `release` | YAML records + generated changelog MDX | mixed | as `mintlify` | append generated entry |
| `generated` | feature matrix, availability tables, structured metadata | mixed + agents | as `mintlify` | **generated** — regen |

Each surface has an adapter implementing one interface (`contracts.md` §11). Adapters are pure: `read(fs) → DocUnit[]`
and `patch(DocUnit, newBody) → FileDiff`. No adapter performs I/O itself.

---

## 6. Concord: the reconciliation pipeline

`change → detect → normalize → trace impact → reconcile → validate → patch/escalate → publish`

```
                     ┌──────────────┐
  product change ───▶│ 1. DETECT    │  diff current product truth vs. last snapshot → FactDelta[]
                     └──────┬───────┘
                     ┌──────▼───────┐
                     │ 2. NORMALIZE │  adapters read all 6 surfaces → DocUnit[] with stable ids
                     └──────┬───────┘
                     ┌──────▼───────┐
                     │ 3. PROJECT   │  extractors find where each fact is *asserted* in each DocUnit
                     │              │  → FactProjection[] { fact_key, doc_unit_id, mode, asserted_value,
                     │              │                       extractor, confidence }
                     └──────┬───────┘
                     ┌──────▼───────┐
                     │ 4. TRACE     │  FactDelta × FactProjection → Impact[]  (+ terminology closure:
                     │              │  a term rename also impacts units that use the *old* term)
                     └──────┬───────┘
                     ┌──────▼───────┐
                     │ 5. CLASSIFY  │  each Impact → exactly one ActionClass (see §6.1). Deterministic
                     │              │  rules only. No model call in this step.
                     └──────┬───────┘
        ┌───────────────────┼───────────────────┬─────────────────────┐
   ┌────▼─────┐      ┌──────▼──────┐    ┌───────▼──────┐      ┌───────▼────────┐
   │ DETERM.  │      │ GROUNDED    │    │ EDITORIAL    │      │ UNRESOLVED     │
   │ REGEN    │      │ PATCH       │    │ REVIEW       │      │ CONFLICT       │
   │ pure fn  │      │ model +     │    │ model drafts │      │ NO EDIT.       │
   │ no model │      │ evidence    │    │ + must-review│      │ Surface only.  │
   └────┬─────┘      └──────┬──────┘    └───────┬──────┘      └───────┬────────┘
        │            ┌──────▼──────────────────▼───────┐              │
        │            │ 6. VALIDATE                      │             │
        │            │  - evidence present & resolvable │             │
        │            │  - no new facts introduced       │             │
        │            │  - adversarial falsification     │             │
        │            │  - path allowlist                │             │
        │            └──────┬───────────────────────────┘             │
        └───────────────────┼─────────────────────────────────────────┘
                     ┌──────▼───────┐
                     │ 7. PUBLISH   │  run record → concord_db; patch bodies → R2;
                     │              │  optional GitHub branch + PR; changelog entry
                     └──────────────┘
```

### 6.1 Action classification — deterministic rules, in order

The first matching rule wins. This table is the specification; `concord-core/src/classify.ts` implements it literally.

| # | Condition | Action |
|---|---|---|
| 1 | Two or more authoritative-tier claims disagree on the fact value, **or** the required evidence is missing/unresolvable | `UNRESOLVED_CONFLICT` |
| 2 | `projection.mode === "generated"` | `DETERMINISTIC_REGEN` |
| 3 | `projection.mode === "mechanical_value"` and the new value is a scalar substitution with an unambiguous span | `DETERMINISTIC_REGEN` |
| 4 | `projection.mode === "derived_prose"` and the delta is a value/availability change with a single authoritative source | `GROUNDED_PATCH` (review required, evidence mandatory) |
| 5 | `projection.mode === "editorial"`, **or** the delta implies information-architecture change (new prerequisite, split/merge page, changed task flow), **or** the doc unit's `owner` is a human role | `EDITORIAL_REVIEW` |
| 6 | Projection exists but the asserted value already equals the new value | `NO_ACTION` |

**Escalation is a first-class success.** The eval harness scores "correctly refused" alongside "correctly fixed", and
`unsafe_autofix_count` must be zero for Phase 16 to pass.

### 6.2 Adversarial verification (Phase 15)

Every candidate finding from steps 3–5 that is *not* `DETERMINISTIC_REGEN` goes through a two-role check before it is
surfaced:

1. **Proposer** emits `{claim, evidence[], proposed_action}` (structured output).
2. **Falsifier** receives the claim and the same evidence with the instruction to *refute*, defaulting to
   `refuted: true` under uncertainty. Separate call, no shared context, no sight of the proposer's reasoning.
3. A refuted finding is recorded as `suppressed` **with the refutation text**, not deleted. The public UI shows
   suppressed findings — this is what makes the failure modes inspectable.

Fan-out respects the Workers **6 simultaneous outgoing connections** limit: batch falsification in groups of ≤ 5.

---

## 7. Run execution model

| Phase | Execution | Why |
|---|---|---|
| 10–13 | Synchronous inside the request. Deterministic only. | Runs complete in < 5 s. A synchronous run is far easier to debug. |
| 14+ | **Cloudflare Queue.** `POST /api/admin/runs` validates + persists a `queued` run and returns the run id immediately; a consumer Worker executes steps and writes each step to D1; the UI polls `GET /api/public/runs/:id`. | 5–15 model calls exceed the 30 s default CPU budget. Queue consumers get 15 min wall time. |

**Run state is the product.** Every step writes a `run_step` row with inputs, outputs, model usage, and timing. That
table is what powers both the public run inspector and the eval harness. Nothing about a run is ephemeral.

`RunStatus`: `queued → running → completed | failed | partial`. `partial` is a real terminal state: some impacts
resolved, some escalated. It is the *expected* outcome of an interesting change, not an error.

---

## 8. Public vs privileged

| | Public (`/api/public/*`) | Privileged (`/api/admin/*`) |
|---|---|---|
| Auth | none | Cloudflare Access (`@anthropic.com`, OTP) **+ backend JWT verification** |
| Model calls | **zero** | yes, capped |
| Reads | fact graph, doc units, past runs, eval report, replay fixtures | everything |
| Writes | none | allowlisted fact mutations + allowlisted doc-unit fixture edits only |
| GitHub | none | ephemeral branch + PR |

Enforcement is **routing plus middleware**, layered:
- `/api/admin/*` is behind a Cloudflare Access application (edge gate).
- The Hono middleware `requireAccessIdentity` verifies the `Cf-Access-Jwt-Assertion` JWT against JWKS, checks `aud`,
  `iss`, expiry, and the email domain. **A missing header is a 403, never a bypass.**
- A `DEMO_ADMIN_ENABLED` env flag defaults to `false`; if unset, the admin routes 404 entirely. This means a
  misconfigured Access app cannot expose a live mutation path.

The public UI must be fully useful with the admin path disabled. Phase 17 is verified in a private browser window.

---

## 9. Failure modes and handling

| Failure | Detection | Behavior |
|---|---|---|
| Container cold/unavailable | kernel fetch throws or times out (8 s) | 503 with copy-registry id `error.analysis.kernel_unavailable`; session turn recorded as `failed`, not silently dropped. Retry once. |
| Kernel returns non-2xx | status check | Surface the kernel's structured error; never expose a traceback. |
| Model refusal (`stop_reason: "refusal"`) | checked **before** reading `content` on every call | NL translation → user-facing "unsupported request" with alternatives. Concord proposal → the impact becomes `EDITORIAL_REVIEW` with reason `model_refusal`. |
| Model returns schema-invalid output | Zod parse of the structured output | Retry once with the validation error appended; second failure → `EDITORIAL_REVIEW`, never a guessed patch. |
| Patch cites unresolvable evidence | validation step 6 | Patch **discarded**, impact re-classified `UNRESOLVED_CONFLICT`. Logged as a proposal failure and counted in the eval report. |
| Spend cap reached | per-run and per-day counters in D1, checked before each call | Run ends `partial` with `reason: "budget_exhausted"`. Remaining impacts stay unresolved and visible. |
| D1 write conflict on concurrent runs | one-run-at-a-time lock row | Second run is rejected with the id of the in-flight run. |
| GitHub API failure | non-2xx | Run still `completed`; `publish` step marked failed with the patch bodies retained in R2. Never leaves a half-created branch: create branch → commit → PR, and on failure delete the branch. |
| Stale generated file hand-edited | generator output ≠ file content | Overwrite, and record a `generated_file_hand_edited` warning in the run. This is a documented behavior, not a bug. |

**Global rule:** no failure path silently drops an impact. Every impact detected in step 4 appears in the run record
with a terminal disposition, including `unresolved` and `abandoned_budget`.

---

## 10. Telemetry, logging, observability

- **Structured JSON logs only**, one object per line, via a `log(event, fields)` helper. Fields always include
  `request_id`, `run_id` (when applicable), `phase`, `duration_ms`.
- **Never log:** request bodies of admin mutations beyond the allowlisted key/value, any header beginning `Cf-Access-`,
  the Anthropic key, GitHub tokens, or full model prompts. Log prompt *hashes* and token counts.
- **Model usage is persisted, not just logged:** every call writes `model_call` row with
  `input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model, purpose, run_id`.
  The public run inspector shows per-run cost. This doubles as the spend-cap source of truth.
- **Audit log** (`audit_log` table, append-only) for every admin action: Access email, fact key, old value, new value,
  run id, resulting PR url. Publicly readable *with the email redacted to domain only*.
- Cloudflare **Workers Logs** for retention; a `/api/public/health` endpoint reports per-dependency status.
- Phase 01 establishes the log helper. Do not defer this to Phase 20.

---

## 11. Rollout and migration

- D1 migrations are numbered `.sql` files applied with `wrangler d1 migrations apply`. Forward-only. Every phase that
  changes schema adds a new file; none edits an existing one.
- **The freeze at Phase 09** is a git tag plus `CONTRACTS-FROZEN.md`. After it, a change to `@relay/contracts` requires
  a minor version bump and a note in that file. Concord pins the version.
- Deploys are independent: `pnpm deploy:relay`, `pnpm deploy:concord`, `pnpm deploy:kernel`. There is no coordinated
  deploy, and neither app may hard-fail on the other being an older version — Concord degrades to "surface unavailable"
  for a missing Relay endpoint.
- Seed data (`pnpm seed:relay`, `pnpm seed:concord`) must reproduce byte-identical state from an empty database. This is
  what makes the public demo reproducible and the eval numbers meaningful.
