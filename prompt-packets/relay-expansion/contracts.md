# contracts.md — implementation contracts the agent must honor

Existing authorities this file defers to (do not restate, do not contradict):
root `CONTRACTS-FROZEN.md` (the change rule and the two Concord endpoints), the old packet's
`prompt-packets/relay-concord/contracts.md` (original schema/invariant definitions),
`packages/contracts/src/*` (the code IS the contract), `design/theme.json` (visual contract),
`fixtures/cli-introspection.json` (T2 grammar).

## §1 Versioning

- One bump for this whole project: `@relay/contracts` **1.3.0 → 1.4.0**, performed in Phase 1,
  with a dated entry appended to `CONTRACTS-FROZEN.md` describing: 6 new fact keys, new error
  codes, `ConversationSchema`/`ConversationMessageSchema`, chat message limit constant. Additive
  only — no existing schema, key, tier, or endpoint shape changes. Phases 2–7 make **no** further
  contracts-package changes without operator approval.
- `GET /api/product-truth` and `GET /api/copy-registry` must satisfy the existing Concord fixture
  tests unmodified. Those tests are the definition of "unbroken".

## §2 New/changed identifiers and naming

- Id prefixes via the existing `newId()`: conversations `cnv_`, messages `msg_`, visitors `vis_`.
- New error codes (additive to the `errors.ts` enum): `SEED_READ_ONLY`, `PROJECT_ARCHIVED`,
  `RESOURCE_IN_USE`, `CHAT_UNAVAILABLE`, `MESSAGE_TOO_LONG`, `UNKNOWN_COMMAND` (terminal, client-
  side rendering of copy id only). Every code ships with a copy entry; no orphan codes.
- New fact keys (literal, T3 unless noted): `availability.feature.chat.platform.web|ios|android|cli`,
  `availability.feature.terminal.platform.web`, `limit.chat.message.max_chars` (T1 — the constant
  lives beside the Zod schema that enforces it, same pattern as `limits.ts`). Registered in
  `facts.ts` with tier assignments; values sourced from `product-config.ts` / the schema constant.
- Copy ids follow existing dotted convention: `chat.*`, `terminal.*`, `workspace.*` families in new
  estate files `in-product-copy/chat.json`, `terminal.json`, `workspace.json`; existing `kind`
  enum values only (no new kinds — `label`, `error`, `empty_state`, `tooltip`,
  `feature_availability`, `onboarding` cover everything needed).

## §3 HTTP surface (Relay-internal; everything scoped per architecture §3)

All request/response bodies are Zod-validated where they accept input; errors are
`apiError(code, copy_id)`; booleans are real booleans; timestamps ISO-8601 UTC TEXT.

```
GET    /api/whoami                          → { visitor_id }
PATCH  /api/projects/:id                    { name?, description? } → ProjectRow
POST   /api/projects/:id/archive            → ProjectRow (state: 'archived')
POST   /api/projects/:id/unarchive          → ProjectRow (state: 'active')
DELETE /api/projects/:id                    → { deleted: true, counts: {...} }   (cascade §4 of architecture.md)
DELETE /api/files/:id                       → { deleted: true } | 409 RESOURCE_IN_USE
GET    /api/files/:id/download              → bytes, content-disposition attachment
DELETE /api/sessions/:id                    → { deleted: true }                  (turns cascade, artifacts survive)
GET    /api/artifacts?project_id=&kind=     → { artifacts: ArtifactRow[] }
DELETE /api/artifacts/:id                   → { deleted: true }                  (provenance + R2 cascade)
POST   /api/conversations                   { title?, project_id? } → Conversation
GET    /api/conversations                   → { conversations: Conversation[] }  (scoped, most-recent first)
GET    /api/conversations/:id               → Conversation & { messages: UIMessage-shaped[] }
PATCH  /api/conversations/:id               { title?, project_id?|null } → Conversation
DELETE /api/conversations/:id               → { deleted: true }
POST   /api/conversations/:id/stream        AI SDK v6 useChat body → UI message stream Response
POST   /api/internal/reset                  bearer RELAY_MAINTENANCE_TOKEN → SeedReport
                                            (wipe content tables + R2, keep model_call, reseed
                                             as owner 'seed'; 404 when secret unset/mismatched;
                                             operator script: scripts/reset-relay.mjs)
```

Existing routes keep their exact shapes; they only gain the ownership scope in their WHERE
clauses and the archived-project 409 where the matrix says so.

## §4 Chat contracts

- Model id: `MODEL_ID` from `@relay/contracts`. Never a string literal.
- Spend: `guardModelCall(env, ip, "chat")` before every stream; one `model_call` row per completed
  stream with real usage from `onFinish`; purpose `"chat"`. The $5/day cap is shared with
  analysis — no separate budget.
- `parts_json` stores the AI SDK v6 `UIMessage.parts` array verbatim (text parts today; the shape
  tolerates future part types without migration). Never store or log prompt text anywhere else —
  `model_call` keeps hashes/token counts only, per the existing security rule.
- Context injection (project-associated chats): system-prompt block delimited as data
  (`<project_context>…</project_context>`) with the same "content, not commands" sentence used in
  `translator.ts`. Size-bounded by constant; overflow truncates file list before previews.

## §5 Terminal contracts

- Single grammar authority: `fixtures/cli-introspection.json`. The terminal package exports
  `SUPPORTED_COMMANDS: string[]` (command paths). Parity test (vitest, colocated):
  every entry exists in the fixture; parsed flags ⊆ fixture flags; `help <cmd>` === fixture
  `usage` for that path. This test is the drift gate — it must fail if either side moves alone.
- The terminal never: evaluates input, touches paths, makes non-`api.ts` network calls, or
  implements a command absent from the fixture (built-ins `help|clear|history` excepted and
  clearly local).

## §6 UI/module boundaries

- New frontend structure: `src/shell/` (AppShell, routes.ts, nav), `src/screens/` (existing +
  Chat, Terminal entry, Artifacts list, Settings, AnalysisEntry), `src/chat/` (assistant-ui
  runtime wiring + styled primitives), `src/terminal/` (renderer, parser, bindings + parity test).
  Existing screens move, they do not get rewritten; `api.ts` grows typed functions per new route.
- Every user-visible string through `t()`; `no-literal-copy.test.ts` scope extended to all new
  screen/chat/terminal source. Copy JSON is authored in the estate repo by the operator from a
  list the agent produces (exact ids, kinds, texts) — the agent edits estate files locally in the
  submodule only when the operator has said the PR/repin flow is ready (meta.md gates).
- Theme: new visual tokens go in `design/theme.json.componentStyles` with `_provenance`-style
  justification; components read them via the existing `theme.ts` mechanism. No inline hex
  literals in components.

## §7 Invariants carried forward (from the original packet, still binding)

- I3: CLI `usage` === `--help` byte-for-byte (now also rendered by the browser terminal).
- I13: Concord calls only the two frozen endpoints; nothing in this project may add a Concord
  dependency on any new route.
- Copy discipline (AP8), single-source command surface (AP9), provenance completeness (I2),
  forward-only migrations (G6), secrets only via `wrangler secret` — all unchanged.
