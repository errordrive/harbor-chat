-- Harbor Chat — multi-provider gateway + model management + feature flags.
-- Idempotent: safe to run on every boot.

-- AI providers (upstream API endpoints). API keys are AES-256-GCM encrypted.
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,                -- 'tokenharbor', 'openrouter'
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,             -- 'https://api.tokenharbor.example/v1'
  api_key_enc TEXT,                   -- encrypted; NULL = use env var fallback
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Models served through the gateway.
CREATE TABLE IF NOT EXISTS gateway_models (
  id TEXT PRIMARY KEY,                -- 'claude-haiku-5.5:free'
  provider_id TEXT NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_free BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gateway_models_provider_idx ON gateway_models (provider_id);

-- Ordered fallback chains. plan_id NULL = global default chain.
-- When auto-switch is ON and a model errors, the next enabled model in the
-- chain is tried. OFF by default (see feature_flags).
CREATE TABLE IF NOT EXISTS model_fallbacks (
  id SERIAL PRIMARY KEY,
  plan_id TEXT,                       -- NULL = applies to all plans
  model_id TEXT NOT NULL,
  fallback_model_id TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  UNIQUE (plan_id, model_id, fallback_model_id)
);

-- Global feature flags (admin-toggled).
CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,                -- 'chat_enabled', 'agent_enabled', 'auto_model_switch'
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the current single provider + pinned models so the gateway works
-- exactly like before until the admin changes it.
INSERT INTO providers (id, name, base_url, enabled)
VALUES ('tokenharbor', 'Token Harbor', 'https://api.tokenharbor.example/v1', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO gateway_models (id, provider_id, display_name, enabled, is_free)
VALUES
  ('claude-haiku-5.5:free', 'tokenharbor', 'Claude Haiku 5.5', TRUE, TRUE),
  ('deepseek-v4.1-flash:free', 'tokenharbor', 'DeepSeek V4.1 Flash', TRUE, TRUE),
  ('mimo-v2.6-flash:free', 'tokenharbor', 'MiMo V2.6 Flash', TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Feature flags: chat + agent ON; auto model switch OFF by default
-- (strict same-model rule — the user's Q1 decision).
INSERT INTO feature_flags (id, enabled)
VALUES
  ('chat_enabled', TRUE),
  ('agent_enabled', TRUE),
  ('auto_model_switch', FALSE)
ON CONFLICT (id) DO NOTHING;
