# relay-kernel

The analysis kernel: a Cloudflare Container running FastAPI with exactly-pinned scientific Python
packages. Package versions in `requirements.txt` are product truth (`T0_RUNTIME`) — the deployed
`/versions` endpoint, read from the actually-imported modules, is the authority source.

Phase 01 surface: `GET /health` and `GET /versions` only. The eight bounded analysis operations
land in Phase 04. There is no code-execution surface, and there never will be (security.md §3).

The container is reachable only through the Relay Worker's Durable Object binding (`KERNEL`);
it has no public hostname. It runs as a non-root user with `matplotlib` on the `Agg` backend and
writes nowhere outside `/tmp`.

Deploys together with the Worker: the container image is built and pushed by `wrangler deploy`
(`pnpm deploy:relay` / `pnpm deploy:kernel`). Requires Docker locally.
