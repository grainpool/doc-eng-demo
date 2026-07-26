# COMPAT.md — observed platform reality

Phase 01, recorded 2026-07-25 on Windows 11 (Node v22.23.1, pnpm 9.15.9, Docker 28.4.0).
Later phases append; nothing here is edited retroactively without a dated note.

## Toolchain versions (observed, not assumed)

| Tool | Version |
|---|---|
| wrangler | 4.114.0 |
| workerd (bundled with the vitest pool's miniflare 4.20251011.0) | compat date ceiling 2025-10-11 (see below) |
| vite | 7.3.6 |
| @cloudflare/vite-plugin | 1.47.0 |
| vitest / @cloudflare/vitest-pool-workers | 4.1.10 / 0.18.8 |
| @anthropic-ai/sdk | 0.115.0 |
| @cloudflare/containers | 0.0.28 |
| hono | 4.12.32 · zod 4.x · react 19.2.8 |

## Kernel image — exact installed Python packages (pinned in requirements.txt)

python 3.12 (python:3.12-slim) · pandas 3.0.5 · numpy 2.5.1 · scipy 1.18.0 · statsmodels 0.14.6 ·
matplotlib 3.11.1 · fastapi 0.140.0 · uvicorn 0.51.0. All install as prebuilt cp312 manylinux
wheels — no compilation during the image build.

## Where the platform disagreed with research-findings.md (or with the phase prompt)

1. **`@cloudflare/vitest-pool-workers` API changed at 0.18 (vitest 4).**
   `defineWorkersConfig` from `.../config` no longer exists; the pool is configured via a
   `cloudflareTest()` Vite plugin from the package root (see `packages/relay-api/vitest.config.ts`).
   The 0.9.x line (which still has the documented API) ships a workerd too old for wrangler-4.114-era
   configs and crashes with `vm._setUnsafeEval is not a function`. Objective preserved; API shape
   deviates from the docs the packet era assumed.
2. **Containers are not available in the vitest pool.** The test pool cannot run the container
   binding, so `wrangler.test.jsonc` omits `containers`/`durable_objects`, `Env.KERNEL` is typed
   optional, and the kernel + Anthropic checks are only shape-asserted in the SELF-layer test. The
   authoritative all-five-green assertion runs against the deployed URL (public, secret-free, works
   in CI).
3. **The pool's workerd caps `compatibility_date` at 2025-10-11** and falls back with a warning when
   the config requests 2026-07-01. Deployed workerd accepts the requested date; only tests run on
   the older runtime.
4. **`assets.directory` + the Vite plugin coexist fine.** The plugin accepted the phase-prompt
   config (`directory`, `binding`, `not_found_handling`, `run_worker_first`) without complaint,
   builds the client into `dist/client/`, and emits a resolved Worker bundle + `wrangler.json` into
   `dist/relay_api/` (worker name with underscores). Deploy command:
   `vite build && wrangler deploy --config dist/relay_api/wrangler.json`.
5. **`@anthropic-ai/sdk` must be current for adaptive thinking.** 0.70.x typings reject
   `thinking: {type: "adaptive"}`; 0.115.0 accepts it. `output_config.effort` typed fine in both.

## Anthropic API

- Model id `claude-opus-5` via the single `MODEL_ID` constant. Call shape used by the health check:
  `max_tokens: 64`, `thinking: {type: "adaptive"}`, `output_config: {effort: "low"}`, no
  `temperature`/`top_p`/`top_k`/`budget_tokens`, `stop_reason === "refusal"` checked before any
  content access.
- Observed live: _see “Deployed observations” below._

## Cloudflare account facts confirmed this phase

- `wrangler r2 bucket create relay-artifacts` succeeded first try — the feared missing-R2-scope
  stall (phase prompt operator gate) did not occur on this OAuth session.
- `wrangler d1 create relay_db` → database id `671f9e9a-8dab-46dd-ad5d-e743dbdf8053` (ENAM).
- R2 binding names cannot contain `-`; binding is `relay_artifacts` for bucket `relay-artifacts`.

## Deployed observations

- **Deploy pipeline**: `vite build && wrangler deploy --config dist/relay_api/wrangler.json`. One
  command shipped the Worker, the client assets, the container image (built locally by Docker,
  pushed to `registry.cloudflare.com`), the Durable Object migration, and the custom domain.
  Wrangler created the `relay.otonieltrejo.com` DNS record itself; global resolution (1.1.1.1) was
  live within ~2 minutes, while this machine's local resolver lagged ~10+ minutes behind.
- **Container application** `relay-api-relaykernelcontainer`, app id
  `a03907f9-1022-4ec0-9d05-21ba660caa3a`, instance type `basic`, max 1 instance. Image ~1.5 GB
  unpacked; push took ~3 minutes on this connection.
- **First live `/api/health` after deploy** (cold container): `all_ok: true`, total 5 346 ms —
  worker_assets 116 ms · D1 864 ms · R2 658 ms · **kernel 5 346 ms (cold)** · Anthropic 1 183 ms.
  Cold start well under the 8 s kernel budget in `constraints.md` §4 — but this was minutes after
  the image push; re-measure a from-scratch cold start in Phase 04 before trusting it.
- **Warm `/api/health`**: total ~1.4 s — worker_assets 9 ms · D1 212 ms · R2 623 ms ·
  **kernel 101 ms (warm)** · Anthropic 1 153 ms. CPU time is far below any limit; `limits.cpu_ms`
  is raised to 300 000 for later AI routes, not for this route.
- **Observed kernel truth (T0)**: python 3.12.13 · pandas 3.0.5 · numpy 2.5.1 · scipy 1.18.0 ·
  statsmodels 0.14.6 · matplotlib 3.11.1 · image build id
  `f29dfb9e17abfab0eeb2bfd42cbe6035fcdcda8ded65a33634b0003d9ed0742c` (content hash — see NOTES.md
  on the real OCI digest).
- **Anthropic live call**: succeeded with `thinking: {type: "adaptive"}` +
  `output_config: {effort: "low"}`, no sampling params; response `model` echoed exactly
  `claude-opus-5`; `stop_reason` was not `refusal`.
- **`run_worker_first: ["/api/*"]` behaved as documented**: `/api/health` reaches the Worker,
  everything else serves the SPA (`/` returned `index.html` 200 through the ASSETS binding).

## Phase 02 additions (2026-07-25)

- `wrangler d1 migrations apply relay_db` worked with the default `migrations/` directory next to
  `wrangler.jsonc`; 14 statements applied cleanly to both a fresh local DB and the remote one. The
  Durable Object `migrations` block and D1 migrations are separate mechanisms and did not interact.
- zod v4's native `z.toJSONSchema()` exists as documented; `z.string().url()` is deprecated in favor
  of the top-level `z.url()`. The `zodToJsonSchema` wrapper in `@relay/contracts` is the single
  derivation point for structured-output schemas.
- Contracts' ULIDs are implemented in-package on the `crypto` global (workerd + Node 22 both have
  it): G3 (zod-only dependency) beats G18's approved `ulid` package inside `@relay/contracts`.

