"""Negative-space assertions (security.md §3): the kernel has exactly the
documented HTTP surface and no code-execution path.

The forbidden-substring scan builds its needles by concatenation so this test
file cannot trip its own scan.
"""

from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app
from app.params import OPERATION_PARAM_MODELS, DatasetRef

APP_DIR = Path(__file__).parent.parent / "app"


def test_only_documented_routes_exist():
    routes = {
        (route.path, method)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
        if method != "HEAD"
    }
    assert routes == {
        ("/health", "GET"),
        ("/versions", "GET"),
        ("/operations", "GET"),
        ("/op/{operation_id}", "POST"),
    }


# A handler parameter must never be a filesystem path, module name,
# expression, format string, code, or URL (the single sanctioned URL lives in
# DatasetRef, which the Worker signs — asserted separately below).
FORBIDDEN_FIELD_NAMES = {
    "path", "file_path", "filepath", "filename", "file", "dir", "directory",
    "module", "module_name", "import", "expression", "expr", "code", "script",
    "query", "command", "cmd", "template", "format_string", "fmt", "url",
    "uri", "href",
}


def test_no_param_field_is_a_path_module_expression_or_format_string():
    for op_id, model in OPERATION_PARAM_MODELS.items():
        for field_name in model.model_fields:
            assert field_name not in FORBIDDEN_FIELD_NAMES, (op_id, field_name)
            assert not field_name.endswith(("_path", "_url", "_uri", "_expr")), (
                op_id,
                field_name,
            )


def test_dataset_ref_is_the_only_url_carrier():
    url_fields = [f for f in DatasetRef.model_fields if "url" in f]
    assert url_fields == ["presigned_url"]


def test_filter_rows_rejects_operator_outside_enum(client, dataset):
    res = client.post(
        "/op/filter_rows",
        json={
            "dataset": dataset,
            "params": {
                "predicates": [
                    {"column": "region", "op": "matches_regex", "value": ".*"}
                ]
            },
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_params"


def test_unknown_param_fields_are_rejected(client, dataset):
    res = client.post(
        "/op/inspect_schema",
        json={"dataset": dataset, "params": {"head_rows": 5, "exec_after": "x"}},
    )
    assert res.status_code == 400


def test_source_contains_no_string_to_code_path():
    # Needles assembled by concatenation so this file never matches itself.
    needles = [
        "ev" + "al(",
        "ex" + "ec(",
        ".que" + "ry(",
        "pd.ev" + "al",
        "__imp" + "ort__",
        "subpro" + "cess",
        "os.sys" + "tem",
        "pick" + "le",
        "impor" + "tlib",
    ]
    for source_file in sorted(APP_DIR.glob("*.py")):
        # Scan code, not comments: contracts.md §4.2 REQUIRES a comment at the
        # filter_rows mask code naming the forbidden calls, so comment lines
        # are stripped. A real call cannot live in a comment.
        code_lines = [
            line
            for line in source_file.read_text(encoding="utf-8").splitlines()
            if not line.lstrip().startswith("#")
        ]
        text = "\n".join(code_lines)
        for needle in needles:
            assert needle not in text, (source_file.name, needle)
