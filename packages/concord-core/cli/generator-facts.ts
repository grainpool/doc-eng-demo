import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS, PRODUCT_CONFIG, type FactClaim } from "@relay/contracts";

/**
 * The fact set the ESTATE'S generated files are committed against: T3
 * config from PRODUCT_CONFIG, the T1 limits as enforced by relay-api's
 * limits.ts (mirrored literally here — Concord may not import relay-api,
 * invariant I13), and every T4 release record from fixtures/releases.json.
 * Used by scripts/regen-estate and by the estate-matches-generators test,
 * so both always agree byte-for-byte.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = "1970-01-01T00:00:00.000Z"; // pinned: facts, not observations

function claim(key: string, value: unknown, tier: FactClaim["tier"], locator: string): FactClaim {
  return { key, value: value as FactClaim["value"], tier, locator, observed_at: NOW, confidence: 1 };
}

interface ReleaseRecord {
  id: string;
  version: string;
  released_at: string;
  summary: string;
  changes: { fact_key: string; from: unknown; to: unknown; kind: string }[];
}

export function generatorFacts(): FactClaim[] {
  const facts: FactClaim[] = [
    claim("limit.upload.csv.max_bytes", 10_485_760, "T1_SCHEMA", "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_BYTES"),
    claim("limit.upload.csv.max_rows", 50_000, "T1_SCHEMA", "packages/relay-api/src/limits.ts#LIMIT_UPLOAD_CSV_MAX_ROWS"),
  ];
  for (const [feature, byPlatform] of Object.entries(PRODUCT_CONFIG.availability)) {
    for (const platform of PLATFORMS) {
      const value = (byPlatform as Record<string, boolean>)[platform];
      if (value === undefined) continue;
      facts.push(
        claim(
          `availability.feature.${feature}.platform.${platform}`,
          value,
          "T3_CONFIG",
          `packages/contracts/src/product-config.ts#availability.${feature}.${platform}`,
        ),
      );
    }
  }
  facts.push(
    claim("plan.feature.analysis_sessions.min_plan", PRODUCT_CONFIG.plans.analysis_sessions_min_plan, "T3_CONFIG", "packages/contracts/src/product-config.ts#plans"),
    claim("plan.feature.connector_drive.min_plan", PRODUCT_CONFIG.plans.connector_drive_min_plan, "T3_CONFIG", "packages/contracts/src/product-config.ts#plans"),
  );
  const releases = (
    JSON.parse(readFileSync(join(root, "fixtures", "releases.json"), "utf8")) as {
      releases: ReleaseRecord[];
    }
  ).releases;
  for (const release of releases) {
    facts.push(
      claim(
        `release.${release.id.replace(/^rel_/, "")}.changes`,
        {
          version: release.version,
          released_at: release.released_at,
          summary: release.summary,
          changes: release.changes,
        },
        "T4_RELEASE",
        `product-truth/releases#${release.id}`,
      ),
    );
  }
  return facts;
}
