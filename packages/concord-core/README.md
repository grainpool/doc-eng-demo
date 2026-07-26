# @concord/core

Pure reconciliation logic. No I/O, no network, no Workers APIs — everything here takes parsed
inputs and returns values, which is what makes the pipeline unit-testable and the eval harness
honest (invariant G2).

| Area | Files |
|---|---|
| Surface adapters (6) | `src/adapters/` — mintlify, helpcenter, inproduct, clidocs, release, generated. Each owns globs, parses files into `DocUnit`s, and (where legal) patches a unit body. Generated-surface `patch()` always throws — regenerate instead (G8). |
| Extractors (7) | `src/extractors.ts` — declared_reference/frontmatter/generated (1.0), term_occurrence/availability_table (0.9), numeric_pattern (0.85), model_extraction (≤0.7 cap). Normalized-value comparison in `src/normalize-value.ts`. |
| Authority arbitration | `src/authority.ts` — tier order per fact family; losers become conflicts, never silent overwrites. |
| Classification | `src/classify.ts` — the six rules mapping (delta × projection) → action class. |
| Conflicts & falsification | `src/conflicts.ts`, `src/falsify.ts` — five conflict kinds; the adversarial falsifier prompt/parser (defaults to refuted under uncertainty). |
| Validation gates | `src/patch-validate.ts` — evidence resolution, anti-hallucination re-extraction, register, path allowlist (denylist first). `src/mutation-validate.ts` — the Change Lab mutation gates. |
| Generators (6) | `src/generators/` — availability matrix, plan gating, CLI reference, changelog, navigation fragment, descriptions. Idempotent; hand-edit detection compares byte-for-byte. |
| Pipeline | `src/pipeline.ts` — deltas → projections → arbitration → classification → patches/findings/conflicts, with conflict-blocking and patch composition. |

## CLI (diagnostics + eval)

```
pnpm ingest -- --dry-run [--surface=X]   list doc units per surface
pnpm eval                                seeded-defect harness → eval-report.{md,json}
EVAL_MODEL=1 pnpm eval                   + N=3 falsification leg
pnpm eval:failures-page                  regenerate the public failures page
pnpm regen:estate                        write generator output into estate/ (the ONLY
                                         sanctioned way generated estate files change)
```

Tests: `npx vitest run` — 95 tests covering adapters (goldens), extractors, arbitration,
classification, generators (idempotency + hand-edit detection), patch/mutation/path validation
(every traversal variant individually), conflicts, falsification defaults, and the I13 coupling
grep.
