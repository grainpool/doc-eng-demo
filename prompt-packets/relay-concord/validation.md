# validation.md — How the build gets verified

Verification is per-phase and cumulative: a later phase must not break an earlier phase's acceptance test. `pnpm test`
runs everything; `pnpm test:phase NN` runs one phase's suite.

---

## 1. Test topology

| Layer | Tool | Covers | Speed |
|---|---|---|---|
| Unit (pure) | `vitest` (node env) | `concord-core` entirely, `@relay/contracts` schemas, `relay-api` pure helpers (limits, normalization, path allowlist) | ms |
| Worker integration | `vitest` + `@cloudflare/vitest-pool-workers` | Hono routes against real D1/R2 bindings in `workerd` | ~seconds |
| Kernel | `pytest` in the container + a TS integration test through the Worker proxy | the eight operations, numeric correctness, route enumeration | seconds |
| CLI | `vitest` spawning the built CLI | exit codes, `--help`, `introspect` parity | seconds |
| Golden file | `vitest` + committed fixtures | adapter outputs, generator outputs, doc unit ids | ms |
| Eval | `pnpm eval` | seeded-defect corpus scoring | minutes (model calls) |
| Manual | checklist below | deployed behavior, Access, GitHub, UX | — |

**No end-to-end browser automation.** It is the highest-maintenance, lowest-signal option at this scale. The manual
checklists below cover what a browser test would, and the Worker integration tests cover the contracts.

`concord-core` must reach **high unit coverage** — it is pure and it holds the interesting logic. Aim for ≥ 90% on
`classify.ts`, `authority.ts`, `normalize-value.ts`, `path-allowlist.ts`, and every extractor. Coverage elsewhere is not
a target.

---

## 2. Phase acceptance tests (the authoritative list)

Each row is a test file the phase must add. The phase is incomplete without it.

