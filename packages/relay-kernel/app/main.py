"""Relay analysis kernel — eight bounded operations (Phase 04).

HTTP surface, exactly and only (contracts.md §4.3; asserted by
tests/test_no_code_surface.py):

    POST /op/{operation_id}   → KernelResult | 400 | 404 (unknown id)
    GET  /versions            → runtime versions + image digest (T0 authority)
    GET  /operations          → the operation catalog
    GET  /health              → { ok: true, egress_probe }

There is deliberately no code-execution surface of any kind: no eval, no
exec, no user-supplied expressions, no file paths, module names, or format
strings from requests (security.md §3). Data arrives only as the DatasetRef
the Worker signs; the eight operations are a closed enum.
"""

import os
import platform
import threading
import time
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # never a display backend

import fastapi
import numpy
import pandas
import scipy
import statsmodels
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .dataset import load_dataset
from .errors import KernelError
from .operations import OPERATIONS
from .params import DatasetRef

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

_BUILD_ID = Path("/app/build-id").read_text().strip() if Path("/app/build-id").exists() else "dev"

VERSIONS = {
    "python": platform.python_version(),
    "pandas": pandas.__version__,
    "numpy": numpy.__version__,
    "scipy": scipy.__version__,
    "statsmodels": statsmodels.__version__,
    "matplotlib": matplotlib.__version__,
    "fastapi": fastapi.__version__,
    "image_digest": _BUILD_ID,
}

# ---------------------------------------------------------------------------
# Egress probe (security.md §3 verification instrument, Phase 04). The target
# host is HARDCODED — this is a self-test of the container's network policy,
# not an endpoint that accepts a URL. Enabled only when the Worker's container
# config sets RELAY_EGRESS_PROBE=1; runs once per container start, off the
# request path, and reports through /health.
_EGRESS_PROBE: dict = {"target": "https://example.com/", "result": "not_run"}


def _run_egress_probe() -> None:
    try:
        with urllib.request.urlopen(_EGRESS_PROBE["target"], timeout=5) as res:
            _EGRESS_PROBE["result"] = f"open:http_{res.status}"
    except Exception as exc:
        _EGRESS_PROBE["result"] = f"failed:{type(exc).__name__}"


if os.environ.get("RELAY_EGRESS_PROBE") == "1":
    threading.Thread(target=_run_egress_probe, daemon=True).start()
else:
    _EGRESS_PROBE["result"] = "disabled"


# ---------------------------------------------------------------------------


def _error(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "detail": detail}}, status_code=status)


@app.exception_handler(RequestValidationError)
def _on_request_validation(_req: Request, exc: RequestValidationError) -> JSONResponse:
    # Contract shape is 400 {error:{code,detail}} — not FastAPI's default 422.
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []))
    return _error(400, "invalid_request", f"invalid request body at: {where}")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "egress_probe": dict(_EGRESS_PROBE)}


@app.get("/versions")
def versions() -> dict:
    # Read from the actually-imported modules — never from requirements.txt.
    # This response is the T0_RUNTIME authority source (architecture.md §4).
    return dict(VERSIONS)


@app.get("/operations")
def operations() -> dict:
    # Catalog entries are generated from the same validation models the
    # handlers use — the catalog cannot drift from behavior.
    return {"operations": [OPERATIONS[op_id].catalog_entry() for op_id in OPERATIONS]}


@app.post("/op/{operation_id}")
async def run_operation(operation_id: str, request: Request) -> JSONResponse:
    # Unknown operation id: 404 with no side effect — checked before the body
    # is even parsed (contracts.md §4.1).
    operation = OPERATIONS.get(operation_id)
    if operation is None:
        return _error(404, "unknown_operation", "unknown operation_id")

    try:
        body = await request.json()
    except Exception:
        return _error(400, "invalid_request", "body must be JSON")
    if not isinstance(body, dict):
        return _error(400, "invalid_request", "body must be a JSON object")

    try:
        dataset_ref = DatasetRef.model_validate(body.get("dataset"))
    except ValidationError:
        return _error(400, "invalid_dataset", "dataset does not match DatasetRef")
    try:
        params = operation.params_model.model_validate(body.get("params") or {})
    except ValidationError as exc:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []))
        return _error(400, "invalid_params", f"params invalid at: {where or 'params'}")

    started = time.monotonic()
    try:
        df = load_dataset(dataset_ref)
        partial = operation.handler(df, params)
    except KernelError as exc:
        return _error(400, exc.code, exc.detail)

    result = {
        "operation_id": operation_id,
        "scalar_result": partial["scalar_result"],
        "tables": partial["tables"],
        "plots": partial["plots"],
        # Echoed on every response so provenance is captured at the moment of
        # computation, not looked up later (contracts.md §4.3).
        "versions": dict(VERSIONS),
        "duration_ms": round((time.monotonic() - started) * 1000, 1),
    }
    return JSONResponse(result)
