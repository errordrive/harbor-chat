'use strict';
/**
 * Model allowlist guard: only models the upstream lists as `:free`
 * (plus the pinned ones) may be requested, so nobody can point this
 * server's API key at a paid model. 10-minute cache.
 */
function createModelGuard({ upstream, pinnedModels }) {
  let cache = { at: 0, ids: null };

  async function isAllowed(model) {
    if (pinnedModels.some((m) => m.id === model)) return true;
    const now = Date.now();
    if (!cache.ids || now - cache.at > 10 * 60 * 1000) {
      const ids = await upstream.fetchFreeModelIds().catch(() => null);
      if (ids) cache = { at: now, ids: new Set(ids) };
      else if (!cache.ids) cache = { at: now - 9 * 60 * 1000, ids: new Set() }; // retry in ~1 min
    }
    return cache.ids.has(model);
  }

  return { isAllowed };
}

module.exports = { createModelGuard };
