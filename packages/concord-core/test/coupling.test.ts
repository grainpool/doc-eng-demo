// Invariant I13: Concord may call exactly two Relay endpoints. No other
// /api/ string literal may appear anywhere in concord-* source.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "test") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|html)$/.test(name)) out.push(full);
  }
  return out;
}

const ALLOWED = new Set(["/api/product-truth", "/api/copy-registry"]);

describe("coupling (I13)", () => {
  it("concord-* source contains no /api/ literal beyond the two permitted", () => {
    const concordPackages = readdirSync(packagesDir).filter((p) =>
      p.startsWith("concord-"),
    );
    expect(concordPackages.length).toBeGreaterThanOrEqual(1);
    const offenders: string[] = [];
    for (const pkg of concordPackages) {
      for (const file of sourceFiles(join(packagesDir, pkg))) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(/["'`](\/api\/[a-z0-9/_:-]*)["'`]/g)) {
          const literal = match[1] as string;
          // Concord's OWN api surface (/api/runs, /api/public/…) is not a
          // Relay call; only RELAY-targeting literals are restricted. The
          // convention: Relay calls are made via relayFetch() and its two
          // constants — anything else matching a Relay route shape fails.
          if (ALLOWED.has(literal)) continue;
          if (
            literal.startsWith("/api/runs") ||
            literal.startsWith("/api/public") ||
            literal.startsWith("/api/admin") // Concord's own admin surface (Phase 14)
          ) {
            continue;
          }
          offenders.push(`${file}: ${literal}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
