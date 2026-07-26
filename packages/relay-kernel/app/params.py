"""Parameter models for the eight operations — mirrors `@relay/contracts`
`OPERATION_PARAMS_SCHEMAS` (contracts.md §4.1/§4.2) field for field.

These models are the kernel's OWN validation layer: the Worker validates the
same shapes with Zod before calling, and the kernel re-validates here because
it does not trust the Worker (security.md §3). `extra="forbid"` everywhere —
an unknown field is a rejection, never a pass-through.

No field in any model is a filesystem path, module name, expression, or
format string (security.md §3, asserted by tests/test_no_code_surface.py).
"""

from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field

PredicateValue = Union[str, bool, int, float, list[Union[str, int, float]]]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DatasetRef(StrictModel):
    """contracts.md §4.3 — the only way data enters the kernel."""

    presigned_url: str = Field(min_length=1, max_length=2048)
    format: Literal["csv", "tsv"]
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    max_bytes: int = Field(ge=1)


class InspectSchemaParams(StrictModel):
    head_rows: int = Field(default=10, ge=1, le=50)


class SummaryStatisticsParams(StrictModel):
    columns: list[str] | None = Field(default=None, min_length=1, max_length=50)


PREDICATE_OPS = (
    "eq", "neq", "gt", "gte", "lt", "lte",
    "in", "not_in", "is_null", "not_null", "contains",
)


class Predicate(StrictModel):
    column: str
    op: Literal[
        "eq", "neq", "gt", "gte", "lt", "lte",
        "in", "not_in", "is_null", "not_null", "contains",
    ]
    value: PredicateValue | None = None


class FilterRowsParams(StrictModel):
    predicates: list[Predicate] = Field(max_length=10)
    combine: Literal["and", "or"] = "and"
    limit: int = Field(default=1000, ge=1, le=5000)


AGGREGATIONS = ("sum", "mean", "median", "min", "max", "count", "std")


class Aggregation(StrictModel):
    column: str
    agg: Literal["sum", "mean", "median", "min", "max", "count", "std"]


class GroupAggregateParams(StrictModel):
    group_by: list[str] = Field(min_length=1, max_length=5)
    aggregations: list[Aggregation] = Field(min_length=1, max_length=10)


class CorrelationMatrixParams(StrictModel):
    columns: list[str] | None = Field(default=None, min_length=2, max_length=50)
    method: Literal["pearson", "spearman", "kendall"] = "pearson"


class LinearRegressionParams(StrictModel):
    dependent: str
    independents: list[str] = Field(min_length=1, max_length=10)


class DistributionTestParams(StrictModel):
    test: Literal["shapiro", "normaltest", "ttest_ind", "mannwhitneyu"]
    # shapiro/normaltest take one column; ttest_ind/mannwhitneyu take two.
    columns: list[str] = Field(min_length=1, max_length=2)


class PlotParams(StrictModel):
    kind: Literal["histogram", "scatter", "line", "bar", "box", "heatmap"]
    x: str
    y: str | None = None
    bins: int | None = Field(default=None, ge=2, le=200)


# Closed enum — no more, no fewer (contracts.md §4.1). Order matters: it is
# the catalog order in GET /operations.
OPERATION_PARAM_MODELS: dict[str, type[StrictModel]] = {
    "inspect_schema": InspectSchemaParams,
    "summary_statistics": SummaryStatisticsParams,
    "filter_rows": FilterRowsParams,
    "group_aggregate": GroupAggregateParams,
    "correlation_matrix": CorrelationMatrixParams,
    "linear_regression": LinearRegressionParams,
    "distribution_test": DistributionTestParams,
    "plot": PlotParams,
}
