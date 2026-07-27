// Phase 02 acceptance test (validation.md §2): every registry key has exactly
// one tier; templated families match expected keys and reject near-misses; no
// duplicate keys; ProductTruthSnapshot round-trips.
import { describe, expect, it } from "vitest";
import {
  CONTRACTS_VERSION,
  FACT_REGISTRY,
  TEMPLATED_FAMILIES,
  matchFactKey,
  ProductTruthSnapshotSchema,
  OPERATION_IDS,
  buildDocUnitId,
  parseDocUnitId,
  newId,
  ulid,
} from "../src/index.js";
import pkg from "../package.json";

describe("FACT_REGISTRY", () => {
  it("every literal key maps to exactly one tier (no key claimed twice)", () => {
    for (const key of Object.keys(FACT_REGISTRY)) {
      const literalEntry = FACT_REGISTRY[key as keyof typeof FACT_REGISTRY];
      expect(literalEntry.tier).toBeTruthy();
      // No templated family may ALSO claim a literal key — that would make a
      // fact authoritative in two tiers (a schema ambiguity, forbidden).
      const templatedClaims = TEMPLATED_FAMILIES.filter((f) => f.matches(key));
      expect(templatedClaims, `literal key ${key} also matched a template`).toHaveLength(0);
    }
  });

  it("has no duplicate keys (object literal collapses them — assert count)", () => {
    const keys = Object.keys(FACT_REGISTRY);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(29); // 23 frozen at 1.0.0 + 6 expansion keys (1.4.0)
  });

  it("templated families are mutually exclusive on their own example keys", () => {
    const examples = [
      "analysis.operation.linear_regression.enabled",
      "cli.command.projects.list.flags",
      "cli.command.projects.list.summary",
    ];
    for (const key of examples) {
      expect(TEMPLATED_FAMILIES.filter((f) => f.matches(key))).toHaveLength(1);
    }
  });

  it("matchFactKey resolves every operation's enabled key to T0_RUNTIME", () => {
    for (const opId of OPERATION_IDS) {
      const entry = matchFactKey(`analysis.operation.${opId}.enabled`);
      expect(entry?.tier).toBe("T0_RUNTIME");
    }
  });

  it("matchFactKey resolves cli command keys to T2_CLI", () => {
    expect(matchFactKey("cli.command.projects.list.flags")?.tier).toBe("T2_CLI");
    expect(matchFactKey("cli.command.introspect.summary")?.tier).toBe("T2_CLI");
  });

  it("rejects near-misses", () => {
    expect(matchFactKey("analysis.operation.eval_code.enabled")).toBeNull(); // not a real op
    expect(matchFactKey("analysis.operation..enabled")).toBeNull();
    expect(matchFactKey("cli.command..flags")).toBeNull();
    expect(matchFactKey("cli.command.projects list.flags")).toBeNull(); // spaces forbidden
    expect(matchFactKey("cli.command.projects.list.usage")).toBeNull(); // only flags|summary
    expect(matchFactKey("limit.upload.csv.max_bytes.extra")).toBeNull();
    expect(matchFactKey("totally.unregistered.key")).toBeNull();
  });
});

describe("ProductTruthSnapshot", () => {
  it("round-trips through Zod", () => {
    const snapshot = {
      snapshot_id: `snap_${ulid()}`,
      generated_at: new Date().toISOString(),
      relay_contracts_version: CONTRACTS_VERSION,
      facts: [
        {
          key: "limit.upload.csv.max_bytes",
          value: 10485760,
          tier: "T1_SCHEMA",
          locator: "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES",
          observed_at: new Date().toISOString(),
          confidence: 1,
        },
      ],
    };
    const parsed = ProductTruthSnapshotSchema.parse(snapshot);
    expect(ProductTruthSnapshotSchema.parse(parsed)).toEqual(parsed);
  });
});

describe("CONTRACTS_VERSION", () => {
  it("matches package.json (single source cannot drift)", () => {
    expect(CONTRACTS_VERSION).toBe(pkg.version);
  });
});

describe("ids", () => {
  it("newId produces prefixed lowercase sortable ids", () => {
    const a = newId("prj");
    const b = newId("prj");
    expect(a).toMatch(/^prj_[0-9abcdefghjkmnpqrstvwxyz]{26}$/);
    expect(a).not.toBe(b);
  });

  it("doc-unit ids build, parse, and refuse the estate/ mount prefix (G22)", () => {
    const id = buildDocUnitId({
      surface: "mintlify",
      path: "docs-mintlify/supported-files.mdx",
      anchor: "file-size-limits",
    });
    expect(id).toBe("mintlify:docs-mintlify/supported-files.mdx#file-size-limits");
    expect(parseDocUnitId(id)).toEqual({
      surface: "mintlify",
      path: "docs-mintlify/supported-files.mdx",
      anchor: "file-size-limits",
    });
    expect(() =>
      buildDocUnitId({ surface: "mintlify", path: "estate/docs-mintlify/x.mdx", anchor: null }),
    ).toThrow();
    expect(() => parseDocUnitId("mintlify:estate/docs-mintlify/x.mdx#a")).toThrow();
  });
});
