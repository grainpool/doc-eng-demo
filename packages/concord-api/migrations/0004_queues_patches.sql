-- Concord migration 0004 — Phase 14 queues, model calls, patch provenance.
-- Forward-only (G6).

CREATE TABLE model_call (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  purpose TEXT NOT NULL,          -- grounded_patch | editorial_draft | model_extraction
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_model_call_run_id ON model_call(run_id);
CREATE INDEX idx_model_call_created_at ON model_call(created_at);

ALTER TABLE run ADD COLUMN reason TEXT;

ALTER TABLE impact ADD COLUMN resolution_note TEXT;

ALTER TABLE patch ADD COLUMN origin TEXT NOT NULL DEFAULT 'deterministic';
ALTER TABLE patch ADD COLUMN doc_unit_id TEXT;
ALTER TABLE patch ADD COLUMN impact_ids_json TEXT;
ALTER TABLE patch ADD COLUMN evidence_json TEXT;
ALTER TABLE patch ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE patch ADD COLUMN validation_json TEXT;
ALTER TABLE patch ADD COLUMN model_call_id TEXT;
ALTER TABLE patch ADD COLUMN changed_because TEXT;
ALTER TABLE patch ADD COLUMN needs_human_because TEXT;
