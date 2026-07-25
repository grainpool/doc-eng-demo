# meta.md — Orchestration Guide (for you, not the coding agent)

This packet builds **Relay** (product fixture) and **Concord** (documentation reconciliation control plane) as two
coordinated workstreams in one monorepo, across **20 verifiable phases**. You run one phase at a time, verify, then
hand the next prompt to a coding agent. No phase asks the agent to reinterpret the whole project.

---

## Assumptions I made (inferred, not given)

These are stated so you can correct them before Phase 01. Each is also recorded in `constraints.md` as a guardrail.

| # | Assumption | Why |
|---|---|---|
| A1 | You are on **Workers Paid ($5/mo)**. | Cloudflare Containers — the analysis kernel — require it. Free tier also caps Worker CPU at 10 ms, which cannot host AI calls. |
| A2 | You own a domain on Cloudflare and can add subdomains (`relay.`, `concord.`, `docs.`). | Stated as available in your spec. |
| A3 | **No real end-user auth in Relay.** Relay identifies "the demo user" via a signed cookie / fixed workspace. | Your scope discipline explicitly excludes complex auth for ordinary Relay users. |
| A4 | **Mintlify docs are Git-backed MDX in the estate repo** (`docs-mintlify/`), published by Mintlify's GitHub app. | Mintlify's current model is `docs.json` + MDX in a repo. Concord patches files, not a CMS API. |
| A5 | **Help center is a local fixture first** (`help-center/` in the estate repo) behind `HelpCenterAdapter`. Intercom is an optional Phase-20+ extension, not built. | Intercom dev workspaces are free but add OAuth + article-model coupling and external state to a demo that must be reproducible from `git clone`. |
| A6 | **Two repositories**: a code monorepo (pnpm workspaces, two deploy targets) and a separate documentation-estate repo. | See "Repo decision" below. |
| A7 | Model calls use **`claude-opus-5`** via a single config constant. Cost is controlled by caps + replay mode, not by silently downgrading models. | Your spend requirements are about *budget enforcement*, and model choice should stay yours. `claude-sonnet-5` is a one-line config swap. |
| A8 | Public demo browses **precomputed run fixtures**; zero model calls on the public path. | Your public/privileged split. |
| A9 | The estate repo contains **no `.github/` directory at all**, and the Concord GitHub App is installed on it and nothing else. | Required to make visitor-triggered branches safe. See "Repo decision". |
| A10 | Provisional names `Relay` / `Concord` are placeholders; the agent must read them from one constants file so renaming is trivial. | You said the names don't matter. |

## Confirmed environment (verified 2026-07-25 — not assumptions)

| | Value |
|---|---|
| GitHub org | **`grainpool`** — intentional, and the same operational identity as the Cloudflare account. Both repos exist, are public, are empty, and have no `.github/` directory. |
| Repo 1 (code) | `https://github.com/grainpool/doc-eng-demo.git` |
| Repo 2 (estate) | `https://github.com/grainpool/doc-eng-demo-estate.git` |
| Cloudflare account id | `589e5ae8d530ba18eb7066f3c8f55478` |
| Cloudflare plan | Workers Paid ($5/mo) + R2 Paid. Containers, D1, and Queues all licensed and **unprovisioned** — clean slate. |
| Zone | `otonieltrejo.com`, Free plan, active. **No plan upgrade is needed for this project** — Workers custom domains work on Free, Access is account-level Zero Trust rather than zone-gated, and our rate limiting is application-level rather than WAF. Do not spend $25 on Pro. |
| Zero Trust | Teams Free, **50 seats included** — see the seat cliff in `constraints.md` §4 and `security.md` §5. Access log retention is 24 h, which is why the D1 `audit_log` is the durable record. |
| Anthropic Console | Org-level spend limit **already configured**. This is the floor beneath the in-app $5/day cap, not a duplicate of it: the app cap is a product behaviour that a bug could defeat, and this is the account boundary under it. |
| Existing resources to avoid colliding with | R2 buckets `gp-prod-uploads`, `numi-backups-prod`; Pages projects `wysee-markdown`, `numitura`. Our names (`relay-artifacts`, `concord-runs`, `relay_db`, `concord_db`) don't collide. |

Two operator to-dos surfaced by that snapshot, neither blocking: enable 2FA on the Cloudflare account (it holds the
Anthropic key and will hold the GitHub App private key — `enforce_twofactor` is currently `false`), and expect to
re-authenticate for R2 bucket creation (see `master-prompt-phase-01.txt`, R2 note). Both are in `operator-runbook.md`
OG-0 and OG-2.

