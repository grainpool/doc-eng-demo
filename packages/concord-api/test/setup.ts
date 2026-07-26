import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(testEnv.concord_db, testEnv.TEST_MIGRATIONS);
