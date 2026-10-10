'use strict';
/**
 * Ledger tests (Phase 1): reserve -> topUp -> settle against pg-mem
 * (in-memory Postgres). Verifies the SQL read-modify-write reuses the
 * accounting.js decision math correctly.
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');

const { createLedger } = require('../lib/ledger');
const { FALLBACK_PLANS } = require('../lib/plans');

const MODEL_DAYS = 28;
const MODEL_TOKENS = 800000;

let pool;
let ledger;

async function freshDb() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  pool = new Pool();
  const sql = fs.readFileSync(path.join(__dirname, '../lib/migrations/001_init.sql'), 'utf8');
  // pg-mem runs one statement at a time; split on semicolons.
  for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  ledger = createLedger(pool, { modelWindowDays: MODEL_DAYS, modelWindowTokens: MODEL_TOKENS });
  await pool.query(
    "INSERT INTO users (id, email, name, pass, plan_id, email_verified) VALUES ('u1', 'a@b.c', 'A', 'x', 'free', TRUE)"
  );
}

beforeEach(freshDb);

const lim = (plan) => ({ daily: plan.daily_credits, model: MODEL_TOKENS });

test('reserve then settle writes ledger event and releases unused budget', async () => {
  const plan = FALLBACK_PLANS.free;
  const today = new Date().toISOString().slice(0, 10);
  const r = await ledger.reserve('u1', 'm1', 5000, lim(plan), 'chat');
  assert.ok(!r.denied, 'should not be denied, got ' + JSON.stringify(r.denied));

  let d = await pool.query('SELECT tokens FROM daily_usage WHERE user_id = $1 AND day = $2', ['u1', today]);
  assert.equal(Number(d.rows[0].tokens), 5000);

  await ledger.settle(r.reservation, 1000, 500); // actual 1500

  d = await pool.query('SELECT tokens FROM daily_usage WHERE user_id = $1 AND day = $2', ['u1', today]);
  assert.equal(Number(d.rows[0].tokens), 1500, 'unused reserve released');

  const ev = await pool.query('SELECT * FROM usage_events WHERE user_id = $1', ['u1']);
  assert.equal(ev.rows.length, 1);
  assert.equal(ev.rows[0].prompt_tokens, 1000);
  assert.equal(ev.rows[0].completion_tokens, 500);
  assert.equal(ev.rows[0].kind, 'chat');

  const g = await pool.query('SELECT tokens FROM pool_usage WHERE id = 1');
  assert.equal(Number(g.rows[0].tokens), 1500, 'pool got actual spend');
});

test('reserve denied when daily budget exhausted', async () => {
  const plan = FALLBACK_PLANS.free;
  const today = new Date().toISOString().slice(0, 10);
  await pool.query('INSERT INTO daily_usage (user_id, day, tokens) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', ['u1', today, plan.daily_credits]);
  await pool.query('UPDATE daily_usage SET tokens = $1 WHERE user_id = $2 AND day = $3', [plan.daily_credits, 'u1', today]);
  const r = await ledger.reserve('u1', 'm1', 100, lim(plan), 'chat');
  assert.ok(r.denied, 'should be denied');
  assert.equal(r.denied.type, 'daily');
});

test('agent topUp extends reservation; mid-run denial releases cleanly', async () => {
  const plan = FALLBACK_PLANS.free;
  const today = new Date().toISOString().slice(0, 10);
  const r = await ledger.reserve('u1', 'm1', 2000, lim(plan), 'agent');
  assert.ok(!r.denied);
  const t = await ledger.topUp(r.reservation, 1500, lim(plan));
  assert.ok(!t.denied);
  assert.equal(t.reservation.reserved, 3500);

  // Exhaust the budget, then topUp must be denied.
  await pool.query('UPDATE daily_usage SET tokens = $1 WHERE user_id = $2 AND day = $3', [plan.daily_credits, 'u1', today]);
  const t2 = await ledger.topUp(r.reservation, 1500, lim(plan));
  assert.ok(t2.denied, 'top-up should be denied when budget exhausted');

  // Settle with partial actuals still works.
  await ledger.settle(r.reservation, 800, 200);
  const d = await pool.query('SELECT tokens FROM daily_usage WHERE user_id = $1 AND day = $2', ['u1', today]);
  assert.ok(Number(d.rows[0].tokens) <= plan.daily_credits);
});

test('agent quota: check + record', async () => {
  const plan = FALLBACK_PLANS.free; // 1 run/day
  assert.equal(await ledger.checkAgentQuota('u1', plan.agent_runs_day), null);
  await ledger.recordAgentRun('u1');
  const denied = await ledger.checkAgentQuota('u1', plan.agent_runs_day);
  assert.ok(denied, 'second run should be denied');
  assert.equal(denied.limit, 1);
  assert.equal(denied.used, 1);
});

test('summary returns daily, agent and per-model numbers', async () => {
  const plan = FALLBACK_PLANS.free;
  const r = await ledger.reserve('u1', 'claude-haiku-5.5:free', 3000, lim(plan), 'chat');
  assert.ok(!r.denied);
  await ledger.settle(r.reservation, 2000, 500);
  await ledger.recordAgentRun('u1');
  const s = await ledger.summary('u1', plan,
    [{ id: 'claude-haiku-5.5:free', label: 'Claude Haiku 5.5' }],
    (id) => id);
  assert.equal(s.dayTokens, 2500);
  assert.equal(s.agentRuns, 1);
  assert.equal(s.models.length, 1);
  assert.equal(s.models[0].used, 2500);
});
