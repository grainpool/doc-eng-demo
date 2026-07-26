import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Same harness shape as relay-api (see its vitest.config.ts and COMPAT.md):
// migrations are read here and applied once per worker in test/setup.ts.
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
