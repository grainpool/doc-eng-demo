"""Each of the eight operations against the committed fixture CSV
(tests/fixtures/analysis.csv), compared to committed expected output.

Numeric tolerance: relative 1e-6 (values were computed with the exact pinned
package set from requirements.txt; the margin absorbs BLAS build variation
across platforms, nothing more). Regression coefficients and p-values are
asserted explicitly per the Phase 04 spec.
"""

import base64

import pytest

TOL = 1e-6


def _run(client, dataset, op_id, params):
    return client.post(f"/op/{op_id}", json={"dataset": dataset, "params": params})


def _table(body, name):
    return next(t for t in body["tables"] if t["name"] == name)


def _row(table, key_index, key):
    return next(r for r in table["rows"] if r[key_index] == key)


def test_inspect_schema(client, dataset):
    res = _run(client, dataset, "inspect_schema", {"head_rows": 3})
    assert res.status_code == 200
    body = res.json()
    assert body["operation_id"] == "inspect_schema"
    assert body["scalar_result"] == {"row_count": 12, "column_count": 4}
    schema = _table(body, "schema")
    assert schema["columns"] == ["column", "dtype", "null_count", "cardinality"]
    units = _row(schema, 0, "units")
    assert units[2] == 0  # null_count
    assert units[3] == 8  # cardinality
    head = _table(body, "head")
    assert head["columns"] == ["region", "units", "price", "score"]
    assert len(head["rows"]) == 3
    assert head["rows"][0] == ["A", 10, 2.5, 60.0]
    # provenance is echoed at the moment of computation
    assert body["versions"]["pandas"]
    assert body["duration_ms"] >= 0


def test_summary_statistics(client, dataset):
    res = _run(client, dataset, "summary_statistics", {"columns": ["units", "score"]})
    assert res.status_code == 200
    body = res.json()
    summary = _table(body, "summary")
    assert summary["columns"] == ["statistic", "units", "score"]
    mean = _row(summary, 0, "mean")
    assert mean[1] == pytest.approx(11.5, rel=TOL)
    std = _row(summary, 0, "std")
    assert std[1] == pytest.approx(2.0670576365276494, rel=TOL)


