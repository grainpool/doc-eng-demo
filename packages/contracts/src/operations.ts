import { z } from "zod";

/** The eight analysis operations — closed enum, no more, no fewer (contracts.md §4.1). */
export const OPERATION_IDS = [
  "inspect_schema",
  "summary_statistics",
  "filter_rows",
  "group_aggregate",
  "correlation_matrix",
  "linear_regression",
  "distribution_test",
  "plot",
] as const;

export const OperationIdSchema = z.enum(OPERATION_IDS);
export type OperationId = z.infer<typeof OperationIdSchema>;

/**
 * filter_rows predicate shape — this is the arbitrary-code firewall
 * (contracts.md §4.2). The kernel builds a boolean mask from these with pandas
 * comparison operators; there is no string-to-code path anywhere.
 */
export const PredicateSchema = z.object({
  column: z.string(),
  op: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "is_null",
    "not_null",
    "contains",
  ]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number()])),
    ])
    .optional(),
});
export type Predicate = z.infer<typeof PredicateSchema>;

export const FilterRowsParamsSchema = z.object({
  predicates: z.array(PredicateSchema).max(10),
  combine: z.enum(["and", "or"]).default("and"),
  limit: z.number().int().min(1).max(5000).default(1000),
});

export const InspectSchemaParamsSchema = z.object({
  head_rows: z.number().int().min(1).max(50).default(10),
});

export const SummaryStatisticsParamsSchema = z.object({
  columns: z.array(z.string()).min(1).max(50).optional(),
});

export const AGGREGATIONS = [
  "sum",
  "mean",
  "median",
  "min",
  "max",
  "count",
  "std",
] as const;

export const GroupAggregateParamsSchema = z.object({
  group_by: z.array(z.string()).min(1).max(5),
  aggregations: z
    .array(z.object({ column: z.string(), agg: z.enum(AGGREGATIONS) }))
    .min(1)
    .max(10),
});

export const CorrelationMatrixParamsSchema = z.object({
  columns: z.array(z.string()).min(2).max(50).optional(),
  method: z.enum(["pearson", "spearman", "kendall"]).default("pearson"),
});

export const LinearRegressionParamsSchema = z.object({
  dependent: z.string(),
  independents: z.array(z.string()).min(1).max(10),
});

export const DistributionTestParamsSchema = z.object({
  test: z.enum(["shapiro", "normaltest", "ttest_ind", "mannwhitneyu"]),
  /** shapiro/normaltest take one column; ttest_ind/mannwhitneyu take two. */
  columns: z.array(z.string()).min(1).max(2),
});

export const PlotParamsSchema = z.object({
  kind: z.enum(["histogram", "scatter", "line", "bar", "box", "heatmap"]),
  x: z.string(),
  y: z.string().optional(),
  bins: z.number().int().min(2).max(200).optional(),
});

/** Per-operation params schema, keyed by the closed enum. */
export const OPERATION_PARAMS_SCHEMAS = {
  inspect_schema: InspectSchemaParamsSchema,
  summary_statistics: SummaryStatisticsParamsSchema,
  filter_rows: FilterRowsParamsSchema,
  group_aggregate: GroupAggregateParamsSchema,
  correlation_matrix: CorrelationMatrixParamsSchema,
  linear_regression: LinearRegressionParamsSchema,
  distribution_test: DistributionTestParamsSchema,
  plot: PlotParamsSchema,
} as const satisfies Record<OperationId, z.ZodType>;

/** contracts.md §4.3 */
export const DatasetRefSchema = z.object({
  presigned_url: z.url(), // R2 presigned GET, ≤ 60 s TTL
  format: z.enum(["csv", "tsv"]),
  sha256: z.string(), // kernel verifies; mismatch → 400
  max_bytes: z.number().int(),
});
export type DatasetRef = z.infer<typeof DatasetRefSchema>;

export const KernelResultSchema = z.object({
  operation_id: z.string(),
  scalar_result: z.record(z.string(), z.unknown()).nullable(),
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.unknown())),
      truncated: z.boolean(),
    }),
  ),
  plots: z.array(
    z.object({
      name: z.string(),
      mime: z.literal("image/png"),
      base64: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  ),
  versions: z.record(z.string(), z.string()),
  duration_ms: z.number(),
});
export type KernelResult = z.infer<typeof KernelResultSchema>;
