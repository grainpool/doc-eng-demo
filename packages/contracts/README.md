# @relay/contracts

The single shared vocabulary of the project: fact registry and tiers,
operation schemas, DatasetRef/KernelResult, TranslationResult, CopyEntry,
artifacts + provenance, CLI introspection, error codes, defect taxonomy,
prefixed ULIDs, and the `zodToJsonSchema` / `zodToOutputFormatSchema`
derivation wrappers.

- **Run**: nothing to run — it is imported by every other package.
- **Test**: `pnpm --filter @relay/contracts test`
- **Deliberately does not**: depend on anything but `zod` (constraints.md
  G3), perform I/O, or contain any Cloudflare/runtime code. Once frozen,
  version bumps follow `CONTRACTS-FROZEN.md` at the repo root.
