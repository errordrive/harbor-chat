-- User-owned custom skills and per-user installation state.
CREATE TABLE IF NOT EXISTS user_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_skills_user_idx ON user_skills(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS skill_installations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill_id)
);
