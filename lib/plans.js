'use strict';
/**
 * Plan/tier engine. Plans live in the DB (editable from the admin panel in
 * Phase 1B); this module caches them in memory and refreshes periodically,
 * so plan changes apply without a restart.
 */
const log = require('./log');

const FALLBACK_PLANS = {
  free: { id: 'free', name: 'Free', daily_credits: 60000, max_output_tokens: 4096, context_tokens: 32000, agent_runs_day: 1, allowed_models: ['*'], price_bdt: 0 },
  plus: { id: 'plus', name: 'Plus', daily_credits: 180000, max_output_tokens: 8192, context_tokens: 64000, agent_runs_day: 10, allowed_models: ['*'], price_bdt: 299 },
  pro: { id: 'pro', name: 'Pro', daily_credits: 600000, max_output_tokens: 32000, context_tokens: 128000, agent_runs_day: 50, allowed_models: ['*'], price_bdt: 799 },
};

function createPlans(pool, { refreshMs = 60000 } = {}) {
  let cache = { ...FALLBACK_PLANS };
  let timer = null;

  async function refresh() {
    try {
      const { rows } = await pool.query('SELECT * FROM plans ORDER BY sort');
      if (rows.length) {
        const next = {};
        for (const r of rows) next[r.id] = r;
        cache = next;
      }
    } catch (e) {
      log.error('plans refresh failed, keeping cache', { error: e.message });
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(refresh, refreshMs);
    if (timer.unref) timer.unref();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function get(planId) {
    return cache[planId] || cache.free;
  }
  function all() {
    return Object.values(cache).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }
  // Model allowlist is now "public models enabled for that plan".
  function modelAllowed(plan, modelId) {
    const list = plan.allowed_models || ['*'];
    return list.includes('*') || list.includes(modelId);
  }

  return { refresh, start, stop, get, all, modelAllowed };
}

module.exports = { createPlans, FALLBACK_PLANS };
