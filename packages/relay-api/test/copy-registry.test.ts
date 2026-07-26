// Phase 08: every copy entry stating a numeric fact declares
// references_facts — EXCEPT the UNDECLARED_FACT_REF seeds listed in
// fixtures/eval/defects.json. The test READS the defect file, so adding a
// seed requires declaring it there.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CopyEntrySchema, SeededDefectSchema, type CopyEntry } from "@relay/contracts";
import defectsFixture from "../../../fixtures/eval/defects.json";

const DEFECTS = z
  .object({ defects: z.array(SeededDefectSchema) })
  .parse(defectsFixture).defects;

const SEEDED_COPY_IDS = new Set(
  DEFECTS.filter((d) => d.class === "UNDECLARED_FACT_REF").map(
    (d) => d.doc_unit_id.split("#")[1] ?? "",
  ),
);

/** A copy text "states a number" when it contains a standalone numeric
 *  token outside interpolation placeholders. Digits inside alphanumeric
 *  product names (D1, R2, sha256) are not numeric claims. */
function statesANumber(entry: CopyEntry): boolean {
  const withoutPlaceholders = entry.text.replace(/\{\w+\}/g, "");
  return /(^|[^A-Za-z0-9])\d/.test(withoutPlaceholders);
}

async function fetchEntries(): Promise<CopyEntry[]> {
  const res = await SELF.fetch("https://example.com/api/copy-registry");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: unknown[] };
  return z.array(CopyEntrySchema).parse(body.entries);
}

describe("GET /api/copy-registry", () => {
  it("returns 60+ schema-valid entries covering all eight kinds", async () => {
    const entries = await fetchEntries();
    expect(entries.length).toBeGreaterThanOrEqual(60);
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds).toEqual(
      new Set([
        "tooltip", "empty_state", "onboarding", "error", "validation",
        "setting_description", "feature_availability", "label",
      ]),
    );
    // ids are unique
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("numeric copy declares references_facts, except the declared seeds", async () => {
    const entries = await fetchEntries();
    expect(SEEDED_COPY_IDS.size).toBeGreaterThanOrEqual(3);
    expect(SEEDED_COPY_IDS.size).toBeLessThanOrEqual(4);
    const offenders = entries.filter(
      (entry) =>
        statesANumber(entry) &&
        entry.references_facts.length === 0 &&
        !SEEDED_COPY_IDS.has(entry.id),
    );
    expect(offenders.map((e) => e.id)).toEqual([]);
    // The seeds themselves really are undeclared — otherwise they're not seeds.
    for (const id of SEEDED_COPY_IDS) {
      const seed = entries.find((e) => e.id === id);
      expect(seed, id).toBeDefined();
      expect(seed?.references_facts).toEqual([]);
      expect(statesANumber(seed as CopyEntry), id).toBe(true);
    }
  });

  it("interpolations in text are declared, and vice versa", async () => {
    const entries = await fetchEntries();
    for (const entry of entries) {
      const inText = [...entry.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(new Set(entry.interpolations), entry.id).toEqual(new Set(inText));
    }
  });
});
