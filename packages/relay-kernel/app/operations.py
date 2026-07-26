"""The eight bounded operations (contracts.md §4.1) — a CLOSED registry.

Each handler takes an already-loaded DataFrame plus a validated params model
and returns the {scalar_result, tables, plots} portion of a KernelResult.
There is no code-execution surface here: no eval, no exec, no
DataFrame string-expression API, no user-supplied expressions, paths, or
module names (security.md §3; asserted by tests/test_no_code_surface.py).
"""

import base64
import io
import math
from typing import Any, Callable

import matplotlib

matplotlib.use("Agg")  # never a display backend

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

from .errors import KernelError
from .params import (
    OPERATION_PARAM_MODELS,
    CorrelationMatrixParams,
    DistributionTestParams,
    FilterRowsParams,
    GroupAggregateParams,
    InspectSchemaParams,
    LinearRegressionParams,
    PlotParams,
    StrictModel,
    SummaryStatisticsParams,
)

MAX_TABLE_ROWS = 5000


def _scalar(v: Any) -> Any:
    """One JSON-safe scalar. NaN/Inf → null (JSON has no NaN)."""
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(v, str):
        return v
    try:
        if pd.isna(v):  # pd.NA, NaT
            return None
    except (TypeError, ValueError):
        pass
    return str(v)


def _table(name: str, df: pd.DataFrame, truncated: bool = False) -> dict:
    if len(df) > MAX_TABLE_ROWS:
        df = df.head(MAX_TABLE_ROWS)
        truncated = True
    return {
        "name": name,
        "columns": [str(c) for c in df.columns],
        "rows": [[_scalar(v) for v in row] for row in df.itertuples(index=False)],
        "truncated": truncated,
    }


def _require_columns(df: pd.DataFrame, columns: list[str]) -> None:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise KernelError(
            "unknown_column", f"column(s) not in dataset: {', '.join(missing)}"
        )


def _numeric_series(df: pd.DataFrame, column: str) -> pd.Series:
    _require_columns(df, [column])
    series = df[column]
    if not pd.api.types.is_numeric_dtype(series):
        raise KernelError("not_numeric", f"column is not numeric: {column}")
    return series


# ---------------------------------------------------------------- operations


def op_inspect_schema(df: pd.DataFrame, params: InspectSchemaParams) -> dict:
    schema = pd.DataFrame(
        {
            "column": [str(c) for c in df.columns],
            "dtype": [str(df[c].dtype) for c in df.columns],
            "null_count": [int(df[c].isna().sum()) for c in df.columns],
            "cardinality": [int(df[c].nunique(dropna=True)) for c in df.columns],
        }
    )
    return {
        "scalar_result": {"row_count": int(len(df)), "column_count": int(len(df.columns))},
        "tables": [
            _table("schema", schema),
            _table("head", df.head(params.head_rows)),
        ],
        "plots": [],
    }


def op_summary_statistics(df: pd.DataFrame, params: SummaryStatisticsParams) -> dict:
    if params.columns is not None:
        _require_columns(df, params.columns)
        selected = df[params.columns]
    else:
        selected = df
    described = selected.describe(include="all")
    out = described.reset_index().rename(columns={"index": "statistic"})
    return {
        "scalar_result": {"columns_described": int(len(described.columns))},
        "tables": [_table("summary", out)],
        "plots": [],
    }


