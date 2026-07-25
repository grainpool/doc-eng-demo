/**
 * T1_SCHEMA — the SINGLE enforcement point for upload limits and supported
 * file types (architecture.md §3.1). Phase 03's upload route reads these
 * constants; Concord later depends on there being exactly one place where the
 * limit both lives and is enforced. Change a value here and the behavior, the
 * fact, and every doc projection must move together — that is the demo's
 * central claim.
 */

export const LIMIT_UPLOAD_CSV_MAX_BYTES = 10_485_760; // 10 MB
export const LIMIT_UPLOAD_CSV_MAX_ROWS = 50_000;

export const SUPPORTED_FILE_TYPES = Object.freeze({
  csv: true,
  tsv: true,
  xlsx: false,
});
