'use strict';
/**
 * Harbor Chat — pure token accounting (Phase 0).
 *
 * No I/O, no globals, no Date.now() inside: every function takes the state
 * object and the current time explicitly, so the math is unit-testable and
 * can later be moved to Postgres without changing it.
 *
 * State shapes:
 *   db  = { users: { [userId]: {
 *             day, dayTokens, lastSeen,
 *             agentDay, agentRuns,
 *             models: { [modelId]: { windowStart, tokens } } } } }
 *   gdb = { windowStart, tokens }   (global pool ledger)
 */

// ---------------------------------------------------------------------------
// Token estimation. Bangla (and other non-Latin scripts) tokenize much more
// densely than English: ~2 chars/token vs ~4 for ASCII. Counting everything
// as chars/4 badly under-counts Bangla, so we estimate per script run.
// This is a FALLBACK — real provider `usage` numbers are always preferred.
// ---------------------------------------------------------------------------
function countScripts(text) {
  let ascii = 0;
  let wide = 0;
  for (const ch of String(text || '')) {
    if (ch.codePointAt(0) < 0x250) ascii++;
    else wide++;
  }
  return { ascii, wide };
}

function tokensFromCounts(ascii, wide) {
  return Math.ceil(ascii / 4 + wide / 2);
}

function estimateTokens(text) {
  const c = countScripts(text);
  return tokensFromCounts(c.ascii, c.wide);
}

// ---------------------------------------------------------------------------
// Per-user ledger: reserve -> call -> settle.
// ---------------------------------------------------------------------------
function dayStr(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function getUsageRow(db, userId, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const today = dayStr(now);
  if (!db.users) db.users = {};
  let d = db.users[userId];
  if (!d) {
    d = { day: today, dayTokens: 0, lastSeen: now, agentDay: today, agentRuns: 0, models: {} };
    db.users[userId] = d;
  }
  if (d.day !== today) { d.day = today; d.dayTokens = 0; }
  if (d.agentDay !== today) { d.agentDay = today; d.agentRuns = 0; }
  d.lastSeen = now;
  return d;
}

function getModelBucket(d, model, windowDays, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const windowMs = windowDays * 86400000;
  let b = d.models[model];
  if (!b || now - b.windowStart > windowMs) {
    b = { windowStart: now, tokens: 0 };
    d.models[model] = b;
  }
  return b;
}

// Returns null when `needTokens` fits inside both budgets,
// otherwise { type: 'daily'|'model', used, limit (, model) }.
function checkReserve(db, userId, model, needTokens, lim, windowDays, nowMs) {
  const d = getUsageRow(db, userId, nowMs);
  if (d.dayTokens + needTokens > lim.daily) {
    return { type: 'daily', used: d.dayTokens, limit: lim.daily };
  }
  const b = getModelBucket(d, model, windowDays, nowMs);
  if (b.tokens + needTokens > lim.model) {
    return { type: 'model', model, used: b.tokens, limit: lim.model };
  }
  return null;
}

function applyReserve(db, userId, model, needTokens, windowDays, nowMs) {
  const d = getUsageRow(db, userId, nowMs);
  d.dayTokens += needTokens;
  getModelBucket(d, model, windowDays, nowMs).tokens += needTokens;
}

// `reservedTokens` was added by applyReserve; `actualTokens` is the true spend
// (real provider usage when available, estimate otherwise).
// Unused budget is released; a rare overshoot is charged.
function applySettle(db, userId, model, reservedTokens, actualTokens, windowDays, nowMs) {
  const diff = reservedTokens - actualTokens;
  if (diff === 0) return;
  const d = getUsageRow(db, userId, nowMs);
  d.dayTokens = Math.max(0, d.dayTokens - diff);
  const b = getModelBucket(d, model, windowDays, nowMs);
  b.tokens = Math.max(0, b.tokens - diff);
}

// Agent runs per day per plan. Returns null when allowed,
// otherwise { type: 'agent', used, limit }.
function checkAgentQuota(db, userId, plan, dailyCaps, nowMs) {
  const d = getUsageRow(db, userId, nowMs);
  const cap = dailyCaps[plan] != null ? dailyCaps[plan] : dailyCaps.free;
  if (d.agentRuns >= cap) return { type: 'agent', used: d.agentRuns, limit: cap };
  return null;
}

function recordAgentRun(db, userId, nowMs) {
  getUsageRow(db, userId, nowMs).agentRuns += 1;
}

// ---------------------------------------------------------------------------
// Global pool governor. The upstream pool (default 3M tokens / 30 days) is
// shared by ALL users, so a separate global ledger guards it.
//   normal   (>25% left):   no change
//   strained (<25% left):   free users get clamped outputs, free agent paused
//   critical (<5% left):    free chat denied with a friendly message
// Set poolTotal <= 0 to disable the governor.
// ---------------------------------------------------------------------------
function getGlobalRow(gdb, windowDays, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const windowMs = windowDays * 86400000;
  if (!gdb.windowStart || now - gdb.windowStart > windowMs) {
    gdb.windowStart = now;
    gdb.tokens = 0;
  }
  return gdb;
}

function recordGlobal(gdb, tokens, windowDays, nowMs) {
  if (!(tokens > 0)) return;
  getGlobalRow(gdb, windowDays, nowMs).tokens += tokens;
}

function governorState(gdb, poolTotal, windowDays, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  if (!(poolTotal > 0)) {
    return { state: 'normal', remaining: Infinity, total: poolTotal, pct: 1, daysLeft: windowDays, windowDays };
  }
  const g = getGlobalRow(gdb, windowDays, now);
  const remaining = Math.max(0, poolTotal - g.tokens);
  const pct = remaining / poolTotal;
  const daysLeft = Math.max(0, (g.windowStart + windowDays * 86400000 - now) / 86400000);
  const state = pct < 0.05 ? 'critical' : pct < 0.25 ? 'strained' : 'normal';
  return { state, remaining, total: poolTotal, pct, daysLeft, windowDays };
}

module.exports = {
  countScripts,
  tokensFromCounts,
  estimateTokens,
  getUsageRow,
  getModelBucket,
  checkReserve,
  applyReserve,
  applySettle,
  checkAgentQuota,
  recordAgentRun,
  getGlobalRow,
  recordGlobal,
  governorState,
};
