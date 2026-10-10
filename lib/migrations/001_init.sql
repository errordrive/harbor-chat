-- Harbor Chat Phase 1 — initial schema.
-- Idempotent: safe to run on every boot.
-- (The `migrations` tracking table is created by lib/db.js before this runs.)

-- Plan tiers (config-driven; edited from the admin panel in Phase 1B).
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  daily_credits INTEGER NOT NULL CHECK (daily_credits >= 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
  context_tokens INTEGER NOT NULL CHECK (context_tokens > 0),
  agent_runs_day INTEGER NOT NULL CHECK (agent_runs_day >= 0),
  allowed_models JSONB NOT NULL DEFAULT '["*"]',
  price_bdt INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plans (id, name, daily_credits, max_output_tokens, context_tokens, agent_runs_day, allowed_models, price_bdt, sort)
VALUES
  ('free', 'Free', 60000, 4096, 32000, 1, '["*"]', 0, 1),
  ('plus', 'Plus', 180000, 8192, 64000, 10, '["*"]', 299, 2),
  ('pro', 'Pro', 600000, 32000, 128000, 50, '["*"]', 799, 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
  sv INTEGER NOT NULL DEFAULT 0,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS email_verifications (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Per-user daily counters (tokens + agent runs). One row per user per day.
CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  tokens BIGINT NOT NULL DEFAULT 0,
  agent_runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Per-user per-model rolling window counters.
CREATE TABLE IF NOT EXISTS model_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, model)
);

-- Global pool ledger (single row).
CREATE TABLE IF NOT EXISTS pool_usage (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  tokens BIGINT NOT NULL DEFAULT 0
);
INSERT INTO pool_usage (id, window_start, tokens)
  VALUES (1, now(), 0) ON CONFLICT (id) DO NOTHING;

-- Append-only usage ledger (every settled call writes one row).
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'agent')),
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events (user_id, created_at DESC);
