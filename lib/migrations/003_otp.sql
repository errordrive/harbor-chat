-- Harbor Chat — email OTP authentication.
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS email_otps (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,              -- 'signup' | 'login'
  attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_otps_email_idx ON email_otps (email, purpose);
