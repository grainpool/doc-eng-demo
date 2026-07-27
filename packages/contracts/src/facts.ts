import { z } from "zod";
import { FACT_TIERS, type FactTier } from "./product-truth.js";
import { OPERATION_IDS } from "./operations.js";

/**
 * The fact-key registry (contracts.md §3.1). Frozen: Concord's authority
 * arbitration reads it, and no fact may be authoritative in two tiers.
 */

export const FACT_VALUE_TYPES = [
  "integer",
  "boolean",
  "semver",
  "term",
  "string",
  "json",
  "enum:plan",
] as const;

export type FactValueType = (typeof FACT_VALUE_TYPES)[number];

export interface FactRegistryEntry {
  tier: FactTier;
  valueType: FactValueType;
  owner: string; // a role, not a person; appears in escalations
}

export const FACT_REGISTRY = Object.freeze({
  "limit.upload.csv.max_bytes":  { tier: "T1_SCHEMA", valueType: "integer", owner: "eng-platform" },
  "limit.upload.csv.max_rows":   { tier: "T1_SCHEMA", valueType: "integer", owner: "eng-platform" },
  "support.file_type.csv":       { tier: "T1_SCHEMA", valueType: "boolean", owner: "eng-platform" },
  "support.file_type.tsv":       { tier: "T1_SCHEMA", valueType: "boolean", owner: "eng-platform" },
  "support.file_type.xlsx":      { tier: "T1_SCHEMA", valueType: "boolean", owner: "eng-platform" },
  "runtime.package.pandas.version":      { tier: "T0_RUNTIME", valueType: "semver", owner: "eng-platform" },
  "runtime.package.scipy.version":       { tier: "T0_RUNTIME", valueType: "semver", owner: "eng-platform" },
  "runtime.package.statsmodels.version": { tier: "T0_RUNTIME", valueType: "semver", owner: "eng-platform" },
  "runtime.package.matplotlib.version":  { tier: "T0_RUNTIME", valueType: "semver", owner: "eng-platform" },
  "runtime.python.version":              { tier: "T0_RUNTIME", valueType: "semver", owner: "eng-platform" },
  "term.canonical.task":     { tier: "T3_CONFIG", valueType: "term", owner: "product-content" },
  "term.canonical.project":  { tier: "T3_CONFIG", valueType: "term", owner: "product-content" },
  "term.canonical.artifact": { tier: "T3_CONFIG", valueType: "term", owner: "product-content" },
  "availability.feature.analysis_sessions.platform.web":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.ios":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.android": { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.analysis_sessions.platform.cli":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.connector_drive.platform.web":       { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  // 1.4.0 (expansion Phase 1): Chat and browser-Terminal surfaces. Values stay
  // false in PRODUCT_CONFIG until the phase that ships each surface flips them.
  "availability.feature.chat.platform.web":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.chat.platform.ios":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.chat.platform.android": { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.chat.platform.cli":     { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "availability.feature.terminal.platform.web": { tier: "T3_CONFIG", valueType: "boolean", owner: "product" },
  "limit.chat.message.max_chars": { tier: "T1_SCHEMA", valueType: "integer", owner: "eng-platform" },
  "plan.feature.analysis_sessions.min_plan": { tier: "T3_CONFIG", valueType: "enum:plan", owner: "product" },
  "plan.feature.connector_drive.min_plan":   { tier: "T3_CONFIG", valueType: "enum:plan", owner: "product" },
  "retention.artifact.days":       { tier: "T3_CONFIG", valueType: "integer", owner: "product" },
  "retention.uploaded_file.days":  { tier: "T3_CONFIG", valueType: "integer", owner: "product" },
  "flag.analysis.regression_enabled": { tier: "T3_CONFIG", valueType: "boolean", owner: "eng-analysis" },
} as const satisfies Record<string, FactRegistryEntry>);

export type RegisteredFactKey = keyof typeof FACT_REGISTRY;

/**
 * Templated families (contracts.md §3.1): a matcher, not 40 literal keys.
 * Command paths are encoded dot-separated (`cli.command.projects.list.flags`)
 * because the fact-key grammar (§3.1) forbids spaces; the T2 resolver encodes
 * `"projects list"` → `projects.list` (Phase 07).
 */
export interface TemplatedFamily {
  family: string;
  tier: FactTier;
  valueType: FactValueType;
  owner: string;
  /** Returns true when `key` belongs to this family and is well-formed. */
  matches(key: string): boolean;
}

const OP_ID_SET: ReadonlySet<string> = new Set(OPERATION_IDS);

export const TEMPLATED_FAMILIES: readonly TemplatedFamily[] = Object.freeze([
  {
    family: "analysis.operation.<op_id>.enabled",
    tier: "T0_RUNTIME",
    valueType: "boolean",
    owner: "eng-analysis",
    matches(key: string): boolean {
      const m = /^analysis\.operation\.([a-z_]+)\.enabled$/.exec(key);
      return m !== null && OP_ID_SET.has(m[1] as string);
    },
  },
  {
    family: "cli.command.<command_path>.flags",
    tier: "T2_CLI",
    valueType: "json",
    owner: "eng-platform",
    matches(key: string): boolean {
      return /^cli\.command\.([a-z0-9_-]+)(\.[a-z0-9_-]+)*\.flags$/.test(key);
    },
  },
  {
    // T4 is TEMPORAL: a release record is authoritative for WHEN something
    // changed, never for a current value — so release claims live under
    // their own keys and can never collide with a T1/T3 key's authority.
    family: "release.<release_id>.changes",
    tier: "T4_RELEASE",
    valueType: "json",
    owner: "product",
    matches(key: string): boolean {
      return /^release\.[a-z0-9_-]+\.changes$/.test(key);
    },
  },
  {
    // T5 records claim a fact key only where the record explicitly says so;
    // the claim key itself is always the decision's own.
    family: "decision.<decision_id>.record",
    tier: "T5_HUMAN",
    valueType: "json",
    owner: "product",
    matches(key: string): boolean {
      return /^decision\.[a-z0-9_-]+\.record$/.test(key);
    },
  },
  {
    family: "cli.command.<command_path>.summary",
    tier: "T2_CLI",
    valueType: "string",
    owner: "eng-platform",
    matches(key: string): boolean {
      return /^cli\.command\.([a-z0-9_-]+)(\.[a-z0-9_-]+)*\.summary$/.test(key);
    },
  },
]);

/**
 * Resolve any fact key — literal or templated — to its registry entry.
 * Returns null for unregistered keys (an UNSUPPORTED_CLAIM elsewhere, never a
 * crash). At most one tier can ever claim a key: literals win, and the
 * templated regexes are mutually exclusive by construction (tested).
 */
export function matchFactKey(key: string): FactRegistryEntry | null {
  const literal = (FACT_REGISTRY as Record<string, FactRegistryEntry>)[key];
  if (literal) return literal;
  for (const family of TEMPLATED_FAMILIES) {
    if (family.matches(key)) {
      return { tier: family.tier, valueType: family.valueType, owner: family.owner };
    }
  }
  return null;
}

export const FactKeySchema = z
  .string()
  .refine((k) => matchFactKey(k) !== null, { message: "unregistered fact key" });

export { FACT_TIERS };
