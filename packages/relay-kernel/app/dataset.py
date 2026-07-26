"""Dataset intake (contracts.md §4.3, security.md §3).

The kernel fetches exactly ONE URL per request: the presigned URL the Worker
handed it. It never fetches a user-supplied URL, never reads a filesystem
path from a request, and enforces `max_bytes` ON READ — an oversized object
is aborted mid-download, not parsed and then measured. The sha256 is verified
before a single byte reaches pandas, which blocks a swapped-object attack
against a presigned URL.

Everything stays in memory (BytesIO); the kernel writes nothing outside /tmp
(and nothing at all here).
"""

import hashlib
import io
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

import pandas as pd

from .errors import KernelError
from .params import DatasetRef

_CHUNK = 64 * 1024
_TIMEOUT_S = 20

# Optional deploy-time host pin (security.md §3 "host-checked"). When
# RELAY_DATASET_HOST is set, a presigned URL on any other host is rejected
# before any connection is opened.
_ALLOWED_HOST_ENV = "RELAY_DATASET_HOST"


def _check_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise KernelError("invalid_dataset", "presigned_url must be http(s)")
    allowed = os.environ.get(_ALLOWED_HOST_ENV)
    if allowed and parsed.netloc != allowed:
        raise KernelError(
            "dataset_host_not_allowed",
            "presigned_url host is not the configured dataset host",
        )


def _download(ref: DatasetRef) -> bytes:
    _check_host(ref.presigned_url)
    hasher = hashlib.sha256()
    buf = io.BytesIO()
    total = 0
    # Cloudflare's Browser Integrity Check bans urllib's default user agent at
    # the edge (error 1010, observed Phase 04 — COMPAT.md). The kernel
    # identifies itself honestly instead.
    request = urllib.request.Request(
        ref.presigned_url, headers={"User-Agent": "relay-kernel/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_S) as res:
            declared = res.headers.get("Content-Length")
            if declared is not None and int(declared) > ref.max_bytes:
                raise KernelError("dataset_too_large", "dataset exceeds max_bytes")
            while True:
                chunk = res.read(_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > ref.max_bytes:
                    # Enforced on read: stop pulling bytes the moment the cap
                    # is crossed (security.md §3).
                    raise KernelError(
                        "dataset_too_large", "dataset exceeds max_bytes"
                    )
                hasher.update(chunk)
                buf.write(chunk)
    except KernelError:
        raise
    except urllib.error.HTTPError as exc:
        # Status code only — never the URL (it is a capability).
        raise KernelError(
            "dataset_fetch_failed", f"dataset fetch failed: http_{exc.code}"
        ) from exc
    except Exception as exc:  # URL expired, DNS, connection reset, …
        raise KernelError(
            "dataset_fetch_failed", f"dataset fetch failed: {type(exc).__name__}"
        ) from exc

    if hasher.hexdigest() != ref.sha256:
        raise KernelError("sha256_mismatch", "dataset sha256 does not match")
    return buf.getvalue()


def load_dataset(ref: DatasetRef) -> pd.DataFrame:
    raw = _download(ref)
    sep = "\t" if ref.format == "tsv" else ","
    try:
        return pd.read_csv(io.BytesIO(raw), sep=sep)
    except Exception as exc:
        raise KernelError(
            "dataset_parse_failed", f"could not parse dataset: {type(exc).__name__}"
        ) from exc
