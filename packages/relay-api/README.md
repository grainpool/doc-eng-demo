# relay-api

The Relay Worker: projects/files/sessions/turns/artifacts routes, the NL →
operation translator (router, never executor), the kernel proxy with signed
60-second dataset capability URLs, the six-tier `/api/product-truth`, the
copy registry endpoint, health checks, spend/rate guards, and structured
redacting logs.

- **Run locally**: `pnpm dev` (from the repo root; serves web + API via the
  Vite Cloudflare plugin). Secrets go in `.dev.vars` (gitignored).
- **Deploy**: `cd packages/relay-web && vite build && wrangler deploy --config dist/relay_api/wrangler.json`
- **Test**: `pnpm --filter relay-api test` (workerd pool; D1 migrations
  applied per worker; deployed-URL layers hit https://relay.otonieltrejo.com).
- **Seed**: `pnpm seed:relay` against a local dev server with
  `RELAY_SEED_ENABLED=1` in `.dev.vars`.
- **Deliberately does not**: run model-authored code (the kernel receives
  only validated `{operation_id, params}`), expose the container publicly,
  store raw IPs, or let Concord call anything beyond `/api/product-truth`
  and `/api/copy-registry`.
