-- Harbor Chat v4.0 — workflows + workspaces.
-- Idempotent: safe to run on every boot.

-- Reusable workflow definitions (user-created or templates).
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template_id TEXT,                   -- 'repair' | 'research-build' | etc, NULL for custom
  steps JSONB NOT NULL DEFAULT '[]',   -- [{id, title, kind, depends_on[], config}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_user_idx ON workflows (user_id);

-- Workflow execution runs (history).
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed | cancelled
  current_step TEXT,
  result JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workflow_runs_user_idx ON workflow_runs (user_id, started_at DESC);

-- User workspaces (isolated file areas, mapped to disk under WORKSPACE_ROOT/<user_id>/).
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_user_idx ON workspaces (user_id);
