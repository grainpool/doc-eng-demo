# relay-web

Vite + React SPA, built into the Relay Worker's static assets and deployed with it as one unit
(`@cloudflare/vite-plugin`; Worker config in `../relay-api/wrangler.jsonc`).

Phase 01: a single screen rendering `/api/health`. No router, no design system, no branding.
From Phase 03 every user-visible string moves to the copy registry (`estate/in-product-copy/`).
