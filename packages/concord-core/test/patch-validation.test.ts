// Phase 14 — invariant I6: evidence is mandatory and mechanically verified.
// A zero-evidence patch is REJECTED (not warned); an unresolvable locator
// causes discard + reclassification; an undeclared fact key in the new body
// is rejected (anti-hallucination, AP5); the path allowlist holds against
// traversal tricks; requires_review is structural for model patches.
import { describe, expect, it } from "vitest";
import type { FactClaim, PatchProposal } from "@relay/contracts";
import { bodyContentSafe, pathAllowlisted, validatePatch } from "../src/patch-validate.js";
import { parsePatchProposal } from "../src/patch-prompts.js";
import { sha256Hex } from "../src/hash.js";
import type { DocUnit } from "../src/types.js";

const NOW = "2026-07-26T00:00:00.000Z";
const LOCATOR = "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES";

const FACTS: FactClaim[] = [
  {
    key: "limit.upload.csv.max_bytes",
    value: 26_214_400,
    tier: "T1_SCHEMA",
    locator: LOCATOR,
    observed_at: NOW,
    confidence: 1,
  },
  {
    key: "retention.artifact.days",
    value: 30,
    tier: "T3_CONFIG",
    locator: "packages/contracts/src/product-config.ts#retention.artifact_days",
    observed_at: NOW,
    confidence: 1,
  },
];

function unit(body = "Maximum file size: 10 MB."): DocUnit {
  return {
    id: "mintlify:docs-mintlify/supported-files.mdx#size-limits",
    surface: "mintlify",
    path: "docs-mintlify/supported-files.mdx",
    anchor: "size-limits",
    title: "Size limits",
    body,
    body_sha256: sha256Hex(body),
    audience: "developer",
    editorial_register: "technical_reference",
    owner: "docs",
    generated: false,
    frontmatter: {},
  };
}

function proposal(overrides: Partial<PatchProposal> = {}): PatchProposal {
  return {
    new_body: "Maximum file size: 25 MB.",
    evidence: [
      {
        fact_key: "limit.upload.csv.max_bytes",
        tier: "T1_SCHEMA",
        locator: LOCATOR,
        value: 26_214_400,
        observed_at: NOW,
      },
    ],
    changed_because: "limit.upload.csv.max_bytes rose from 10 MB to 25 MB.",
    editorial_risk: "none",
    needs_human_because: null,
    ...overrides,
  };
}

describe("patch validation gates (I6)", () => {
  it("a valid grounded proposal passes all four gates", () => {
    const verdict = validatePatch({ proposal: proposal(), unit: unit(), facts: FACTS, detectedAt: NOW });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.validation).toMatchObject({
        evidence_resolvable: true,
        introduces_no_new_facts: true,
        path_allowlisted: true,
      });
    }
  });

  it("gate a: a zero-evidence patch is REJECTED, not warned", () => {
    // The contract schema itself refuses evidence: [] — and so does the gate.
    const zeroEvidence = { ...proposal(), evidence: [] };
    const verdict = validatePatch({
      proposal: zeroEvidence as unknown as PatchProposal,
      unit: unit(),
      facts: FACTS,
      detectedAt: NOW,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("gate_a");
      expect(verdict.reclassify_to).toBe("UNRESOLVED_CONFLICT");
    }
  });

  it("gate a: an unresolvable locator causes discard + reclassification", () => {
    const bad = proposal();
    (bad.evidence[0] as { locator: string }).locator = "packages/nowhere.ts#GONE";
    const verdict = validatePatch({ proposal: bad, unit: unit(), facts: FACTS, detectedAt: NOW });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("unresolvable");
      expect(verdict.reclassify_to).toBe("UNRESOLVED_CONFLICT");
    }
  });

  it("gate b: a body asserting an undeclared fact key is rejected (anti-hallucination)", () => {
    const hallucinating = proposal({
      // 30 days matches retention.artifact.days — NOT in the evidence set.
      new_body: "Maximum file size: 25 MB. Files are kept for 30 days after upload too.",
    });
    const verdict = validatePatch({ proposal: hallucinating, unit: unit(), facts: [FACTS[0] as FactClaim, { ...(FACTS[1] as FactClaim) }], detectedAt: NOW });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("gate_b");
  });

  it("gate b: removing the evidence item for an asserted fact flips accept → reject", () => {
    // Same body; with evidence it passes, without it it is rejected.
    const withEvidence = validatePatch({ proposal: proposal(), unit: unit(), facts: FACTS, detectedAt: NOW });
    expect(withEvidence.ok).toBe(true);
    const without = proposal({
      evidence: [
        {
          fact_key: "retention.artifact.days",
          tier: "T3_CONFIG",
          locator: "packages/contracts/src/product-config.ts#retention.artifact_days",
          value: 30,
          observed_at: NOW,
        },
      ],
    });
    const verdict = validatePatch({ proposal: without, unit: unit(), facts: FACTS, detectedAt: NOW });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("limit.upload.csv.max_bytes");
  });

  it("editorial_risk structure/meaning forces EDITORIAL_REVIEW", () => {
    for (const risk of ["structure", "meaning"] as const) {
      const verdict = validatePatch({
        proposal: proposal({ editorial_risk: risk }),
        unit: unit(),
        facts: FACTS,
        detectedAt: NOW,
      });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.force_editorial).toBe(true);
    }
  });

  it("dangerous MDX constructs in a model body are rejected", () => {
    for (const body of [
      "Fine text <script>alert(1)</script>",
      "<iframe src='https://otonieltrejo.com'></iframe>",
      "click [here](javascript:alert(1))",
      "img with onerror=alert(1)",
      "import Evil from 'evil'",
    ]) {
      expect(bodyContentSafe(body), body).toBe(false);
    }
    expect(bodyContentSafe("Maximum file size: 25 MB. See [docs](/supported-files).")).toBe(true);
  });

  it("the contract schema refuses zero evidence at parse time (min 1 is load-bearing)", () => {
    expect(() =>
      parsePatchProposal(
        JSON.stringify({
          new_body: "x",
          evidence: [],
          changed_because: "y",
          editorial_risk: "none",
          needs_human_because: null,
        }),
      ),
    ).toThrow();
  });
});

describe("path allowlist (security.md §4.3)", () => {
  it("allows exactly the documentation surfaces", () => {
    for (const path of [
      "docs-mintlify/supported-files.mdx",
      "docs-mintlify/docs.json",
      "docs-mintlify/generated/cli/relay.mdx",
      "help-center/articles/upload-failed.md",
      "help-center/index.json",
      "in-product-copy/files.json",
    ]) {
      expect(pathAllowlisted(path), path).toBe(true);
    }
  });

  it("denylist wins over allowlist, and traversal tricks are rejected", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      "docs-mintlify/.hidden.mdx",
      "docs-mintlify/evil.ts",
      "docs-mintlify/deploy.yml",
      "in-product-copy/package.json",
      "help-center/../../../etc/passwd",
      "docs-mintlify/%2e%2e/secrets.mdx",
      "/etc/passwd",
      "C:/windows/system32.mdx",
      "docs-mintlify\\windows.mdx",
      "docs-mintlify/a\u0000b.mdx",
      "product-truth/releases/new.yaml",
      "estate/docs-mintlify/mounted.mdx",
      "packages/concord-api/wrangler.jsonc",
      "Dockerfile",
      "pnpm-lock.yaml",
      ".env.production",
    ]) {
      expect(pathAllowlisted(path), path).toBe(false);
    }
  });
});
