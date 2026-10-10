'use strict';
/**
 * One-time import of the Phase 0 JSON files (data/users.json, data/usage.json)
 * into Postgres. Runs on boot only when the users table is empty and the
 * JSON files exist. Existing JSON accounts are grandfathered as
 * email_verified=true (they signed up before verification existed).
 */
const fs = require('fs');
const path = require('path');
const log = require('./log');

async function importJsonIfNeeded(pool, dataDir) {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n > 0) return; // already populated
    const usersFile = path.join(dataDir, 'users.json');
    if (!fs.existsSync(usersFile)) return;
    const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const users = Object.values((raw && raw.users) || {});
    if (!users.length) return;
    log.info('importing JSON accounts to Postgres', { count: users.length });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of users) {
        if (!u || !u.id || !u.email || !u.pass) continue;
        await client.query(
          `INSERT INTO users (id, email, name, pass, plan_id, sv, email_verified, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
           ON CONFLICT (id) DO NOTHING`,
          [u.id, String(u.email).toLowerCase(), u.name || 'User', u.pass,
           ['free', 'plus', 'pro'].includes(u.plan) ? u.plan : 'free',
           u.sv || 0, new Date(u.createdAt || Date.now())]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    log.info('JSON import done');
  } catch (e) {
    log.error('JSON import failed (non-fatal)', { error: e.message });
  }
}

module.exports = { importJsonIfNeeded };
