# supporting-spec-index.md — what to read, when

## This packet (`prompt-packets/relay-expansion/`)

| Doc | Purpose | Consult when |
|---|---|---|
| `architecture.md` | The decided design, §-numbered | Start of every phase; §s named per prompt |
| `contracts.md` | Schemas, routes, ids, invariants to honor | Before writing any route/schema/copy id |
| `constraints.md` | Non-goals, anti-patterns, hard rules | Always attached; re-read before "improving" anything |
| `implementation-plan.md` | Phase scope/acceptance | When tempted to pull work forward |
| `validation.md` | Test + QA definitions | End of every phase, before claiming done |
| `research-findings.md` | Package decisions + why | Phase 4 (chat stack), Phase 5 (terminal) |

## Repository documents (current-state authorities)

| Doc | Authority over | Consult when |
|---|---|---|
| `CONTRACTS-FROZEN.md` | The Concord surface + change rule | Phase 1 (the 1.4.0 entry), any contracts thought |
| `ARCHITECTURE.md` (root) | How Concord consumes Relay truth | Understanding why facts/copy matter |
| `SECURITY.md`, `COMPAT.md` | Security model, platform gotchas (workers.dev dataset origin, vitest env) | Phases 1, 2, 4 |
| `design/theme.json` + `design/README.md` | Visual contract + derived-value discipline | Phases 3–7, any styling |
| `packages/contracts/src/*` | The literal contract code | Whenever prose and code could disagree — code wins |
| `fixtures/cli-introspection.json` | T2 grammar (terminal + CLI) | Phases 2, 5 |
| `NOTES.md`, `EVALUATION.md` | Build history, verified observations | Phase 1 audit; Phase 7 write-up |

## Previous packet (`prompt-packets/relay-concord/`) — historical, read-only

| Doc | Consult when |
|---|---|
| `contracts.md` | Phase 1 — original invariants (I2, I3, I13…), fact-family definitions |
| `architecture.md` | Understanding kernel/session/artifact flow before touching adjacent code |
| `constraints.md` | Original anti-patterns (AP1, AP8, AP9) this packet extends |
| `security.md` | Spend rails, secret handling, injection posture rationale |
| `operator-runbook.md` | Operator-side procedures (secrets, deploys, submodule) |
| Phase prompts 01–20 | Only to answer "why is X built this way" — never as current requirements. The "feature complete" freeze language in late phases is a historical milestone, not a present constraint. |

## External (verify at use time, do not trust memory)

- assistant-ui docs (AI SDK v6 integration, primitives) — Phase 4.
- Vercel AI SDK v6 docs (`streamText`, `toUIMessageStreamResponse`, `useChat`, UIMessage parts) — Phase 4.
- `@ai-sdk/anthropic` provider docs — Phase 4.
- xterm.js docs (`@xterm/xterm`, fit addon) — Phase 5.
- Cloudflare Workers streaming Response + Vite plugin docs — Phases 4–5 if streaming misbehaves.
