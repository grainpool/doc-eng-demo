# architecture.md — Relay Multi-Surface Expansion

One architecture, decided. Sections are referenced by number from the phase prompts.

## §1 What exists (verified against the repo — reconfirm in Phase 1)

- **Monorepo** (pnpm): `relay-api` (Hono Worker: D1 `relay_db`, R2 `relay_artifacts`, Container DO
  kernel, `@anthropic-ai/sdk`), `relay-web` (Vite 7 + React 19, served as Worker assets,
  hash routing in `App.tsx`, five screens, 720px single column), `relay-cli` (commander, 21
  commands, `introspect --json` = T2 authority → `fixtures/cli-introspection.json`),
  `relay-kernel` (Python container), `contracts` (`@relay/contracts` **1.3.0**), plus the three
  Concord packages (out of scope, must keep compiling and passing).
- **Frozen surface** (`CONTRACTS-FROZEN.md`): Concord consumes exactly `GET /api/product-truth`
  and `GET /api/copy-registry`. Change rule: anything Concord parses ⇒ MINOR bump + dated
  changelog entry. Additive error codes and copy entries need no bump.
- **Copy**: authoritative JSON in the estate submodule (`estate/in-product-copy/*.json`), imported
  at build time by both `relay-web/src/copy.ts` and `relay-api/src/routes/copy-registry.ts`.
  Hardcoded UI strings are a test failure (`no-literal-copy.test.ts`).
- **Demo auth**: `demo-auth.ts` signs a cookie whose value is the fixed string `demo-user` — one
  global workspace. This is the defect Phase 1–2 repairs.
- **Lifecycle gaps**: projects have create/list/get only (no rename/archive/delete despite the
  `state` column); files have upload/list/get (no delete, no download); sessions have
  create/list/turns; artifacts have per-project list, detail, download (no global list, no delete).
- **Spend rails**: `limits-guard.ts` — $5/UTC-day computed from `model_call` rows, 20 req/hr/IP per
  route, checked *before* any Anthropic call. `model_call.purpose` already enumerates `"chat"`.
- **Theme**: `design/theme.json` (Olive Folio) — contractual `elementStyles`/palette, explicitly
  DERIVED `componentStyles` with provenance notes. `relay-web/src/theme.ts` applies it.

## §2 Target shape

```
relay-api (same Worker, same bindings)          relay-web (same Vite app)
  /api/whoami                    NEW              #/chat, #/chat/:id          NEW  (default route)
  /api/projects…      + PATCH/DELETE/archive      #/projects, #/projects/:id  rehoused
  /api/files…         + DELETE, /download         #/analysis, #/analysis/sessions/:id  rehoused entry
  /api/sessions…      + DELETE                    #/terminal                  NEW
  /api/conversations… NEW (CRUD + /stream)        #/artifacts, #/artifacts/:id  promoted to global
  /api/artifacts      + global list, DELETE       #/settings                  NEW (product info)
  /api/product-truth  UNCHANGED SHAPE (new fact keys are additive content)
  /api/copy-registry  UNCHANGED SHAPE (new entries additive)
```

No new deploy targets, no new Cloudflare resources, no queue/cron. Frontend/backend boundary,
build, and deploy pipeline (`vite build` → scrub → `wrangler deploy`) are untouched.

## §3 Demo identity (the workspace model)

- The existing signed cookie (`relay_demo`) stops carrying the fixed `demo-user` string and starts
  carrying a per-browser visitor id `vis_<26-char-id>` minted by the same middleware on first
  contact. Signature mechanism, cookie name, flags, and the no-401 property are unchanged; an old
  `demo-user` cookie fails the value-shape check and is re-minted.
