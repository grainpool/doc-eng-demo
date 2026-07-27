-- Migration 0005 — expansion Phase 1 (prompt-packets/relay-expansion/):
-- per-visitor demo workspaces and chat conversations. Forward-only (G6).
--
-- owner_id semantics (architecture.md §3 of the expansion packet):
--   'vis_…' — the browser that created the row (signed demo cookie)
--   'seed'  — deployed demo content, immutable through the API
--   NULL    — rows created before scoping shipped; NO API semantics
--             (invisible to reads, removed by the Phase-2 maintenance reset)

ALTER TABLE project ADD COLUMN owner_id TEXT;
CREATE INDEX idx_project_owner_id ON project(owner_id);

CREATE TABLE conversation (
  id TEXT PRIMARY KEY,                       -- cnv_…
  owner_id TEXT,                             -- vis_… | 'seed' | NULL (see header)
  project_id TEXT REFERENCES project(id),    -- nullable: chats may be global
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversation_owner_id ON conversation(owner_id);
CREATE INDEX idx_conversation_project_id ON conversation(project_id);

-- parts_json stores the AI SDK UIMessage.parts array VERBATIM: the wire shape
-- is the storage shape, so reloads hydrate without translation and future
-- part types need no migration.
CREATE TABLE conversation_message (
  id TEXT PRIMARY KEY,                       -- msg_…
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  parts_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_conversation_message_conversation_id
  ON conversation_message(conversation_id);
