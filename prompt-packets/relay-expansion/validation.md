# validation.md — how the build is verified

Standing gate for every phase: `pnpm -r typecheck && pnpm lint && pnpm -r test` — the recursive
scope includes all Concord packages (compatibility canary), the seed-determinism test, the CLI
introspection staleness gate, and `no-literal-copy`. A phase that reddens any of these is not done.

## §1 Concord compatibility (every phase, automated)

- Concord contract/fixture tests pass unmodified.
- `GET /api/product-truth` parses with `ProductTruthSnapshotSchema`; `GET /api/copy-registry`
  parses with `CopyEntrySchema[]` — asserted by existing tests; new keys/entries are additive.
- Grep-gate: no `packages/concord-*` file changed in the diff (CI-style check the agent runs).

## §2 Lifecycle + demo scoping (Phase 2 tests, kept green after)

- Project: create → rename → archive (writes 409 while archived) → unarchive → delete.
- Cascade: seed a project with files, a session with turns, a conversation, artifacts; delete the
  project; assert zero remaining rows in all six tables and zero surviving R2 keys (list bucket by
  prefix in the test env).
- File delete: free file deletes and removes its R2 object; session-referenced file returns 409
  `RESOURCE_IN_USE`.
- Session delete: turns gone, artifacts + provenance intact; artifact detail renders the
  removed-session state.
- Isolation: visitor A creates a project; visitor B (second cookie) cannot read, mutate, or delete
  it (list excludes it; direct GET 404s; DELETE 404s — not 403, ids must not leak existence).
- Seed content: readable by both; any mutation → 403 `SEED_READ_ONLY`.
- NULL-owner rows (pre-scoping debris): excluded from lists, direct GET 404s.
- Maintenance reset: without `RELAY_MAINTENANCE_TOKEN` (or with a wrong bearer) the route is the
  generic 404; with it, all content tables and their R2 objects are wiped, `model_call` rows
  survive, and the reseeded state passes the seed-determinism assertions with every row owned by
  `seed`.
- CLI: cookie persisted across invocations (two `relay projects create` land in one workspace);
  `relay projects delete` + confirm flag behavior; introspection fixture regenerated and gate green.

## §3 Shell (Phase 3, mostly manual — checklist)

- Every pre-expansion flow works rehoused: upload → session → NL turn → artifact detail.
- Old URLs redirect; `#/health` reachable under Settings.
- Narrow viewport: sidebar collapses, all surfaces usable at 360px width.
- Keyboard: tab order sane, focus visible (theme focus ring), nav operable without pointer.
- Workspace banner communicates: anonymous cookie workspace, public demo, no confidential
  uploads, content clearable.

## §4 Chat (Phase 4)

Automated:
- Stream route: 200 + UI-message stream for a valid body; user + assistant messages persisted;
  `model_call` row written with purpose `chat` and nonzero usage (mock client in tests).
- Guard: spend cap reached → 429 BUDGET_EXHAUSTED before any model call; rate limit → 429; both
  render copy strings in the UI (component test).
- Key absent → `CHAT_UNAVAILABLE` state, zero Anthropic calls.
- Message over `limit.chat.message.max_chars` → 422 `MESSAGE_TOO_LONG`.
- Scoping: conversation of visitor A invisible to B; project association restricted to projects A
  can read; archived project → 409 on new association.
- Secrets: built client bundle contains no `sk-ant`, no cookie secret (existing scrub + test).
Manual:
- Long streamed response renders readably (76ch column, serif, no jank); reload mid-conversation
  restores history; rename/delete/new thread; project-context chat references an uploaded CSV's
  columns correctly; abort mid-stream shows retriable error, not a phantom message.

## §5 Terminal (Phase 5)

Automated:
- Parity test: every binding path ∈ fixture; binding flags ⊆ fixture flags; `help <cmd>` output
  === fixture `usage` for every supported command. (Prove it fails on an injected drift once.)
- Parser: unknown command → UNKNOWN_COMMAND copy + suggestion; real-but-unbound command → the
  installed-CLI message; flag typo → usage excerpt.
- No-eval: static assertion that the terminal module graph contains no `eval`/`Function`/dynamic
  import of user input (lint rule or test).
Manual:
- `projects list`, `projects create --name "T"`, `sessions run …`, `artifacts list` round-trip
  against the live API from the browser; `clear`/`history`/arrow-keys; resize/reflow via fit
  addon; overflow scrollback; paste multi-line input behaves.

## §6 Analysis regression (every phase)

- Existing analysis suite untouched and green: translation tests, kernel proxy, provenance,
  spend-limits, seed determinism. Manual smoke after Phases 3 and 7: full workflow on the live
  site.

## §7 Product QA matrix (Phase 7, manual)

Desktop + mobile widths × all five surfaces: loading, empty, error, and populated states; long
project/file names (ellipsis, no layout break); 20+ conversations in thread list; terminal
resize/overflow; destructive confirms (project delete requires typed name); slow network
(throttled) shows loading states not blank panes; a Chat visit with the daily budget exhausted
shows the budget message; artifact download works on mobile; `prefers-reduced-motion` honored.

## §8 Definition of Done (final gate — the operator walks the live site)

- [ ] Landing (`#/chat`) reads as an AI workspace, not a CSV tool; nav shows Chat / Projects /
      Analysis / Terminal / Artifacts / Settings.
- [ ] A first-time visitor can: chat with streaming; create a project + upload + delete a file;
      run an analysis session; use the browser terminal; browse artifact provenance; delete
      everything they made; read what the demo persists.
- [ ] Standalone CLI still installs and passes its tests; browser terminal and CLI share one
      grammar (parity test green).
- [ ] Concord live: a reconciliation run against the deployed Relay completes and parses both
      endpoints (operator-triggered check).
- [ ] Contracts at 1.4.0 with exactly one new CONTRACTS-FROZEN entry; six new facts report true
      values; every new error code has copy; `no-literal-copy` green.
- [ ] Visual coherence: Olive Folio everywhere, including chat bubbles and the terminal panel;
      no dashboard decoration; keyboard + contrast pass.
- [ ] `pnpm -r typecheck && pnpm lint && pnpm -r test` green at the final commit.
