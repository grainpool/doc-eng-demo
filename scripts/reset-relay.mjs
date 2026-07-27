// `node scripts/reset-relay.mjs` — wipe + reseed a DEPLOYED Relay through the
// token-gated maintenance route (expansion Phase 2). The token comes from the
// RELAY_MAINTENANCE_TOKEN env var (never argv — argv leaks into shell history
// and process lists). Target defaults to production; override with RELAY_RESET_URL.
const base = process.env.RELAY_RESET_URL ?? "https://relay.otonieltrejo.com";
const token = process.env.RELAY_MAINTENANCE_TOKEN;
if (!token) {
  console.error("RELAY_MAINTENANCE_TOKEN is not set; refusing to call the reset route.");
  process.exit(1);
}
const res = await fetch(`${base}/api/internal/reset`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
if (!res.ok) {
  console.error(`reset failed (${res.status}). Is the secret set on the Worker, and does it match?`);
  process.exit(1);
}
console.log(await res.json());
