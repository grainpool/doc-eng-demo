import { PRODUCT_CONFIG, type FactClaim } from "@relay/contracts";
import type { TierResolver } from "./types.js";

const CONFIG_FILE = "packages/contracts/src/product-config.ts";

export const t3Config: TierResolver = {
  tier: "T3_CONFIG",
  async resolve() {
    return { status: "ok" as const, claims: await claims() };
  },
};

function claims(): Promise<FactClaim[]> {
    const observedAt = new Date().toISOString();
    const claim = (key: string, value: string | number | boolean, anchor: string): FactClaim => ({
      key,
      value,
      tier: "T3_CONFIG",
      locator: `${CONFIG_FILE}#${anchor}`,
      observed_at: observedAt,
      confidence: 1,
    });

    const { terminology, availability, plans, retention, flags } = PRODUCT_CONFIG;

    const claims: FactClaim[] = [
      claim("term.canonical.task", terminology.task, "terminology.task"),
      claim("term.canonical.project", terminology.project, "terminology.project"),
      claim("term.canonical.artifact", terminology.artifact, "terminology.artifact"),
      ...Object.entries(availability.analysis_sessions).map(([platform, enabled]) =>
        claim(
          `availability.feature.analysis_sessions.platform.${platform}`,
          enabled,
          `availability.analysis_sessions.${platform}`,
        ),
      ),
      claim(
        "availability.feature.connector_drive.platform.web",
        availability.connector_drive.web,
        "availability.connector_drive.web",
      ),
      claim(
        "plan.feature.analysis_sessions.min_plan",
        plans.analysis_sessions_min_plan,
        "plans.analysis_sessions_min_plan",
      ),
      claim(
        "plan.feature.connector_drive.min_plan",
        plans.connector_drive_min_plan,
        "plans.connector_drive_min_plan",
      ),
      claim("retention.artifact.days", retention.artifact_days, "retention.artifact_days"),
      claim(
        "retention.uploaded_file.days",
        retention.uploaded_file_days,
        "retention.uploaded_file_days",
      ),
      claim(
        "flag.analysis.regression_enabled",
        flags.analysis_regression_enabled,
        "flags.analysis_regression_enabled",
      ),
    ];
    return Promise.resolve(claims);
}
