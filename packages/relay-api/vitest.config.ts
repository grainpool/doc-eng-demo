import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";

// @cloudflare/vitest-pool-workers >= 0.18 (vitest 4): the pool is configured
// via the cloudflareTest() Vite plugin (COMPAT.md). Migrations are read here
// and applied once per worker in test/setup.ts. The relative path resolves
// from the package root (vitest sets cwd to the config directory); Node
// globals like __dirname are avoided because this package typechecks against
// Workers types only.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/setup.ts"],
    },
  };
});
