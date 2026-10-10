'use strict';
/**
 * GET /api/models — pinned free models + live free-model discovery.
 * Cached 5 minutes; pinned list always present as fallback.
 */
const { sendJson } = require('../lib/http');
const log = require('../lib/log');

function mount(add, ctx) {
  const { upstream, pinnedModels } = ctx;
  let cache = null;
  let cacheAt = 0;
  const TTL = 5 * 60 * 1000;

  add('GET', '/api/models', async (req, res) => {
    const now = Date.now();
    if (!cache || now - cacheAt > TTL) {
      const live = await upstream.fetchFreeModelIds().catch(() => null);
      const ids = new Set(pinnedModels.map((p) => p.id));
      const models = pinnedModels.map((p) => ({ ...p }));
      if (live) {
        for (const id of live) {
          if (!ids.has(id)) {
            ids.add(id);
            models.push({ id, label: id.replace(/:free$/, '').replace(/-/g, ' ') });
          }
        }
      }
      cache = { models };
      cacheAt = now;
      if (!live) log.warn('model list: upstream unreachable, serving pinned only');
    }
    return sendJson(res, 200, cache);
  });
}

module.exports = { mount };
