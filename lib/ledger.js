'use strict';
/**
 * Token ledger on Postgres — reserve -> call -> settle.
 *
 * The DECISION math is not reimplemented here: it calls the pure functions
 * in ./lib/accounting.js (estimateTokens, checkReserve, governorState) on
 * state fetched from the DB. This file only does the read-modify-write.
 *
 * Tables: daily_usage (per user/day), model_usage (per user/model window),
 * pool_usage (global single row), usage_events (append-only ledger).
 *
 * Note: the day bucket is passed as a 'YYYY-MM-DD' (UTC) parameter rather
 * than SQL CURRENT_DATE, so the boundary is explicit and test-friendly.
 */
const accounting = require('./accounting');
const log = require('./log');

function createLedger(pool, { modelWindowDays, modelWindowTokens }) {
  const nowMs = () => Date.now();
  const todayStr = () => new Date(nowMs()).toISOString().slice(0, 10);

  // Build the { users: {...} } shape that accounting.checkReserve expects,
  // from live DB counters. Rows are locked FOR UPDATE inside the caller's txn.
  async function loadState(client, userId, model, today) {
    const now = nowMs();
    const d = await client.query(
      'SELECT tokens, agent_runs FROM daily_usage WHERE user_id = $1 AND day = $2',
      [userId, today]
    );
    const m = await client.query(
      'SELECT window_start, tokens FROM model_usage WHERE user_id = $1 AND model = $2',
      [userId, model]
    );
    const dayTokens = d.rows.length ? Number(d.rows[0].tokens) : 0;
    let bucket = m.rows.length
      ? { windowStart: new Date(m.rows[0].window_start).getTime(), tokens: Number(m.rows[0].tokens) }
      : null;
    if (!bucket || now - bucket.windowStart > modelWindowDays * 86400000) {
      bucket = { windowStart: now, tokens: 0 };
      await client.query(
        `INSERT INTO model_usage (user_id, model, window_start, tokens) VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, model) DO UPDATE SET window_start = $3, tokens = 0`,
        [userId, model, new Date(now)]
      );
    }
    return {
      users: {
        [userId]: {
          day: today, dayTokens, lastSeen: now,
          models: { [model]: bucket },
        },
      },
    };
  }

  async function ensureDailyRow(client, userId, today) {
    await client.query(
      'INSERT INTO daily_usage (user_id, day, tokens, agent_runs) VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING',
      [userId, today]
    );
  }

  /**
   * Reserve `needTokens` from the user's daily + per-model budgets.
   * Returns { denied } or { reservation }.
   * `lim` = { daily, model } resolved from the user's plan.
   */
  async function reserve(userId, model, needTokens, lim, kind) {
    const today = todayStr();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureDailyRow(client, userId, today);
      await client.query('SELECT tokens FROM daily_usage WHERE user_id = $1 AND day = $2 FOR UPDATE', [userId, today]);
      await client.query('SELECT tokens FROM model_usage WHERE user_id = $1 AND model = $2 FOR UPDATE', [userId, model]);
      const state = await loadState(client, userId, model, today);
      const denied = accounting.checkReserve(state, userId, model, needTokens, lim, modelWindowDays, nowMs());
      if (denied) {
        await client.query('ROLLBACK');
        return { denied };
      }
      await client.query('UPDATE daily_usage SET tokens = tokens + $1 WHERE user_id = $2 AND day = $3', [needTokens, userId, today]);
      await client.query('UPDATE model_usage SET tokens = tokens + $1 WHERE user_id = $2 AND model = $3', [needTokens, userId, model]);
      await client.query('COMMIT');
      return { reservation: { userId, model, kind, reserved: needTokens, day: today } };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Top up an existing reservation by `amount` (agent per-step top-up).
   * Returns { denied } or { reservation } (reservation.reserved updated).
   */
  async function topUp(reservation, amount, lim) {
    const r = await reserve(reservation.userId, reservation.model, amount, lim, reservation.kind);
    if (r.denied) return r;
    reservation.reserved += amount;
    return { reservation };
  }

  /**
   * Settle: replace the reservation with the true spend, append to the
   * usage_events ledger, and add the true spend to the global pool.
   */
  async function settle(reservation, promptTokens, completionTokens) {
    const today = reservation.day || todayStr();
    const actual = Math.max(0, promptTokens | 0) + Math.max(0, completionTokens | 0);
    const diff = reservation.reserved - actual; // >0 releases unused budget
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (diff !== 0) {
        await client.query(
          'UPDATE daily_usage SET tokens = GREATEST(0, tokens - $1::bigint) WHERE user_id = $2 AND day = $3',
          [diff, reservation.userId, today]
        );
        await client.query(
          'UPDATE model_usage SET tokens = GREATEST(0, tokens - $1::bigint) WHERE user_id = $2 AND model = $3',
          [diff, reservation.userId, reservation.model]
        );
      }
      await client.query(
        'INSERT INTO usage_events (user_id, model, kind, prompt_tokens, completion_tokens) VALUES ($1, $2, $3, $4, $5)',
        [reservation.userId, reservation.model, reservation.kind, Math.max(0, promptTokens | 0), Math.max(0, completionTokens | 0)]
      );
      // Global pool (single row, rolling window).
      const now = nowMs();
      const g = await client.query('SELECT window_start FROM pool_usage WHERE id = 1 FOR UPDATE');
      if (now - new Date(g.rows[0].window_start).getTime() > modelWindowDays * 86400000) {
        await client.query('UPDATE pool_usage SET window_start = $1, tokens = $2 WHERE id = 1', [new Date(now), actual]);
      } else {
        await client.query('UPDATE pool_usage SET tokens = tokens + $1 WHERE id = 1', [actual]);
      }
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      log.error('ledger settle failed', { error: e.message, userId: reservation.userId });
      throw e;
    } finally {
      client.release();
    }
    return actual;
  }

  // --- agent daily quota (from the plan, stored in DB) ---
  async function checkAgentQuota(userId, agentRunsDay) {
    const { rows } = await pool.query(
      'SELECT agent_runs FROM daily_usage WHERE user_id = $1 AND day = $2',
      [userId, todayStr()]
    );
    const used = rows.length ? Number(rows[0].agent_runs) : 0;
    if (used >= agentRunsDay) return { type: 'agent', used, limit: agentRunsDay };
    return null;
  }
  async function recordAgentRun(userId) {
    await pool.query(
      `INSERT INTO daily_usage (user_id, day, tokens, agent_runs) VALUES ($1, $2, 0, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET agent_runs = daily_usage.agent_runs + 1`,
      [userId, todayStr()]
    );
  }

  // --- usage summary for /api/usage ---
  async function summary(userId, plan, pinnedModels, modelLabel) {
    const now = nowMs();
    const today = todayStr();
    const d = await pool.query(
      'SELECT tokens, agent_runs FROM daily_usage WHERE user_id = $1 AND day = $2', [userId, today]
    );
    const dayTokens = d.rows.length ? Number(d.rows[0].tokens) : 0;
    const agentRuns = d.rows.length ? Number(d.rows[0].agent_runs) : 0;
    const m = await pool.query('SELECT model, window_start, tokens FROM model_usage WHERE user_id = $1', [userId]);
    const models = [];
    const seen = new Set();
    const byId = new Map(m.rows.map((r) => [r.model, r]));
    for (const p of pinnedModels) {
      const r = byId.get(p.id);
      let tokens = 0;
      if (r && now - new Date(r.window_start).getTime() <= modelWindowDays * 86400000) tokens = Number(r.tokens);
      models.push({ id: p.id, label: p.label, used: tokens, limit: modelWindowTokens, windowDays: modelWindowDays });
      seen.add(p.id);
    }
    for (const r of m.rows) {
      if (seen.has(r.model)) continue;
      if (now - new Date(r.window_start).getTime() > modelWindowDays * 86400000) continue;
      if (Number(r.tokens) <= 0) continue;
      models.push({ id: r.model, label: modelLabel(r.model), used: Number(r.tokens), limit: modelWindowTokens, windowDays: modelWindowDays });
    }
    return { dayTokens, agentRuns, models };
  }

  return { reserve, topUp, settle, checkAgentQuota, recordAgentRun, summary };
}

module.exports = { createLedger };
