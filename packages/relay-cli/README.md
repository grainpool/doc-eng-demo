# relay-cli

The `relay` CLI (commander): projects (incl. rename/archive/delete), files
(incl. download/delete), sessions, artifacts (incl. delete), config, and
`introspect` — the T2_CLI authority source, derived by walking the live
command tree so it cannot drift from `--help` (invariant I3, parity-tested
for every command; the browser Terminal renders the same fixture). Exit
codes are contractual (0/1/2/3/4/5/6). The CLI persists the signed demo
cookie in `~/.config/relay/session` (0600) so every invocation shares one
anonymous workspace; `relay config show` reports whether an identity is
saved, never its value.

- **Build**: `pnpm --filter relay-cli build` (esbuild bundle → `dist/bin.js`).
- **Run**: `node packages/relay-cli/dist/bin.js --help`.
- **Test**: `pnpm --filter relay-cli test` (parity + exit codes against a
  stub API).
- **Fixture**: `pnpm cli:introspect` regenerates
  `fixtures/cli-introspection.json`; CI fails if the committed copy is stale.
- **Deliberately does not**: maintain a hand-written command manifest, add
  commands beyond the contract list, or embed documentation pages —
  generated CLI docs are Concord's job (Phase 13).