def test_filter_rows(client, dataset):
    res = _run(
        client,
        dataset,
        "filter_rows",
        {
            "predicates": [
                {"column": "region", "op": "eq", "value": "A"},
                {"column": "units", "op": "gte", "value": 12},
            ],
            "combine": "and",
            "limit": 10,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["scalar_result"] == {"matched": 3, "returned": 3}
    rows = _table(body, "rows")
    assert sorted(r[1] for r in rows["rows"]) == [12, 13, 15]
    assert rows["truncated"] is False


def test_filter_rows_more_ops(client, dataset):
    res = _run(
        client,
        dataset,
        "filter_rows",
        {
            "predicates": [
                {"column": "units", "op": "in", "value": [8, 9]},
                {"column": "region", "op": "contains", "value": "B"},
            ],
            "combine": "or",
        },
    )
    assert res.status_code == 200
    assert res.json()["scalar_result"]["matched"] == 6  # all B rows (incl. 8, 9)


def test_group_aggregate(client, dataset):
    res = _run(
        client,
        dataset,
        "group_aggregate",
        {
            "group_by": ["region"],
            "aggregations": [
                {"column": "units", "agg": "sum"},
                {"column": "score", "agg": "mean"},
            ],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["scalar_result"] == {"group_count": 2}
    groups = _table(body, "groups")
    assert groups["columns"] == ["region", "units_sum", "score_mean"]
    row_a = _row(groups, 0, "A")
    assert row_a[1] == 71
    assert row_a[2] == pytest.approx(65.28333333333333, rel=TOL)
    row_b = _row(groups, 0, "B")
    assert row_b[1] == 67
    assert row_b[2] == pytest.approx(64.38333333333334, rel=TOL)


def test_correlation_matrix(client, dataset):
    res = _run(client, dataset, "correlation_matrix", {"method": "pearson"})
    assert res.status_code == 200
    body = res.json()
    corr = _table(body, "correlation")
    assert corr["columns"] == ["column", "units", "price", "score"]
    units = _row(corr, 0, "units")
    assert units[1] == pytest.approx(1.0, rel=TOL)
    assert units[2] == pytest.approx(0.256154710728, rel=TOL)
    assert units[3] == pytest.approx(0.984159248035, rel=TOL)


def test_linear_regression(client, dataset):
    res = _run(
        client,
        dataset,
        "linear_regression",
        {"dependent": "score", "independents": ["units", "price"]},
    )
    assert res.status_code == 200
    body = res.json()
    scalar = body["scalar_result"]
    assert scalar["r_squared"] == pytest.approx(0.9738114879329165, rel=TOL)
    assert scalar["adj_r_squared"] == pytest.approx(0.9679918185846758, rel=TOL)
    assert scalar["n_observations"] == 12
    assert scalar["f_statistic"] == pytest.approx(167.33106808332482, rel=TOL)

    coefs = _table(body, "coefficients")
    assert coefs["columns"] == [
        "term", "coefficient", "std_error", "t_statistic",
        "p_value", "ci_low_95", "ci_high_95",
    ]
    const = _row(coefs, 0, "const")
    units = _row(coefs, 0, "units")
    price = _row(coefs, 0, "price")
    # Coefficients — explicit, per the phase spec.
    assert const[1] == pytest.approx(31.822186836518085, rel=TOL)
    assert units[1] == pytest.approx(2.5764331210191083, rel=TOL)
    assert price[1] == pytest.approx(1.1464968152866106, rel=TOL)
    # Standard errors.
    assert units[2] == pytest.approx(0.14899613573862192, rel=TOL)
    # p-values — explicit, per the phase spec.
    assert const[4] == pytest.approx(8.287905211993414e-07, rel=TOL)
    assert units[4] == pytest.approx(3.2627067873104684e-08, rel=TOL)
    assert price[4] == pytest.approx(0.21240582865464172, rel=TOL)
    # 95% confidence intervals.
    assert units[5] == pytest.approx(2.239380445328731, rel=TOL)
    assert units[6] == pytest.approx(2.9134857967094856, rel=TOL)


@pytest.mark.parametrize(
    ("test", "columns", "stat", "p"),
    [
        ("shapiro", ["score"], 0.9669183679813304, 0.8759968574881061),
        ("normaltest", ["score"], 0.575536224846539, 0.7499354727973826),
        ("ttest_ind", ["units", "price"], 14.115486331229537, 1.6579050921418595e-12),
        ("mannwhitneyu", ["units", "price"], 144.0, 3.6017053686677334e-05),
    ],
)
def test_distribution_test(client, dataset, test, columns, stat, p):
    res = _run(client, dataset, "distribution_test", {"test": test, "columns": columns})
    assert res.status_code == 200
    scalar = res.json()["scalar_result"]
    assert scalar["test"] == test
    assert scalar["statistic"] == pytest.approx(stat, rel=TOL)
    assert scalar["p_value"] == pytest.approx(p, rel=TOL)


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.mark.parametrize(
    "params",
    [
        {"kind": "histogram", "x": "score", "bins": 6},
        {"kind": "scatter", "x": "units", "y": "score"},
        {"kind": "line", "x": "score"},
        {"kind": "bar", "x": "region", "y": "units"},
        {"kind": "box", "x": "units"},
        {"kind": "heatmap", "x": "units"},
    ],
)
def test_plot(client, dataset, params):
    res = _run(client, dataset, "plot", params)
    assert res.status_code == 200
    body = res.json()
    assert len(body["plots"]) == 1
    plot = body["plots"][0]
    assert plot["mime"] == "image/png"
    assert base64.b64decode(plot["base64"])[:8] == PNG_MAGIC
    assert plot["width"] > 0 and plot["height"] > 0


# ------------------------------------------------------ dataset-intake gates


def test_sha256_mismatch_is_400(client, dataset):
    bad = {**dataset, "sha256": "0" * 64}
    res = _run(client, bad, "inspect_schema", {})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "sha256_mismatch"


def test_oversized_dataset_is_400(client, dataset):
    res = _run(client, {**dataset, "max_bytes": 16}, "inspect_schema", {})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "dataset_too_large"


def test_unknown_operation_is_404(client, dataset):
    res = _run(client, dataset, "drop_table", {})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "unknown_operation"


def test_unknown_column_is_400(client, dataset):
    res = _run(
        client, dataset, "summary_statistics", {"columns": ["no_such_column"]}
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "unknown_column"


def test_host_pinning_rejects_other_hosts(client, dataset, monkeypatch):
    monkeypatch.setenv("RELAY_DATASET_HOST", "relay.otonieltrejo.com")
    res = _run(client, dataset, "inspect_schema", {})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "dataset_host_not_allowed"


def test_operations_catalog_matches_contract(client):
    res = client.get("/operations")
    assert res.status_code == 200
    ops = res.json()["operations"]
    assert [o["id"] for o in ops] == [
        "inspect_schema", "summary_statistics", "filter_rows", "group_aggregate",
        "correlation_matrix", "linear_regression", "distribution_test", "plot",
    ]
    for op in ops:
        assert set(op) == {"id", "summary", "params_schema", "returns", "enabled"}
        assert op["enabled"] is True
        assert op["params_schema"]["type"] == "object"
        # every catalog schema forbids unknown fields — mirror of the models
        assert op["params_schema"].get("additionalProperties") is False
