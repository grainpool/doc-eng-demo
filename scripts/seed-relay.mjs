// `pnpm seed:relay` — seeds a LOCAL Relay (wrangler dev with
// RELAY_SEED_ENABLED=1 in .dev.vars) with the deterministic fixture state:
// 3 projects, 5 files, 4 sessions, ~12 artifacts incl. a two-step lineage
// chain. The production deploy does not enable the seed route.
const base = process.env.RELAY_SEED_URL ?? "http://localhost:8787";
const res = await fetch(`${base}/api/internal/seed`, { method: "POST" });
if (!res.ok) {
  console.error(
    `seed failed (${res.status}). Is \`pnpm dev\` running, and is RELAY_SEED_ENABLED=1 set in packages/relay-api/.dev.vars?`,
  );
  process.exit(1);
}
console.log(await res.json());
