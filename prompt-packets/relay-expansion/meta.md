# meta.md — Orchestration Guide (for you, not the coding agent)

This packet expands **Relay** from a bounded data-analysis workspace into a multi-surface AI
workspace (Chat, Projects, Analysis, Terminal, Artifacts) inside the **already deployed**
Relay/Concord monorepo. It repairs product lifecycle defects and demo-identity ambiguity along the
way. Concord is out of scope and must keep working untouched.

**7 phases.** Run one at a time, verify the gate, then hand the next prompt to a coding agent.
The old packet (`prompt-packets/relay-concord/`) is historical evidence — never edited, sometimes
consulted (each phase prompt says when).

---

## Assumptions (correct these before Phase 1 if wrong)

| # | Assumption | Why |
|---|---|---|
| B1 | The deployed system matches the repo at HEAD (contracts `1.3.0`, estate pinned at `22aee4c`). | Recent commits say so; Phase 1 re-verifies. |
| B2 | You can commit to the **estate repo** and repin the submodule. New copy entries are the ONE permitted estate change (chat/terminal/workspace copy files). No docs pages change. | Copy registry is a machine-readable product surface; your instructions allow it. |
| B3 | Chat and the browser Terminal reuse the **existing** `ANTHROPIC_API_KEY`, `MODEL_ID` (`claude-opus-5`), the $5/day cap, and the 20/hr/IP rate guard. No new spend infrastructure. | `limits-guard.ts` already generalizes by route; `model_call.purpose` already anticipates `"chat"`. |
| B4 | Production was **wiped on 2026-07-27** (verified: all 45 projects were build-phase test debris; the deterministic seed never ran in prod — the seed route is dev-only). A minimal live demo project ("Quarterly Sales", 2 CSVs, 1 session, real artifacts) was recreated through the public API. Phase 2 makes wipe+reseed **programmatic**: a token-gated maintenance route + `scripts/reset-relay.mjs`, run once after the Phase-2 deploy (wiping interim junk incl. the interim demo project) and reusable any time the public demo needs a reset. Rows with `owner_id NULL` (created pre-scoping) have **no API semantics**: invisible to reads, removed by the reset. | Junk re-accumulates until scoping ships, so a reset capability beats a one-off manual prune; it also finally gets the full deterministic fixture (3 projects, lineage chain) into production. |
| B5 | The CLI persists its minted visitor cookie in a local config file so CLI-created resources stay in one workspace across invocations. | Without this, per-visitor scoping would orphan every CLI request. |
| B6 | AI SDK **v6** (`ai@^6`, `@ai-sdk/react@^3`) + `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@ai-sdk/anthropic` (the v6-line major) is the chat stack; `@xterm/xterm@^5` + `@xterm/addon-fit` is the terminal renderer. Verified current July 2026 — see `research-findings.md`. | Decided during packet generation, per your instruction to pick one. |
| B7 | Hash routing stays (extended, not replaced). No react-router, no Tailwind, no second component system. assistant-ui is used via its **unstyled primitives**, styled with Olive Folio. | Smallest-delta rule; the repo has no Tailwind and the copy/no-literal-copy discipline is CSS-agnostic. |

## User-provided documents that are PART of this packet

Include these with prompts as listed below — the packet deliberately does not duplicate them:

- `prompt-packets/relay-concord/contracts.md` and `architecture.md` — the original build contracts (historical authority).
- `CONTRACTS-FROZEN.md`, `ARCHITECTURE.md`, `SECURITY.md`, `COMPAT.md` — repo-root current-state docs.
- `design/theme.json` + `design/README.md` — the visual contract (Olive Folio).
- `fixtures/cli-introspection.json` — the T2 grammar the Terminal reuses.
- The live repo itself — every phase starts by reading code, not prose.

## Phase sequence, inputs, gates