## Phase 03 additions (2026-07-25)

- Workers' non-standard `crypto.DigestStream` works as documented and is what makes single-pass
  streaming sha256 possible; WebCrypto alone has no incremental digest.
- In the vitest pool, D1 migrations are applied per-worker via `readD1Migrations` (vitest.config) +
  `applyD1Migrations` (test/setup.ts). The pool's `env` is typed as the wrangler-generated `Env`,
  so the harness-only `TEST_MIGRATIONS` binding needs a local cast in setup.
- `design/theme.json` existed and was applied: `elementStyles` verbatim under a `.content` scope,
  derived `componentStyles`/`palette` as chrome classes, all emitted into one generated stylesheet
  (`relay-web/src/theme.ts`). No token was altered; no new color pairings were introduced beyond
  the README's verified list.

## Phase 04 additions (2026-07-26)

- **Container egress is OPEN — the security.md §3 "no general egress" network policy does not exist
  on Cloudflare Containers today.** Verified with the hardcoded startup probe
  (`RELAY_EGRESS_PROBE=1`, target `https://example.com/`, reported via the kernel's `/health`):
  observed `open:http_200` from inside the deployed container. There is no per-container egress
  policy in the platform config surface. Compensating controls actually in place: the kernel never
  accepts a URL from any request except the Worker-signed `DatasetRef`, it host-pins that fetch to
  `RELAY_DATASET_HOST`, verifies sha256 before parsing, and enforces `max_bytes` on read. Recorded
  as a real gap between the spec's assumption and the platform, not silently papered over.
- **R2 presigned URLs require S3-compatible access keys that exist nowhere in the operator
  inventory** (operator-runbook.md lists no such credential, and inventing one is forbidden).
  Objective preserved per the research-findings deviation rule: the Worker signs its own
  capability URLs (HMAC-SHA256; TTL ≤ 60 s, method and single object key inside the signed
  payload) and serves the bytes from the R2 binding at `GET /api/dataset`. See
  `packages/relay-api/src/kernel/presign.ts`.
- **The zone's bot protection blocks server-to-server fetches to the custom domain.** The
  kernel's dataset fetch to `relay.otonieltrejo.com` was rejected at the edge: Python's default
  user agent gets error 1010 outright, and even with a custom `relay-kernel/1.0` UA the edge
  intermittently 403'd (one success, then blocks — fingerprint-based scoring). Fix that needs no
  dashboard work: dataset capability URLs are signed for
  `https://relay-api.trejootoniel.workers.dev` (workers.dev requests do not traverse the zone's
  security products). `workers_dev: true` + `preview_urls: false` in wrangler.jsonc;
  `RELAY_DATASET_ORIGIN` var is the signing origin and `RELAY_DATASET_HOST` pins the kernel.
- **`max_instances: 1` + two DO ids = a 500.** The health check used `getContainer(env.KERNEL,
  "health")` while the op proxy used `"kernel"`; the second actor could not schedule a container
  and its fetches failed with status 500. Everything now shares the single instance id `"kernel"`.
- **A deployed image change does not restart a running container instance.** The warm instance
  kept serving the old image/env for minutes after `wrangler deploy`; new code arrives only when
  the instance restarts (sleep, eviction, or rollout). Verification polls must expect this lag.
- **The true OCI image digest IS visible at deploy time** (`registry.cloudflare.com/...@sha256:d9da1376…`
  in wrangler's push output) but is not knowable from inside the image at build time; `/versions`
  continues to report the build-content hash (`17e675bd…`) as `image_digest` (NOTES.md item stands).
- **Observed Phase-04 latency** through `POST /api/internal/kernel/op/:id` (12-row fixture, warm
  container): inspect_schema ~0.40 s · summary_statistics ~0.35 s · filter_rows ~0.37 s ·
  group_aggregate ~0.39 s · correlation_matrix ~0.36 s · linear_regression ~0.38 s ·
  distribution_test ~0.39 s · plot ~0.91–1.12 s (22 KB PNG). First op after a container start:
  ~7.9 s total (within the 8 s per-attempt budget; the proxy's one retry covers the pathological
  cold case).
- Kernel pytest suite (29 tests incl. committed OLS coefficients/p-values at rel 1e-6) runs inside
  the pinned image locally (`docker run … pytest`) and on `python:3.12` + the same
  `requirements.txt` in CI's `kernel` job.

## Phase 05 additions (2026-07-26)

**The structured-outputs endpoint compiles schemas to a constrained-decoding grammar and accepts
far less than full JSON Schema.** All observed live against `claude-opus-5`:

1. `oneOf` rejected ("Schema type 'oneOf' is not supported") — zod emits it for discriminated
   unions; `zodToJsonSchema` now rewrites `oneOf` → `anyOf` (equivalent here: a discriminated
   union is mutually exclusive by construction).
2. Open objects rejected ("'additionalProperties: object/true' is not supported") — every object
   must be explicitly closed; the wrapper now stamps `additionalProperties: false`.
3. Validation keywords rejected (`minimum`/`maximum` observed; length/item bounds presumed) —
   `zodToOutputFormatSchema` prunes derived schemas to a structural whitelist (type, properties,
   required, items, enum, const, anyOf, default, description). Dropped constraints are still
   enforced by the Zod re-validation gate.
4. Grammar size is a hard budget: a union embedding the eight per-op param schemas failed with
   "The compiled grammar is too large"; even ONE wide all-optional params object failed with
   "Schema is too complex". Final shape: `params` travels as a JSON-encoded STRING field;
   `operation_id` stays a schema-enforced closed enum (the security property), and params are
   parsed + validated Worker-side before any kernel call.
5. **Non-streaming requests that fail grammar compilation can HANG instead of erroring** — the
   connection sat open with zero bytes and died at ~60 s (some middlebox), while the same request
   with `stream: true` returned the real "Schema is too complex" error in ~19 s. When debugging
   structured-output 4xx-ish behavior, debug with streaming on.

Observed translation cost/latency (12-row fixture, catalog + schema + preview in prompt):
~2 420 input / ~100–150 output tokens, 1 call, ~3.6–4.8 s end-to-end per turn (kernel warm).
Narration: streamed, ~4 s. Both write `model_call` rows (purpose, tokens, prompt hash).

## Phase 11 additions (2026-07-26)

- **Canonical docs URL: `https://docs.otonieltrejo.com`** (operator-confirmed, OG-3 complete).
  Mintlify is connected to `grainpool/doc-eng-demo-estate` → `docs-mintlify/`. Use this hostname
  everywhere the packet says `docs.<domain>`.
- Verified live: the site renders (HTTP 200, title "Relay - Relay Docs") and
  `https://docs.otonieltrejo.com/llms.txt` is GENERATED by Mintlify from page frontmatter
  `description`s + `docs.json` — it lists all 14 pages with `.md` links and embeds the
  `markdown.instructions` agent guidance verbatim. Nothing hand-authored (G7 honored).
- `$ref`-split navigation (`navigation.json` + `navigation-generated.json`) built fine.

## Development environment notes (Windows)

- **`pnpm setup` is shadowed by pnpm's built-in `setup` command** (which configures `PNPM_HOME`
  and prints "Setup complete. Open a new terminal…"). The project script must be invoked as
  `pnpm run setup`. The phase prompt's literal "`pnpm setup`" cannot be bound to a script under
  pnpm 9; `pnpm run setup` is the working equivalent and the README says so.

- corepack cannot write its pnpm shim to `C:\Program Files\nodejs` without elevation (EPERM);
  pnpm was installed via `npm install -g pnpm@9.15.9` instead.
- The vitest pool leaves `EBUSY` warnings deleting miniflare temp dirs on Windows at shutdown;
  harmless, tests unaffected.
- Git for Windows 2.40 shipped with no configured credential helper on this machine;
  `credential.helper=manager` was set globally and GitHub auth completed interactively via GCM's
  browser flow (needed once; cached thereafter).
- **This LAN's DNS resolver negative-cached the brand-new `relay.otonieltrejo.com` record** for
  well over 30 minutes after deploy (NXDOMAIN locally while 1.1.1.1 answered). Consequence: the
  deployed-URL test in `health.test.ts` failed on this machine immediately after the first deploy
  while the same suite passed in GitHub CI (clean resolvers) — see CI run 30178033001, green.
  Not a platform issue; it clears when the local resolver's negative TTL expires.

## Phase 12 additions

- **Worker secrets piped through PowerShell arrive corrupted.** `Get-Content -Raw | npx wrangler secret put`
  produced a secret the API rejected with `401 invalid x-api-key` (PowerShell 5.1 re-encodes the
  pipeline with the console codepage and appends a newline). The same key piped from Git Bash with
  `printf '%s'` worked. Symptom is invisible until first use — `wrangler secret put` reports success
  either way. Model-extraction run_steps record a truncated `first_error` for exactly this class of
  silent ops failure (never prompt text).
- **Secret/deploy propagation lag applies to plain Workers too**, not only containers: a run fired
  seconds after `wrangler deploy`/`secret put` can execute the previous version (observed: a
  redeployed step schema missing its new field; a re-put secret still 401ing one run later).
  Verification needs a delay or polling, as with the kernel container (Phase 04 note).
