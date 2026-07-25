-- Migration 0002 — Phase 03 adds the project description field.
-- 0001 is already applied and is never edited (constraints.md G6).
ALTER TABLE project ADD COLUMN description TEXT;
