# doc-eng-demo — Relay + Concord

Two separately buildable systems in one monorepo, built to demonstrate a thesis: **documentation is
an engineered information system**, not prose that trails the product. Facts have authoritative
sources, renderings have provenance, drift is detectable, and every automated change carries the
evidence that justifies it — or it does not happen.

- **Relay** — a small AI workspace application (projects, files, AI-assisted chat, bounded CSV
  analysis sessions with full provenance, a real CLI). A deliberately modest product whose job is to
  generate nontrivial documentation requirements: limits, platform availability, plan gating,
  retention windows, CLI surfaces, terminology.
- **Concord** — the primary technical focus: a documentation reconciliation control plane. It models
  product truth and a heterogeneous documentation estate as a **fact graph**, detects drift between
  them, and decides per surface whether a change is deterministically regenerated, AI-patched with
  mandatory evidence, escalated for editorial review, or refused as an unresolved conflict.

Live: [relay.otonieltrejo.com](https://relay.otonieltrejo.com) ·
[concord.otonieltrejo.com](https://concord.otonieltrejo.com) ·
[docs.otonieltrejo.com](https://docs.otonieltrejo.com)

## Architecture

```
                 product truth (six tiers, six places)
   T1 schema · T2 CLI introspection · T3 config · T4 releases · T5 decisions · T6 copy
        │
        ▼                                        estate/ (repo 2, submodule)
┌──────────────┐  GET /api/product-truth   ┌──────────────────────────────────┐
│  relay-api   │◄──────────────────────────│  concord-api (Worker + Queue)    │
│  (Worker +   │  GET /api/copy-registry   │   snapshot → extract → arbitrate │
│  D1 + R2 +   │       (the ONLY two)      │   → classify → validate → patch  │
│  container   │                           │   → falsify → publish            │
│  kernel)     │                           └───────┬──────────────┬───────────┘
└──────────────┘                                   │              │
        ▲                                          ▼              ▼
   relay-web SPA                            concord-web UI   GitHub App (repo 2 ONLY)
   (+ relay CLI)                            (read-only +     branch → PR with evidence
                                             Change Lab)     → human review → Mintlify
                                                               publishes docs site
```

Six documentation surfaces are parsed by six adapters (Mintlify docs, help center, in-product copy,
CLI docs, release notes, generated pages). Seven extractors project facts out of the prose with
per-extractor confidence; authority arbitration decides which tier wins per fact; six classification
rules map each fact delta to an action class. Model-authored patches pass four mechanical gates
(evidence resolution, anti-hallucination extraction, register, path allowlist) and an adversarial
falsifier before a human ever sees them. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Two repositories — and why

| | this repo (`doc-eng-demo`) | [`doc-eng-demo-estate`](https://github.com/grainpool/doc-eng-demo-estate) |
|---|---|---|
| Contains | all code, product truth, fixtures, CI | the six documentation surfaces |
| `.github/` | yes — CI lives here and only here | **none, ever** |
| GitHub App | not installed — unreachable | Concord's App: Contents+PRs write |

The split is a security boundary, not an organizational preference. Concord holds `Contents: write`
on the estate through a GitHub App installed **on the estate repo only**. The estate contains no
`.github/` directory, so no privileged workflow is reachable from any branch the App (or a visitor-
triggered run) pushes — and the repo holding CI and code is structurally out of the App's reach, not
merely disallowed by policy. Branch protection on the estate's `main` forces every write down the PR
path. Four independent layers, detailed in [SECURITY.md](SECURITY.md).

The estate is mounted at `estate/` as a git submodule and read from disk — no build step fetches it
over the network.

## Getting started

```sh
git clone --recurse-submodules https://github.com/grainpool/doc-eng-demo.git
cd doc-eng-demo
pnpm install
pnpm run setup    # submodule init + git hooks (pre-commit secret scan).
                  # NOTE: "run" is required — bare `pnpm setup` invokes pnpm's
                  # own built-in setup command, not this script (see COMPAT.md).
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Requires Node 22+, pnpm 9+, and Docker Desktop (only for deploying the analysis-kernel container;
tests and local dev do not need it). `pnpm dev` starts the Relay app locally; the Concord inspector
is served by `concord-api` (`npx wrangler dev` in `packages/concord-api`). Deployed behavior that
differs from documentation is recorded in [COMPAT.md](COMPAT.md) — that file is the project's
observed-platform-reality journal and worth reading first when something disagrees with you.

## Packages

| Package | What it is |
|---|---|
| `packages/contracts` | `@relay/contracts` — Zod schemas, enums, error codes, the model constant. The freeze surface (v1.3.0). |
| `packages/relay-api` | The Relay Worker (Hono): API + static assets + D1 + R2 + container proxy. |
| `packages/relay-web` | Vite + React SPA, built into the Worker's assets and deployed with it. |
| `packages/relay-cli` | The `relay` CLI — real commands against the deployed API; its introspection JSON is tier-2 product truth. |
| `packages/relay-kernel` | The analysis kernel: a Cloudflare Container (FastAPI + pinned pandas/scipy/statsmodels/matplotlib), eight named operations, no code execution surface. |
| `packages/concord-core` | Pure reconciliation logic: adapters, extractors, arbitration, classification, validation gates, generators, falsifier prompts. No I/O. |
| `packages/concord-api` | The Concord Worker: run executor (Queue consumer), spend gates, Access identity middleware, GitHub publish path, cleanup cron. |
| `packages/concord-web` | The public run inspector, replay Change Lab, facts browser, failures page, Access-gated live admin. Static, no framework. |

## How the two workstreams relate

Relay exists so Concord has something true to reconcile against. The coupling is deliberately
minimal (invariant I13): Concord calls exactly two Relay endpoints — `GET /api/product-truth` and
`GET /api/copy-registry` — and nothing else, enforced by a test that greps the source. Relay never
calls Concord. The estate's in-product copy is imported by Relay's web client at build time, which
is what makes UI copy a documentation surface Concord can patch.

## What the evaluation shows

A 36-defect seeded corpus (12 defect classes, 5 negative controls) is injected **in memory** over
the clean estate and run through the real pipeline ([EVALUATION.md](EVALUATION.md) has the
methodology; `fixtures/eval/defects.json` is the corpus):

- **Detection precision 0.882, false-positive rate 0.0** — when Concord flags something, it is real.
- **Detection recall 0.484 overall** — honest and analyzed: structural classes the fact graph
  models (broken refs 3/3, term drift 3/4, stale in-product copy 1/1) score high; classes needing
  editorial judgment (duplicate guidance, missing prerequisites, unsupported claims) score 0 by
  design and are documented as expected misses on the
  [failures page](https://concord.otonieltrejo.com/failures.html).
- **Unsafe autofix count 0 (hard gate)** — no defect ever produced an unreviewed content change.
- **Provenance completeness 1.0 (hard gate)** — every emitted patch carries resolvable evidence.
- Remediation correctness 1.0 over the patches produced; the model-assisted falsifier leg (N=3)
  suppresses false-positive findings at a stable 0.25 rate with zero spread across runs.

## What this deliberately does not do

Non-goals from the build constraints — absences by design, not gaps:

- **No real user auth for Relay** — one fixed demo workspace behind a signed cookie. `plan` and
  `role` exist as product facts to document, not as enforced authorization.
- **No multi-tenancy, RBAC, billing, or checkout** — `plan.feature.*.min_plan` is a documentation
  fact.
- **No RAG, vector stores, or embeddings** — Relay chat gets the file list + schema summary in the
  prompt; that is sufficient and that is the point.
- **No arbitrary code execution** — eight named kernel operations; no `eval`, no
  `DataFrame.query()`, no notebooks, no user-supplied expressions.
- **The help center is a fixture** — a real Intercom integration is a deliberate non-goal; the
  `HelpCenterAdapter` reads and patches local files, which is all the reconciliation problem needs.
- **No connector ecosystem** — `connector_drive` is a mock that exists to generate
  availability/permission documentation.
- **No CMS, editor, or docs theme** — Mintlify renders the docs site; Concord writes files;
  Concord's UI is read-only except the Change Lab's two allowlisted mutation kinds.
- **No hand-authored `llms.txt`** — Mintlify generates it from the reconciled inputs (site
  description, page descriptions, `markdown.instructions`).

## Documents

[ARCHITECTURE.md](ARCHITECTURE.md) — the reconciliation model, source tiers, action classes ·
[SECURITY.md](SECURITY.md) — threat model, controls, verified properties, operator-configured
settings · [EVALUATION.md](EVALUATION.md) — methodology and numbers ·
[COMPAT.md](COMPAT.md) — observed platform reality · [NOTES.md](NOTES.md) — accepted debt ·
[CONTRACTS-FROZEN.md](CONTRACTS-FROZEN.md) — the frozen API surface and its additive history.