def op_filter_rows(df: pd.DataFrame, params: FilterRowsParams) -> dict:
    # SECURITY PROPERTY, NOT A STYLE CHOICE (contracts.md §4.2, security.md §3):
    # predicates compile to boolean masks built with pandas comparison
    # operators ONLY. This function must never call DataFrame.query(),
    # pd.eval(), eval(), exec(), or any other string-to-code path — the
    # structured predicate enum below is the entire expressive power of
    # filtering, by design. A predicate can select rows; it can never execute.
    masks: list[pd.Series] = []
    for pred in params.predicates:
        _require_columns(df, [pred.column])
        series = df[pred.column]
        op = pred.op
        value = pred.value
        needs_value = op not in ("is_null", "not_null")
        if needs_value and value is None:
            raise KernelError("invalid_predicate", f"op '{op}' requires a value")
        try:
            if op == "eq":
                mask = series == value
            elif op == "neq":
                mask = series != value
            elif op == "gt":
                mask = series > value
            elif op == "gte":
                mask = series >= value
            elif op == "lt":
                mask = series < value
            elif op == "lte":
                mask = series <= value
            elif op == "in":
                if not isinstance(value, list):
                    raise KernelError("invalid_predicate", "op 'in' requires a list value")
                mask = series.isin(value)
            elif op == "not_in":
                if not isinstance(value, list):
                    raise KernelError("invalid_predicate", "op 'not_in' requires a list value")
                mask = ~series.isin(value)
            elif op == "is_null":
                mask = series.isna()
            elif op == "not_null":
                mask = series.notna()
            elif op == "contains":
                # regex=False: the value is a literal substring, never a pattern.
                mask = series.astype("string").str.contains(str(value), regex=False)
            else:  # pragma: no cover — Literal enum makes this unreachable
                raise KernelError("invalid_predicate", f"unknown op: {op}")
        except KernelError:
            raise
        except Exception as exc:  # e.g. ordering comparison on incompatible dtype
            raise KernelError(
                "invalid_predicate",
                f"predicate on '{pred.column}' failed: {type(exc).__name__}",
            ) from exc
        masks.append(mask.fillna(False).astype(bool))

    if masks:
        combined = masks[0]
        for mask in masks[1:]:
            combined = (combined & mask) if params.combine == "and" else (combined | mask)
    else:
        combined = pd.Series(True, index=df.index)

    matched = df[combined]
    returned = matched.head(params.limit)
    return {
        "scalar_result": {
            "matched": int(len(matched)),
            "returned": int(len(returned)),
        },
        "tables": [_table("rows", returned, truncated=len(matched) > len(returned))],
        "plots": [],
    }


def op_group_aggregate(df: pd.DataFrame, params: GroupAggregateParams) -> dict:
    _require_columns(df, params.group_by)
    _require_columns(df, [a.column for a in params.aggregations])
    named = {
        f"{a.column}_{a.agg}": pd.NamedAgg(column=a.column, aggfunc=a.agg)
        for a in params.aggregations
    }
    try:
        grouped = df.groupby(params.group_by, dropna=False).agg(**named).reset_index()
    except Exception as exc:  # e.g. mean over a string column
        raise KernelError(
            "invalid_aggregation", f"aggregation failed: {type(exc).__name__}"
        ) from exc
    return {
        "scalar_result": {"group_count": int(len(grouped))},
        "tables": [_table("groups", grouped)],
        "plots": [],
    }


def _numeric_frame(df: pd.DataFrame, columns: list[str] | None) -> pd.DataFrame:
    if columns is not None:
        _require_columns(df, columns)
        selected = df[columns]
        non_numeric = [
            c for c in selected.columns if not pd.api.types.is_numeric_dtype(selected[c])
        ]
        if non_numeric:
            raise KernelError(
                "not_numeric", f"column(s) not numeric: {', '.join(non_numeric)}"
            )
    else:
        selected = df.select_dtypes(include="number")
    if len(selected.columns) < 2:
        raise KernelError("not_numeric", "need at least 2 numeric columns")
    return selected


def op_correlation_matrix(df: pd.DataFrame, params: CorrelationMatrixParams) -> dict:
    selected = _numeric_frame(df, params.columns)
    corr = selected.corr(method=params.method)
    out = corr.reset_index().rename(columns={"index": "column"})
    return {
        "scalar_result": {"method": params.method, "columns": int(len(corr.columns))},
        "tables": [_table("correlation", out)],
        "plots": [],
    }