- **Ownership column**: `owner_id TEXT` on `project` and `conversation` only. Files, sessions,
  turns, artifacts inherit ownership through their project (conversations without a project stand
  alone). Two owner classes with API semantics: `vis_*` (a visitor) and `seed` (deployed demo
  content). `NULL` (rows created before scoping deployed) has **no** API semantics: invisible to
  reads, unreachable for mutation, and removed by the maintenance reset (below) that runs
  immediately after the Phase-2 deploy.
- **Authorization rule** (one function, `workspace.ts`, used by every route):
  - read/list: rows where `owner_id = me OR owner_id = 'seed'`;
  - mutate/delete: `owner_id = me` only; `seed` rows return 403 `SEED_READ_ONLY` (new additive
    error code + copy entry);
  - there is deliberately **no cross-visitor read** of `vis_*` content — that is the entire
    privacy model, and the UI says so plainly (workspace banner copy: anonymous, cookie-scoped,
    public demo, don't upload confidential data, content may be cleared).
- **Maintenance reset (Phase 2)**: the deterministic seed (`seed.ts`) is currently dev-only
  (`RELAY_SEED_ENABLED`), so production has never held the canonical fixture. Phase 2 adds
  `POST /api/internal/reset`, gated by a `RELAY_MAINTENANCE_TOKEN` secret (bearer header;
  route behaves as 404 when the secret is unset or the token mismatches). It wipes all content
  tables (**never** `model_call` — that is the spend-cap record) plus their R2 objects, then runs
  the existing seed with `owner_id = 'seed'` on every row. `scripts/reset-relay.mjs` calls it
  (token from env, never argv). This is how the public demo gets cleaned from now on — no manual
  D1/R2 surgery.
- **CLI identity**: the CLI persists the `set-cookie` it receives into `~/.config/relay/session`
  (0600) and replays it; `relay config show` reports whether an identity exists. Same API, same
  rule — no token system. The `--token` flag remains reserved as-is.
- `GET /api/whoami` → `{ visitor_id, seeded_content_visible: true }` for the UI banner and tests.
  Relay-internal; not part of the Concord surface.

## §4 Resource lifecycle (the matrix — implement exactly this, nothing more)

| Resource | create | list | read | update | archive | delete | cascade on delete |
|---|---|---|---|---|---|---|---|
| project | ✔ | ✔ scoped | ✔ scoped | ✔ rename/description | ✔ archive/unarchive (existing `state` col) | ✔ with confirm | files+R2, sessions, turns, conversations+messages, artifacts+provenance+R2 — one route, D1 batch + R2 deletes, verified by test |
| file | ✔ upload | ✔ | ✔ + **download** (new) | ✖ deliberate (re-upload) | ✖ | ✔ | R2 object; blocked with 409 `RESOURCE_IN_USE` if a session references it (simpler + more honest than nulling provenance sources) |
| conversation | ✔ | ✔ scoped | ✔ | ✔ rename, set/clear project | ✖ | ✔ | its messages |
| analysis session | ✔ | ✔ | ✔ | ✖ **immutable history — deliberate** | ✖ | ✔ | its turns. Artifacts SURVIVE: provenance is a historical record; `session_id` in provenance keeps pointing at the deleted id and the artifact detail renders it as "session removed". |
| turn | ✔ via run | ✔ | ✔ | ✖ | ✖ | ✖ only via session/project | — |
| artifact | ✔ by kernel | ✔ global + per-project | ✔ + download | ✖ | ✖ | ✔ | provenance row + R2 object |

Archived projects: read-only (uploads/sessions/turns/conversation-attach return 409
`PROJECT_ARCHIVED`), still listed under an "Archived" filter, unarchive restores.

## §5 Application shell (Phase 3)

- `AppShell` component: persistent left sidebar (Chat / Projects / Analysis / Terminal /
  Artifacts / Settings), collapsible to a top bar under ~720px; content region with per-surface
  max-width (chat ~76ch reading column, analysis/artifacts wider, terminal fluid). Global vs
  project context is shown in a contextual header (project name + surface), not duplicated nav.
- Routing stays hash-based: extract `App.tsx`'s regexes into a small route-table module
  (`routes.ts`: pattern → screen + params). Default route becomes `#/chat`. Old URLs
  (`#/projects/:id`, `#/sessions/:id`, `#/artifacts/:id`, `#/health`) keep working — `#/sessions/:id`
  redirects to `#/analysis/sessions/:id`; `#/health` lives under Settings.
- Analysis gets an **entry screen** (`#/analysis`): recent sessions across visible projects + a
  "start analysis" flow (pick/create project → pick/upload dataset → session). `Session.tsx`
  itself is rehoused, not rewritten.
- Visual direction: Olive Folio is contractual. Extend `design/theme.json.componentStyles` with
  DERIVED entries (sidebar, nav item, contextual header, terminal panel) carrying the same
  `_provenance` discipline as the existing derived entries. Anthropic-inspired restraint =
  typography-led hierarchy, whitespace, few borders/cards, no gradients/KPI tiles/status pills.
  No proprietary fonts or branding; Georgia stack stays.

## §6 Chat (Phase 4)

**Data.** Migration 0005 (written in Phase 1):

```sql
CREATE TABLE conversation (
  id TEXT PRIMARY KEY,                -- cnv_…, via newId("cnv")
  owner_id TEXT,                      -- vis_* | 'seed' | NULL
  project_id TEXT REFERENCES project(id),   -- nullable: chats can be global
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE conversation_message (
  id TEXT PRIMARY KEY,                -- msg_…
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  parts_json TEXT NOT NULL,           -- AI SDK v6 UIMessage.parts, verbatim
  created_at TEXT NOT NULL
);
```

**Flow.** `POST /api/conversations/:id/stream` receives the AI SDK v6 `useChat` body. Server:
(1) auth-scope check; (2) `guardModelCall(env, ip, "chat")` — the existing guard, existing 429s;
(3) persist the incoming user message; (4) `streamText({ model: anthropic(MODEL_ID), system,
messages: convertToModelMessages(...), })` from `ai@6` + `@ai-sdk/anthropic`; (5) return
`result.toUIMessageStreamResponse()`; (6) `onFinish`: persist assistant message parts + insert a
`model_call` row (`purpose: "chat"`, real token usage) — same accounting the analysis path uses,
so chat spends from the same $5/day budget. Message length capped by a Zod schema in
`@relay/contracts` (the cap doubles as T1 fact `limit.chat.message.max_chars`). History sent to
the model is truncated to the most recent N messages by budget — deterministic, documented in code.

**Project context.** If `project_id` is set, the system prompt gains a bounded block: project
name/description, file list with shapes, and for CSV/TSV files the existing `datasetPreview`
output (schema + sample rows). Wrapped in data-not-instructions framing exactly like
`translator.ts` does. No RAG, no embeddings, no file-content dumping beyond previews.

**UI.** assistant-ui unstyled primitives + `@assistant-ui/react-ai-sdk` runtime over `useChat`
(`@ai-sdk/react@3`) pointed at the stream route; thread list from `GET /api/conversations`;
reload hydrates `useChat` initial messages from stored `parts_json`. Rename/delete/new/associate
actions call the CRUD routes. Failure states are explicit: guard 429s and Anthropic errors render
copy-registry strings, never optimistic UI. The API key exists only in the Worker; the scrub
step and existing tests keep it out of the client bundle.

## §7 Browser Terminal (Phase 5)

Three parts, strict boundaries:

1. **Renderer** — `@xterm/xterm` + fit addon in `#/terminal`. Owns keystrokes, echo, scrollback,
   prompt, and a local history buffer (ArrowUp/Down). Styled as a derived dark panel of the Olive
   palette (documented in theme.json `_provenance`).
2. **Grammar** — `fixtures/cli-introspection.json` imported at build time. Parser resolves
   `<tokens>` → longest matching command path, then parses flags per the fixture's flag specs.
   `help` and `help <command>` render the fixture's `summary`/`usage` **verbatim** — the same
   bytes as real `--help` (invariant I3 extends to the browser).
3. **Bindings** — `terminal/bindings.ts`: an explicit map from supported command paths to
   functions calling the existing `api.ts` client (browser cookie = same workspace as the web UI).
   Support: `projects list|show|create|rename|delete`, `files list|show|delete` (upload and
   download are pointed at the web UI with a friendly message — no fake filesystem), `sessions
   list|create|run`, `artifacts list|show|delete` (download → triggers a browser download),
   `config show|status`, `introspect`. Local built-ins: `help`, `clear`, `history`.
   Unbound-but-real commands print "available in the installed CLI"; unknown tokens print the
   unknown-command copy entry with a nearest-match suggestion.

**Anti-drift**: a vitest asserts every binding's command path exists in the fixture and its parsed
flag names are a subset of the fixture's flags; and that `help <cmd>` output equals the fixture
`usage`. The fixture itself is already CI-gated against the built CLI, so browser ⇄ CLI cannot
silently diverge — one authority, two renderers. Nothing in the terminal evaluates input as code.

## §8 Artifacts + product truth (Phase 6)

- `GET /api/artifacts?project_id=&kind=` (scoped like everything else) powers `#/artifacts`:
  filterable browse → detail (existing provenance/lineage rendering, promoted) → download/delete.
  `origin` is NOT added to the schema — Analysis is the only real producer; the *UI* copy simply
  says artifacts come from analysis today. No faked multi-surface provenance.
- New T3 facts (registered in Phase 1, values true once the surface ships — flip in the phase that
  ships it, never before): `availability.feature.chat.platform.{web,ios,android,cli}` (true/ false/
  false/false), `availability.feature.terminal.platform.web` (true). New T1 fact:
  `limit.chat.message.max_chars` (from the contracts Zod schema that enforces it). That is the
  whole fact delta — six literal keys, each with multiple genuine user-facing representations.
- Cross-surface links: artifact→project, artifact detail→(defunct-aware) session link,
  session→artifacts produced, project→its conversations, chat header→project. Ordinary hrefs, no
  state synchronization layer.

## §9 Failure modes and observability

- Every new route logs through the existing `log()` (request id, no payloads/secrets); errors use
  `apiError(code, copy_id)` — codes additive, every code has a copy entry.
- Model paths: guard-before-call (already the rule), 429 rendered as friendly budget/rate copy,
  stream aborts render a retriable error bubble, `ANTHROPIC_API_KEY` absent → chat surface shows
  an explicit unavailable state (mirrors `messagesClient() === null` handling in sessions).
- Destructive actions: typed-confirm for project delete (name match), plain confirm for
  file/session/conversation/artifact; deletes are server-side transactions (D1 batch) with R2
  cleanup after the DB commit; a failed R2 delete logs `r2_orphan` with the keys (visible, not
  silent — acceptable for a demo, documented).

## §10 Rollout

- Migrations are forward-only additions (`0005_*`), applied with `wrangler d1 migrations apply`
  before deploying the Worker that needs them — same procedure as 0002–0004.
- Phase 2 deploy sequence: apply migration → deploy Worker → `node scripts/reset-relay.mjs`
  (wipes pre-scoping NULL-owner debris, seeds the canonical fixture as `seed`). Between the
  Worker deploy and the reset, NULL rows are simply invisible — acceptable for the minutes it
  takes.
- Contracts go 1.3.0 → **1.4.0** once, in Phase 1, with the CONTRACTS-FROZEN.md entry. The two
  Concord endpoints keep their schemas; new fact keys/copy entries are additive content.
- Estate repins happen exactly twice (Phase 3, Phase 6), both copy-only.
- Deploys after Phases 2, 3, 4, 5, 6, 7 — each phase ends live-verifiable.
