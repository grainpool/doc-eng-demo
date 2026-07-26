# relay-cli

The `relay` CLI (commander): projects, files, sessions, artifacts, config,
and `introspect` — the T2_CLI authority source, derived by walking the live
command tree so it cannot drift from `--help` (invariant I3, parity-tested
for every command). Exit codes are contractual (0/1/2/3/4/5/6).

- **Build**: `pnpm --filter relay-cli build` (esbuild bundle → `dist/bin.js`).
- **Run**: `node packages/relay-cli/dist/bin.js --help`.
- **Test**: `pnpm --filter relay-cli test` (parity + exit codes against a
  stub API).
- **Fixture**: `pnpm cli:introspect` regenerates
  `fixtures/cli-introspection.json`; CI fails if the committed copy is stale.
- **Deliberately does not**: maintain a hand-written command manifest, add
  commands beyond the contract list, or embed documentation pages —
  generated CLI docs are Concord's job (Phase 13).
