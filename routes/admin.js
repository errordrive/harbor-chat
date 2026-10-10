'use strict';
/**
 * Admin API: dashboard stats, user management, plan editing, ledger view.
 * Every route requires an admin session (is_admin flag on the user).
 */
const { readJson, sendJson, csrfOk } = require('../lib/http');
const { requireAdmin } = require('../lib/admin');
const { encrypt } = require('../lib/crypto');
const log = require('../lib/log');

function mount(add, ctx) {
  const { pool, auth, config, plans, governor, gateway } = ctx;

  const gate = async (req, res) => {
    if (!csrfOk(req)) { sendJson(res, 403, { error: 'CSRF check failed' }); return null; }
    return requireAdmin(pool, auth, req, res);
  };

  // ---- dashboard stats ----
  add('GET', '/api/admin/stats', async (req, res) => {
    if (!(await gate(req, res))) return;
    try {
      const g = await governor.state().catch(() => ({ remaining: 0 }));
      const users = await pool.query('SELECT COUNT(*)::int AS n FROM users');
      const signups = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE created_at > now() - interval '24 hours'"
      );
      const today = await pool.query(
        `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS tokens,
                COUNT(*)::int AS calls
         FROM usage_events WHERE created_at > now() - interval '24 hours'`
      );
      const byPlan = await pool.query(
        'SELECT plan_id, COUNT(*)::int AS n FROM users GROUP BY plan_id'
      );
      return sendJson(res, 200, {
        ok: true,
        pool: {
          remaining: g.remaining, total: config.poolTotalTokens,
          strained: g.remaining < config.poolTotalTokens * 0.25,
          critical: g.remaining < config.poolTotalTokens * 0.05,
        },
        users: users.rows[0].n,
        signups24h: signups.rows[0].n,
        tokens24h: Number(today.rows[0].tokens),
        calls24h: today.rows[0].calls,
        byPlan: byPlan.rows,
      });
    } catch (e) {
      log.error('admin stats failed', { error: e.message });
      return sendJson(res, 500, { error: 'Could not load stats.' });
    }
  });

  // ---- users list ----
  add('GET', '/api/admin/users', async (req, res, query) => {
    if (!(await gate(req, res))) return;
    const search = String(query.search || '').trim().toLowerCase().slice(0, 100);
    const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 100);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
    try {
      const where = search ? 'WHERE email ILIKE $1 OR name ILIKE $1' : '';
      const params = search ? [`%${search}%`] : [];
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.name, u.plan_id, u.is_admin, u.banned, u.email_verified,
                u.created_at,
                COALESCE(d.tokens, 0)::bigint AS tokens_today,
                COALESCE(d.agent_runs, 0)::int AS agent_runs_today
         FROM users u
         LEFT JOIN daily_usage d ON d.user_id = u.id AND d.day = CURRENT_DATE::date
         ${where}
         ORDER BY u.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users u ${where}`, params
      );
      return sendJson(res, 200, { ok: true, users: rows, total: count.rows[0].n });
    } catch (e) {
      log.error('admin users failed', { error: e.message });
      return sendJson(res, 500, { error: 'Could not load users.' });
    }
  });

  // ---- change user plan ----
  add('POST', '/api/admin/users/plan', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const plan = plans.get(body.plan_id);
    if (!plan || !plans.all().some((p) => p.id === body.plan_id)) {
      return sendJson(res, 400, { error: 'Invalid plan.' });
    }
    await pool.query('UPDATE users SET plan_id = $1 WHERE id = $2', [body.plan_id, body.user_id]);
    log.info('admin changed plan', { adminId: admin.id, userId: body.user_id, plan: body.plan_id });
    // Refresh the plan cache so it picks up any recent DB edits.
    await plans.refresh().catch(() => {});
    return sendJson(res, 200, { ok: true });
  });

  // ---- ban / unban user ----
  add('POST', '/api/admin/users/ban', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (body.user_id === admin.id) return sendJson(res, 400, { error: 'You cannot ban yourself.' });
    // Bumping sv invalidates all of the user's sessions.
    await pool.query('UPDATE users SET banned = $1, sv = sv + 1 WHERE id = $2',
      [!!body.banned, body.user_id]);
    log.info('admin ban change', { adminId: admin.id, userId: body.user_id, banned: !!body.banned });
    return sendJson(res, 200, { ok: true });
  });

  // ---- plans list ----
  add('GET', '/api/admin/plans', async (req, res) => {
    if (!(await gate(req, res))) return;
    return sendJson(res, 200, { ok: true, plans: plans.all() });
  });

  // ---- update plan ----
  add('PUT', '/api/admin/plans', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const p = body.plan;
    if (!p || !p.id || !plans.get(p.id)) return sendJson(res, 400, { error: 'Invalid plan.' });
    const int = (v, min, max) => {
      const n = parseInt(v, 10);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const daily = int(p.daily_credits, 0, 100000000);
    const maxOut = int(p.max_output_tokens, 256, 128000);
    const ctxTokens = int(p.context_tokens, 1000, 1000000);
    const agentRuns = int(p.agent_runs_day, 0, 1000);
    const price = int(p.price_bdt, 0, 1000000);
    if ([daily, maxOut, ctxTokens, agentRuns, price].some((v) => v === null)) {
      return sendJson(res, 400, { error: 'One or more values are out of range.' });
    }
    const name = String(p.name || '').trim().slice(0, 40) || p.id;
    await pool.query(
      `UPDATE plans SET name = $1, daily_credits = $2, max_output_tokens = $3,
        context_tokens = $4, agent_runs_day = $5, price_bdt = $6 WHERE id = $7`,
      [name, daily, maxOut, ctxTokens, agentRuns, price, p.id]
    );
    await plans.refresh();
    log.info('admin updated plan', { adminId: admin.id, plan: p.id });
    return sendJson(res, 200, { ok: true, plans: plans.all() });
  });

  // ---- recent usage events ----
  add('GET', '/api/admin/events', async (req, res, query) => {
    if (!(await gate(req, res))) return;
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
    try {
      const { rows } = await pool.query(
        `SELECT e.id, e.user_id, u.email, e.model, e.kind,
                e.prompt_tokens, e.completion_tokens, e.created_at
         FROM usage_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.id DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return sendJson(res, 200, { ok: true, events: rows });
    } catch (e) {
      log.error('admin events failed', { error: e.message });
      return sendJson(res, 500, { error: 'Could not load events.' });
    }
  });