def op_linear_regression(df: pd.DataFrame, params: LinearRegressionParams) -> dict:
    if params.dependent in params.independents:
        raise KernelError(
            "invalid_params", "dependent cannot also be an independent"
        )
    for col in [params.dependent, *params.independents]:
        _numeric_series(df, col)
    data = df[[params.dependent, *params.independents]].dropna()
    if len(data) <= len(params.independents) + 1:
        raise KernelError("insufficient_data", "not enough rows for OLS")
    y = data[params.dependent].astype(float)
    x = sm.add_constant(data[params.independents].astype(float))
    results = sm.OLS(y, x).fit()
    ci = results.conf_int(alpha=0.05)
    coefficients = pd.DataFrame(
        {
            "term": list(results.params.index),
            "coefficient": list(results.params),
            "std_error": list(results.bse),
            "t_statistic": list(results.tvalues),
            "p_value": list(results.pvalues),
            "ci_low_95": list(ci[0]),
            "ci_high_95": list(ci[1]),
        }
    )
    return {
        "scalar_result": {
            "r_squared": _scalar(results.rsquared),
            "adj_r_squared": _scalar(results.rsquared_adj),
            "n_observations": int(results.nobs),
            "f_statistic": _scalar(results.fvalue),
            "f_p_value": _scalar(results.f_pvalue),
        },
        "tables": [_table("coefficients", coefficients)],
        "plots": [],
    }


def op_distribution_test(df: pd.DataFrame, params: DistributionTestParams) -> dict:
    one_sample = params.test in ("shapiro", "normaltest")
    expected = 1 if one_sample else 2
    if len(params.columns) != expected:
        raise KernelError(
            "invalid_params",
            f"test '{params.test}' takes exactly {expected} column(s)",
        )
    samples = [
        _numeric_series(df, c).dropna().astype(float) for c in params.columns
    ]
    try:
        if params.test == "shapiro":
            result = stats.shapiro(samples[0])
        elif params.test == "normaltest":
            result = stats.normaltest(samples[0])
        elif params.test == "ttest_ind":
            result = stats.ttest_ind(samples[0], samples[1])
        else:  # mannwhitneyu — Literal enum: no other value can reach here
            result = stats.mannwhitneyu(samples[0], samples[1])
    except Exception as exc:  # e.g. too few observations for the test
        raise KernelError(
            "insufficient_data", f"test failed: {type(exc).__name__}"
        ) from exc
    return {
        "scalar_result": {
            "test": params.test,
            "statistic": _scalar(result.statistic),
            "p_value": _scalar(result.pvalue),
            "sample_sizes": [int(len(s)) for s in samples],
        },
        "tables": [],
        "plots": [],
    }


def _fig_to_plot(name: str, fig: "plt.Figure") -> dict:
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    width_in, height_in = fig.get_size_inches()
    dpi = fig.get_dpi()
    return {
        "name": name,
        "mime": "image/png",
        "base64": base64.b64encode(buf.getvalue()).decode("ascii"),
        "width": int(round(width_in * dpi)),
        "height": int(round(height_in * dpi)),
    }


