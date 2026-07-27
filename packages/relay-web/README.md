# relay-web

The Relay SPA (React + Vite): a multi-surface AI workspace — Chat (streaming
Anthropic conversations via assistant-ui primitives + AI SDK v7), Projects
(full lifecycle + files), Analysis (the bounded session workbench), a browser
Terminal (xterm renderer over the CLI introspection grammar), Artifacts
(global browse with provenance/lineage), and Settings. Chat and Terminal are
route-level lazy chunks. Every user-visible string renders through `t()`
from the estate copy registry — a literal in JSX fails lint AND a test
(invariant I1). The Olive Folio theme in `design/theme.json` is applied
verbatim for content styles; chrome styles (including the shell and the dark
terminal panel) are provenance-documented derivations.

- **Run**: `pnpm dev` (repo root).
- **Build**: `pnpm --filter relay-web build` — emits the client bundle and
  the resolved Worker config used for deploys.
- **Test**: `pnpm --filter relay-web test` (no-literal-copy scan + the
  terminal ⇄ CLI parity drift gate).
- **Deliberately does not**: hardcode copy, fetch fonts/CDNs, declare its own
  terminal command vocabulary (the fixture is the grammar), or contain any
  number that exists as a product fact — limits come from
  `/api/product-truth` at runtime.