**Deviations from your spec, and why** — see `research-findings.md` §"Deviations". The two that matter:
1. **Python analysis does NOT run in Python Workers (Pyodide).** It runs in a **Cloudflare Container** with real
   `pandas`/`scipy`/`statsmodels`/`matplotlib`. Pyodide's wheel coverage for that combination is "early stages" and
   pins versions outside your control — which would destroy the *package-version-as-product-truth* requirement.
2. **Reconciliation runs move to Cloudflare Queues only at Phase 14**, not before. Phases 10–13 are fast and
   synchronous. Workflows was considered and rejected (extra concept weight; run state already lives in D1 because the
   demo must let anyone inspect past runs).

---

## Repo decision: two repositories — a code monorepo and a documentation estate.

**Code is one monorepo. The documentation estate is a separate repo.** Both public.

Why a monorepo for the code: Concord's thesis is that it consumes *another system's* contracts. A monorepo enforces that
with a versioned workspace package (`@relay/contracts`) and a CI typecheck that fails when Relay breaks something
Concord depends on. Two code repos would replace that compile-time guarantee with a published-package dance, and the
freeze point would become a release ceremony instead of a git tag.

Why the estate is separate: it is the only way the security argument stays one sentence. The Concord GitHub App needs
`Contents: write` to open a PR, and a visitor can trigger a run. If the App were installed where CI lives, safety would
rest on GitHub's workflow-trigger semantics — true, but subtle, and a bad story for a project whose point is rigor.
Splitting makes it structural: **the App is installed on the estate repo, the estate repo contains no `.github/`
directory at all, and therefore no privileged CI exists for a visitor-authored branch to reach.** It also mirrors how
production systems are usually organized — application code and its documentation estate in different repositories with
different owners and review cultures.

**Repo 1 — `doc-eng-demo`** (this repo). All code, all product truth, all fixtures, CI. **The App is not installed here.**
```
doc-eng-demo/
  packages/
    contracts/           # @relay/contracts — the freeze surface. Zod schemas + fact keys.
    relay-api/           # Relay Worker: Hono API + D1 + R2 + Container binding
    relay-web/           # Relay UI: Vite + React, built into relay-api's assets
    relay-cli/           # @relay/cli — commander, real --help, `introspect --json`
    relay-kernel/        # Python analysis kernel (Dockerfile + FastAPI, bounded ops)
    concord-core/        # pure logic: ingest, normalize, fact graph, reconcile, eval. No Cloudflare imports.
    concord-api/         # Concord Worker: Hono API + D1 + R2 + Queue + Access JWT verify
    concord-web/         # Concord UI: Change Lab, run inspector, eval scorecard
  product-truth/
    releases/*.yaml      # T4 — structured release records. TRUTH, not prose.
    decisions/*.yaml     # T5 — human product decisions
  fixtures/
    cli-introspection.json
    eval/defects.json    # answer key + in-memory injections
    runs/*.json          # precomputed reconciliation runs for public replay
    changelab/editable-units.json
  estate/                # ← git submodule → repo 2. Read-only from here.
  prompt-packets/        # this packet
  .github/workflows/     # CI. Lives here and ONLY here.
```

**Repo 2 — `doc-eng-demo-estate`.** The documentation estate. **No `.github/` directory.** Mintlify's GitHub app
connects here; Concord's App is installed here and nowhere else.
```
doc-eng-demo-estate/
  docs-mintlify/
    docs.json            # $ref-split so generated fragments are separate files
    *.mdx                # the developer docs surface
    generated/           # CLI reference, feature matrix, changelog, metadata fragments
  help-center/
    index.json
    *.md                 # the help-center surface (Intercom stand-in)
  in-product-copy/
    *.json               # the copy registry — Relay's UI strings
  README.md              # explains that this repo is written to by an automated system
```

**How the two connect.** Repo 2 is mounted into repo 1 at `estate/` as a git submodule pinned to a SHA. Builds read it
from disk, so nothing needs the network. `pnpm setup` runs `git submodule update --init`; CI checks out with
`submodules: recursive`; the README tells humans to clone with `--recurse-submodules`.

**The direction of writes is one-way and absolute: Concord writes only to repo 2, never to repo 1.** Two consequences
you should expect rather than be surprised by:
- Release *records* are product truth and live in repo 1, so Concord cannot patch them. It generates the changelog
  *page* into repo 2 from those records, and if it believes a record's prose should change it escalates to the owner.
  This is the boundary working, not a limitation to route around.
