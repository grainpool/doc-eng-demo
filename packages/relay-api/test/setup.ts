import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Bring the ephemeral test database up to the current migration state before
// any test runs. TEST_MIGRATIONS is injected by vitest.config.ts; it is a
// test-harness binding, not part of the Worker's own Env.
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(testEnv.relay_db, testEnv.TEST_MIGRATIONS);
