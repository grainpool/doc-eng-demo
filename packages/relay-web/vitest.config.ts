import { defineConfig } from "vitest/config";

// Plain node-environment tests (source scans). Deliberately does NOT reuse
// vite.config.ts — the cloudflare plugin there would boot workerd.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
