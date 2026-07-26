# concord-api

The Concord Worker: Hono API + Cloudflare Queue consumer + D1 + the concord-web assets. Everything
impure lives here; the logic it drives is `@concord/core`.

| Area | Files |
|---|---|
| Run executor | `src/run.ts` — snapshot fetch (the only two Relay endpoints, I13), pipeline, guarded model calls (≤5 concurrent, ≤20/run, ≤$5/UTC-day — slot reserved BEFORE each call), falsification, persistence, publish. |
| Identity gate | `src/middleware/access.ts` — Cloudflare Access JWT verification (iss+aud+exp) + independent email check; 404 when `DEMO_ADMIN_ENABLED` unset (default-off, I12). |
| GitHub publish | `src/github.ts` — per-run repo-scoped installation tokens, the second path-allowlist check, branch→commit→PR, branch deletion on failure, 48h cleanup cron. |
| Spend | `src/spend.ts` — `model_call` rows, per-run and per-day gates. |
| Live mutations | `POST /api/admin/changelab` — working-copy mutations, one concurrent live run, ≤5/identity/hour, 16 KB body cap, append-only `audit_log`. |
| Logging | `src/log.ts` — structured JSON with the security.md §6 redaction list (enforced by `test/redaction.test.ts`). |
| Health | `GET /api/health` — per-dependency status (D1, assets, Relay, queue, GitHub config, replay recordings, estate SHA, contracts version). No secrets, no env values. |
| Baked estate | `src/estate.generated.ts` (gitignored; `scripts/generate-estate.mjs` regenerates from the submodule and records `ESTATE_SHA` — the publish branch base). |

Public surface: `/api/public/*` (runs, facts, audit — redacted), replay scenarios, and the static
inspector. Public runs get a **null model client** — zero model calls by construction (I11).

Deploy: `npx wrangler deploy` (admin surface stays 404 unless `--var DEMO_ADMIN_ENABLED:true` is
passed explicitly). Secrets via `wrangler secret put` only: `ANTHROPIC_API_KEY`,
`GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY` (PKCS#8 — see COMPAT.md).

Tests: `npx vitest run` (vitest-pool-workers + D1 migrations) — the Access 403 matrix with forged
JWTs, I11, dispositions and forced spend caps, the GitHub publish/cleanup suite (zero-calls
refusal, orphan-branch deletion, idempotent cleanup, no-leak scans), and redaction.
