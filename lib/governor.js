'use strict';
/**
 * Global pool governor. Reads the pool_usage row and applies the pure
 * accounting.governorState math. Phase 1B's admin dashboard reads this too.
 */
const accounting = require('./accounting');

function createGovernor(pool, { poolTotalTokens, poolWindowDays }) {
  async function state() {
    const { rows } = await pool.query('SELECT window_start, tokens FROM pool_usage WHERE id = 1');
    const r = rows[0] || { window_start: new Date(0), tokens: 0 };
    const gdb = { windowStart: new Date(r.window_start).getTime(), tokens: Number(r.tokens) };
    return accounting.governorState(gdb, poolTotalTokens, poolWindowDays, Date.now());
  }
  return { state };
}

module.exports = { createGovernor };
