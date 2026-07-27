// MISSING_COVERAGE — the absence detector. Synthetic cases pin the rules
// (feature granularity, hand-authored-only, capitalized-noun vocabulary);
// the real-estate case pins the actual production gap: Chat and Terminal
// shipped with zero hand-authored doc mentions, analysis_sessions is
// covered. Deterministic throughout — no model call anywhere.
import { describe, expect, it } from "vitest";
import type { FactClaim } from "@relay/contracts";
import { enabledFeatures, missingCoverageFindings } from "../src/coverage.js";
import { runPipeline } from "../src/pipeline.js";
import { readEstate } from "../cli/ingest.js";
import { evalSnapshot } from "../cli/eval-facts.js";
import type { DocUnit } from "../src/types.js";

const NOW = "1970-01-01T00:00:00.000Z";

function claim(key: string, value: unknown, tier: FactClaim["tier"] = "T3_CONFIG"): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator: "test", observed_at: NOW, confidence: 1 };
}

function unit(over: Partial<DocUnit>): DocUnit {
  return {
    id: "mintlify:docs-mintlify/x.mdx#page",
    surface: "mintlify",
    path: "docs-mintlify/x.mdx",
    anchor: null,
    title: "A page",
    body: "Some prose.",
    body_sha256: "0".repeat(64),
    audience: "end_user",
    editorial_register: "technical_reference",
    owner: "product-content",
    generated: false,
    frontmatter: {},
    ...over,
  };
}

const CHAT_WEB = "availability.feature.chat.platform.web";

describe("missingCoverageFindings", () => {
  it("fires for an enabled feature no hand-authored unit mentions", () => {
    const findings = missingCoverageFindings([claim(CHAT_WEB, true)], [unit({})]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "missing_coverage",
      fact_key: CHAT_WEB,
      doc_unit_id: null,
      projection_id: null,
      owner: "product",
    });
  });

  it("one capitalized mention anywhere satisfies the boolean", () => {
    const covered = unit({ body: "Open Chat from the sidebar." });
    expect(missingCoverageFindings([claim(CHAT_WEB, true)], [covered])).toHaveLength(0);
  });

  it("shell-sense lowercase 'terminal' does NOT count as coverage of Terminal", () => {
    const shellSense = unit({ body: "Run relay from your terminal." });
    const findings = missingCoverageFindings(
      [claim("availability.feature.terminal.platform.web", true)],
      [shellSense],
    );
    expect(findings).toHaveLength(1);
  });

  it("generated and in-product units cannot satisfy coverage", () => {
    const generated = unit({ generated: true, surface: "generated", body: "| chat | true |" });
    const inproduct = unit({ surface: "inproduct", body: "New Chat conversation" });
    expect(
      missingCoverageFindings([claim(CHAT_WEB, true)], [generated, inproduct]),
    ).toHaveLength(1);
  });

  it("disabled features are never checked", () => {
    const facts = [
      claim("availability.feature.connector_drive.platform.web", false),
      claim(CHAT_WEB, false),
    ];
    expect(missingCoverageFindings(facts, [unit({})])).toHaveLength(0);
  });

  it("T4 temporal claims cannot enable a feature (rolled-back launches stay dark)", () => {
    const t4 = claim("availability.feature.chat.platform.ios", true, "T4_RELEASE");
    expect(enabledFeatures([t4]).size).toBe(0);
  });

  it("feature granularity: multiple enabled platforms yield ONE finding", () => {
    const facts = [
      claim(CHAT_WEB, true),
      claim("availability.feature.chat.platform.cli", true),
    ];
    const findings = missingCoverageFindings(facts, [unit({})]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fact_key).toBe("availability.feature.chat.platform.cli"); // lexically first
    expect(findings[0]!.detail).toContain(CHAT_WEB);
  });

  it("word boundaries hold: 'Chatter' is not 'Chat'", () => {
    const nearMiss = unit({ body: "Chatter about features." });
    expect(missingCoverageFindings([claim(CHAT_WEB, true)], [nearMiss])).toHaveLength(1);
  });
});

describe("the real estate (the production gap, measured)", () => {
  const out = runPipeline({
    previous: evalSnapshot("snap_cov_prev"),
    current: evalSnapshot("snap_cov_cur"),
    files: readEstate().map((f) => ({ ...f, content: f.content.replaceAll("\r\n", "\n") })),
    detectedAt: NOW,
  });
  const coverage = out.findings.filter((f) => f.kind === "missing_coverage");

  it("chat and terminal are standing missing_coverage findings; nothing else is", () => {
    expect(coverage.map((f) => f.fact_key).sort()).toEqual([
      "availability.feature.chat.platform.web",
      "availability.feature.terminal.platform.web",
    ]);
  });

  it("covered analysis_sessions produces no finding (the negative control)", () => {
    expect(coverage.find((f) => f.fact_key.includes("analysis_sessions"))).toBeUndefined();
  });
});
