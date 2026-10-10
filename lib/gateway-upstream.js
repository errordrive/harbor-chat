'use strict';
/**
 * Harbor Chat v4.0 — gateway-aware upstream with health-aware failover.
 * - Resolves each model to its provider (base URL + decrypted API key)
 * - Health tracking + circuit breaker per model
 * - Error classification (rate_limit, auth, quota, context_length, outage)
 * - Bounded retries with backoff
 * - Request correlation IDs for tracing
 * - Streaming-safe fallback (only before response starts)
 * - Admin-configurable fallback chains (OFF by default = strict same-model)
 */
const { createUpstream } = require('./upstream');
const { createHealthTracker, classifyError } = require('./health');
const crypto = require('crypto');
const log = require('./log');

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

function createGatewayUpstream({ gateway, config }) {
  const clients = new Map();
  const health = createHealthTracker();

  async function clientFor(modelId) {
    const resolved = await gateway.resolve(modelId);
    if (!resolved) return null;
    const key = resolved.provider.id + ':' + resolved.apiKey.slice(-8);
    if (!clients.has(key)) {
      clients.set(key, createUpstream({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        timeoutMs: config.upstreamTimeoutMs,
      }));
    }
    return { client: clients.get(key), resolved };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Single attempt with retry on transient errors.
  async function attempt(client, payload, modelId, correlationId) {
    let lastErr = null;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const r = await client.postChat({ ...payload, model: modelId });
      const ok = !r.err && r.upRes && r.upRes.statusCode === 200;
      if (ok) {
        health.record(modelId, true);
        return { ...r, modelUsed: modelId, correlationId };
      }
      const category = classifyError(r.err, r.upRes?.statusCode);
      health.record(modelId, false, category);
      lastErr = r;
      // Don't retry auth/quota errors; do retry rate_limit/outage with backoff.
      if (category === 'auth' || category === 'quota') break;
      if (category === 'context_length') break; // caller handles by trimming
      if (i < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, i);
        log.info('gateway retry', { model: modelId, category, attempt: i + 1, correlationId });
        await sleep(delay);
        try { if (r.upRes) r.upRes.resume(); } catch (_) {}
      }
    }
    return { ...lastErr, modelUsed: modelId, correlationId, errorCategory: classifyError(lastErr?.err, lastErr?.upRes?.statusCode) };
  }

  async function postChatWithFallback(modelId, payload, planId) {
    const correlationId = 'req_' + crypto.randomBytes(8).toString('hex');

    // Skip if circuit open (unless it's the only option).
    const first = await clientFor(modelId);
    if (!first) {
      return { upRes: null, err: new Error('Model not available.'), modelUsed: modelId, correlationId };
    }
    let r = await attempt(first.client, payload, modelId, correlationId);
    if (!r.err && r.upRes && r.upRes.statusCode === 200) return r;

    // Fallback chain (admin-enabled only, health-aware).
    const chain = await gateway.fallbackChain(modelId, planId);
    for (const fbId of chain) {
      if (!health.isHealthy(fbId)) {
        log.info('gateway skip unhealthy', { model: fbId, correlationId });
        continue;
      }
      const fb = await clientFor(fbId);
      if (!fb) continue;
      log.info('gateway fallback', { from: modelId, to: fbId, correlationId });
      try { if (r.upRes) r.upRes.resume(); } catch (_) {}
      r = await attempt(fb.client, payload, fbId, correlationId);
      if (!r.err && r.upRes && r.upRes.statusCode === 200) {
        return { ...r, fallbackUsed: fbId };
      }
    }
    return r;
  }

  async function callModelWithFallback(modelId, messages, temperature, maxTokens, planId) {
    const correlationId = 'req_' + crypto.randomBytes(8).toString('hex');
    const first = await clientFor(modelId);
    if (!first) throw new Error('Model not available.');
    try {
      const r = await first.client.callModel(modelId, messages, temperature, maxTokens);
      health.record(modelId, true);
      return { ...r, modelUsed: modelId, correlationId };
    } catch (e) {
      const category = classifyError(e);
      health.record(modelId, false, category);
      if (category === 'auth' || category === 'quota' || category === 'context_length') throw e;
      const chain = await gateway.fallbackChain(modelId, planId);
      for (const fbId of chain) {
        if (!health.isHealthy(fbId)) continue;
        const fb = await clientFor(fbId);
        if (!fb) continue;
        log.info('gateway fallback (agent)', { from: modelId, to: fbId, correlationId });
        try {
          const r = await fb.client.callModel(fbId, messages, temperature, maxTokens);
          health.record(fbId, true);
          return { ...r, modelUsed: fbId, fallbackUsed: fbId, correlationId };
        } catch (e2) {
          health.record(fbId, false, classifyError(e2));
        }
      }
      throw e;
    }
  }

  async function errorMessage(upRes) {
    const any = clients.values().next().value;
    if (any) return any.errorMessage(upRes);
    const tmp = createUpstream({ apiKey: 'x', baseUrl: 'https://example.com', timeoutMs: 5000 });
    return tmp.errorMessage(upRes);
  }
  async function readBody(upRes) {
    const any = clients.values().next().value;
    if (any) return any.readBody(upRes);
    const tmp = createUpstream({ apiKey: 'x', baseUrl: 'https://example.com', timeoutMs: 5000 });
    return tmp.readBody(upRes);
  }

  return {
    postChat: (payload, modelId, planId) => postChatWithFallback(modelId, payload, planId),
    callModel: (modelId, messages, temperature, maxTokens, planId) =>
      callModelWithFallback(modelId, messages, temperature, maxTokens, planId),
    errorMessage, readBody,
    health, // exposed for admin diagnostics
  };
}

module.exports = { createGatewayUpstream };
