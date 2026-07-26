"""Test harness: serve the committed fixture over a local HTTP server so the
full DatasetRef path (download → max_bytes on read → sha256 verify → parse)
is exercised, not bypassed."""

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).parent / "fixtures" / "analysis.csv"
FIXTURE_BYTES = FIXTURE.read_bytes()
FIXTURE_SHA256 = hashlib.sha256(FIXTURE_BYTES).hexdigest()


class _FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 — http.server API
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header("Content-Length", str(len(FIXTURE_BYTES)))
        self.end_headers()
        self.wfile.write(FIXTURE_BYTES)

    def log_message(self, *args) -> None:  # keep test output clean
        pass


@pytest.fixture(scope="session")
def fixture_url() -> str:
    server = HTTPServer(("127.0.0.1", 0), _FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/analysis.csv"
    server.shutdown()


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def dataset(fixture_url: str) -> dict:
    return {
        "presigned_url": fixture_url,
        "format": "csv",
        "sha256": FIXTURE_SHA256,
        "max_bytes": 10_485_760,
    }
