-- Migration 0004 — Phase 09: per-IP request accounting for the model-path
-- rate limit (security.md §5). Stores a sha256 of the IP, never the IP.
CREATE TABLE request_rate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_request_rate_lookup ON request_rate(ip_hash, route, created_at);
