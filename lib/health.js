'use strict';
/**
 * Harbor Chat v4.0 — provider health tracking + circuit breaker.
 * Tracks per-model success/failure, classifies errors, and opens circuits
 * after repeated failures (cooldown before retry).
 */

const CIRCUIT_THRESHOLD = 5;       // failures to open circuit
const CIRCUIT_COOLDOWN_MS = 60000; // 1 min cooldown
const HEALTH_WINDOW = 50;          // rolling window of recent calls

// Classify upstream errors into categories.
function classifyError(err, statusCode) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (statusCode === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }
  if (statusCode === 401 || statusCode === 403 || msg.includes('invalid') && msg.includes('key') || msg.includes('unauthorized')) {
    return 'auth';
  }
  if (statusCode === 402 || msg.includes('quota') || msg.includes('insufficient') || msg.includes('billing')) {
    return 'quota';
  }
  if (msg.includes('context') && (msg.includes('length') || msg.includes('too long') || msg.includes('tokens'))) {
    return 'context_length';
  }
  if (statusCode === 400 && msg.includes('context')) {
    return 'context_length';
  }
  if (!err || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('socket') || statusCode >= 500) {
    return 'outage';
  }
  return 'unknown';
}

function createHealthTracker() {
  // modelId -> { calls: [{ok, at, category}], circuitOpenUntil }
  const state = new Map();

  function record(modelId, ok, category) {
    let s = state.get(modelId);
    if (!s) { s = { calls: [], circuitOpenUntil: 0 }; state.set(modelId, s); }
    s.calls.push({ ok, at: Date.now(), category: category || (ok ? null : 'unknown') });
    if (s.calls.length > HEALTH_WINDOW) s.calls.shift();
    // Circuit breaker: open after N consecutive failures.
    if (!ok) {
      const recent = s.calls.slice(-CIRCUIT_THRESHOLD);
      if (recent.length >= CIRCUIT_THRESHOLD && recent.every((c) => !c.ok)) {
        s.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      }
    } else {
      // Success closes the circuit.
      s.circuitOpenUntil = 0;
    }
  }

  function isHealthy(modelId) {
    const s = state.get(modelId);
    if (!s) return true;
    return Date.now() >= s.circuitOpenUntil;
  }

  function stats(modelId) {
    const s = state.get(modelId);
    if (!s || !s.calls.length) return { calls: 0, success_rate: 1, circuit: 'closed', by_category: {} };
    const ok = s.calls.filter((c) => c.ok).length;
    const by_category = {};
    for (const c of s.calls) {
      if (!c.ok) by_category[c.category] = (by_category[c.category] || 0) + 1;
    }
    return {
      calls: s.calls.length,
      success_rate: ok / s.calls.length,
      circuit: Date.now() < s.circuitOpenUntil ? 'open' : 'closed',
      by_category,
    };
  }

  function allStats() {
    const out = {};
    for (const [id] of state) out[id] = stats(id);
    return out;
  }

  return { record, isHealthy, stats, allStats, classifyError };
}

module.exports = { createHealthTracker, classifyError, CIRCUIT_THRESHOLD, CIRCUIT_COOLDOWN_MS };
