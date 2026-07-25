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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

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
