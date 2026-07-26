// Pre-commit secret scan (security.md §7). Greps STAGED content for
// secret-shaped strings; blocks the commit on any hit.
import { execFileSync } from "node:child_process";

const PATTERNS = [
  { name: "Anthropic API key", regex: /sk-ant-/ },
  { name: "PEM private key", regex: /-----BEGIN/ },
  { name: "GitHub token", regex: /ghp_/ },
  { name: "GitHub fine-grained token", regex: /github_pat_/ },
];

// Files whose SOURCE legitimately contains the pattern literals themselves
// (the scanner, the log redaction list, the leak-shape test assertions).
// Anything else matching a pattern blocks the commit.
const ALLOWLIST = new Set([
  "scripts/secret-scan.mjs",
  "packages/relay-api/src/log.ts",
  "packages/relay-api/test/health.test.ts",
  // The concord-api twin of the redaction list (Phase 20). Note what is NOT
  // here: documentation. A doc that needs the exemption is a doc that could
  // later carry a real key — SECURITY.md describes the patterns in prose
  // instead, and the redaction TEST assembles its samples from fragments.
  "packages/concord-api/src/log.ts",
]);

const stagedFiles = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

let failed = false;
for (const file of stagedFiles) {
  if (ALLOWLIST.has(file)) continue;
  let content;
  try {
    content = execFileSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    continue; // deleted/binary edge cases
  }
  for (const { name, regex } of PATTERNS) {
    if (regex.test(content)) {
      console.error(`secret-scan: ${name} pattern found in staged file: ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error("secret-scan: commit blocked. Remove the secret and try again.");
  process.exit(1);
}
