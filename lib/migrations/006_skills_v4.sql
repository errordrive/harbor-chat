-- Harbor Chat v4.0 — skills ecosystem: versions, execution history, updates.
-- Idempotent: safe to run on every boot.

-- Version history for custom skills (rollback support).
CREATE TABLE IF NOT EXISTS skill_versions (
  id SERIAL PRIMARY KEY,
  skill_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,            -- full versioned manifest
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions (skill_id, version);

-- Skill execution history (per user, per skill).
CREATE TABLE IF NOT EXISTS skill_executions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL DEFAULT '1.0.0',
  input_summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',  -- completed | failed | cancelled
  output_summary TEXT NOT NULL DEFAULT '',
  duration_ms INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_executions_user_idx ON skill_executions (user_id, created_at DESC);

-- Extend user_skills with manifest fields (v4.0).
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT '';
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS manifest JSONB NOT NULL DEFAULT '{}';
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS test_cases JSONB NOT NULL DEFAULT '[]';
