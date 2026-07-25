"""Relay analysis kernel — Phase 01 walking skeleton.

Exposes ONLY /health and /versions. There is deliberately no code-execution
surface of any kind: no eval, no exec, no user-supplied expressions, no file
paths from requests (security.md §3). The eight bounded operations arrive in
Phase 04.
"""

import platform
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # never a display backend

import fastapi
import numpy
import pandas
import scipy
import statsmodels
from fastapi import FastAPI

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

_BUILD_ID = Path("/app/build-id").read_text().strip() if Path("/app/build-id").exists() else "dev"


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/versions")
def versions() -> dict:
    # Read from the actually-imported modules — never from requirements.txt.
    # This response is the T0_RUNTIME authority source (architecture.md §4).
    return {
        "python": platform.python_version(),
        "pandas": pandas.__version__,
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
        "statsmodels": statsmodels.__version__,
        "matplotlib": matplotlib.__version__,
        "fastapi": fastapi.__version__,
        "image_digest": _BUILD_ID,
    }
