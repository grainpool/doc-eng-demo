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

## From Phase 04

- Container egress is open (COMPAT.md). If Cloudflare ships per-container egress policies, adopt
  them and re-run the probe; until then the host-pin + no-URL-inputs design is the control.
- Dataset capability URLs ride the workers.dev host because the zone's bot protection 403s the
  container's fetches. An operator could alternatively add a bot-management exception in the
  dashboard; deliberately not requested — not worth an operator gate for a working path.
- The egress probe (`RELAY_EGRESS_PROBE`) is left enabled: one hardcoded HEAD-of-startup fetch per
  container start. Flip the env var off in `kernel.ts` once Phase 20's audit no longer wants the
  live observation.
- The true OCI digest is printed by every deploy; if Phase 06 provenance wants it instead of the
  build-content hash, thread it in as a container env var at deploy time.

## From Phase 12

- `frontmatter_field` projections are span-less (frontmatter sits outside the unit body), so the
  pipeline records them but does not classify them on a delta. Phase 13 needs a frontmatter-aware
  patcher (rewrite the YAML value) before rule 3 can fire for them.
- The 30-day retention ambiguity (artifact vs uploaded-file, equal values) is refused by
  `numeric_pattern` by design. If the two values ever diverge, the refusals disappear on their own;
  consider a `concord:fact` marker in the two retention passages if per-fact attribution is wanted
  while they remain equal.
- `term_occurrence` emits one projection per unit per term (first occurrence). Per-occurrence spans
  (a unit mixing "Task" and "Job") are a Phase 13 concern when term patches become real.
- Interpolated in-product copy still asserts nothing statically (Phase 10 decision); rule 4 should
  turn those `references_facts` declarations into derived_prose projections.
- `model_extraction` fan-out is capped at 10 units/run (`MODEL_EXTRACTION_MAX_UNITS`), prioritizing
  nothing in particular; a signal-based ranking (units containing digits/platform words) would spend
  the budget better.

## From Phase 13

- Impact→patch linkage in concord_db is still BY PATH (Phase 10 shape): an
  EDITORIAL_REVIEW impact on a unit whose file also got a deterministic patch
  shows that patch id. Phase 14 should link patches per impact (`impact_ids`
  on the Patch record, per contracts.md §14) and null it for non-regen impacts.
- Hand-edit detection cannot distinguish "hand-edited" from "regen proposed
  but never applied" once the previous snapshot catches up (both differ from
  generator output for current AND previous facts). The warning text says so;
  the ambiguity disappears in Phase 17 when regen patches are actually
  applied via PR.
- numeric_pattern also matches PREVIOUS-snapshot values so stale renderings
  keep projecting mid-change. Values older than one snapshot are still
  invisible to it; the eval (Phase 16) will show whether one-snapshot memory
  is enough for the STALE_* defect classes.
- The cli-docs and cli-reference pages are generated from the introspection
  FIXTURE. If the fixture and the live `relay introspect --json` drift, CI's
  staleness gate catches it in repo 1, but Concord itself never verifies —
  consider a T2-vs-fixture freshness check in Phase 15's conflict machinery.

## From Phase 14

- The editorial-draft call reuses buildPatchUserPrompt; a dedicated
  editorial user-prompt shape (naming the anchor/URL occurrence explicitly)
  would give reviewers better drafts. Revisit when Phase 15 escalations
  carry owners into the UI.
- Queue consumer retries (max_retries 1) re-run the WHOLE executeRun on
  transient failure; the run row goes back to running. Idempotency holds at
  the D1 level only for the run row — repeated doc_unit/projection inserts
  on a retried run would violate PKs. Acceptable now (failed runs re-fail
  cleanly); Phase 17 should make the consumer resume-aware.
- The daily spend cap is shared with model_extraction and both AI paths;
  there is no per-purpose budget split. Phase 20's audit may want one.
