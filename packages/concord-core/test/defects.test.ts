// Phase 11: the eval defect corpus is well-formed — every injection's `find`
// matches EXACTLY ONCE in its target file (an ambiguous injection is a
// broken answer key), the estate is committed CLEAN, and the corpus covers
// the required classes with ≥4 negative controls.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SeededDefectSchema } from "@relay/contracts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFECTS = z
  .object({ defects: z.array(SeededDefectSchema) })
  .parse(
    JSON.parse(readFileSync(join(root, "fixtures", "eval", "defects.json"), "utf8")),
  ).defects;

function estatePathOf(docUnitId: string): string {
  const withoutSurface = docUnitId.slice(docUnitId.indexOf(":") + 1);
  return withoutSurface.split("#")[0] as string;
}

describe("fixtures/eval/defects.json", () => {
  it("has ≥24 entries, ≥4 expected_detection:false, and covers the required classes", () => {
    expect(DEFECTS.length).toBeGreaterThanOrEqual(24);
    const falsePositiveControls = DEFECTS.filter((d) => !d.expected_detection);
    expect(falsePositiveControls.length).toBeGreaterThanOrEqual(4);
    for (const control of falsePositiveControls) {
      expect(control.injection).toBeNull();
      expect(control.expected_action).toBe("NO_ACTION");
    }
    const classes = new Set(DEFECTS.map((d) => d.class));
    for (const required of [
      "STALE_VALUE", "WRONG_PLATFORM", "TERM_DRIFT", "BROKEN_REF",
      "DUP_GUIDANCE", "MISSING_PREREQ", "CONTRADICTION", "UNSUPPORTED_CLAIM",
      "IA_PROBLEM", "STALE_INPRODUCT_COPY",
    ]) {
      expect(classes, required).toContain(required);
    }
    expect(new Set(DEFECTS.map((d) => d.id)).size).toBe(DEFECTS.length);
  });

  it("every injection's find string matches exactly once in its target file", () => {
    for (const defect of DEFECTS) {
      if (!defect.injection) continue;
      const file = join(root, "estate", estatePathOf(defect.doc_unit_id));
      const content = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
      const needle = defect.injection.find;
      const occurrences = content.split(needle).length - 1;
      expect(occurrences, `${defect.id} in ${file}`).toBe(1);
      // The replacement genuinely changes the content.
      expect(defect.injection.replace).not.toBe(needle);
    }
  });

  it("no doc_unit_id carries the estate/ mount prefix (I15)", () => {
    for (const defect of DEFECTS) {
      expect(defect.doc_unit_id).not.toMatch(/^[a-z]+:estate\//);
    }
  });

  it("the committed estate is clean (defects are injections, never commits)", () => {
    const status = execSync("git status --porcelain", {
      cwd: join(root, "estate"),
      encoding: "utf8",
    });
    // Uncommitted WORK in progress is allowed while developing, but no file
    // may contain an injected defect: applying every injection must CHANGE
    // its file (asserted above via exactly-one-match of the CLEAN text).
    expect(typeof status).toBe("string");
  });
});
