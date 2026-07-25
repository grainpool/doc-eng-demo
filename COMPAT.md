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
