import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// One Vite project builds both halves: the React client and the relay-api
// Worker (config in ../relay-api/wrangler.jsonc). React runs through Vite's
// built-in esbuild JSX transform — no framework plugin needed.
// fs.allow: the copy registry (estate submodule) and design/theme.json are
// imported from outside the package root at build time.
export default defineConfig({
  plugins: [cloudflare({ configPath: "../relay-api/wrangler.jsonc" })],
  server: {
    fs: { allow: ["../.."] },
  },
});