- Relay's UI copy lives in repo 2 and reaches Relay through the submodule pin. A patch merged in repo 2 does not change
  the running app until the pin is bumped — which is itself a real, documentable product state.

---

## Phase sequence, and why this order de-risks the build

Four blocks. **Do not reorder.** The ordering rule: prove the *riskiest external dependency chain* before writing any
product logic, then build Relay to a frozen contract, then build Concord against a fixture that cannot move under it.

| Block | Phases | What it proves |
|---|---|---|
| **0. Walking skeleton** | 01 | Every external dependency works, deployed, together, before any feature exists. |
| **A. Relay fixture** | 02–09 | A small coherent product that emits stable, multi-sourced product truth. Ends at a git tag. |
| **FREEZE** | gate after 09 | `@relay/contracts@1.0.0` tagged. Concord may now assume stability. |
| **B. Concord** | 10–20 | Reconciliation, escalation, evaluation, Change Lab, privileged mutation, hardening. |

### Full phase table

Phases marked **⛔** have an operator gate — see `operator-runbook.md` before starting them.

| Phase | Prompt file | Deliverable | You verify before continuing |
|---|---|---|---|
| 01 **⛔ OG-1, OG-2** | `master-prompt-phase-01.txt` | **Walking skeleton.** One Worker on your domain serving a React page; `/api/health` proves D1 write+read, R2 put+get, Container round-trip returning real `pandas.__version__`, and one live Anthropic call. Both repos created, estate wired as a submodule, CI. | Visit the URL. `GET /api/health` returns all five checks green with real version strings. `pnpm test` and `pnpm typecheck` pass. A fresh `git clone --recurse-submodules` gives you a populated `estate/`. `COMPAT.md` records actual observed versions/limits. |
| 02 | `phase-02-prompt.txt` | `@relay/contracts` + D1 schema + fact-key registry. Six product-truth source tiers wired as stubs. | `pnpm --filter @relay/contracts test` passes. Every fact key in `contracts.md` §3 resolves to exactly one authoritative tier. No fact is claimed by two tiers *by construction* (conflicts must be data, not schema). |
| 03 | `phase-03-prompt.txt` | Projects, files, R2 upload with enforced limits, project state, UI shell. | Create project → upload CSV → see it listed. Upload an over-limit file → the rejection message text comes from the copy registry, not a hardcoded string. |
| 04 | `phase-04-prompt.txt` | **Analysis kernel.** Container with 8 bounded operations, no arbitrary code path. `/kernel/versions` + `/kernel/operations` introspection. | `curl` each of the 8 ops directly against the kernel via the Worker proxy. Confirm no endpoint accepts code. `/kernel/operations` matches the contract. |
| 05 | `phase-05-prompt.txt` | Analysis sessions: happy path UI + NL→structured-op translation via structured outputs. | Upload CSV → ask "which columns correlate?" in plain English → get a correlation table. Then assert the NL layer *refused* an unsupported request instead of improvising. |
| 06 | `phase-06-prompt.txt` | Artifacts + provenance + lineage view. | Open any artifact → see source file, op id, params, kernel package versions, timestamp. Lineage graph renders. |
| 07 | `phase-07-prompt.txt` | CLI with real `--help`, real errors, and `relay introspect --json`. | `relay --help`, `relay projects list`, a deliberate error, and `relay introspect --json | jq` all behave. The JSON validates against the contract schema. |
| 08 | `phase-08-prompt.txt` | In-product copy registry (structured), release/change records, `/api/product-truth`. | Every user-visible string in the UI traces to a copy-registry id. `/api/product-truth` returns all fact keys with their source tier and provenance. |
| 09 | `phase-09-prompt.txt` | **Relay hardening + CONTRACT FREEZE.** Tests, seed fixtures, spend + rate limits, `git tag relay-contracts-v1`. | `pnpm test` green. Seed script reproduces identical state from clean D1. Tag exists. `CONTRACTS-FROZEN.md` lists what Concord may rely on. |
| 10 | `phase-10-prompt.txt` | **Concord's tiny milestone.** ONE fact (`limit.upload.csv.max_bytes`), TWO surfaces, deterministic result + explained relationship. | Change the limit in Relay config → run Concord → it names both affected doc units, explains *why* each is affected, and produces the correct deterministic update. Nothing else exists yet. **Do not proceed until this is clean.** |
| 11 **⛔ OG-3** | `phase-11-prompt.txt` | Remaining five adapters (Mintlify MDX, help center, in-product copy, CLI introspection, releases). | Each adapter has a golden-file test. `concord ingest --dry-run` lists every doc unit found per surface with a stable id. **And: `docs.<domain>` serves the Mintlify site and `/llms.txt` returns content** — this is the phase where you connect Mintlify, and nothing else will fail if you don't. |
| 12 | `phase-12-prompt.txt` | Fact graph: normalization, provenance, confidence, authority resolution, ownership. | The graph renders. Query one fact → see every projection across surfaces with differing wording but identical value. |
| 13 | `phase-13-prompt.txt` | Deterministic reconciliation + generators (feature matrix, CLI reference, structured metadata). | Regenerate twice → byte-identical output. Hand-edit a generated file → next run overwrites it and says so. |
| 14 | `phase-14-prompt.txt` | Grounded AI patch proposals with mandatory evidence. Queues introduced here. | Every proposed patch carries citations to source facts. Strip the evidence → the proposal is rejected by validation, not merely unflagged. |
| 15 | `phase-15-prompt.txt` | Conflict detection, escalation, adversarial verification (propose → falsify → surface). | Plant two contradicting authoritative sources → the system refuses to edit, names the owner, and states what evidence is missing. |
| 16 | `phase-16-prompt.txt` | Evaluation harness, defect corpus applied as in-memory injections, scorecard, "What the system gets wrong". | `pnpm eval` prints precision/recall/FP/escalation metrics and writes a report. Unsafe-autofix count is **0** or the phase fails. The live estate is unchanged by an eval run — `git status` in `estate/` is clean afterwards. |
| 17 | `phase-17-prompt.txt` | Change Lab + public replay of precomputed runs. | In a private window (no auth), replay a full change end-to-end. Confirm zero model calls in logs. |
| 18 **⛔ OG-4** | `phase-18-prompt.txt` | Cloudflare Access (`@anthropic.com` + OTP) + backend JWT validation + allowlisted live mutation. | Hit the privileged API with no JWT → 403. With a forged JWT → 403. With a real one → live run. Try a fact key outside the allowlist → rejected. |
| 19 **⛔ OG-5, OG-6** | `phase-19-prompt.txt` | GitHub App ephemeral branch/PR, least privilege, auto-cleanup. | A run opens a real PR touching only allowlisted paths. Attempt a path outside the allowlist → refused before any API call. Branch is reaped. **`main` cannot be pushed to directly** — that line verifies *your* branch protection, not the agent's code. |
| 20 | `phase-20-prompt.txt` | Security/observability/cost hardening + public polish + agent-readable docs + README/architecture. | Work `validation.md` §8 (the full security checklist) line by line. Then `git clone` into a fresh directory and follow your own README. |

