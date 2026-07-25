# NOTES.md — deferred ideas

Ideas noted during a phase and deliberately not built in it (constraints.md AP11).

## From Phase 01

- The kernel's `image_digest` is a build-time content hash over `requirements.txt` + `app/main.py`
  (the true OCI digest is not readable from inside the container). Phase 04/06 should decide whether
  to thread the real image digest in from the deploy pipeline instead, since provenance rows cite it.
- D1 health probe uses inline `CREATE TABLE IF NOT EXISTS`; real numbered `.sql` migrations start at
  Phase 02 (`0001`). The probe table can move into the migration set then.
- Add a small unit test for `log.ts` redaction now that the helper exists; the full redaction test
  matrix is Phase 20 (`redaction.test.ts`).
- The deployed-URL health test hits production from CI. If cold-container flakiness shows up in CI,
  gate it behind an env var and keep it in a scheduled workflow instead.
- `test` script currently only exists in `relay-api`; as packages gain tests, keep `pnpm -r run test`
  as the aggregate entry point.
