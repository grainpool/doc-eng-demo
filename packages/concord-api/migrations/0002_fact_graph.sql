-- Concord migration 0002 — Phase 12 fact graph. Forward-only (G6).

ALTER TABLE fact_projection ADD COLUMN span_start INTEGER;
ALTER TABLE fact_projection ADD COLUMN span_end INTEGER;
ALTER TABLE fact_projection ADD COLUMN detected_at TEXT;
ALTER TABLE fact_projection ADD COLUMN normalized_value_json TEXT;

ALTER TABLE doc_unit ADD COLUMN owner TEXT;
ALTER TABLE doc_unit ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;

CREATE TABLE finding (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  kind TEXT NOT NULL,            -- inconsistent_value | undocumented_fact | authority_conflict
  fact_key TEXT NOT NULL,
  doc_unit_id TEXT,
  projection_id TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_finding_run_id ON finding(run_id);
CREATE INDEX idx_finding_fact_key ON finding(fact_key);

CREATE INDEX idx_fact_projection_fact_key ON fact_projection(fact_key);
CREATE INDEX idx_fact_projection_run_id ON fact_projection(run_id);
CREATE INDEX idx_doc_unit_run_id ON doc_unit(run_id);
