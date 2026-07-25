import type { FactClaim } from "@relay/contracts";
import {
  LIMIT_UPLOAD_CSV_MAX_BYTES,
  LIMIT_UPLOAD_CSV_MAX_ROWS,
  SUPPORTED_FILE_TYPES,
} from "../limits.js";
import type { TierResolver } from "./types.js";

/**
 * T1_SCHEMA: read from the enforcement constants themselves. Locators use
 * stable symbol anchors (file#SYMBOL) rather than line numbers — line numbers
 * rot with every edit (noted in the Phase 02 report).
 */
const LIMITS_FILE = "packages/relay-api/src/limits.ts";

export const t1Schema: TierResolver = {
  tier: "T1_SCHEMA",
  status: "ok",
  resolve(): Promise<FactClaim[]> {
    const observedAt = new Date().toISOString();
    const claims: FactClaim[] = [
      {
        key: "limit.upload.csv.max_bytes",
        value: LIMIT_UPLOAD_CSV_MAX_BYTES,
        tier: "T1_SCHEMA",
        locator: `${LIMITS_FILE}#LIMIT_UPLOAD_CSV_MAX_BYTES`,
        observed_at: observedAt,
        confidence: 1,
      },
      {
        key: "limit.upload.csv.max_rows",
        value: LIMIT_UPLOAD_CSV_MAX_ROWS,
        tier: "T1_SCHEMA",
        locator: `${LIMITS_FILE}#LIMIT_UPLOAD_CSV_MAX_ROWS`,
        observed_at: observedAt,
        confidence: 1,
      },
      ...Object.entries(SUPPORTED_FILE_TYPES).map(
        ([ext, supported]): FactClaim => ({
          key: `support.file_type.${ext}`,
          value: supported,
          tier: "T1_SCHEMA",
          locator: `${LIMITS_FILE}#SUPPORTED_FILE_TYPES.${ext}`,
          observed_at: observedAt,
          confidence: 1,
        }),
      ),
    ];
    return Promise.resolve(claims);
  },
};