| Phase | Test file | Asserts |
|---|---|---|
| 01 | `relay-api/test/health.test.ts` | All five dependency checks return `ok`, and the response contains no secret-shaped string (`sk-ant-`, `-----BEGIN`). |
| 02 | `contracts/test/facts.test.ts` | Every registry key has exactly one tier; templated families match expected keys; no duplicate key; `ProductTruthSnapshot` round-trips. |
| 03 | `relay-api/test/files.test.ts` | Over-limit upload → 413-equivalent error with a `copy_id`; unsupported extension → distinct code; sha256/row/column counts recorded. |
| 03 | `relay-web/test/no-literal-copy.test.ts` | Source scan finds no user-visible literal in JSX text nodes. |
| 04 | `relay-kernel/tests/test_operations.py` | Each of the eight ops on a fixture CSV matches committed expected output within tolerance. |
| 04 | `relay-kernel/tests/test_no_code_surface.py` | Route enumeration contains only the four documented routes; no handler parameter accepts a path/expression; `filter_rows` rejects an operator not in the enum. |
| 04 | `relay-api/test/kernel-proxy.test.ts` | sha256 mismatch → 400; oversized dataset → 400; unknown operation id → 404. |
| 05 | `relay-api/test/nl-translation.test.ts` | Unsupported request → `kind:"unsupported"` and **zero** kernel calls (spy asserts this); invalid params → 422 and zero kernel calls; refusal `stop_reason` handled before reading content. |
| 06 | `relay-api/test/provenance.test.ts` | Artifact insert without complete provenance throws; provenance versions equal the mocked kernel response for that turn; lineage resolves a two-step chain. |
| 07 | `relay-cli/test/introspect-parity.test.ts` | For every command, `introspect --json`'s `usage` equals `--help` output. |
| 07 | `relay-cli/test/exit-codes.test.ts` | Each contractual exit code is produced by its condition. |
| 08 | `relay-api/test/copy-registry.test.ts` | Every copy entry stating a numeric fact declares `references_facts`, except the ids listed in `fixtures/eval/defects.json` as `UNDECLARED_FACT_REF` seeds. |
| 08 | `relay-api/test/product-truth.test.ts` | All six tiers return non-empty; every claim has a resolvable locator. |
| 09 | `relay-api/test/seed-determinism.test.ts` | Seeding twice from empty yields identical snapshots modulo timestamps. |
| 10 | `concord-core/test/milestone.test.ts` | One fact change → exactly two impacts, correct classes, explanations naming fact + tier + relationship; rerun → two `NO_ACTION`. |
| 11 | `concord-core/test/adapters/*.golden.test.ts` | Each adapter's parsed units match its committed golden file; ids stable across two runs; `patch()` on a generated unit throws. |
| 11 | `concord-core/test/coupling.test.ts` | No `/api/` string literal in `concord-*` other than the two allowed endpoints (I13). |
| 12 | `concord-core/test/semantic-consistency.test.ts` | Four differently-worded projections with equal normalized values → zero findings (I9); `model_extraction` confidence ≤ 0.7. |
| 12 | `concord-core/test/authority.test.ts` | T4 never overrides a current value; lower-tier disagreement produces a conflict, not an override; T5 wins only where it claims the key. |
| 13 | `concord-core/test/generators.idempotent.test.ts` | Every generator is byte-identical across two runs (I8). |
| 13 | `concord-core/test/classify.test.ts` | All six rules fire on crafted inputs; `model_extraction` never yields `DETERMINISTIC_REGEN` (I5); no `llms.txt` path is ever emitted (G7). |
| 14 | `concord-core/test/patch-validation.test.ts` | Zero-evidence patch rejected (I6); unresolvable locator → discard + reclassify; patch introducing an undeclared fact key rejected; `requires_review` true for all model-origin patches. |
| 14 | `concord-api/test/run-dispositions.test.ts` | Every detected impact has a terminal disposition (I10). |
| 15 | `concord-core/test/conflicts.test.ts` | T3-vs-T4 contradiction → `UNRESOLVED_CONFLICT`, no patch, named owner, non-empty `missing_information`; `resolution === null` (I7). |
| 15 | `concord-core/test/falsification.test.ts` | A refuted finding is retained as `suppressed` with refutation text; concurrency never exceeds 5. |
| 16 | `concord-core/test/eval-harness.test.ts` | Harness scores a synthetic corpus correctly; `unsafe_autofix_count === 0` (I14). |
| 17 | `concord-api/test/public-no-model.test.ts` | Every public route yields `model_usage.calls === 0` (I11). |
| 18 | `concord-api/test/access.test.ts` | Missing header → 403; self-signed token → 403; wrong `aud` → 403; wrong `iss` → 403; expired → 403; wrong domain → 403; `DEMO_ADMIN_ENABLED` unset → 404 (I12). |
| 18 | `concord-core/test/mutation-allowlist.test.ts` | Off-allowlist key rejected before value validation; off-enum value rejected; oversized body rejected; `<script>`/`import`/`{expr}` in a doc body rejected. |
| 19 | `concord-core/test/path-allowlist.test.ts` | Denylist wins over allowlist; traversal variants rejected (`..`, `%2e%2e%2f`, absolute, backslash, unicode); `.github/**` rejected; only the seven allowed globs pass. |
| 19 | `concord-api/test/github-cleanup.test.ts` | A failure after branch creation deletes the branch. |
| 20 | `concord-api/test/redaction.test.ts` | The log helper drops every field on the redaction list; no `Cf-Access-*` header value is ever serialized. |

---

## 3. Manual QA — Relay (run after Phase 09)

1. Create a project. Upload a valid CSV. Confirm row/column counts match the file.
2. Upload an 11 MB CSV → rejection message matches the copy registry entry, and states the limit.
3. Upload a `.pdf` → distinct rejection, distinct message.
4. Open an analysis session. Run all four of: schema inspection, summary statistics, a correlation, a regression.
5. Ask for something unsupported ("cluster these rows"). Confirm a clean refusal naming supported alternatives, and that
   no artifact was created.
6. Open an artifact → confirm source file, operation, params, package versions, timestamp all shown.
7. Chain: filter → correlate. Confirm the lineage view shows the chain.
8. `relay --help`, `relay projects --help`, `relay projects list --help`. All three are real and distinct.
9. `relay projects list --json | jq`. `relay files show <bad-id>` → exit 4 with a real message.
10. `relay introspect --json | jq '.commands | length'` → matches the command count.
11. Kill the container (or block it) → analysis returns 503 with `error.analysis.kernel_unavailable`, the turn is
    recorded as failed, and the UI is not broken.

## 4. Manual QA — Concord public (run after Phase 17)

Do this in a **private browser window** with `DEMO_ADMIN_ENABLED` unset.

