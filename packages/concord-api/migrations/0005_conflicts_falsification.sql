-- Concord migration 0005 — Phase 15 conflicts + adversarial verification.
-- Forward-only (G6).

CREATE TABLE conflict (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  fact_key TEXT NOT NULL,
  kind TEXT NOT NULL,               -- contracts.md §15, five kinds
  claims_json TEXT NOT NULL,        -- the disagreeing claims, verbatim (≥ 2)
  missing_information_json TEXT NOT NULL,
  likely_owner TEXT NOT NULL,
  suggested_question TEXT NOT NULL,
  -- ALWAYS NULL: Concord never resolves (invariant I7). Kept as a column so
  -- the schema itself documents the invariant.
  resolution TEXT CHECK (resolution IS NULL)
);
CREATE INDEX idx_conflict_run_id ON conflict(run_id);
CREATE INDEX idx_conflict_fact_key ON conflict(fact_key);

ALTER TABLE impact ADD COLUMN conflict_id TEXT;

-- Adversarial verification: suppressed findings are stored and displayed,
-- never deleted.
ALTER TABLE finding ADD COLUMN disposition TEXT NOT NULL DEFAULT 'active';
ALTER TABLE finding ADD COLUMN refutation TEXT;
ALTER TABLE finding ADD COLUMN proposal_json TEXT;
