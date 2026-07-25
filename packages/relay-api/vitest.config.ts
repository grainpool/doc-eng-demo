import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// @cloudflare/vitest-pool-workers >= 0.18 (vitest 4): the pool is configured
// via the cloudflareTest() Vite plugin, not defineWorkersConfig (COMPAT.md).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
});
