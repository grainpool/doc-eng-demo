-- Migration 0003 — Phase 05: a turn records where its kernel result lives.
-- Forward-only (constraints.md G6): 0001 is applied and is never edited.
ALTER TABLE session_turn ADD COLUMN result_r2_key TEXT;