### Why this de-risks

- **Phase 01 fails cheap.** Five external dependencies (Workers assets, D1, R2, Containers, Anthropic API) are proven
  in one afternoon, with zero product code to throw away if the Container path or the Vite plugin misbehaves.
- **Phase 04 before 05.** The container is the single most likely thing to fight you. It gets its own phase, verified
  by `curl`, before any UI depends on it.
- **Phase 09 is a hard gate.** Concord's difficulty comes almost entirely from its inputs moving. Freezing the contract
  at a tag converts an integration problem into a fixture problem.
- **Phase 10 is deliberately tiny.** One fact, two surfaces. If the fact→projection→action chain is wrong, you find out
  with ~300 lines of code in front of you instead of 3,000.
- **Deterministic before AI (13 before 14).** If a change can be handled mechanically, the AI path must never see it.
  Building deterministic first makes that ordering structural, not aspirational.
- **Escalation before evaluation (15 before 16).** The eval harness needs "correctly refused to edit" as a scoreable
  outcome. Building the escalation machinery first means the harness measures real behavior, not a placeholder.
- **Access before GitHub (18 before 19).** No visitor-triggered write path exists until the identity gate is verified
  at the backend.

---

## Which supporting docs to attach to each prompt

Attach **only** the listed files. Over-attaching is the main cause of an agent drifting outside its phase.

**Never attach `meta.md` or `operator-runbook.md`.** Both are yours. Every operator gate is already restated in the phase
prompt that depends on it, so the agent stops correctly without having read either — and attaching the runbook invites it
to attempt work that is not its to do.

