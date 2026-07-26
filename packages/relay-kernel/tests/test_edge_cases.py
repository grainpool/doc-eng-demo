"""Phase 09 edge cases (validation.md §7): unicode column names, a column
named like a pandas method, and the filter_rows row cap."""

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest


def _serve(payload: bytes):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/data.csv"


def _dataset(payload: bytes, url: str) -> dict:
    return {
        "presigned_url": url,
        "format": "csv",
        "sha256": hashlib.sha256(payload).hexdigest(),
        "max_bytes": 10_485_760,
    }


@pytest.fixture()
def serve():
    servers = []

    def start(payload: bytes):
        server, url = _serve(payload)
        servers.append(server)
        return _dataset(payload, url)

    yield start
    for server in servers:
        server.shutdown()


def test_unicode_column_names(client, serve):
    payload = "región,ünits,скор\nA,1,2.5\nB,3,4.5\n".encode("utf-8")
    dataset = serve(payload)
    res = client.post("/op/inspect_schema", json={"dataset": dataset, "params": {}})
    assert res.status_code == 200
    schema = next(t for t in res.json()["tables"] if t["name"] == "schema")
    assert [r[0] for r in schema["rows"]] == ["región", "ünits", "скор"]

    res = client.post(
        "/op/filter_rows",
        json={"dataset": dataset, "params": {"predicates": [
            {"column": "región", "op": "eq", "value": "A"}]}},
    )
    assert res.status_code == 200
    assert res.json()["scalar_result"]["matched"] == 1


def test_column_named_like_pandas_method(client, serve):
    # 'mean', 'count', 'index' are attribute names on DataFrame — the kernel
    # must treat them as data columns, never as attributes (no string-to-code
    # path means bracket access everywhere).
    payload = b"mean,count,index\n1,2,3\n4,5,6\n7,8,9\n"
    dataset = serve(payload)
    res = client.post(
        "/op/summary_statistics",
        json={"dataset": dataset, "params": {"columns": ["mean", "count"]}},
    )
    assert res.status_code == 200
    summary = next(t for t in res.json()["tables"] if t["name"] == "summary")
    mean_row = next(r for r in summary["rows"] if r[0] == "mean")
    assert mean_row[1] == pytest.approx(4.0)

    res = client.post(
        "/op/group_aggregate",
        json={"dataset": dataset, "params": {
            "group_by": ["index"],
            "aggregations": [{"column": "mean", "agg": "sum"}]}},
    )
    assert res.status_code == 200


def test_filter_rows_limit_cap(client, serve):
    rows = "\n".join(f"{i},x" for i in range(200))
    payload = f"n,tag\n{rows}\n".encode()
    dataset = serve(payload)
    res = client.post(
        "/op/filter_rows",
        json={"dataset": dataset, "params": {
            "predicates": [{"column": "tag", "op": "eq", "value": "x"}],
            "limit": 50}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["scalar_result"] == {"matched": 200, "returned": 50}
    table = next(t for t in body["tables"] if t["name"] == "rows")
    assert len(table["rows"]) == 50
    assert table["truncated"] is True

    # limit above the schema cap (5000) is rejected by validation, not clamped
    res = client.post(
        "/op/filter_rows",
        json={"dataset": dataset, "params": {
            "predicates": [{"column": "tag", "op": "eq", "value": "x"}],
            "limit": 50_000}},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_params"
