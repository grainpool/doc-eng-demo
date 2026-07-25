-- Migration 0001 — Relay core schema. Forward-only (constraints.md G6):
-- never edit this file after it has been applied; add 0002_*.sql instead.
-- Booleans are INTEGER 0/1 and are normalized at the repository layer;
-- 0/1 never leaks into a contract type. Timestamps are ISO 8601 UTC TEXT.

CREATE TABLE project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE file (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  column_count INTEGER,
  row_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_file_project_id ON file(project_id);

CREATE TABLE analysis_session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  file_id TEXT REFERENCES file(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_analysis_session_project_id ON analysis_session(project_id);

CREATE TABLE session_turn (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES analysis_session(id),
  prompt TEXT NOT NULL,
  operation_id TEXT,
  params_json TEXT,
  status TEXT NOT NULL,          -- pending | completed | failed | refused
  error_code TEXT,               -- ErrorCode enum value when failed
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_session_turn_session_id ON session_turn(session_id);

CREATE TABLE artifact (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id),
  kind TEXT NOT NULL CHECK (kind IN ('plot', 'table_csv', 'summary_json', 'operation_record')),
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  retention_expires_at TEXT,     -- derived from retention.artifact.days; NULL = no expiry
  created_at TEXT NOT NULL
);
CREATE INDEX idx_artifact_project_id ON artifact(project_id);

-- Provenance completeness is enforced by the SCHEMA (contracts.md §6 I2):
-- every column NOT NULL, one row per artifact. An artifact row without
-- complete provenance cannot exist.
CREATE TABLE artifact_provenance (
  artifact_id TEXT PRIMARY KEY REFERENCES artifact(id),
  source_file_id TEXT NOT NULL,
  source_file_sha256 TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  params_json TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  runtime_versions_json TEXT NOT NULL,   -- verbatim KernelResult.versions (AP4)
  kernel_image_digest TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  derived_from_artifact_ids_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE model_call (
  id TEXT PRIMARY KEY,
  run_id TEXT,                   -- Concord reconciliation run id, when applicable
  session_id TEXT,               -- Relay session, when applicable
  turn_id TEXT,
  purpose TEXT NOT NULL,         -- nl_translation | narration | chat | ...
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  prompt_hash TEXT,              -- hashes only, never prompt text (security.md §6)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_model_call_run_id ON model_call(run_id);

-- Staged for Phase 08: the copy registry's D1 mirror. The authoritative files
-- live in the estate repo (in-product-copy/*.json).
CREATE TABLE copy_entry (
  id TEXT PRIMARY KEY,           -- the copy id, e.g. 'error.upload.too_large'
  kind TEXT NOT NULL CHECK (kind IN ('tooltip', 'empty_state', 'onboarding', 'error',
    'validation', 'setting_description', 'feature_availability', 'label')),
  text TEXT NOT NULL,
  surface_location TEXT NOT NULL,
  references_facts_json TEXT NOT NULL DEFAULT '[]',
  owner TEXT NOT NULL,
  editorial_register TEXT NOT NULL CHECK (editorial_register IN ('terse_ui', 'friendly_help', 'technical_reference')),
  interpolations_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
