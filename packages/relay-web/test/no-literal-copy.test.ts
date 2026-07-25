// Phase 03 acceptance test (validation.md §2): no user-visible literal in JSX
// text nodes anywhere in relay-web source. Every string renders via t() from
// the copy registry (constraints.md AP8). This scan was verified to FAIL on a
// deliberately planted literal (<h1>Projects</h1>) before shipping.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * Finds JSX text nodes: content between a closing `>` and the next `<` that
 * contains a letter. Expressions ({...}), whitespace, and punctuation-only
 * separators are not violations.
 */
function findLiteralTextNodes(source: string): string[] {
  const violations: string[] = [];
  const textNode = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
  for (const match of source.matchAll(textNode)) {
    const text = (match[1] ?? "").trim();
    if (text.length === 0) continue;
    // Generic type parameters and expression fragments also match the regex
    // (`useState<LoadState>(null); ...<`). Prose copy never contains these
    // code characters, so their presence marks a non-JSX match.
    if (/[;=()[\]]/.test(text)) continue;
    violations.push(text);
  }
  return violations;
}

describe("no user-visible literals in JSX", () => {
  it("every JSX text node with letters comes from t(), not a literal", () => {
    const offenders: Record<string, string[]> = {};
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const found = findLiteralTextNodes(source);
      if (found.length > 0) offenders[file] = found;
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual({});
  });
});
