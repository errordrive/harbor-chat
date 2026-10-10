'use strict';
/**
 * Token Harbor OpenAI-compatible client.
 * Uses https.request (NOT fetch) so the Authorization header survives
 * proxies that strip browser-style requests.
 */
const https = require('https');
const accounting = require('./accounting');
const log = require('./log');

function createUpstream({ apiKey, baseUrl, timeoutMs }) {
  const BASE = baseUrl.replace(/\/+$/, '');

  function request(method, urlPath, bodyObj) {
    return new Promise((resolve) => {
      const target = new URL(BASE + urlPath);
      const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
      const req = https.request(
        {
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method,
          headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            Accept: method === 'POST' ? 'text/event-stream, application/json' : 'application/json',
            'User-Agent': 'harbor-chat/1.1',
            ...(payload ? { 'Content-Length': payload.length } : {}),
          },
          timeout: timeoutMs,
        },
        (upRes) => resolve({ upRes, err: null })
      );
      req.on('timeout', () => { req.destroy(new Error('upstream timeout')); });
      req.on('error', (err) => resolve({ upRes: null, err }));
      if (payload) req.write(payload);
      req.end();
    });
  }

  function readBody(upRes) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => resolve(Buffer.concat(chunks)));
      upRes.on('error', reject);
    });
  }

  // POST /chat/completions with one safety retry: some OpenAI-compatible
  // providers reject the (spec-compliant) stream_options field with a 400.
  async function postChat(payload) {
    let r = await request('POST', '/chat/completions', payload);
    if (!r.err && r.upRes && r.upRes.statusCode === 400 && payload.stream_options) {
      try { r.upRes.resume(); } catch (_) {}
      const retry = { ...payload };
      delete retry.stream_options;
      log.info('upstream rejected stream_options, retrying without it');
      r = await request('POST', '/chat/completions', retry);
    }
    return r;
  }

  async function errorMessage(upRes) {
    let msg = 'The AI service returned an error.';
    try {
      const buf = await readBody(upRes);
      const p = JSON.parse(buf.toString('utf8'));
      if (p && p.error && p.error.message) msg = String(p.error.message).slice(0, 500);
    } catch (_) {}
    return msg;
  }

  // Non-streaming call. Resolves { text, promptTokens, completionTokens }
  // (real usage when the provider sends it, Bangla-aware estimate otherwise).
  async function callModel(model, messages, temperature, maxTokens) {
    const payload = { model, messages, stream: false };
    if (typeof temperature === 'number' && temperature >= 0 && temperature <= 2) payload.temperature = temperature;
    if (Number.isInteger(maxTokens) && maxTokens > 0) payload.max_tokens = maxTokens;
    const { upRes, err } = await request('POST', '/chat/completions', payload);
    if (err || !upRes) throw new Error('Could not reach the AI service.');
    const buf = await readBody(upRes);
    if (upRes.statusCode !== 200) throw new Error(await errorMessage(upRes));
    let p;
    try { p = JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('The AI service returned an unreadable response.'); }
    const ch = p.choices && p.choices[0];
    const text = (ch && ch.message && ch.message.content) || '';
    let pt = accounting.estimateTokens(JSON.stringify(messages));
    let ct = accounting.estimateTokens(text);
    if (p.usage) {
      if (Number.isInteger(p.usage.prompt_tokens)) pt = p.usage.prompt_tokens;
      if (Number.isInteger(p.usage.completion_tokens)) ct = p.usage.completion_tokens;
    }
    return { text, promptTokens: pt, completionTokens: ct };
  }

  async function fetchFreeModelIds() {
    const { upRes, err } = await request('GET', '/models', null);
    if (err || !upRes) return null;
    try {
      const buf = await readBody(upRes);
      if (upRes.statusCode !== 200) return null;
      const data = JSON.parse(buf.toString('utf8'));
      return (data.data || [])
        .filter((m) => typeof m.id === 'string' && m.id.endsWith(':free'))
        .map((m) => m.id);
    } catch (e) { return null; }
  }

  return { request, readBody, postChat, errorMessage, callModel, fetchFreeModelIds };
}

module.exports = { createUpstream };
