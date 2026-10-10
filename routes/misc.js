'use strict';
/**
 * Misc routes: /api/health, /api/usage, /api/config (public, non-secret),
 * /api/plans (public plan list for the pricing UI).
 */
const { sendJson } = require('../lib/http');
const log = require('../lib/log');

function mount(add, ctx) {
  const { pool, auth, config, plans, ledger, governor, pinnedModels, modelLabel } = ctx;

  add('GET', '/api/health', async (req, res) => {
    let dbOk = false;
    try {
      await pool.query('SELECT 1');
      dbOk = true;
    } catch (e) { /* db down */ }
    const g = await governor.state().catch(() => null);
    return sendJson(res, dbOk ? 200 : 503, {
      ok: dbOk,
      time: new Date().toISOString(),
      pool: g ? {
        remaining: g.remaining,
        total: config.poolTotalTokens,
        strained: g.remaining < config.poolTotalTokens * 0.25,
        critical: g.remaining < config.poolTotalTokens * 0.05,
      } : null,
    });
  });

  add('GET', '/api/usage', async (req, res) => {
    const user = await auth.getAuthUser(pool, req).catch(() => null);
    if (!user) return sendJson(res, 401, { error: 'Not signed in.' });
    const plan = plans.get(user.plan_id);
    try {
      const s = await ledger.summary(user.id, plan, pinnedModels, modelLabel);
      const g = await governor.state().catch(() => ({ remaining: Infinity }));
      return sendJson(res, 200, {
        ok: true,
        plan: plan.id,
        planName: plan.name,
        daily: { used: s.dayTokens, limit: plan.daily_credits },
        agent: { used: s.agentRuns, limit: plan.agent_runs_day },
        models: s.models,
        poolStrained: g.remaining < config.poolTotalTokens * 0.25,
      });
    } catch (e) {
      log.error('usage failed', { error: e.message, userId: user.id });
      return sendJson(res, 500, { error: 'Could not load usage.' });
    }
  });

  // Public, non-secret config for the frontend (Turnstile site key).
  add('GET', '/api/config', async (req, res) => {
    return sendJson(res, 200, {
      ok: true,
      turnstileSiteKey: config.turnstileSiteKey || null,
      requireEmailVerification: config.requireEmailVerification,
    });
  });

  add('GET', '/api/plans', async (req, res) => {
    const list = plans.all().map((p) => ({
      id: p.id, name: p.name,
      dailyCredits: p.daily_credits,
      maxOutputTokens: p.max_output_tokens,
      agentRunsDay: p.agent_runs_day,
      priceBdt: p.price_bdt || 0,
    }));
    return sendJson(res, 200, { ok: true, plans: list });
  });
}

module.exports = { mount };
