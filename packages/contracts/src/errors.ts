import { z } from "zod";

/**
 * Closed error-code enum (contracts.md §1). Grows in later phases; values are
 * SCREAMING_SNAKE because they appear in JSON.
 */
export const ERROR_CODES = [
  "INTERNAL",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "UPSTREAM_UNAVAILABLE",
  "KERNEL_UNAVAILABLE",
  // File-intake codes: distinct so rejections are distinguishable (Phase 03
  // wires the behavior; the enum is part of the freeze surface).
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "TOO_MANY_ROWS",
  // Phase-09 spend controls (security.md §5): both map to HTTP 429.
  "BUDGET_EXHAUSTED",
  "RATE_LIMITED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * A copy id points into the copy registry (contracts.md §8), e.g.
 * "error.upload.too_large". Lowercase dotted segments.
 */
export const CopyIdSchema = z
  .string()
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, "expected a dotted lowercase copy id");
export type CopyId = z.infer<typeof CopyIdSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    copy_id: z.string(),
    detail: z.string().optional(),
    field: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * The single error shape for every HTTP error response. `copy_id` points into
 * the copy registry (formalized in Phase 08); HTTP responses never contain a
 * hand-written user-facing sentence.
 */
export function apiError(
  code: ErrorCode,
  copyId: string,
  detail?: string,
  field?: string,
): ApiError {
  return {
    error: {
      code,
      copy_id: copyId,
      ...(detail !== undefined ? { detail } : {}),
      ...(field !== undefined ? { field } : {}),
    },
  };
}
