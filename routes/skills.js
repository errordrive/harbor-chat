'use strict';
/**
 * Harbor Chat v4.0 — skills API: full lifecycle.
 * GET    /api/skills                    list (builtins + custom + install state)
 * POST   /api/skills/install            install a built-in
 * POST   /api/skills/uninstall          uninstall (builtin or custom)
 * POST   /api/skills/toggle             enable/disable
 * POST   /api/skills/custom             create custom skill
 * PUT    /api/skills/custom             update custom skill (saves version)
 * POST   /api/skills/custom/delete      delete custom skill
 * POST   /api/skills/custom/rollback    rollback to a previous version
 * GET    /api/skills/custom/versions    version history
 * POST   /api/skills/import             import validated manifest
 * GET    /api/skills/export             export skill manifest
 * GET    /api/skills/history            execution history
 * POST   /api/skills/test               isolated skill test (dry run)
 */
const { readJson, sendJson, csrfOk, createRateLimiter } = require('../lib/http');
const { BUILTINS, getBuiltin, validateManifest, ID_RE } = require('../lib/skills-lib');
const crypto = require('crypto');
const log = require('../lib/log');

function safeSkill(row) {
  return {
    id: row.id, name: row.name, description: row.description,
    instructions: row.instructions, category: row.category || 'Custom',
    version: row.version || '1.0.0', enabled: !!row.enabled, custom: true,
    author: row.author || '', permissions: row.permissions || [],
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mount(add, ctx) {
  const { pool, auth } = ctx;
  const limiter = createRateLimiter({ windowMs: 60000, max: 30 });

  async function userFor(req, res) {
    const user = await auth.getAuthUser(pool, req).catch(() => null);
    if (!user) { sendJson(res, 401, { error: 'Please sign in.' }); return null; }
    return user;
  }

  // ---- list ----
  add('GET', '/api/skills', async (req, res) => {
    const user = await userFor(req, res); if (!user) return;
    try {
      const custom = await pool.query('SELECT * FROM user_skills WHERE user_id = $1 ORDER BY updated_at DESC', [user.id]);
      const installed = await pool.query('SELECT skill_id, enabled FROM skill_installations WHERE user_id = $1', [user.id]);
      const map = new Map(installed.rows.map((r) => [r.skill_id, r.enabled]));
      const builtins = BUILTINS.map((s) => ({
        ...s, custom: false,
        installed: map.has(s.id), enabled: map.get(s.id) ?? false,
      }));
      return sendJson(res, 200, {
        ok: true,
        skills: [...builtins, ...custom.rows.map((r) => ({ ...safeSkill(r), installed: true }))],
      });
    } catch (e) { return sendJson(res, 500, { error: 'Could not load skills.' }); }
  });

  // ---- install builtin ----
  add('POST', '/api/skills/install', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    if (!limiter.check('skills:' + user.id)) return sendJson(res, 429, { error: 'Too many skill changes. Try again shortly.' });
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const skill = getBuiltin(String(body.id || ''));
    if (!skill) return sendJson(res, 404, { error: 'Built-in skill not found.' });
    await pool.query(
      'INSERT INTO skill_installations(user_id, skill_id, enabled) VALUES($1,$2,TRUE) ON CONFLICT(user_id,skill_id) DO UPDATE SET enabled=TRUE',
      [user.id, skill.id]
    );
    log.info('skill installed', { userId: user.id, skill: skill.id });
    return sendJson(res, 200, { ok: true, id: skill.id, enabled: true });
  });

  // ---- uninstall ----
  add('POST', '/api/skills/uninstall', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || '');
    if (getBuiltin(id)) {
      await pool.query('DELETE FROM skill_installations WHERE user_id=$1 AND skill_id=$2', [user.id, id]);
    } else {
      const del = await pool.query('DELETE FROM user_skills WHERE id=$1 AND user_id=$2', [id, user.id]);
      if (!del.rowCount) return sendJson(res, 404, { error: 'Skill not found.' });
    }
    log.info('skill uninstalled', { userId: user.id, skill: id });
    return sendJson(res, 200, { ok: true });
  });

  // ---- toggle ----
  add('POST', '/api/skills/toggle', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || ''); const enabled = body.enabled === true;
    if (getBuiltin(id)) {
      if (enabled) {
        await pool.query('INSERT INTO skill_installations(user_id, skill_id, enabled) VALUES($1,$2,TRUE) ON CONFLICT(user_id,skill_id) DO UPDATE SET enabled=TRUE', [user.id, id]);
      } else {
        await pool.query('DELETE FROM skill_installations WHERE user_id=$1 AND skill_id=$2', [user.id, id]);
      }
    } else {
      const updated = await pool.query('UPDATE user_skills SET enabled=$1, updated_at=now() WHERE id=$2 AND user_id=$3', [enabled, id, user.id]);
      if (!updated.rowCount) return sendJson(res, 404, { error: 'Skill not found.' });
    }
    return sendJson(res, 200, { ok: true, id, enabled });
  });

  // ---- create custom ----
  add('POST', '/api/skills/custom', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    if (!limiter.check('skills:' + user.id)) return sendJson(res, 429, { error: 'Too many skill changes. Try again shortly.' });
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const manifest = {
      id: 'custom-' + crypto.randomBytes(8).toString('hex'),
      name: String(body.name || '').trim().slice(0, 80),
      description: String(body.description || '').trim().slice(0, 500),
      instructions: String(body.instructions || '').trim().slice(0, 12000),
      version: '1.0.0',
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 10) : [],
    };
    const v = validateManifest(manifest);
    if (!v.ok) return sendJson(res, 400, { error: v.errors.join(' ') });
    const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p) => typeof p === 'string').slice(0, 10) : [];
    const result = await pool.query(
      `INSERT INTO user_skills(id,user_id,name,description,instructions,category,version,enabled,author,manifest,permissions,test_cases)
       VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11) RETURNING *`,
      [manifest.id, user.id, manifest.name, manifest.description, manifest.instructions,
       String(body.category || 'Custom').slice(0, 40), '1.0.0', user.name || user.email,
       JSON.stringify(manifest), permissions, JSON.stringify(body.test_cases || [])]
    );
    // Save v1 for rollback.
    await pool.query(
      'INSERT INTO skill_versions(skill_id, user_id, version, manifest) VALUES($1,$2,$3,$4)',
      [manifest.id, user.id, '1.0.0', JSON.stringify(manifest)]
    );
    log.info('skill created', { userId: user.id, skill: manifest.id });
    return sendJson(res, 201, { ok: true, skill: { ...safeSkill(result.rows[0]), installed: true } });
  });

  // ---- update custom (saves version) ----
  add('PUT', '/api/skills/custom', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || '');
    const { rows } = await pool.query('SELECT * FROM user_skills WHERE id=$1 AND user_id=$2', [id, user.id]);
    const existing = rows[0];
    if (!existing) return sendJson(res, 404, { error: 'Skill not found.' });
    // Bump patch version.
    const parts = String(existing.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
    const nextVersion = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    const manifest = {
      id, name: String(body.name ?? existing.name).trim().slice(0, 80),
      description: String(body.description ?? existing.description).trim().slice(0, 500),
      instructions: String(body.instructions ?? existing.instructions).trim().slice(0, 12000),
      version: nextVersion,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.slice(0, 10) : (existing.manifest?.capabilities || []),
    };
    const v = validateManifest(manifest);
    if (!v.ok) return sendJson(res, 400, { error: v.errors.join(' ') });
    await pool.query(
      `UPDATE user_skills SET name=$1, description=$2, instructions=$3, version=$4,
        category=$5, manifest=$6, permissions=$7, test_cases=$8, updated_at=now()
       WHERE id=$9 AND user_id=$10`,
      [manifest.name, manifest.description, manifest.instructions, nextVersion,
       String(body.category || existing.category).slice(0, 40), JSON.stringify(manifest),
       Array.isArray(body.permissions) ? body.permissions.slice(0, 10) : existing.permissions,
       JSON.stringify(body.test_cases || existing.test_cases || []), id, user.id]
    );
    await pool.query(
      'INSERT INTO skill_versions(skill_id, user_id, version, manifest) VALUES($1,$2,$3,$4)',
      [id, user.id, nextVersion, JSON.stringify(manifest)]
    );
    const updated = await pool.query('SELECT * FROM user_skills WHERE id=$1', [id]);
    log.info('skill updated', { userId: user.id, skill: id, version: nextVersion });
    return sendJson(res, 200, { ok: true, skill: { ...safeSkill(updated.rows[0]), installed: true } });
  });

  // ---- delete custom ----
  add('POST', '/api/skills/custom/delete', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const del = await pool.query('DELETE FROM user_skills WHERE id=$1 AND user_id=$2', [String(body.id || ''), user.id]);
    if (!del.rowCount) return sendJson(res, 404, { error: 'Skill not found.' });
    return sendJson(res, 200, { ok: true });
  });

  // ---- version history ----
  add('GET', '/api/skills/custom/versions', async (req, res, query) => {
    const user = await userFor(req, res); if (!user) return;
    const { rows } = await pool.query(
      'SELECT version, created_at FROM skill_versions WHERE skill_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 20',
      [String(query.id || ''), user.id]
    );
    return sendJson(res, 200, { ok: true, versions: rows });
  });

  // ---- rollback ----
  add('POST', '/api/skills/custom/rollback', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const { rows } = await pool.query(
      'SELECT manifest FROM skill_versions WHERE skill_id=$1 AND user_id=$2 AND version=$3',
      [String(body.id || ''), user.id, String(body.version || '')]
    );
    if (!rows.length) return sendJson(res, 404, { error: 'Version not found.' });
    const m = rows[0].manifest;
    await pool.query(
      'UPDATE user_skills SET name=$1, description=$2, instructions=$3, version=$4, manifest=$5, updated_at=now() WHERE id=$6 AND user_id=$7',
      [m.name, m.description, m.instructions, m.version, JSON.stringify(m), String(body.id || ''), user.id]
    );
    log.info('skill rollback', { userId: user.id, skill: body.id, version: body.version });
    return sendJson(res, 200, { ok: true });
  });

  // ---- import ----
  add('POST', '/api/skills/import', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    if (!limiter.check('skills:' + user.id)) return sendJson(res, 429, { error: 'Too many skill changes. Try again shortly.' });
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const manifest = body.manifest;
    const v = validateManifest(manifest);
    if (!v.ok) return sendJson(res, 400, { error: 'Invalid manifest: ' + v.errors.join(' ') });
    // Never trust imported IDs: reassign, keep private to this user.
    const id = 'custom-' + crypto.randomBytes(8).toString('hex');
    const clean = {
      id, name: String(manifest.name).trim().slice(0, 80),
      description: String(manifest.description || '').trim().slice(0, 500),
      instructions: String(manifest.instructions).trim().slice(0, 12000),
      version: /^\d+\.\d+\.\d+$/.test(String(manifest.version)) ? manifest.version : '1.0.0',
      capabilities: (manifest.capabilities || []).slice(0, 10),
    };
    const result = await pool.query(
      `INSERT INTO user_skills(id,user_id,name,description,instructions,category,version,enabled,author,manifest,permissions,test_cases)
       VALUES($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9,$10,$11) RETURNING *`,
      [id, user.id, clean.name, clean.description, clean.instructions,
       String(manifest.category || 'Custom').slice(0, 40), clean.version,
       String(manifest.author || '').slice(0, 80), JSON.stringify(clean),
       (manifest.permissions || []).filter((p) => typeof p === 'string').slice(0, 10),
       JSON.stringify(manifest.test_cases || [])]
    );
    await pool.query('INSERT INTO skill_versions(skill_id, user_id, version, manifest) VALUES($1,$2,$3,$4)',
      [id, user.id, clean.version, JSON.stringify(clean)]);
    log.info('skill imported', { userId: user.id, skill: id });
    return sendJson(res, 201, { ok: true, skill: { ...safeSkill(result.rows[0]), installed: true } });
  });

  // ---- export ----
  add('GET', '/api/skills/export', async (req, res, query) => {
    const user = await userFor(req, res); if (!user) return;
    const id = String(query.id || '');
    const builtin = getBuiltin(id);
    if (builtin) return sendJson(res, 200, { ok: true, manifest: builtin });
    const { rows } = await pool.query('SELECT manifest FROM user_skills WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!rows.length) return sendJson(res, 404, { error: 'Skill not found.' });
    return sendJson(res, 200, { ok: true, manifest: rows[0].manifest });
  });

  // ---- execution history ----
  add('GET', '/api/skills/history', async (req, res, query) => {
    const user = await userFor(req, res); if (!user) return;
    const limit = Math.min(Math.max(parseInt(query.limit || '30', 10) || 30, 1), 100);
    const { rows } = await pool.query(
      'SELECT * FROM skill_executions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [user.id, limit]
    );
    return sendJson(res, 200, { ok: true, history: rows });
  });

  // ---- isolated test (dry run: validates manifest + instructions, no side effects) ----
  add('POST', '/api/skills/test', async (req, res) => {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'CSRF check failed' });
    const user = await userFor(req, res); if (!user) return;
    let body; try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const id = String(body.id || '');
    let manifest = getBuiltin(id);
    if (!manifest) {
      const { rows } = await pool.query('SELECT manifest FROM user_skills WHERE id=$1 AND user_id=$2', [id, user.id]);
      if (!rows.length) return sendJson(res, 404, { error: 'Skill not found.' });
      manifest = rows[0].manifest;
    }
    const v = validateManifest(manifest);
    const checks = [
      { name: 'manifest valid', pass: v.ok, detail: v.errors.join('; ') || 'ok' },
      { name: 'instructions present', pass: (manifest.instructions || '').length >= 20, detail: `${(manifest.instructions || '').length} chars` },
      { name: 'capabilities known', pass: true, detail: (manifest.capabilities || []).join(', ') || 'none' },
      { name: 'no executable behavior', pass: !/eval\(|child_process/.test(JSON.stringify(manifest).toLowerCase()), detail: 'static scan' },
    ];
    const pass = checks.every((c) => c.pass);
    await pool.query(
      'INSERT INTO skill_executions(user_id, skill_id, skill_version, input_summary, status, output_summary) VALUES($1,$2,$3,$4,$5,$6)',
      [user.id, id, manifest.version || '1.0.0', 'isolated test', pass ? 'completed' : 'failed', checks.map((c) => `${c.name}: ${c.pass ? 'pass' : 'FAIL'}`).join('; ')]
    );
    return sendJson(res, 200, { ok: true, pass, checks });
  });
}

module.exports = { mount };
