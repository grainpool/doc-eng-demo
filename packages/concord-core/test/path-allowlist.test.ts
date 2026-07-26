// Phase 19 — the repository path allow/denylist (security.md §4.3,
// invariant I16). The DENYLIST is evaluated first and independently: a bug
// in the allowlist must not open a hole, and a path present in BOTH lists
// is denied. Every traversal variant is rejected individually. Only
// .md/.mdx/.json under the six allowed globs pass, and no path may resolve
// outside the estate repo.
import { describe, expect, it } from "vitest";
import { pathAllowlisted } from "../src/patch-validate.js";

describe("path allowlist (§4.3 / I16)", () => {
  it("only .md/.mdx/.json under the six allowed globs pass", () => {
    for (const path of [
      "docs-mintlify/supported-files.mdx",
      "docs-mintlify/nested/deep/page.mdx",
      "docs-mintlify/docs.json",
      "docs-mintlify/generated/cli/relay.mdx",
      "docs-mintlify/generated/fragment.json",
      "help-center/articles/upload-failed.md",
      "help-center/index.json",
      "in-product-copy/files.json",
    ]) {
      expect(pathAllowlisted(path), path).toBe(true);
    }
  });

  it("a path in BOTH lists is denied — the denylist wins", () => {
    // Matches the docs-mintlify/generated/** allowlist glob AND the
    // dotfile/extension denylist entries.
    for (const path of [
      "docs-mintlify/generated/.hidden.mdx", // allowlisted dir, dotfile
      "docs-mintlify/generated/evil.ts", // allowlisted dir, denied extension
      "docs-mintlify/generated/workflow.yml", // allowlisted dir, YAML denied
      "docs-mintlify/generated/package.json", // .json glob vs package.json denylist
      "help-center/pnpm-lock.yaml",
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });

  it(".github/** is rejected — repo 2 must NEVER grow CI", () => {
    for (const path of [
      ".github/workflows/deploy.yml",
      ".github/CODEOWNERS",
      "docs-mintlify/.github/x.mdx",
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });

  it("code, config, and credential file classes are rejected", () => {
    for (const path of [
      "docs-mintlify/page.ts",
      "docs-mintlify/page.tsx",
      "docs-mintlify/page.js",
      "help-center/script.py",
      "help-center/query.sql",
      "help-center/run.sh",
      "help-center/run.ps1",
      "docs-mintlify/config.yaml",
      "docs-mintlify/config.yml",
      "Dockerfile",
      "docs-mintlify/Dockerfile",
      "package.json",
      "pnpm-lock.yaml",
      "docs-mintlify/key.pem",
      ".env",
      "docs-mintlify/.env.production",
      ".gitignore",
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });

  it("each traversal variant is rejected individually (I16)", () => {
    for (const path of [
      "../packages/relay-api/src/limits.ts",
      "docs-mintlify/../../secrets.mdx",
      "docs-mintlify/..",
      "docs-mintlify/%2e%2e/escape.mdx",
      "docs-mintlify/%2E%2E%2Fescape.mdx",
      "/etc/passwd",
      "/docs-mintlify/absolute.mdx",
      "C:/estate/docs-mintlify/windows.mdx",
      "docs-mintlify\\backslash.mdx",
      "docs-mintlify/a\u0000b.mdx",
      "docs-mintlify//double-slash.mdx",
      "docs-mintlify/./dot-segment.mdx",
      "docs-mintlify/caf\u0065\u0301.mdx", // NFD unicode — normalization trick
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });

  it("paths outside the six surfaces are rejected even with clean extensions", () => {
    for (const path of [
      "cli-docs/relay.md", // generated surface — regen-only, not PR-writable
      "release-notes/README.md",
      "generated/availability-matrix.mdx",
      "estate/docs-mintlify/mounted.mdx", // the mount prefix never appears (I15)
      "README.md",
      "notes/scratch.md",
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });
});
