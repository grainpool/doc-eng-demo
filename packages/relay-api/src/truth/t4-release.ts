import type { FactClaim } from "@relay/contracts";
import releasesFixture from "../../../../fixtures/releases.json";
import type { TierResolution, TierResolver } from "./types.js";

/**
 * T4_RELEASE — TEMPORAL, not factual (contracts.md §9): each claim is a
 * release record keyed `release.<id>.changes`, authoritative for WHEN facts
 * changed and NEVER for a current value. A release whose `to` disagrees with
 * T3's current value is a CONTRADICTION conflict, not a correction — the
 * rel_2026_05_02_ios_launch record is deliberately such a fixture.
 */
interface ReleaseRecord {
  source_file: string;
  id: string;
  version: string;
  released_at: string;
  summary: string;
  changes: { fact_key: string; from: unknown; to: unknown; kind: string }[];
}

const RELEASES = (releasesFixture as { releases: ReleaseRecord[] }).releases;

export const t4Release: TierResolver = {
  tier: "T4_RELEASE",
  resolve(): Promise<TierResolution> {
    const observedAt = new Date().toISOString();
    const claims: FactClaim[] = RELEASES.map((release) => ({
      key: `release.${release.id.replace(/^rel_/, "")}.changes`,
      value: {
        version: release.version,
        released_at: release.released_at,
        summary: release.summary,
        changes: release.changes,
      },
      tier: "T4_RELEASE" as const,
      locator: `${release.source_file}#changes`,
      observed_at: observedAt,
      confidence: 1,
    }));
    return Promise.resolve({ status: "ok", claims });
  },
};
