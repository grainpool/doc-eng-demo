import type { RelayKernelContainer } from "./kernel.js";

export interface Env {
  ASSETS: Fetcher;
  relay_db: D1Database;
  relay_artifacts: R2Bucket;
  /** Optional: absent in the vitest-pool-workers environment (see COMPAT.md). */
  KERNEL?: DurableObjectNamespace<RelayKernelContainer>;
  /** Set via `wrangler secret put` only — never in vars, never committed. */
  ANTHROPIC_API_KEY?: string;
  /** Signs the demo-user cookie (the entire Relay auth model). Secret store only. */
  RELAY_DEMO_COOKIE_SECRET?: string;
}
