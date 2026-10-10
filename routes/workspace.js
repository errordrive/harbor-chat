'use strict';
/**
 * Harbor Chat v4.0 — workflows + workspace API.
 */
const { readJson, sendJson, csrfOk, createRateLimiter } = require('../lib/http');
const { TEMPLATES, getTemplate, createWorkflow, startRun } = require('../lib/workflow');
const ws = require('../lib/workspace');
const log = require('../lib/log');

function mount(add, ctx) {
  const { pool, auth } = ctx;
  const limiter = createRateLimiter({ windowMs: 60000, max: 30 });

  async function userFor(req, res) {
    const user = await auth.getAuthUser(pool, req).catch(() => null);
    if (!user) { sendJson(res, 401, { error: 'Please sign in.' }); return null; }
    return user;
  }

  // ---- workflow templates ----
  add('GET', '/api/workflows/templates', async (req, res) => {
    const user = await userFor(req, res); if (!user) return;
    return sendJson(res, 200, {
      ok: true,
      templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })),
    });
  });

  // ---- list workflows ----
  add('GET', '/api/workflows', async (req, res) => {
    const user = await userFor(req, res); if (!user) return;
    const { rows } = await pool.query(
      'SELECT id, name, description, template_id, created_at FROM workflows WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [user.id]
    );
    return sendJson(res, 200, { ok: true, workflows: rows });
  });

  // ---- create workflow ----
  add('POST', '/api/workflows', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    if (!limiter.check('wf:' + user.id)) return sendJson(res, 429, { error: 'Too many requests.' });
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const wf = await createWorkflow(pool, user.id, {
        name: body.name, description: body.description,
        template_id: body.template_id, steps: body.steps,
      });
      return sendJson(res, 201, { ok: true, workflow: wf });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- start run ----
  add('POST', '/api/workflows/run', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const run = await startRun(pool, user.id, String(body.workflow_id || ''));
      log.info('workflow started', { userId: user.id, run: run.runId });
      return sendJson(res, 200, { ok: true, run_id: run.runId, steps: run.steps });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- run history ----
  add('GET', '/api/workflows/runs', async (req, res) => {
    const user = await userFor(req, res); if (!user) return;
    const { rows } = await pool.query(
      `SELECT r.*, w.name as workflow_name FROM workflow_runs r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.user_id=$1 ORDER BY r.started_at DESC LIMIT 30`,
      [user.id]
    );
    return sendJson(res, 200, { ok: true, runs: rows });
  });

  // ---- workspace: ensure ----
  add('POST', '/api/workspace/init', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    try {
      ws.ensureDir(user.id);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  });

  // ---- workspace: list ----
  add('GET', '/api/workspace/list', async (req, res, query) => {
    const user = await userFor(req, res); if (!user) return;
    try {
      ws.ensureDir(user.id);
      const files = ws.listFiles(user.id, String(query.path || ''));
      return sendJson(res, 200, { ok: true, files });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- workspace: read ----
  add('GET', '/api/workspace/read', async (req, res, query) => {
    const user = await userFor(req, res); if (!user) return;
    try {
      const content = ws.readFile(user.id, String(query.path || ''));
      return sendJson(res, 200, { ok: true, content });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- workspace: write ----
  add('POST', '/api/workspace/write', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    if (!limiter.check('ws:' + user.id)) return sendJson(res, 429, { error: 'Too many requests.' });
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const r = ws.writeFile(user.id, String(body.path || ''), body.content);
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- workspace: delete ----
  add('POST', '/api/workspace/delete', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    // Destructive: require explicit confirmation flag.
    if (body.confirm !== true) return sendJson(res, 400, { error: 'Deletion requires confirm:true.' });
    try {
      const r = ws.deletePath(user.id, String(body.path || ''));
      log.info('workspace delete', { userId: user.id, path: body.path });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });

  // ---- workspace: move/rename ----
  add('POST', '/api/workspace/move', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const r = ws.movePath(user.id, String(body.from || ''), String(body.to || ''));
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });
}

module.exports = { mount };
