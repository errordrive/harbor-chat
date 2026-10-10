#!/usr/bin/env node
/**
 * Harbor Chat — Phase 1.
 *
 * Thin boot file: wires config -> Postgres -> modules -> routes -> HTTP.
 * All logic lives in lib/ and routes/. Static UI served from ./public.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { config, checkRequired } = require('./lib/config');
const log = require('./lib/log');
const { createPool, migrate } = require('./lib/db');
const { importJsonIfNeeded } = require('./lib/import-json');
const { syncAdmins } = require('./lib/admin');
const { createGateway } = require('./lib/gateway');
const { createGatewayUpstream } = require('./lib/gateway-upstream');
const { createPlans } = require('./lib/plans');
const { createAuth } = require('./lib/auth');
const { createMailer } = require('./lib/mail');
const { createLedger } = require('./lib/ledger');
const { createGovernor } = require('./lib/governor');
const { createUpstream } = require('./lib/upstream');
const { createModelGuard } = require('./lib/model-guard');
const { sendJson } = require('./lib/http');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

// Models pinned at the top of the picker (user's own picks).
const PINNED_MODELS = [
  { id: 'claude-haiku-5.5:free', label: 'Claude Haiku 5.5' },
  { id: 'deepseek-v4.1-flash:free', label: 'DeepSeek V4.1 Flash' },
  { id: 'mimo-v2.6-flash:free', label: 'MiMo V2.6 Flash' },
];
function modelLabel(id) {
  const p = PINNED_MODELS.find((m) => m.id === id);
  if (p) return p.label;
  return id.replace(':free', '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Static file serving (unchanged from Phase 0).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (req.method === 'GET' && !urlPath.startsWith('/api/')) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(d2);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
async function boot() {
  checkRequired(log);

  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await importJsonIfNeeded(pool, DATA_DIR);
  await syncAdmins(pool, config.adminEmails);

  const plans = createPlans(pool);
  await plans.refresh();
  plans.start();

  const auth = createAuth({
    sessionSecret: config.sessionSecret || 'dev-only-secret-change-me',
    sessionDays: config.sessionDays,
    isProd: config.isProd,
  });
  const mailer = createMailer({
    resendApiKey: config.resendApiKey,
    mailFrom: config.mailFrom,
    appBaseUrl: config.appBaseUrl || `http://localhost:${config.port}`,
  });
  const ledger = createLedger(pool, {
    modelWindowDays: config.modelWindowDays,
    modelWindowTokens: config.modelWindowTokenLimit,
  });
  const governor = createGovernor(pool, {
    poolTotalTokens: config.poolTotalTokens,
    poolWindowDays: config.poolWindowDays,
  });
  const upstream = createUpstream({
    apiKey: config.tokenHarborKey,
    baseUrl: config.tokenHarborBase,
    timeoutMs: config.upstreamTimeoutMs,
  });
  const { isAllowed: isModelAllowed } = createModelGuard({ upstream, pinnedModels: PINNED_MODELS });
  const gateway = createGateway({ pool, config });
  await gateway.refresh().catch(() => {});
  const gatewayUpstream = createGatewayUpstream({ gateway, config });

  const ctx = {
    config, pool, plans, auth, mailer, ledger, governor, upstream, gateway, gatewayUpstream,
    pinnedModels: PINNED_MODELS, modelLabel, isModelAllowed, log,
  };

  // Tiny router: exact method+path match.
  const routes = [];
  const add = (method, routePath, handler) => routes.push({ method, path: routePath, handler });

  require('./routes/auth').mount(add, ctx);
  require('./routes/chat').mount(add, ctx);
  require('./routes/agent').mount(add, ctx);
  require('./routes/skills').mount(add, ctx);
  require('./routes/workspace').mount(add, ctx);
  require('./routes/models').mount(add, ctx);
  require('./routes/misc').mount(add, ctx);
  require('./routes/admin').mount(add, ctx);

  const server = http.createServer((req, res) => {
    (async () => {
      try {
        const url = new URL(req.url, 'http://x');
        const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
        if (route) {
          const query = Object.fromEntries(url.searchParams.entries());
          await route.handler(req, res, query);
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          return sendJson(res, 404, { error: 'Not found' });
        }
        serveStatic(req, res);
      } catch (e) {
        log.error('request failed', { error: e.message, url: req.url, method: req.method });
        if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
        else try { res.end(); } catch (_) {}
      }
    })();
  });

  server.listen(config.port, () => {
    log.info('harbor-chat listening', { port: config.port, env: config.isProd ? 'production' : 'dev' });
  });

  const shutdown = () => {
    log.info('shutting down');
    plans.stop();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

boot().catch((e) => {
  log.error('boot failed', { error: e.message });
  process.exit(1);
});
