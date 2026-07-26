# relay-kernel

The analysis kernel: a Cloudflare Container running FastAPI + pandas/scipy/
statsmodels/matplotlib, exposing exactly eight bounded operations
(`POST /op/{id}`), `/versions` (the T0 authority source, read from the
actually-imported modules), `/operations` (catalog generated from the same
validation models the handlers use), and `/health`. Data arrives only as a
Worker-signed DatasetRef: sha256-verified, size-capped on read, host-pinned.

- **Run**: deployed with the Worker (wrangler builds/pushes the image —
  Docker required locally). Reachable ONLY through the Worker's Durable
  Object binding; there is no public hostname.
- **Test**: build the image, then run pytest inside it (CI's `kernel` job is
  the bare-metal equivalent): 32 tests including committed OLS
  coefficients/p-values at rel 1e-6 and the no-code-surface enumeration.
- **Deliberately does not**: expose any code-execution surface — no eval, no
  exec, no `DataFrame.query()`, no file paths, module names, or expressions
  from requests; no writes outside /tmp. `requirements.txt` pins are product
  truth.
