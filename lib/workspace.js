'use strict';
/**
 * Harbor Chat v4.0 — secure workspace file operations.
 * Each user gets an isolated directory: WORKSPACE_ROOT/<user_id>/.
 * All paths are resolved safely: no traversal, no symlinks, no absolute escapes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function workspaceRoot() {
  return process.env.WORKSPACE_ROOT || path.join(__dirname, '..', 'workspaces');
}

function userDir(userId) {
  const root = path.resolve(workspaceRoot());
  const dir = path.resolve(root, String(userId).replace(/[^a-zA-Z0-9_-]/g, '_'));
  if (!dir.startsWith(root + path.sep)) throw new Error('Invalid user id.');
  return dir;
}

// Resolve a user-supplied relative path safely inside the user's dir.
function safePath(userId, rel) {
  const dir = userDir(userId);
  const target = path.resolve(dir, String(rel || ''));
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error('Path traversal blocked.');
  }
  // Refuse symlinks.
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) throw new Error('Symlinks not allowed.');
  } catch (e) {
    if (e.message === 'Symlinks not allowed.') throw e;
    // File doesn't exist yet — check parent dirs for symlinks.
    let p = path.dirname(target);
    while (p.startsWith(dir)) {
      try {
        if (fs.lstatSync(p).isSymbolicLink()) throw new Error('Symlinks not allowed.');
      } catch (e2) {
        if (e2.message === 'Symlinks not allowed.') throw e2;
        break;
      }
      if (p === dir) break;
      p = path.dirname(p);
    }
  }
  return target;
}

function ensureDir(userId) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listFiles(userId, rel = '') {
  const target = safePath(userId, rel);
  const entries = fs.readdirSync(target, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    path: path.relative(userDir(userId), path.join(target, e.name)),
    dir: e.isDirectory(),
    size: e.isFile() ? fs.statSync(path.join(target, e.name)).size : 0,
  })).sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

function readFile(userId, rel, maxBytes = 500000) {
  const target = safePath(userId, rel);
  const st = fs.statSync(target);
  if (!st.isFile()) throw new Error('Not a file.');
  if (st.size > maxBytes) throw new Error('File too large.');
  return fs.readFileSync(target, 'utf8');
}

function writeFile(userId, rel, content) {
  const target = safePath(userId, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Backup existing.
  if (fs.existsSync(target)) {
    const bak = target + '.bak-' + Date.now();
    fs.copyFileSync(target, bak);
  }
  fs.writeFileSync(target, String(content ?? ''), 'utf8');
  return { path: path.relative(userDir(userId), target) };
}

function deletePath(userId, rel) {
  const target = safePath(userId, rel);
  if (target === userDir(userId)) throw new Error('Cannot delete workspace root.');
  const st = fs.statSync(target);
  if (st.isDirectory()) fs.rmSync(target, { recursive: true });
  else fs.unlinkSync(target);
  return { ok: true };
}

function movePath(userId, from, to) {
  const src = safePath(userId, from);
  const dst = safePath(userId, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return { ok: true };
}

module.exports = {
  workspaceRoot, userDir, safePath, ensureDir,
  listFiles, readFile, writeFile, deletePath, movePath,
};
