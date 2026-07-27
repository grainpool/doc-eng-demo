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

## From Phase 15

- temporal_contradiction deliberately ignores "value moved beyond the last
  release" (current matches neither from nor to). That is a MISSING RELEASE
  RECORD, which deserves its own lighter finding kind in Phase 20's audit —
  blocking reconciliation for it would freeze every fast-moving fact.
- The standing iOS contradiction and the competing regression-flag decisions
  now emit conflicts on EVERY run by design (the escalation demo). If the
  noise bothers later phases, the fix is a human ConflictResolution record
  (new record type), never widening Conflict.resolution (I7).
- Falsification currently covers inconsistent_value findings from sub-1.0
  extractors and model candidates. Grounded-patch proposals get their
  falsification pass in the §14 validation.falsification field — wiring the
  falsifier into the patch path is a natural Phase 16 hardening if eval
  shows unsafe autofixes.

## Expansion Phase 1 audit — 2026-07-27 (prompt-packets/relay-expansion/)

Repo inspected at contracts 1.3.0 → bumped to 1.4.0 this phase. Classification of every
existing Relay capability for the multi-surface expansion:

**Preserve unchanged**: analysis kernel + 8 bounded operations; NL translation/narration
(`analysis/*.ts`, stays on `@anthropic-ai/sdk`); session/turn flow and immutable turn history;
artifact persistence + schema-enforced provenance/lineage; spend rails (`limits-guard.ts` —
shared $5/day budget, per-IP rate); copy discipline (`t()` + estate registry + no-literal-copy);
CLI introspection authority (I3); both frozen Concord endpoints; deploy pipeline.

**Expose through new UI**: artifacts (global browse/detail — today reachable only via
project); analysis entry (today project-first routing only); CLI grammar (browser terminal
renders `fixtures/cli-introspection.json`); health (moves under Settings).

**Extend**: `demo-auth.ts` (fixed `demo-user` → per-visitor `vis_*`, done this phase);
`product-config.ts` (chat/terminal availability, done); truth resolvers T1/T3 (six new facts,
done); `App.tsx` routing (route table + shell, Phase 3); `api.ts` client (new routes, Phases 2–6);
seed (`owner='seed'`, Phase 2); CLI (lifecycle commands + cookie persistence, Phase 2).

**Repair**: project lifecycle (no rename/archive/delete despite `state` column — Phase 2);
file lifecycle (no delete/download — Phase 2); workspace scoping (global pool → `workspace.ts`
rule, groundwork done, routes adopt in Phase 2); production seeding (dev-only seed route; prod
was verified to contain ONLY build-phase test debris and was wiped 2026-07-27; Phase 2 adds the
token-gated maintenance reset).

**Deprecate/remove**: the fixed `demo-user` identity (gone this phase); nothing else — no
existing route or schema is removed.

Code-vs-packet contradictions found: none blocking. One nuance: `artifact_provenance.session_id`
has no FK, which is exactly what lets artifacts survive session deletion (the packet's §4 matrix
relies on it) — deliberate, keep.

Lifecycle matrix implemented across Phases 2–6 (authority: expansion `architecture.md` §4):
project C/R/U/archive/delete+cascade; file C/R/download/delete (409 in-use, no update);
conversation C/R/rename+assoc/delete; session C/R/delete (turns cascade, artifacts survive;
history immutable); turn create/read only; artifact kernel-create/R/download/delete.

Done this phase: contracts 1.4.0 (6 fact keys, 5 error codes, chat schemas, `cnv|msg|vis`
prefixes, registry 23→29, CONTRACTS-FROZEN entry); migration `0005_expansion_identity.sql`
(project.owner_id, conversation, conversation_message + indexes, applied locally); demo-auth v2 +
`workspace.ts` + `GET /api/whoami` + `demo-identity.test.ts`; product-truth test asserts the six
new keys report honest (false/8000) values.
