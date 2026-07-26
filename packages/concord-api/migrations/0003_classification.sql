-- Concord migration 0003 — Phase 13 full classification. Forward-only (G6).

ALTER TABLE impact ADD COLUMN disposition TEXT NOT NULL DEFAULT 'unresolved';
ALTER TABLE finding ADD COLUMN owner TEXT;

CREATE TABLE run_warning (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  kind TEXT NOT NULL,            -- generated_file_hand_edited
  path TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_run_warning_run_id ON run_warning(run_id);