| Phase | Prompt | Support docs to attach | Deliverable | Verify before continuing |
|---|---|---|---|---|
| 1 | `master-prompt-phase-01.txt` | `architecture.md`, `contracts.md`, `constraints.md`, root `CONTRACTS-FROZEN.md`, old packet `contracts.md` | Audit report (`NOTES.md` section), lifecycle matrix committed, migration `0005`, `@relay/contracts` **1.4.0** (facts + schemas), demo-auth v2 (per-visitor ids), `whoami` endpoint. No UI change. | `pnpm -r typecheck && pnpm -r test` green **including all Concord tests**; `GET /api/product-truth` and `/api/copy-registry` byte-shape-compatible (Concord fixture tests prove it); CONTRACTS-FROZEN changelog has the 1.4.0 entry. |
| 2 | `phase-02-prompt.txt` | `architecture.md` §3–4, `contracts.md` §2–3, `validation.md` §2 | Full project/file/session lifecycle routes with ownership enforcement + cascades; token-gated maintenance reset+seed route + `scripts/reset-relay.mjs`; CLI gains rename/delete/download commands + cookie persistence; introspection fixture regenerated; seed rows owned by `seed`. | New lifecycle tests green; cascade test proves no orphaned D1 rows or R2 objects; two-visitor isolation test green; reset route 404s without its token and wipes+reseeds deterministically with it; `relay projects delete` works from a real shell. **Operator:** set `RELAY_MAINTENANCE_TOKEN` secret, deploy, run `node scripts/reset-relay.mjs` once. |
| 3 | `phase-03-prompt.txt` | `architecture.md` §5, `constraints.md` (visual rules), `design/theme.json`, `design/README.md` | The multi-surface app shell: sidebar nav, route table, rehoused Projects/Analysis/Artifacts screens, empty states, Settings/About. Chat + Terminal appear as routed placeholders ("coming in this workspace" empty states with real copy). | Manual QA: every old flow (upload → session → turn → artifact) still works inside the new shell, desktop + narrow; keyboard nav; no hardcoded strings (`no-literal-copy` extended and green). **Estate copy PR #1 + submodule repin happens here.** |
| 4 | `phase-04-prompt.txt` | `architecture.md` §6, `contracts.md` §4, `validation.md` §4, `research-findings.md` | Chat: streaming Anthropic conversations, D1 persistence, thread list, rename/delete, optional project association with bounded context. | New conversation streams and survives reload; kill the API key in dev → visible failure state; spend/rate guard covered by test; no key in client bundle (`scrub-dist-secrets` still green); Concord tests still green. |
| 5 | `phase-05-prompt.txt` | `architecture.md` §7, `contracts.md` §5, `validation.md` §5 | Browser Terminal: xterm surface, command engine bound to introspection fixture, anti-drift parity test. | `relay projects list` works in the browser; `help`/`clear`/`history` work; unsupported input fails with copy-registry error text; parity test fails if a bound command's flags drift from the fixture. |
| 6 | `phase-06-prompt.txt` | `architecture.md` §8, `contracts.md` §6 | Artifacts as a first-class area (global browse/filter/detail/delete), cross-surface links (artifact→project, session→artifact, chat→project), T3 facts now report real values, copy complete. | Artifact reachable in ≤2 clicks from anywhere; provenance renders; deleting an artifact cleans R2 + provenance; product-truth snapshot shows chat/terminal availability facts with correct values. **Estate copy PR #2 + repin if any strings were added.** |
| 7 | `phase-07-prompt.txt` | `validation.md` (all), `constraints.md` | Hardening: full manual QA matrix, a11y pass, responsive pass, error/empty/loading audit, docs-worthy behavior inventory for the future docs project, final deploy + live verification. | The Definition-of-Done checklist in `validation.md` §8 — every box. Live site walk-through as a first-time visitor. |

## Why this order de-risks the build

1. **Contracts and migrations first** (Phase 1) because every later phase writes to the new columns
   and fact keys; changing them mid-build would ripple. It is also the only phase that can break
   Concord, so it carries the heaviest regression gate while the diff is smallest.
2. **Lifecycle + identity before UI** (Phase 2): the shell, chat, and terminal all render
   ownership-scoped lists and destructive actions. Building UI against the broken global pool would
   mean rebuilding it. The scripted reset lands here too, so the moment scoping deploys the
   database can be put into its canonical seeded state with one command.
3. **Shell before surfaces** (Phase 3): Chat and Terminal land into stable navigation instead of
   each phase re-litigating layout.
4. **Chat before Terminal** (4 before 5): Chat exercises the new conversation tables and spend
   guards; Terminal is lower-risk (no model calls) and benefits from the settled API client.
5. **Cross-surface polish after all surfaces exist** (Phase 6) so provenance/links are real, never
   faked — your explicit constraint.
6. **Hardening last** (Phase 7), when every state it audits actually exists.

## Standing rules for every phase

- Attach `constraints.md` to **every** prompt. It is short and load-bearing.
- The agent must run `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` before claiming done — the
  Concord packages are in `-r` scope on purpose: they are the compatibility canary.
- Any change under `packages/contracts/` beyond what Phase 1 versioned = stop and ask you.
- Estate changes: only `in-product-copy/*.json`, only via your PR + repin (Phases 3 and 6).
- Never edit `prompt-packets/relay-concord/`.
