declare module "cloudflare:test" {
  // The test worker's bindings (from wrangler.test.jsonc via worker-configuration.d.ts).
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
