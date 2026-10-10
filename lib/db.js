'use strict';
/**
 * Postgres connection + migration runner.
 * Uses the `pg` driver. Migrations are plain SQL files in ./migrations,
 * applied in filename order and recorded in the `migrations` table.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const log = require('./log');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function createPool(databaseUrl) {
  // Local/test hook: USE_PGMEM=true boots the server against an in-memory
  // Postgres (pg-mem, devDependency). Production always uses real Postgres.
  if (process.env.USE_PGMEM === 'true') {
    let newDb;
    try {
      ({ newDb } = require('pg-mem'));
    } catch (e) {
      throw new Error('USE_PGMEM=true but pg-mem is not installed (npm i -D pg-mem)');
    }
    const { Pool: MemPool } = newDb().adapters.createPg();
    return new MemPool();
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Neon and most managed Postgres require TLS.
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => log.error('pg pool error', { error: err.message }));
  return pool;
}

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT id FROM migrations')).rows.map((r) => r.id));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const id = f.replace(/\.sql$/, '');
      if (done.has(id)) continue;
      log.info('applying migration', { id });
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      await client.query('BEGIN');
      try {
        // Run statement-by-statement (pg-mem and some drivers choke on
        // multi-statement strings). Migration files must not contain
        // semicolons inside string literals.
        for (const stmt of sql.split(/;[ \t]*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
          await client.query(stmt);
        }
        await client.query('INSERT INTO migrations (id) VALUES ($1)', [id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      log.info('migration applied', { id });
    }
  } finally {
    client.release();
  }
}

module.exports = { createPool, migrate };
