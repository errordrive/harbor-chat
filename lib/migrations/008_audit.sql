-- Harbor Chat v4.0 — audit log for security-sensitive actions.
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id TEXT,                        -- NULL for system/anonymous
  action TEXT NOT NULL,                -- 'login', 'signup', 'password_reset', 'admin_ban', etc.
  detail JSONB NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, created_at DESC);
