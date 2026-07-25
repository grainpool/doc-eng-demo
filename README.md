# doc-eng-demo — Relay + Concord

Two separately buildable systems in one monorepo:

- **Relay** — a small AI workspace application (projects, files, an AI-assisted chat, bounded CSV
  analysis sessions with full provenance, a real CLI). A deliberately modest product whose job is to
  generate nontrivial documentation requirements.
- **Concord** — the primary technical focus (built from Phase 10): a documentation reconciliation
  control plane that models product truth and a heterogeneous documentation estate as a fact graph,
  and decides per surface whether a change is deterministically regenerated, AI-patched with
  mandatory evidence, escalated for editorial review, or refused as an unresolved conflict.

## Two repositories

| | this repo (`doc-eng-demo`) | [`doc-eng-demo-estate`](https://github.com/grainpool/doc-eng-demo-estate) |
|---|---|---|
| Contains | all code, product truth, fixtures, CI | the six documentation surfaces |
| `.github/` | yes — CI lives here and only here | **none, ever** |

The estate is mounted at `estate/` as a git submodule and read from disk — no build step fetches it
over the network. The split is a security boundary: the Concord GitHub App (Phase 19) is installed
on the estate repo only, so the repo holding CI and code is structurally out of its reach.

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

Requires Node 22+, pnpm 9+, and Docker (for the analysis-kernel container image).

## Packages

| Package | What it is |
|---|---|
| `packages/contracts` | `@relay/contracts` — Zod schemas, enums, error codes, the model constant. The freeze surface. |
| `packages/relay-api` | The Relay Worker (Hono): API + static assets + D1 + R2 + container proxy. |
| `packages/relay-web` | Vite + React SPA, built into the Worker's assets and deployed with it. |
| `packages/relay-cli` | The `relay` CLI (stub until Phase 07). |
| `packages/relay-kernel` | The analysis kernel: a Cloudflare Container (FastAPI + pinned pandas/scipy/statsmodels/matplotlib). |

Concord packages arrive in Phase 10.

## Scripts

`pnpm setup` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm dev` ·
`pnpm deploy:relay` · `pnpm deploy:kernel` (the kernel image ships inside the Relay deploy)

## Phase 01 status

Walking skeleton: [https://relay.otonieltrejo.com](https://relay.otonieltrejo.com) serves a single
page reporting `GET /api/health` — five dependency checks (Worker+assets, D1, R2, container kernel,
Anthropic API) with real observed values. Observed platform reality is recorded in [COMPAT.md](COMPAT.md).