1. Fact-graph explorer: open `limit.upload.csv.max_bytes` → see ≥ 4 projections with different wording, all consistent.
2. Open `term.canonical.task` → see term occurrences across surfaces.
3. Replay the rename run. Confirm you can see: detected facts, affected doc units, deterministic updates, proposed
   patches **with evidence**, at least one conflict, required reviews, and a generated changelog entry.
4. For one proposed patch, open the evidence panel and follow each locator to its source.
5. Replay the "enable on iOS" run. Confirm the help-center article and the availability matrix are both affected, and
   that the reference page and the tooltip are updated with *different wording*.
6. Open the eval scorecard. Confirm per-class recall, false positives, and escalation metrics are shown.
7. Open "What the system gets wrong". Confirm it names specific real misses, not generic caveats.
8. Open a past run's step list. Confirm timings and model usage are shown (0 calls for replay).
9. Check network tab / logs: **zero** requests to `api.anthropic.com` across the whole session.

## 5. Manual QA — privileged (run after Phase 19)

1. Visit `/admin` from a non-`@anthropic.com` address → Access denies; confirm no PIN email is sent.
2. From an `@anthropic.com` address → OTP arrives, login succeeds.
3. `curl` `/api/admin/runs` with no cookie/header → 403. With a hand-forged JWT → 403.
4. Trigger a live rename run. Watch steps stream. Confirm real model calls and per-run cost appear.
5. Confirm a PR was opened, touching only allowlisted paths, with evidence in the body and a run-inspector link.
6. Submit a mutation with an off-allowlist fact key → rejected with `MUTATION_NOT_ALLOWED`.
7. Submit a doc body containing `<script>alert(1)</script>` → rejected.
8. Submit a doc body containing `import x from "y"` → rejected.
9. Start two runs concurrently → the second is rejected naming the in-flight run.
10. Trigger 6 runs in an hour → the sixth is rate-limited.
11. Check `audit_log` → your identity, the mutation, the run id, and the PR url are recorded.
12. Wait 48 h (or run the cron manually) → the branch and PR are reaped.

## 6. Evaluation criteria (Phase 16)

`pnpm eval` writes `eval-report.json` + `eval-report.md`.

| Metric | Definition | Gate |
|---|---|---|
| Detection precision | correct findings ÷ all findings | report; investigate < 0.75 |
| Detection recall (overall) | detected ÷ `expected_detection: true` defects | report; investigate < 0.70 |
| Detection recall **per class** | same, split by the 12 classes | report; **at least two classes must be < 100%** or suspect the harness |
| False-positive rate | findings on `expected_detection: false` items ÷ those items | report; investigate > 0.20 |
| Remediation correctness | patches whose diff matches the expected fix ÷ patches offered | report |
| Escalation appropriateness | correctly escalated ÷ defects whose `expected_action` is `EDITORIAL_REVIEW`/`UNRESOLVED_CONFLICT` | report; investigate < 0.80 |
| **Unsafe autofix count** | auto-applied patches on defects whose `expected_action` was not `DETERMINISTIC_REGEN` | **must be 0 — hard gate** |
| Provenance completeness | patches with ≥ 1 resolvable evidence item ÷ all patches | **must be 1.0 — hard gate** |
| Falsification suppression rate | suppressed ÷ proposed non-deterministic findings | report only; a very high value means the falsifier is too aggressive |

**Honesty rules.** Metrics are computed by the harness and committed verbatim. Do not tune the fixture to improve a
score. Do not remove a defect the system misses. A perfect score on every metric means the harness is measuring the
implementation rather than the problem — treat it as a failing phase and add harder defects.

## 7. Edge cases and regression risks to test explicitly

**Relay**
- Empty CSV; CSV with one column; CSV with duplicate column names; CSV with a BOM; CRLF line endings (Windows —
  the developer will produce these); a column named like a pandas method (`count`, `mean`); unicode column names;
  a value containing a `,` inside quotes; 5,000+ rows hitting the `filter_rows` cap.
- Regression on `limit.upload.csv.max_bytes`: the limit exists in one enforcement point. A change must alter behavior,
  the fact, the error copy interpolation, and every doc projection. If any of those four falls out of sync, the demo's
  central claim is broken.

**Concord**
- A doc unit deleted between runs (projection now dangles) → run must handle it, not crash.
- A doc unit renamed (id changes) → treated as delete + add, and reported as such.
- Two facts projected into the same sentence → both impacts must be produced, and patches must not conflict on the same
  span (detect overlapping spans and escalate).
