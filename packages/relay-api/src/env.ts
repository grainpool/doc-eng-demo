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
  /** Signs 60 s dataset capability URLs (kernel/presign.ts). Secret store only. */
  RELAY_DATASET_URL_SECRET?: string;
  /** Origin dataset capability URLs are signed for (workers.dev — COMPAT.md).
   *  Absent in tests: falls back to the request origin. */
  RELAY_DATASET_ORIGIN?: string;
  /** "1" enables POST /api/internal/seed (tests + local dev only). */
  RELAY_SEED_ENABLED?: string;
}
