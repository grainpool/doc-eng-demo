// Phase 11 golden tests: the committed estate in, committed expected unit
// lists out. Doc-unit ids must be identical across two runs; a change that
// alters ids must update the golden file in the same commit (run with
// GOLDEN_UPDATE=1 to regenerate). Also: patch() throws on generated units,
// and the mount prefix is rejected at the adapter boundary (I15).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADAPTERS, filesFor, readEstate } from "../cli/ingest.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden");

interface GoldenUnit {
  id: string;
  path: string;
  anchor: string | null;
  title: string;
  generated: boolean;
}

describe.each(ADAPTERS.map((a) => [a.surface, a] as const))(
  "%s adapter",
  (surface, adapter) => {
    const estate = readEstate();
    const files = filesFor(adapter, estate);

    it("matches its committed golden unit list, stable across two runs", () => {
      const toGolden = (): GoldenUnit[] =>
        adapter.parse(files).map((u) => ({
          id: u.id,
          path: u.path,
          anchor: u.anchor,
          title: u.title,
          generated: u.generated,
        }));
      const one = toGolden();
      const two = toGolden();
      expect(JSON.stringify(two)).toBe(JSON.stringify(one)); // id stability
      expect(one.length).toBeGreaterThan(0);
      for (const unit of one) {
        expect(unit.id.startsWith(`${surface}:`)).toBe(true);
        expect(unit.id).not.toContain("estate/"); // I15
      }

      const goldenPath = join(GOLDEN_DIR, `${surface}.expected-units.json`);
      if (process.env.GOLDEN_UPDATE === "1") {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, `${JSON.stringify(one, null, 2)}\n`);
      }
      expect(existsSync(goldenPath), `${goldenPath} missing — run GOLDEN_UPDATE=1`).toBe(true);
      expect(one).toEqual(JSON.parse(readFileSync(goldenPath, "utf8")));
    });

    it("rejects mount-prefixed paths (I15)", () => {
      expect(() =>
        adapter.parse([{ path: "estate/whatever.mdx", content: "x" }]),
      ).toThrow(/mount prefix/);
    });
  },
);

describe("patch() on generated units", () => {
  it("throws for every generated unit of every adapter (G8)", () => {
    const estate = readEstate();
    let generatedSeen = 0;
    for (const adapter of ADAPTERS) {
      for (const unit of adapter.parse(filesFor(adapter, estate))) {
        if (unit.generated) {
          generatedSeen++;
          expect(() => adapter.patch(unit, "new body")).toThrow(/generated/);
        }
      }
    }
    expect(generatedSeen).toBeGreaterThanOrEqual(4); // cli-docs, release-notes, generated, cli-reference, changelog
  });
});
