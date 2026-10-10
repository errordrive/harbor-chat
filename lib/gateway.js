'use strict';
/**
 * Provider gateway: resolves a model id -> provider (base URL + decrypted key),
 * serves the admin-editable model list, fallback chains, and feature flags.
 * Cached in memory, refreshed every 60s (same pattern as plans).
 */
const { decrypt } = require('./crypto');
const log = require('./log');

const REFRESH_MS = 60 * 1000;

function createGateway({ pool, config }) {
  let cache = { at: 0, providers: [], models: [], fallbacks: [], flags: {} };

  async function refresh() {
    try {
      const [p, m, f, ff] = await Promise.all([
        pool.query('SELECT * FROM providers WHERE enabled = TRUE'),
        pool.query('SELECT * FROM gateway_models WHERE enabled = TRUE'),
        pool.query('SELECT * FROM model_fallbacks ORDER BY position ASC'),
        pool.query('SELECT * FROM feature_flags'),
      ]);
      const flags = {};
      for (const row of ff.rows) flags[row.id] = !!row.enabled;
      cache = { at: Date.now(), providers: p.rows, models: m.rows, fallbacks: f.rows, flags };
    } catch (e) {
      log.error('gateway refresh failed', { error: e.message });
    }
  }

  async function ensure() {
    if (Date.now() - cache.at > REFRESH_MS) await refresh();
  }

  // Resolve a model id to its provider + credentials. Returns null if the
  // model is disabled or unknown.
  async function resolve(modelId) {
    await ensure();
    const model = cache.models.find((m) => m.id === modelId);
    if (!model) return null;
    const provider = cache.providers.find((p) => p.id === model.provider_id);
    if (!provider) return null;
    // API key: DB (encrypted) wins; falls back to the env var for the seeded provider.
    let apiKey = decrypt(config.sessionSecret, provider.api_key_enc);
    if (!apiKey && provider.id === 'tokenharbor') apiKey = config.tokenHarborKey;
    if (!apiKey) return null;
    return { model, provider, apiKey, baseUrl: provider.base_url.replace(/\/$/, '') };
  }

  // Ordered fallback chain for a model + plan. Empty unless the admin
  // enabled auto_model_switch AND configured fallbacks.
  async function fallbackChain(modelId, planId) {
    await ensure();
    if (!cache.flags.auto_model_switch) return [];
    const out = [];
    const seen = new Set([modelId]);
    let current = modelId;
    for (let i = 0; i < 5; i++) {
      const fb = cache.fallbacks.find(
        (r) => r.model_id === current && (r.plan_id === planId || r.plan_id === null) && !seen.has(r.fallback_model_id)
      );
      if (!fb) break;
      // Only chain to enabled models.
      if (!cache.models.some((m) => m.id === fb.fallback_model_id)) break;
      seen.add(fb.fallback_model_id);
      out.push(fb.fallback_model_id);
      current = fb.fallback_model_id;
    }
    return out;
  }

  async function flag(id, def = true) {
    await ensure();
    return cache.flags[id] !== undefined ? cache.flags[id] : def;
  }

  async function listModels() {
    await ensure();
    return cache.models.map((m) => ({
      id: m.id, provider_id: m.provider_id, display_name: m.display_name,
      enabled: m.enabled, is_free: m.is_free,
    }));
  }

  return { refresh, resolve, fallbackChain, flag, listModels, _cache: () => cache };
}

module.exports = { createGateway };
