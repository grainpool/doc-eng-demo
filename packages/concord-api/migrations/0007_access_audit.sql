-- Concord migration 0007 — Phase 18 live runs + audit. Forward-only (G6).

ALTER TABLE run ADD COLUMN mode TEXT;            -- 'live' for Change-Lab runs
ALTER TABLE run ADD COLUMN mutation_json TEXT;

-- Append-only: one row per admin action. Teams Free retains Access logs for
-- only 24h — THIS table is the durable record (SECURITY.md). The public
-- view redacts access_email to its domain.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  access_email TEXT NOT NULL,
  mutation_json TEXT NOT NULL,
  run_id TEXT,
  outcome TEXT NOT NULL,          -- queued | completed | failed | partial | rejected:<code>
  pr_url TEXT                     -- null until Phase 19
);
CREATE INDEX idx_audit_log_ts ON audit_log(ts);
CREATE INDEX idx_audit_log_email ON audit_log(access_email);
