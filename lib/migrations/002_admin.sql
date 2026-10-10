-- Harbor Chat — admin panel support.
-- Idempotent: safe to run on every boot.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS users_is_admin_idx ON users (is_admin) WHERE is_admin = TRUE;
