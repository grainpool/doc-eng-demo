import { mintlifyAdapter } from "./adapters/mintlify.js";
import { inproductAdapter } from "./adapters/inproduct.js";
import { helpcenterAdapter } from "./adapters/helpcenter.js";
import {
  clidocsAdapter,
  releaseAdapter,
  generatedAdapter,
} from "./adapters/generated-like.js";
import type { SurfaceAdapter } from "./types.js";

/** All six surface adapters, and glob-based file routing between them. */
export const ADAPTERS: SurfaceAdapter[] = [
  mintlifyAdapter,
  helpcenterAdapter,
  inproductAdapter,
  clidocsAdapter,
  releaseAdapter,
  generatedAdapter,
];

export function globToRegExp(glob: string): RegExp {
  const escapeLiteral = (s: string): string =>
    s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
  const source = glob.split("**/").map(escapeLiteral).join("(?:.*/)?");
  return new RegExp(`^${source}$`);
}

export function filesFor(
  adapter: SurfaceAdapter,
  files: ReadonlyArray<{ path: string; content: string }>,
): { path: string; content: string }[] {
  const patterns = adapter.ownedGlobs.map(globToRegExp);
  return files.filter((f) => patterns.some((p) => p.test(f.path)));
}

/** Parse the whole estate: every adapter over the files it owns. */
export function parseEstate(
  files: ReadonlyArray<{ path: string; content: string }>,
): ReturnType<SurfaceAdapter["parse"]> {
  return ADAPTERS.flatMap((adapter) => adapter.parse(filesFor(adapter, files)));
}
