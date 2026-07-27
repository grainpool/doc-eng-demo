# implementation-plan.md — 7 phases

De-risk order: contracts/migrations (the only Concord-risk) → lifecycle/identity foundation →
shell → the two new surfaces (model-bearing first) → cross-surface truth → hardening. Foundation,
integration, business rules, and polish are deliberately separated.

---

## Phase 1 — Audit, contracts 1.4.0, migrations, identity groundwork

**Objective**: everything later phases build on exists and Concord provably still works.
**Scope**: repo audit report (preserve / expose / extend / repair / deprecate classification,
appended to `NOTES.md`); lifecycle matrix committed as `docs`-free code comment or NOTES section;
migration `0005` (`owner_id` on project + conversation tables + indexes); `@relay/contracts` 1.4.0
(fact keys, error codes, conversation schemas, chat message limit); `CONTRACTS-FROZEN.md` entry;
`demo-auth.ts` v2 (per-visitor ids, legacy cookie re-mint); `workspace.ts` scope helper;
`GET /api/whoami`. **No UI, no new surfaces.**
**Depends on**: nothing.
**Acceptance**: full monorepo suite green incl. Concord fixture/coupling tests; product-truth
snapshot includes the six new keys with honest values (chat/terminal availability **false** —
nothing shipped yet); two fresh cookies get distinct `vis_*` ids; old `demo-user` cookie is
re-minted.
**Waits for later**: any route behavior change beyond scoping plumbing.

## Phase 2 — Project/file/session lifecycle repair + demo scoping + CLI parity

**Objective**: the foundation behaves like a managed product, not a global dump.
**Scope**: PATCH/archive/unarchive/DELETE project with full cascade (D1 batch + R2 cleanup);
DELETE/download file (409 when session-referenced); DELETE session (turns cascade, artifacts
survive); ownership enforcement on every existing route (mine|seed reads, mine mutations, NULL
invisible); token-gated `POST /api/internal/reset` + `scripts/reset-relay.mjs` (wipe content +
R2, keep `model_call`, reseed as `seed`); seed marks rows `owner='seed'`;
CLI: `projects rename|archive|delete`, `files delete|download`, cookie persistence in
`~/.config/relay/session`; regenerate `fixtures/cli-introspection.json`; destructive-action UX in
the *existing* screens (minimal — the shell arrives next phase).
**Acceptance**: cascade test proves zero orphaned rows/objects; two-visitor isolation test; reset
route 404s without token, wipes+reseeds deterministically with it, preserves `model_call`; seed
determinism test still green; staleness gate green after fixture regen; manual: create→rename→
archive→unarchive→delete a project from UI and from the real CLI. Operator then sets
`RELAY_MAINTENANCE_TOKEN`, deploys, and runs the reset script once — production receives the
canonical seeded fixture for the first time.
**Waits**: conversations routes (tables exist, unused), any navigation work.

## Phase 3 — Multi-surface application shell

**Objective**: one product, five visible surfaces, existing features rehoused unchanged.
**Scope**: `AppShell` + sidebar + route table; default `#/chat` (placeholder state this phase);
rehouse ProjectList/ProjectDetail/Session/ArtifactDetail; Analysis entry screen; Settings/About
(product info from product-truth + health link); workspace banner (demo privacy/persistence
copy); empty/loading states per surface; theme.json derived tokens for shell; estate copy PR #1
(chat/terminal/workspace families + shell strings) + submodule repin; old-route redirects.
**Acceptance**: full regression of the analysis workflow inside the shell; narrow viewport nav;
keyboard traversal; `no-literal-copy` extended and green; placeholders explain what's coming
using registry copy (not lorem).
**Waits**: any chat/terminal functionality.

## Phase 4 — Chat

**Objective**: polished streaming Anthropic chat with persistence and lifecycle.
**Scope**: conversation CRUD routes + stream route per architecture §6; `ai@6` +
`@ai-sdk/anthropic` + `@ai-sdk/react@3` + `@assistant-ui/react(-ai-sdk)` (unstyled primitives,
Olive Folio styling); thread list, new/rename/delete/reopen; project association picker + bounded
context injection; spend guard + `model_call` accounting; failure states (budget, rate, key
absent, stream abort); flip `availability.feature.chat.platform.web` to true.
**Acceptance**: validation.md §4 suite + manual: stream, reload mid-history, delete thread,
kill key in dev → explicit unavailable state; Concord tests green; bundle check (lazy route).
**Waits**: attachments beyond project association (explicitly deferred unless trivial),
terminal work.

## Phase 5 — Browser Terminal

**Objective**: the CLI surface visible in the product without installing anything.
**Scope**: `#/terminal` with xterm renderer; parser + bindings over the introspection fixture;
built-ins help/clear/history; parity/drift vitest; unavailable-in-browser messaging for
upload/download-style commands; flip `availability.feature.terminal.platform.web` to true.
**Acceptance**: validation.md §5; parity test demonstrably fails when a binding flag is renamed
(prove once in a scratch commit, then revert); no code-eval path exists by construction.
**Waits**: nothing downstream.

## Phase 6 — Artifacts first-class + cross-surface truth

**Objective**: durable outputs discoverable product-wide; product truth reports the finished shape.
**Scope**: global artifacts route + browse/filter/detail screens; artifact delete lifecycle;
cross-surface links (architecture §8); defunct-session rendering; copy completion + estate PR #2
/ repin if needed; verify all six new facts render correctly in product-truth and any
copy interpolations reference them.
**Acceptance**: artifact reachable in ≤2 clicks from chat/projects/analysis/terminal contexts;
delete cleans provenance + R2; snapshot diff shows only expected fact values.
**Waits**: nothing.

## Phase 7 — Hardening and product polish

**Objective**: credible public demo under failure, on phones, with a keyboard.
**Scope**: full manual QA matrix (validation.md §7), a11y pass, responsive pass, long-content
stress (long chat responses, long names, many threads, terminal overflow/resize), error-state
audit against copy registry, spend-cap dry-run, final deploy + live walk-through, EVALUATION.md
note recording what the expansion changed product-wise (for the future docs project).
**Acceptance**: Definition-of-Done checklist (validation.md §8) fully checked on the live site.
