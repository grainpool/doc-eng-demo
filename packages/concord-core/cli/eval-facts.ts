import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLATFORMS,
  PRODUCT_CONFIG,
  type FactClaim,
  type ProductTruthSnapshot,
} from "@relay/contracts";
import { generatorFacts } from "./generator-facts.js";

/**
 * The eval snapshot: the FULL current product truth as the local harness
 * can know it — T1 limits/support, all of T3 (terms, availability, plans,
 * retention, flags), T4 releases, T5 decisions. T0/T2 runtime facts are
 * live-only and out of eval scope (their absence merely appears in the
 * undocumented-facts baseline, which the harness subtracts).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "1970-01-01T00:00:00.000Z";

function claim(key: string, value: unknown, tier: FactClaim["tier"], locator: string): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator, observed_at: NOW, confidence: 1 };
}

export function evalFacts(): FactClaim[] {
  const facts = generatorFacts(); // T1 limits + T3 availability/plans + T4 releases
  facts.push(
    claim("support.file_type.csv", true, "T1_SCHEMA", "packages/relay-api/src/limits.ts#ACCEPTED_EXTENSIONS"),
    claim("support.file_type.tsv", true, "T1_SCHEMA", "packages/relay-api/src/limits.ts#ACCEPTED_EXTENSIONS"),
    claim("support.file_type.xlsx", false, "T1_SCHEMA", "packages/relay-api/src/limits.ts#ACCEPTED_EXTENSIONS"),
  );
  for (const [name, term] of Object.entries(PRODUCT_CONFIG.terminology)) {
    facts.push(claim(`term.canonical.${name}`, term, "T3_CONFIG", `packages/contracts/src/product-config.ts#terminology.${name}`));
  }
  facts.push(
    claim("retention.artifact.days", PRODUCT_CONFIG.retention.artifact_days, "T3_CONFIG", "packages/contracts/src/product-config.ts#retention.artifact_days"),
    claim("retention.uploaded_file.days", PRODUCT_CONFIG.retention.uploaded_file_days, "T3_CONFIG", "packages/contracts/src/product-config.ts#retention.uploaded_file_days"),
    claim("flag.analysis.regression_enabled", PRODUCT_CONFIG.flags.analysis_regression_enabled, "T3_CONFIG", "packages/contracts/src/product-config.ts#flags"),
  );
  void PLATFORMS;
  interface DecisionRecord {
    id: string;
    source_file: string;
    decided_at: string;
    claims_fact_keys: string[];
    statement: string;
  }
  const decisions = (
    JSON.parse(readFileSync(join(root, "fixtures", "decisions.json"), "utf8")) as {
      decisions: DecisionRecord[];
    }
  ).decisions;
  for (const decision of decisions) {
    facts.push(
      claim(
        `decision.${decision.id.replace(/^dec_/, "")}.record`,
        {
          decided_at: decision.decided_at,
          claims_fact_keys: decision.claims_fact_keys,
          statement: decision.statement,
        },
        "T5_HUMAN",
        `${decision.source_file}#statement`,
      ),
    );
  }
  return facts;
}

export function evalSnapshot(id: string): ProductTruthSnapshot {
  return {
    snapshot_id: id,
    generated_at: NOW,
    relay_contracts_version: "1.2.0",
    facts: evalFacts(),
  };
}