- A fact with zero projections → reported as `undocumented_fact`, which is a finding, not silence.
- A projection whose fact key is not in the registry → `UNSUPPORTED_CLAIM`.
- The same fact stated in a code block inside an MDX page → must not be patched (code samples are not prose).
- Terminology rename closure: after `Job → Task`, occurrences of "Job" in *URLs and anchors* must be flagged for
  editorial review, not silently rewritten (link breakage risk).

**Cross-cutting**
- Clock skew on the Access JWT (small `nbf`/`exp` tolerance).
- Container cold start during the first analysis of the day.
- Two phases' migrations applied out of order → `wrangler d1 migrations list` must be checked in CI.

## 8. Security verification checklist (Phase 20 — every line must pass)

**Secrets**
- [ ] `grep -r "sk-ant-" .` finds nothing outside `.gitignore`d files.
- [ ] Built client bundles contain no secret, no `ANTHROPIC`, no GitHub key material.
- [ ] `/api/health` and `/api/public/*` return no environment value.
- [ ] Error responses contain no stack trace, file path, or config value.
- [ ] Pre-commit secret scan is installed and fires on a planted test secret.

**Access / authorization**
- [ ] Missing `Cf-Access-Jwt-Assertion` → 403.
- [ ] Self-signed JWT → 403. Wrong `aud` → 403. Wrong `iss` → 403. Expired → 403.
- [ ] Non-`@anthropic.com` email in a valid JWT → 403.
- [ ] `DEMO_ADMIN_ENABLED` unset → admin routes 404.
- [ ] No `if (dev) skipAuth` branch exists in the production bundle (grep the built output).
- [ ] Access policy uses "Emails ending in", and "One-time PIN" is **not** an Include rule under Login Methods.

**Code execution / SSRF**
- [ ] No `eval`, `new Function`, `child_process`, or `exec` in any Worker or the kernel.
- [ ] No endpoint anywhere accepts a URL to fetch.
- [ ] Kernel outbound fetch to a non-R2 host fails.
- [ ] `filter_rows` rejects any operator outside the enum; no `DataFrame.query()` call exists in the kernel.
- [ ] Unknown `operation_id` → 404, no side effect.

**Repository writes**
- [ ] Every path in the denylist is rejected, with the denylist checked before the allowlist.
- [ ] Traversal variants rejected (`..`, `%2e%2e%2f`, absolute, backslash, unicode).
- [ ] The demo repo contains no `.github/workflows/`.
- [ ] Branch protection on `main`: PR required, no force push, no deletion.
- [ ] GitHub App has exactly Contents:write, Pull requests:write, Metadata:read — nothing more.
- [ ] The App is installed on the demo repo only.
- [ ] Installation tokens are repo-scoped and never returned in a response.

**Spend / abuse**
- [ ] Public routes make zero model calls (verified in logs, not just in tests).
- [ ] Per-run call cap enforced (force it and confirm `partial` + `budget_exhausted`).
- [ ] Per-day spend cap enforced (temporarily lower it and confirm).
- [ ] Per-identity hourly run limit enforced.
- [ ] One concurrent run enforced.
- [ ] Admin request body size capped.

**Logging**
- [ ] No `Cf-Access-*` header value appears in any log line.
- [ ] Prompts are logged as hashes, not text.
- [ ] Presigned URLs never logged.
- [ ] `audit_log` records every admin action; the public view shows domain only.

## 9. Diagnostics you will want when something breaks

Build these as you go; they pay for themselves in the later phases.

| Command | Purpose |
|---|---|
| `pnpm concord ingest --dry-run --surface=mintlify` | List doc units and ids per surface without running anything. |
| `pnpm concord facts --key=<fact>` | Print every projection of one fact with extractor, confidence, and asserted value. |
| `pnpm concord explain --run=<id> --impact=<id>` | Print the full decision chain: delta → projection → rule → action → disposition. |
| `pnpm concord diff-truth --against=<snapshot>` | Show fact deltas between two snapshots. |
| `pnpm relay kernel-probe --op=<id> --file=<path>` | Call one kernel operation directly with a local file. |
| `GET /api/public/runs/:id?verbose=1` | Full run record including suppressed findings and step detail. |
| `GET /api/health` | Per-dependency status with versions. |

Every one of these should work offline against seeded fixtures, so debugging never requires a live model call.
