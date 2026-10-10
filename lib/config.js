'use strict';
/**
 * Centralized environment configuration. All env vars are parsed and
 * validated once at boot; modules receive what they need via ctx.
 * Fail fast on missing REQUIRED vars with a clear message.
 *
 * Local dev: if `.env.local` exists (created by `neon link`), its values
 * are loaded for any vars not already set in the environment.
 */
const fs = require('fs');
const path = require('path');

(function loadLocalEnv() {
  try {
    const f = path.join(__dirname, '..', '.env.local');
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch (e) { /* non-fatal */ }
})();
function int(name, def) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isInteger(v) && v >= 0 ? v : def;
}
function str(name, def) {
  const v = (process.env[name] || '').trim();
  return v || def;
}

const config = {
  port: int('PORT', 3000),
  tokenHarborKey: str('TOKENHARBOR_KEY', ''),
  tokenHarborBase: str('TOKENHARBOR_BASE', 'https://tokenharbor.ai/v1').replace(/\/+$/, ''),
  databaseUrl: str('DATABASE_URL', ''),
  sessionSecret: str('SESSION_SECRET', ''),
  sessionDays: int('SESSION_DAYS', 30),
  trustProxyHops: (() => {
    const v = parseInt(process.env.TRUST_PROXY_HOPS || '', 10);
    return Number.isInteger(v) && v >= 0 ? v : 1;
  })(),

  // Budgets
  dailyTokenLimit: int('DAILY_TOKEN_LIMIT', 60000), // fallback if plans table unreachable
  modelWindowTokenLimit: int('MODEL_WINDOW_TOKEN_LIMIT', 800000),
  modelWindowDays: int('MODEL_WINDOW_DAYS', 28),
  maxOutputTokens: int('MAX_OUTPUT_TOKENS', 32000), // absolute server cap

  // Pool governor
  poolTotalTokens: int('POOL_TOTAL_TOKENS', 3000000),
  poolWindowDays: int('POOL_WINDOW_DAYS', 30),

  // Agent
  agentSteps: 6,

  // Email (Resend)
  resendApiKey: str('RESEND_API_KEY', ''),
  mailFrom: str('MAIL_FROM', 'Harbor Chat <noreply@nayem.me>'),
  appBaseUrl: str('APP_BASE_URL', ''), // e.g. https://harbor-chat.onrender.com (for email links)
  requireEmailVerification: (process.env.REQUIRE_EMAIL_VERIFICATION || 'true').toLowerCase() !== 'false',
  allowMailLog: (process.env.ALLOW_MAIL_LOG || '').toLowerCase() === 'true', // dev only: return links in API response

  // Turnstile (Cloudflare) — optional; skipped with a warning when unset
  turnstileSecretKey: str('TURNSTLE_SECRET_KEY', ''),
  turnstileSiteKey: str('TURNSTLE_SITE_KEY', ''),

  // Admin panel: comma-separated emails auto-promoted to admin on boot.
  adminEmails: str('ADMIN_EMAILS', '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 120000),
  isProd: (process.env.NODE_ENV || '') === 'production',
};

function checkRequired(log) {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.tokenHarborKey) log.warn('TOKENHARBOR_KEY is not set — /api/chat and /api/agent will error until you set it.');
  if (missing.length) {
    throw new Error('Missing required env vars: ' + missing.join(', '));
  }
  if (config.requireEmailVerification && !config.resendApiKey && !config.allowMailLog) {
    log.warn('REQUIRE_EMAIL_VERIFICATION=true but no RESEND_API_KEY — signups will fail to send verification emails. Set RESEND_API_KEY or ALLOW_MAIL_LOG=true (dev only).');
  }
  if (!config.sessionSecret) {
    log.warn('SESSION_SECRET is not set — sessions will not survive restarts. Set a 32+ char random string.');
  }
  if (!config.turnstileSecretKey) {
    log.warn('TURNSTLE_SECRET_KEY is not set — captcha is skipped. Set it for production.');
  }
}

module.exports = { config, checkRequired };
