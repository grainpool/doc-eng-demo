-- Concord migration 0006 — Phase 17: link each run to the snapshot it saw,
-- so verbose reconstruction cites the right facts. Forward-only (G6).
ALTER TABLE run ADD COLUMN snapshot_id TEXT;
