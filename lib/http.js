'use strict';
/**
 * Minimal HTTP helpers: JSON body parsing, JSON responses, client IP,
 * and a tiny in-memory fixed-window rate limiter.
 */

function readJson(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getClientIp(req, trustProxyHops) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  if (fwd && trustProxyHops > 0) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    const ip = parts[parts.length - trustProxyHops] || parts[0];
    if (ip) return ip;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window rate limiter. check(key) -> true if allowed.
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return {
    check(key) {
      const now = Date.now();
      let rec = hits.get(key);
      if (!rec || now - rec.start > windowMs) {
        rec = { start: now, count: 0 };
        hits.set(key, rec);
      }
      rec.count += 1;
      return rec.count <= max;
    },
  };
}

// CSRF: allow only same-origin (or no Origin, e.g. curl/health checks).
function csrfOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = String(req.headers.host || '').split(',')[0].trim();
    const xfHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const expected = xfHost || host;
    return o.host === expected;
  } catch (e) { return false; }
}

module.exports = { readJson, sendJson, getClientIp, createRateLimiter, csrfOk };
