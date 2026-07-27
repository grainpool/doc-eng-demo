/**
 * T3_CONFIG — declared product configuration: platform availability, plan
 * gating, retention, canonical terminology, feature flags. This file is the
 * authoritative source for every fact the registry assigns to T3_CONFIG.
 * Deliberately NOT one YAML holding all product truth (constraints.md AP1):
 * T1 lives with the code that enforces it, T0 in the running container,
 * T2 in the live CLI tree.
 */

export const PLANS = ["free", "pro", "team"] as const;
export type Plan = (typeof PLANS)[number];

export const PLATFORMS = ["web", "ios", "android", "cli"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PRODUCT_CONFIG = Object.freeze({
  terminology: Object.freeze({
    task: "Task",
    project: "Project",
    artifact: "Artifact",
  }),
  availability: Object.freeze({
    analysis_sessions: Object.freeze({
      web: true,
      ios: false,
      android: false,
      cli: true,
    }),
    connector_drive: Object.freeze({
      web: false,
    }),
    // Expansion surfaces (contracts 1.4.0). False until the phase that ships
    // each surface flips it — availability facts must never lead the product.
    chat: Object.freeze({
      web: false,
      ios: false,
      android: false,
      cli: false,
    }),
    terminal: Object.freeze({
      web: false,
    }),
  }),
  plans: Object.freeze({
    analysis_sessions_min_plan: "free" as Plan,
    connector_drive_min_plan: "team" as Plan,
  }),
  retention: Object.freeze({
    artifact_days: 30,
    uploaded_file_days: 30,
  }),
  flags: Object.freeze({
    analysis_regression_enabled: true,
  }),
});
