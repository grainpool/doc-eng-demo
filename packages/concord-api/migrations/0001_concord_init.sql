-- Concord migration 0001 — Phase 10. Forward-only (G6).
CREATE TABLE snapshot (
  id TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE TABLE run (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running'   -- running | completed | failed
);

CREATE TABLE run_step (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  step TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_run_step_run_id ON run_step(run_id);

CREATE TABLE doc_unit (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES run(id),
  surface TEXT NOT NULL,
  path TEXT NOT NULL,
  anchor TEXT,
  title TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE fact_projection (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES run(id),
  fact_key TEXT NOT NULL,
  doc_unit_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  asserted_value_json TEXT,
  extractor TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE impact (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  fact_key TEXT NOT NULL,
  delta_json TEXT NOT NULL,
  doc_unit_id TEXT NOT NULL,
  projection_id TEXT NOT NULL,
  action TEXT NOT NULL,
  classification_rule INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  patch_id TEXT
);
CREATE INDEX idx_impact_run_id ON impact(run_id);

CREATE TABLE patch (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  path TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  unified TEXT NOT NULL
);
CREATE INDEX idx_patch_run_id ON patch(run_id);
