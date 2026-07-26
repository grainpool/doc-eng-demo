/**
 * `concord ingest --dry-run [--surface=X]` — lists every doc unit found per
 * surface with its deterministic, estate-relative id. This shell does the
 * I/O; all parsing is the pure adapters in src/.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintlifyAdapter } from "../src/adapters/mintlify.js";
import { inproductAdapter } from "../src/adapters/inproduct.js";
import { helpcenterAdapter } from "../src/adapters/helpcenter.js";
import {
  clidocsAdapter,
  releaseAdapter,
  generatedAdapter,
} from "../src/adapters/generated-like.js";
import type { SurfaceAdapter } from "../src/types.js";

const ESTATE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "estate",
);

export function readEstate(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        // ESTATE-RELATIVE paths with forward slashes — never the mount prefix.
        files.push({
          path: relative(ESTATE, full).replaceAll("\\", "/"),
          content: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(ESTATE);
  return files;
}

export const ADAPTERS: SurfaceAdapter[] = [
  mintlifyAdapter,
  helpcenterAdapter,
  inproductAdapter,
  clidocsAdapter,
  releaseAdapter,
  generatedAdapter,
];

function globToRegExp(glob: string): RegExp {
  const escapeLiteral = (s: string): string =>
    s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
  const source = glob.split("**/").map(escapeLiteral).join("(?:.*/)?");
  return new RegExp(`^${source}$`);
}

export function filesFor(
  adapter: SurfaceAdapter,
  files: { path: string; content: string }[],
): { path: string; content: string }[] {
  const patterns = adapter.ownedGlobs.map(globToRegExp);
  return files.filter((f) => patterns.some((p) => p.test(f.path)));
}

export function ingest(
  surface?: string,
): { surface: string; ids: string[] }[] {
  const files = readEstate();
  const out: { surface: string; ids: string[] }[] = [];
  for (const adapter of ADAPTERS) {
    if (surface && adapter.surface !== surface) continue;
    const units = adapter.parse(filesFor(adapter, files));
    out.push({ surface: adapter.surface, ids: units.map((u) => u.id) });
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  if (!args.includes("--dry-run")) {
    console.error("usage: concord-ingest --dry-run [--surface=<name>]");
    process.exitCode = 2;
    return;
  }
  const surfaceArg = args.find((a) => a.startsWith("--surface="))?.slice(10);
  for (const { surface, ids } of ingest(surfaceArg)) {
    console.log(`${surface}: ${ids.length} units`);
    for (const id of ids) console.log(`  ${id}`);
  }
}

if (process.argv[1]?.endsWith("ingest.js") || process.argv[1]?.endsWith("ingest.ts")) {
  main();
}
