'use strict';
/**
 * Phase 0 tests: token estimation, reserve->settle ledger, agent quota,
 * global pool governor. Run with: npm test  (node --test test/)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const acc = require('../lib/accounting');

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0); // fixed "now" for determinism
const LIM = { daily: 60000, model: 800000 };
const WD = 28;

describe('estimateTokens (Bangla-aware fallback)', () => {
  it('empty string -> 0', () => {
    assert.equal(acc.estimateTokens(''), 0);
    assert.equal(acc.estimateTokens(null), 0);
  });
  it('ascii counts ~4 chars/token', () => {
    assert.equal(acc.estimateTokens('a'.repeat(40)), 10);
    assert.equal(acc.estimateTokens('hello world'), 3); // 11 chars -> ceil(11/4)
  });
  it('bangla counts ~2 chars/token (not chars/4)', () => {
    const bn = 'আমি বাংলায় কথা বলছি'; // definitely non-latin
    const chars = [...bn].length;
    assert.equal(acc.estimateTokens(bn), Math.ceil(chars / 2));
    assert.ok(acc.estimateTokens(bn) > Math.ceil(chars / 4), 'must exceed the old chars/4 estimate');
  });
  it('mixed text weights each script', () => {
    // 4 ascii + 4 wide -> ceil(4/4 + 4/2) = 3
    assert.equal(acc.estimateTokens('abcd' + 'অআইঈ'), 3);
  });
  it('emoji counts as wide (safe side)', () => {
    assert.equal(acc.estimateTokens('👍'.repeat(4)), 2);
  });
});

describe('reserve -> settle ledger', () => {
  let db;
  beforeEach(() => { db = { users: {} }; });

  it('allows a reservation that fits, then settles to actuals', () => {
    assert.equal(acc.checkReserve(db, 'u1', 'm', 10000, LIM, WD, T0), null);
    acc.applyReserve(db, 'u1', 'm', 10000, WD, T0);
    assert.equal(db.users.u1.dayTokens, 10000);
    assert.equal(db.users.u1.models.m.tokens, 10000);
    // actual spend was only 6000 -> 4000 released
    acc.applySettle(db, 'u1', 'm', 10000, 6000, WD, T0);
    assert.equal(db.users.u1.dayTokens, 6000);
    assert.equal(db.users.u1.models.m.tokens, 6000);
  });

  it('denies when prompt+max_tokens would exceed the daily budget', () => {
    acc.applyReserve(db, 'u1', 'm', 59000, WD, T0);
    const d = acc.checkReserve(db, 'u1', 'm', 2000, LIM, WD, T0);
    assert.equal(d.type, 'daily');
    assert.equal(d.used, 59000);
    assert.equal(d.limit, 60000);
  });

  it('denies when the per-model window would be exceeded', () => {
    const small = { daily: 10 ** 9, model: 5000 };
    acc.applyReserve(db, 'u1', 'm', 4000, WD, T0);
    const d = acc.checkReserve(db, 'u1', 'm', 2000, small, WD, T0);
    assert.equal(d.type, 'model');
    assert.equal(d.model, 'm');
  });

  it('a failed upstream call settles to zero (full release)', () => {
    acc.applyReserve(db, 'u1', 'm', 8000, WD, T0);
    acc.applySettle(db, 'u1', 'm', 8000, 0, WD, T0);
    assert.equal(db.users.u1.dayTokens, 0);
    assert.equal(db.users.u1.models.m.tokens, 0);
  });

  it('overshoot beyond the reservation is charged, never negative', () => {
    acc.applyReserve(db, 'u1', 'm', 1000, WD, T0);
    acc.applySettle(db, 'u1', 'm', 1000, 1500, WD, T0);
    assert.equal(db.users.u1.dayTokens, 1500);
    acc.applySettle(db, 'u1', 'm', 0, 0, WD, T0 + 1); // no-op settle
    assert.equal(db.users.u1.dayTokens, 1500);
  });

  it('daily budget resets at UTC midnight', () => {
    acc.applyReserve(db, 'u1', 'm', 59000, WD, T0);
    const nextDay = T0 + 13 * 3600000; // 01:00 UTC next day
    assert.equal(acc.checkReserve(db, 'u1', 'm', 2000, LIM, WD, nextDay), null);
    assert.equal(db.users.u1.dayTokens, 0);
  });

  it('model window rolls over after windowDays', () => {
    const small = { daily: 10 ** 9, model: 5000 };
    acc.applyReserve(db, 'u1', 'm', 5000, WD, T0);
    assert.ok(acc.checkReserve(db, 'u1', 'm', 1, small, WD, T0));
    const later = T0 + (WD + 1) * 86400000;
    assert.equal(acc.checkReserve(db, 'u1', 'm', 1, small, WD, later), null);
  });

  it('concurrent reservations cannot overspend (reserve is immediately visible)', () => {
    acc.applyReserve(db, 'u1', 'm', 40000, WD, T0); // request A
    const d = acc.checkReserve(db, 'u1', 'm', 25000, LIM, WD, T0); // request B
    assert.equal(d.type, 'daily'); // 40000 + 25000 > 60000
  });
});

describe('agent daily quota', () => {
  let db;
  const caps = { free: 1, plus: 10, pro: 50 };
  beforeEach(() => { db = { users: {} }; });

  it('free user gets 1 run/day, second is denied', () => {
    assert.equal(acc.checkAgentQuota(db, 'u1', 'free', caps, T0), null);
    acc.recordAgentRun(db, 'u1', T0);
    const d = acc.checkAgentQuota(db, 'u1', 'free', caps, T0);
    assert.equal(d.type, 'agent');
    assert.equal(d.limit, 1);
  });
  it('quota resets next day', () => {
    acc.recordAgentRun(db, 'u1', T0);
    assert.equal(acc.checkAgentQuota(db, 'u1', 'free', caps, T0 + 86400000), null);
  });
  it('plus/pro get higher caps', () => {
    for (let i = 0; i < 10; i++) acc.recordAgentRun(db, 'u2', T0);
    assert.ok(acc.checkAgentQuota(db, 'u2', 'plus', caps, T0));
    assert.equal(acc.checkAgentQuota(db, 'u2', 'pro', caps, T0), null);
  });
});

describe('global pool governor', () => {
  let gdb;
  beforeEach(() => { gdb = { windowStart: 0, tokens: 0 }; });

  it('starts normal with a full pool', () => {
    const g = acc.governorState(gdb, 3000000, 30, T0);
    assert.equal(g.state, 'normal');
    assert.equal(g.remaining, 3000000);
  });
  it('strained below 25%, critical below 5%', () => {
    acc.recordGlobal(gdb, 2300000, 30, T0); // 700k left = 23.3%
    assert.equal(acc.governorState(gdb, 3000000, 30, T0).state, 'strained');
    acc.recordGlobal(gdb, 600000, 30, T0); // 100k left = 3.3%
    assert.equal(acc.governorState(gdb, 3000000, 30, T0).state, 'critical');
  });
  it('poolTotal <= 0 disables the governor', () => {
    assert.equal(acc.governorState(gdb, 0, 30, T0).state, 'normal');
  });
  it('window rolls over and the pool refills', () => {
    acc.recordGlobal(gdb, 2900000, 30, T0);
    assert.equal(acc.governorState(gdb, 3000000, 30, T0).state, 'critical');
    const later = T0 + 31 * 86400000;
    const g = acc.governorState(gdb, 3000000, 30, later);
    assert.equal(g.state, 'normal');
    assert.equal(g.remaining, 3000000);
  });
  it('recordGlobal ignores non-positive values', () => {
    acc.recordGlobal(gdb, -500, 30, T0);
    acc.recordGlobal(gdb, 0, 30, T0);
    assert.equal(acc.governorState(gdb, 3000000, 30, T0).remaining, 3000000);
  });
});
