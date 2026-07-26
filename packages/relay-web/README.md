# relay-web

The Relay SPA (React + Vite): project list/detail, uploader, analysis
sessions with streamed narration, artifact detail with provenance and
lineage. Every user-visible string renders through `t()` from the estate
copy registry — a literal in JSX fails lint AND a test (invariant I1). The
Olive Folio theme in `design/theme.json` is applied verbatim for content
styles; chrome styles are derived.

- **Run**: `pnpm dev` (repo root).
- **Build**: `pnpm --filter relay-web build` — emits the client bundle and
  the resolved Worker config used for deploys.
- **Test**: `pnpm --filter relay-web test` (the no-literal-copy scan).
- **Deliberately does not**: hardcode copy, fetch fonts/CDNs, or contain any
  number that exists as a product fact — limits come from
  `/api/product-truth` at runtime.
