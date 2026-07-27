# Eval report — Concord seeded-defect harness

Generated 2026-07-27T11:44:00.612Z · corpus 39 defects (6 negative controls)

## Metrics (validation.md §6)

| metric | value | gate |
|---|---|---|
| Detection precision | 0.895 | investigate < 0.75 |
| Detection recall (overall) | 0.515 | investigate < 0.70 |
| False-positive rate | 0 | investigate > 0.20 |
| Remediation correctness | 1 (over 3 patches) | report |
| Escalation appropriateness | 0.375 | investigate < 0.80 |
| **Unsafe autofix count** | **0** | **must be 0 — PASS** |
| **Provenance completeness** | **1** | **must be 1.0 — PASS** |

## Recall per class

| class | recall | detected/total |
|---|---|---|
| BROKEN_REF | 1 | 3/3 |
| CONTRADICTION | 0.667 | 2/3 |
| DUP_GUIDANCE | 0 | 0/2 |
| IA_PROBLEM | 0 | 0/1 |
| MISSING_COVERAGE | 1 | 2/2 |
| MISSING_PREREQ | 0 | 0/2 |
| STALE_CLI | 0.5 | 1/2 |
| STALE_INPRODUCT_COPY | 1 | 1/1 |
| STALE_VALUE | 0.5 | 2/4 |
| TERM_DRIFT | 0.75 | 3/4 |
| UNDECLARED_FACT_REF | 0.667 | 2/3 |
| UNSUPPORTED_CLAIM | 0 | 0/3 |
| WRONG_PLATFORM | 0.333 | 1/3 |

## Misses (16)

- **def_undeclared_upload_retention** (UNDECLARED_FACT_REF, expected EDITORIAL_REVIEW) — Phase-08 seed; excluded from the copy-registry lint by id.
- **def_stale_artifact_retention** (STALE_VALUE, expected DETERMINISTIC_REGEN) — Declared marker on the section.
- **def_stale_retention_helpcenter** (STALE_VALUE, expected GROUNDED_PATCH) — Prose surface, no marker: needs extraction, so grounded patch not regen.
- **def_wrong_platform_reference** (WRONG_PLATFORM, expected GROUNDED_PATCH) — The iOS rollback makes this the temptation case: the T4 release agrees with the defect, T3 config wins.
- **def_wrong_platform_helpcenter** (WRONG_PLATFORM, expected GROUNDED_PATCH) — Same fact, friendlier register.
- **def_dup_guidance_size_check** (DUP_GUIDANCE, expected EDITORIAL_REVIEW) — Same instruction in two surfaces, now diverging.
- **def_missing_prereq_run_analysis** (MISSING_PREREQ, expected EDITORIAL_REVIEW) — IA/procedural change — never auto-patched.
- **def_contradiction_upload_retention** (CONTRADICTION, expected UNRESOLVED_CONFLICT) — The declared marker sits on this section, so the conflict is between the injected doc value and both the fact and the sibling surface.
- **def_unsupported_claim_soc2** (UNSUPPORTED_CLAIM, expected EDITORIAL_REVIEW) — No fact key exists for certifications — exactly why it is unsupported.
- **def_unsupported_claim_encryption** (UNSUPPORTED_CLAIM, expected EDITORIAL_REVIEW) — 
- **def_ia_problem_cli_exit_codes** (IA_PROBLEM, expected EDITORIAL_REVIEW) — Content in the wrong surface/audience.
- **def_stale_cli_exit_code** (STALE_CLI, expected GROUNDED_PATCH) — The introspection fixture is the T2 authority.
- **def_conflict_insufficient_evidence** (UNSUPPORTED_CLAIM, expected UNRESOLVED_CONFLICT) — Phase 15 planted fixture (insufficient_evidence): the cited 'SLA page' resolves nowhere in the product-truth snapshot.
- **def_term_drift_lowercase** (TERM_DRIFT, expected GROUNDED_PATCH) — Expected MISS with the current extractor — kept deliberately so TERM_DRIFT recall stays honest (AP7).
- **def_dup_guidance_retention** (DUP_GUIDANCE, expected EDITORIAL_REVIEW) — Cross-surface divergence needs either a numeric mismatch hit ('90 days' matches no current value) or a dup detector that does not exist — expected miss, on the failures page.
- **def_missing_prereq_json_flag** (MISSING_PREREQ, expected EDITORIAL_REVIEW) — Removed preconditions leave no contradiction to measure — detection would need procedure modeling. Expected miss, analyzed on the failures page.

## False positives (0)

none

## Determinism and the model leg

This run is fully deterministic (no model calls); scores are identical across runs by construction. Model-assisted stats (falsification) are produced by eval:model (N=3) and merged below when present.

Model leg (EVAL_MODEL=1, N=3): 4 non-deterministic finding(s) falsified per run; suppression rates [0.25,0.25,0.25] → mean 0.25, spread 0; 12 model calls, est. $0.0603.

Baseline (clean estate): 11 findings (0 broken refs), 2 standing conflicts, 0 warnings.
