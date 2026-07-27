# constraints.md — attach to EVERY phase prompt

## Non-goals (build none of this, even if it seems adjacent)

Accounts/auth/OAuth/billing/orgs · RAG, embeddings, vector search · tool execution, agents,
browsing, code execution in chat · a real shell, PTY, WebContainers, VM, server-side exec for the
terminal · new statistical operations or kernel changes · a replacement CLI · any Concord change
(core, api, web, reconciliation, fixtures) · a docs rewrite (a later project owns it) · Next.js ·
react-router · Tailwind or any second component/styling system · TanStack Query or a state
library · new Cloudflare resources (queues, KV, DOs beyond the existing kernel, cron).

## Do-not-touch list

- `prompt-packets/relay-concord/**` — historical record, read-only.
- `packages/concord-*/**` — must keep compiling and passing, never edited.
- `packages/relay-kernel/**` and the analysis operation set — frozen.
- Analysis translation/narration (`analysis/*.ts`) — stays on `@anthropic-ai/sdk`; do not migrate
  it to the AI SDK.
- The two frozen endpoints' response shapes; `FACT_REGISTRY` tier assignments; existing fact keys.
- Existing migrations 0001–0004 (forward-only rule G6).
- `design/theme.json` existing values — extend `componentStyles` only, with provenance notes.
- Seeded demo content semantics: `seed`-owned rows are immutable through the API.

## Anti-patterns (the failure modes this packet is designed against)

- **AP-E1 Greenfield reflex**: rebuilding a working screen/route because integration is annoying.
  Rehouse, adapt, extend. A rewrite requires a named concrete defect.
- **AP-E2 Second vocabulary**: hand-declaring terminal commands/flags/help text instead of reading
  the introspection fixture. One authority, two renderers.
- **AP-E3 Enterprise dashboard**: cards, KPI tiles, gradients, status pills, decorative icons,
  generic SaaS hero styling. Relay is calm, editorial, typography-led.
- **AP-E4 Optimistic UI**: hiding a failed model call, delete, or upload behind a success state.
  Failures render honestly with copy-registry strings.
- **AP-E5 Fact inflation**: registering trivial facts to look documentation-rich. Six new keys is
  the budget; each must be genuinely enforced/configured and multi-surface.
- **AP-E6 Silent contract creep**: any change Concord could parse without the 1.4.0 bump +
  CONTRACTS-FROZEN entry; or a second bump after Phase 1 without operator sign-off.
- **AP-E7 Faked provenance**: implying chat/terminal produce artifacts before they do.
- **AP-E8 Literal strings**: any user-visible text not through `t()`; any hex color not through
  the theme.

## Hard rules

- Model calls: guard-before-call, one shared $5/day budget, per-IP rate on every model route, one
  `model_call` row per call with real usage, hashes never prompt text. Public paths that don't
  need a model make zero model calls.
- Secrets only in Worker env via `wrangler secret`; the client bundle is scrub-checked; no key,
  cookie secret, or signed URL secret ever reaches the browser.
- Prompt-injection posture: any user/file content entering a model prompt is delimited and
  declared data-not-instructions (existing `translator.ts` pattern).
- Mutations verify workspace ownership server-side; the browser terminal gets no privileged path —
  it calls the same scoped API as the UI.
- Deterministic behavior over cleverness: bounded history windows, bounded context blocks, explicit
  truncation, explicit unavailable-states when the key/budget is absent.
- Accessibility: keyboard-reachable nav and actions, focus states from the theme, `prefers-reduced-
  motion` respected, contrast per design/README verification approach.
- Every phase ends with `pnpm -r typecheck && pnpm lint && pnpm -r test` green — including all
  Concord packages, the seed-determinism test, the introspection staleness gate, and
  `no-literal-copy`.

## Performance/reliability envelope

- Bundle: chat + terminal deps are route-level lazy imports (`React.lazy`) so `#/projects` doesn't
  pay for xterm. Keep the initial chunk roughly what it is today.
- D1: every new query hits an index (`owner_id` indexes land with migration 0005); cascade deletes
  are batched statements, not row-by-row loops in JS where a single statement works.
- No polling loops; streams and ordinary fetches only.