// ==================== PROVIDERS ====================

  add('GET', '/api/admin/providers', async (req, res) => {
    if (!(await gate(req, res))) return;
    const { rows } = await pool.query(
      'SELECT id, name, base_url, enabled, created_at, (api_key_enc IS NOT NULL) AS has_key FROM providers ORDER BY id'
    );
    return sendJson(res, 200, { ok: true, providers: rows });
  });

  add('POST', '/api/admin/providers', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const name = String(body.name || '').trim().slice(0, 80);
    const baseUrl = String(body.base_url || '').trim().slice(0, 200);
    if (!id || !name || !/^https?:\/\/.+/.test(baseUrl)) {
      return sendJson(res, 400, { error: 'id, name and a valid https base_url are required.' });
    }
    const enc = body.api_key ? encrypt(config.sessionSecret, String(body.api_key)) : null;
    await pool.query(
      `INSERT INTO providers (id, name, base_url, api_key_enc, enabled)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id) DO UPDATE SET name = $2, base_url = $3,
         api_key_enc = COALESCE($4, providers.api_key_enc)`,
      [id, name, baseUrl, enc]
    );
    await gateway.refresh();
    log.info('admin upserted provider', { adminId: admin.id, provider: id });
    return sendJson(res, 200, { ok: true });
  });

  add('POST', '/api/admin/providers/toggle', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    await pool.query('UPDATE providers SET enabled = $1 WHERE id = $2', [!!body.enabled, String(body.id || '')]);
    await gateway.refresh();
    return sendJson(res, 200, { ok: true });
  });

  add('DELETE', '/api/admin/providers', async (req, res, query) => {
    const admin = await gate(req, res);
    if (!admin) return;
    const id = String(query.id || '');
    if (id === 'tokenharbor') return sendJson(res, 400, { error: 'The default provider cannot be deleted.' });
    await pool.query('DELETE FROM providers WHERE id = $1', [id]);
    await gateway.refresh();
    log.info('admin deleted provider', { adminId: admin.id, provider: id });
    return sendJson(res, 200, { ok: true });
  });

  // ==================== MODELS ====================

  add('GET', '/api/admin/models', async (req, res) => {
    if (!(await gate(req, res))) return;
    const { rows } = await pool.query(
      'SELECT m.*, p.name AS provider_name FROM gateway_models m JOIN providers p ON p.id = m.provider_id ORDER BY m.id'
    );
    return sendJson(res, 200, { ok: true, models: rows });
  });

  add('POST', '/api/admin/models', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || '').trim().slice(0, 120);
    const providerId = String(body.provider_id || '').trim();
    const displayName = String(body.display_name || id).trim().slice(0, 80);
    if (!id || !providerId) return sendJson(res, 400, { error: 'id and provider_id are required.' });
    const prov = await pool.query('SELECT id FROM providers WHERE id = $1', [providerId]);
    if (!prov.rows.length) return sendJson(res, 400, { error: 'Provider not found.' });
    await pool.query(
      `INSERT INTO gateway_models (id, provider_id, display_name, enabled, is_free)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (id) DO UPDATE SET provider_id = $2, display_name = $3, is_free = $4`,
      [id, providerId, displayName, body.is_free !== false]
    );
    await gateway.refresh();
    log.info('admin upserted model', { adminId: admin.id, model: id });
    return sendJson(res, 200, { ok: true });
  });

  add('POST', '/api/admin/models/toggle', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    await pool.query('UPDATE gateway_models SET enabled = $1 WHERE id = $2', [!!body.enabled, String(body.id || '')]);
    await gateway.refresh();
    return sendJson(res, 200, { ok: true });
  });

  add('DELETE', '/api/admin/models', async (req, res, query) => {
    const admin = await gate(req, res);
    if (!admin) return;
    await pool.query('DELETE FROM gateway_models WHERE id = $1', [String(query.id || '')]);
    await pool.query('DELETE FROM model_fallbacks WHERE model_id = $1 OR fallback_model_id = $1', [String(query.id || '')]);
    await gateway.refresh();
    return sendJson(res, 200, { ok: true });
  });

  // ==================== FALLBACK CHAINS ====================

  add('GET', '/api/admin/fallbacks', async (req, res) => {
    if (!(await gate(req, res))) return;
    const { rows } = await pool.query('SELECT * FROM model_fallbacks ORDER BY plan_id NULLS FIRST, model_id, position');
    return sendJson(res, 200, { ok: true, fallbacks: rows });
  });

  add('POST', '/api/admin/fallbacks', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    // body: { plan_id (or null), chain: [modelId, fallback1, fallback2, ...] }
    const planId = body.plan_id || null;
    const chain = Array.isArray(body.chain) ? body.chain.map(String).filter(Boolean) : [];
    if (chain.length < 2) return sendJson(res, 400, { error: 'Chain needs at least 2 models.' });
    await pool.query('DELETE FROM model_fallbacks WHERE plan_id IS NOT DISTINCT FROM $1 AND model_id = $2', [planId, chain[0]]);
    for (let i = 1; i < chain.length; i++) {
      await pool.query(
        'INSERT INTO model_fallbacks (plan_id, model_id, fallback_model_id, position) VALUES ($1, $2, $3, $4)',
        [planId, chain[0], chain[i], i]
      );
    }
    await gateway.refresh();
    log.info('admin set fallback chain', { adminId: admin.id, model: chain[0] });
    return sendJson(res, 200, { ok: true });
  });

  add('DELETE', '/api/admin/fallbacks', async (req, res, query) => {
    const admin = await gate(req, res);
    if (!admin) return;
    const planId = query.plan_id || null;
    await pool.query('DELETE FROM model_fallbacks WHERE plan_id IS NOT DISTINCT FROM $1 AND model_id = $2',
      [planId, String(query.model_id || '')]);
    await gateway.refresh();
    return sendJson(res, 200, { ok: true });
  });

  // ==================== FEATURE FLAGS ====================

  add('GET', '/api/admin/flags', async (req, res) => {
    if (!(await gate(req, res))) return;
    const { rows } = await pool.query('SELECT id, enabled FROM feature_flags ORDER BY id');
    return sendJson(res, 200, { ok: true, flags: rows });
  });

  add('POST', '/api/admin/flags', async (req, res) => {
    const admin = await gate(req, res);
    if (!admin) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const allowed = ['chat_enabled', 'agent_enabled', 'auto_model_switch'];
    if (!allowed.includes(body.id)) return sendJson(res, 400, { error: 'Unknown flag.' });
    await pool.query(
      `INSERT INTO feature_flags (id, enabled, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET enabled = $2, updated_at = now()`,
      [body.id, !!body.enabled]
    );
    await gateway.refresh();
    log.info('admin set flag', { adminId: admin.id, flag: body.id, enabled: !!body.enabled });
    return sendJson(res, 200, { ok: true });
  });

  // ==================== PROVIDER DIAGNOSTICS ====================
  // Health stats without secrets: success rates, circuits, error categories.

  add('GET', '/api/admin/diagnostics', async (req, res) => {
    if (!(await gate(req, res))) return;
    const gw = ctx.gatewayUpstream;
    const healthStats = gw?.health ? gw.health.allStats() : {};
    const models = await gateway.listModels().catch(() => []);
    return sendJson(res, 200, {
      ok: true,
      models: models.map((m) => ({
        id: m.id, provider_id: m.provider_id, display_name: m.display_name,
        enabled: m.enabled, health: healthStats[m.id] || { calls: 0, success_rate: 1, circuit: 'closed', by_category: {} },
      })),
      auto_switch: await gateway.flag('auto_model_switch', false).catch(() => false),
    });
  });
  // ==================== AUDIT LOG ====================

  add('GET', '/api/admin/audit', async (req, res, query) => {
    if (!(await gate(req, res))) return;
    const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset || '0', 10) || 0, 0);
    try {
      const { rows } = await pool.query(
        `SELECT a.*, u.email FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return sendJson(res, 200, { ok: true, events: rows });
    } catch (e) {
      return sendJson(res, 500, { error: 'Could not load audit log.' });
    }
  });
}

module.exports = { mount };
