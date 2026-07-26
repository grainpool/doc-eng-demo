// Phase 18 (grep-based): the production concord-api sources contain no
// dev-auth bypass and import no dev middleware. Lives in concord-core
// because this suite has real filesystem access (node environment).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("no dev-auth bypass in concord-api production sources", () => {
  it("src/ has no bypass branch and no dev middleware", () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "concord-api", "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts")) files.push(full);
      }
    };
    walk(srcDir);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/access-dev|DEV_BYPASS|bypassAccess/i);
      expect(content, file).not.toMatch(/if\s*\(.*(dev|DEV).*\)\s*(return\s+next|await\s+next)/);
    }
    // And the middleware itself never skips verification on a header alone.
    const middleware = readFileSync(join(srcDir, "middleware", "access.ts"), "utf8");
    expect(middleware).toContain("jwtVerify");
    expect(middleware).toContain("issuer");
    expect(middleware).toContain("audience");
  });
});
