// The failures page's "Blind spots observed in production" section renders
// FROM T5 coverage_observation decision records (product truth), keeps the
// two evidence classes visibly distinct, and is self-retiring: no records of
// that kind, no section. The committed real record must appear on the real
// page inputs.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coverageObservations,
  renderFailuresPage,
  type DecisionRecord,
  type EvalReport,
} from "../cli/failures-page.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const REPORT = JSON.parse(
  readFileSync(join(root, "eval-report.json"), "utf8"),
) as EvalReport;
const DECISIONS = (
  JSON.parse(readFileSync(join(root, "fixtures", "decisions.json"), "utf8")) as {
    decisions: DecisionRecord[];
  }
).decisions;

describe("failures page — blind spots observed in production", () => {
  it("renders the committed coverage_observation record from product truth", () => {
    const html = renderFailuresPage(REPORT, DECISIONS);
    expect(html).toContain("Blind spots observed in production");
    expect(html).toContain("dec_prose_coverage_deferral");
    // The statement text comes from the record, not from generator prose.
    expect(html).toContain("itself the detection.");
    expect(html).toContain("product-truth/decisions/2026-07-27-prose-coverage-deferral.yaml");
    // The evidence-class distinction is stated on the page.
    expect(html).toContain("seeded and measured");
    expect(html).toContain("human-attested");
  });

  it("is self-retiring: without coverage_observation records the section disappears", () => {
    const withoutObservations = DECISIONS.filter(
      (d) => d.kind !== "coverage_observation",
    );
    const html = renderFailuresPage(REPORT, withoutObservations);
    expect(html).not.toContain("Blind spots observed in production");
    // The measured sections are untouched either way.
    expect(html).toContain("What the system gets wrong");
    expect(html).toContain(`Misses (${REPORT.misses.length})`);
  });

  it("selects only coverage_observation records, never other decision kinds", () => {
    const selected = coverageObservations(DECISIONS);
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.every((d) => d.kind === "coverage_observation")).toBe(true);
    // The standing-conflict records (deliberate demo noise) stay out.
    expect(selected.find((d) => d.id === "dec_regression_flag_keep")).toBeUndefined();
  });

  it("the observation record claims no fact keys (no third standing conflict)", () => {
    const record = DECISIONS.find((d) => d.id === "dec_prose_coverage_deferral");
    expect(record).toBeDefined();
    expect(record!.claims_fact_keys).toEqual([]);
  });
});