| Phase | Attach |
|---|---|
| 01 | `architecture.md`, `constraints.md`, `research-findings.md`, `validation.md`, `supporting-spec-index.md` |
| 02 | `contracts.md`, `architecture.md`, `constraints.md` |
| 03 | `contracts.md`, `constraints.md`, `validation.md` |
| 04 | `contracts.md` (§4 kernel), `constraints.md`, `security.md` (§3 kernel isolation), `research-findings.md` (§2) |
| 05 | `contracts.md` (§4, §5), `constraints.md`, `security.md` (§5 model spend) |
| 06 | `contracts.md` (§6 provenance), `constraints.md` |
| 07 | `contracts.md` (§7 CLI), `constraints.md`, `validation.md` |
| 08 | `contracts.md` (§3, §8, §9), `constraints.md` |
| 09 | `contracts.md` (all), `validation.md`, `constraints.md` |
| 10 | `contracts.md` (§10–§12), `architecture.md` (§6 Concord), `constraints.md` |
| 11 | `contracts.md` (§11 adapters), `constraints.md`, `research-findings.md` (§4 Mintlify, §5 Intercom) |
| 12 | `contracts.md` (§12 fact graph), `architecture.md` (§6) |
| 13 | `contracts.md` (§13 actions), `constraints.md` |
| 14 | `contracts.md` (§14 patches), `security.md` (§5), `architecture.md` (§7 queues) |
| 15 | `contracts.md` (§15 conflicts) |
| 16 | `validation.md` (§6 eval), `contracts.md` (§16 defect taxonomy) |
| 17 | `contracts.md` (§17 Change Lab), `security.md` (§4 mutation allowlist) |
| 18 | `security.md` (all), `research-findings.md` (§3 Access), `architecture.md` (§8) |
| 19 | `security.md` (all), `research-findings.md` (§6 GitHub App) |
| 20 | `validation.md` (all), `security.md` (all), `constraints.md` |

## What YOU must supply — see `operator-runbook.md`

**`operator-runbook.md` is the authoritative list of every action only a human can perform**, in phase order, with what
you do, what you hand back, how long it takes, and what breaks if you skip it. Read it before Phase 01 and keep it open.
It is operator-facing: **do not attach it to a phase prompt.** Each gate is duplicated into the prompt that needs it, so
the agent stops on its own without having read the runbook.

Summary, so you can plan your time:

| Gate | Phase | What you do | Time |
|---|---|---|---|
| OG-0 | before 01 | Prerequisites — already satisfied on this account; verify only | — |
| OG-1 | 01 | Provide the Anthropic API key for `wrangler secret put` | 1 min |
| OG-2 | 01 | *Conditional* — create the R2 bucket in the dashboard if the CLI scope fails | 2 min |
| OG-3 | 11 | **Mintlify: account, connect repo 2, custom domain + `docs` CNAME** | 20–30 min |
| OG-4 | 18 | Zero Trust team domain, **seat notification**, Access application | 20 min |
| OG-5 | 19 | GitHub App — create, install on repo 2 only, private key | 15 min |
| OG-6 | 19 | Branch protection on `main` of the estate repo | 3 min |

Roughly **75 minutes of human work total**, unevenly distributed. Phases 02–10 and 12–17 need nothing from you but
verification. OG-3 is the one with no loud failure if you forget it — nothing breaks at Phase 11, and then Phase 20
cannot verify the served `/llms.txt`.

If you have brand/visual preferences, hand them to the agent at Phase 03 (Relay UI) and Phase 17 (Concord UI). Absent
that, the agent is instructed to keep both UIs plain and legible and not invent a brand.

**The standing rule the agent follows:** at any gate whose input is missing, it stops and asks you for that one item. It
does not invent a placeholder, comment out the dependent code, mark the step "skipped for now", or attempt the dashboard
configuration itself. A fabricated credential that typechecks is worse than a halt.

## How to run a phase

0. **Check `operator-runbook.md` for a gate on this phase.** Phases 01, 11, 18, and 19 need something from you. For 11,
   18, and 19, do your part *before* handing over the prompt — the agent will otherwise get partway in and stop.
1. Paste the phase prompt + attach only its listed docs.
2. Let the agent finish. Do not answer mid-phase scope questions with "yes, also do X" — that is what the next phase is for.
3. Run the phase's verification row above and the matching section of `validation.md`.
4. If verification fails, re-prompt **inside the same phase** with the observed failure. Do not advance.
5. Commit with the phase number in the message: `phase-04: analysis kernel container`.
6. When a platform reality contradicts this packet, the agent must append to `COMPAT.md` and state the deviation
   in its response. Read those. They are the highest-value output of the early phases.