def op_plot(df: pd.DataFrame, params: PlotParams) -> dict:
    kind = params.kind
    fig, ax = plt.subplots(figsize=(8, 5))
    try:
        if kind == "histogram":
            series = _numeric_series(df, params.x).dropna()
            ax.hist(series, bins=params.bins or 20)
            ax.set_xlabel(params.x)
            ax.set_ylabel("count")
        elif kind == "scatter":
            if params.y is None:
                raise KernelError("invalid_params", "scatter requires y")
            ax.scatter(_numeric_series(df, params.x), _numeric_series(df, params.y))
            ax.set_xlabel(params.x)
            ax.set_ylabel(params.y)
        elif kind == "line":
            if params.y is not None:
                _require_columns(df, [params.x])
                ax.plot(df[params.x], _numeric_series(df, params.y))
                ax.set_xlabel(params.x)
                ax.set_ylabel(params.y)
            else:
                ax.plot(_numeric_series(df, params.x).reset_index(drop=True))
                ax.set_ylabel(params.x)
        elif kind == "bar":
            _require_columns(df, [params.x])
            if params.y is not None:
                _numeric_series(df, params.y)
                grouped = (
                    df.groupby(params.x, dropna=False)[params.y].mean().sort_index()
                )
                ax.bar([str(v) for v in grouped.index], grouped.values)
                ax.set_ylabel(f"mean {params.y}")
            else:
                counts = df[params.x].value_counts(dropna=False).sort_index()
                ax.bar([str(v) for v in counts.index], counts.values)
                ax.set_ylabel("count")
            ax.set_xlabel(params.x)
        elif kind == "box":
            series = _numeric_series(df, params.x).dropna()
            ax.boxplot([series], tick_labels=[params.x])
        else:  # heatmap — correlation of numeric columns; Literal enum is closed
            selected = _numeric_frame(df, None)
            corr = selected.corr(method="pearson")
            image = ax.imshow(corr.values, cmap="viridis", vmin=-1, vmax=1)
            ax.set_xticks(range(len(corr.columns)))
            ax.set_xticklabels([str(c) for c in corr.columns], rotation=45, ha="right")
            ax.set_yticks(range(len(corr.columns)))
            ax.set_yticklabels([str(c) for c in corr.columns])
            fig.colorbar(image, ax=ax)
        fig.tight_layout()
        plot = _fig_to_plot(f"{kind}_{params.x}", fig)
    except KernelError:
        plt.close(fig)
        raise
    except Exception as exc:
        plt.close(fig)
        raise KernelError("plot_failed", f"plot failed: {type(exc).__name__}") from exc
    return {"scalar_result": {"kind": kind}, "tables": [], "plots": [plot]}


# ------------------------------------------------------------------ registry

Handler = Callable[[pd.DataFrame, Any], dict]


class Operation:
    def __init__(
        self, op_id: str, summary: str, params_model: type[StrictModel],
        returns: str, handler: Handler,
    ) -> None:
        self.op_id = op_id
        self.summary = summary
        self.params_model = params_model
        self.returns = returns
        self.handler = handler

    def catalog_entry(self) -> dict:
        # params_schema is generated from the SAME model the handler
        # validates with — the catalog cannot drift from behavior.
        return {
            "id": self.op_id,
            "summary": self.summary,
            "params_schema": self.params_model.model_json_schema(),
            "returns": self.returns,
            "enabled": True,
        }


OPERATIONS: dict[str, Operation] = {
    op.op_id: op
    for op in [
        Operation(
            "inspect_schema",
            "Column dtypes, null counts, cardinality, and the first rows.",
            InspectSchemaParams,
            "tables: schema, head; scalar: row_count, column_count",
            op_inspect_schema,
        ),
        Operation(
            "summary_statistics",
            "describe() over selected (or all) columns.",
            SummaryStatisticsParams,
            "tables: summary",
            op_summary_statistics,
        ),
        Operation(
            "filter_rows",
            "Select rows with structured predicates (never a query string).",
            FilterRowsParams,
            "tables: rows; scalar: matched, returned",
            op_filter_rows,
        ),
        Operation(
            "group_aggregate",
            "group_by columns × named aggregations.",
            GroupAggregateParams,
            "tables: groups; scalar: group_count",
            op_group_aggregate,
        ),
        Operation(
            "correlation_matrix",
            "Pairwise correlation (pearson|spearman|kendall) of numeric columns.",
            CorrelationMatrixParams,
            "tables: correlation",
            op_correlation_matrix,
        ),
        Operation(
            "linear_regression",
            "statsmodels OLS: coefficients, std errors, p-values, r², CIs.",
            LinearRegressionParams,
            "tables: coefficients; scalar: r_squared, adj_r_squared, …",
            op_linear_regression,
        ),
        Operation(
            "distribution_test",
            "shapiro | normaltest | ttest_ind | mannwhitneyu.",
            DistributionTestParams,
            "scalar: test, statistic, p_value, sample_sizes",
            op_distribution_test,
        ),
        Operation(
            "plot",
            "histogram|scatter|line|bar|box|heatmap rendered to PNG (Agg).",
            PlotParams,
            "plots: one PNG",
            op_plot,
        ),
    ]
}

# The registry and the params-model table must agree exactly — both mirror
# contracts.md §4.1.
assert set(OPERATIONS) == set(OPERATION_PARAM_MODELS)
