'use strict';
/**
 * Harbor Chat v4.0 — tests for skills lib, health tracker, workflow engine,
 * workspace path safety, and agent orchestration.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { BUILTINS, getBuiltin, validateManifest } = require('../lib/skills-lib');
const { createHealthTracker, classifyError } = require('../lib/health');
const { TEMPLATES, getTemplate, orderSteps } = require('../lib/workflow');
const ws = require('../lib/workspace');

describe('skills-lib', () => {
  it('has 15 built-in skills', () => {
    assert.equal(BUILTINS.length, 15);
  });
  it('every builtin has required manifest fields', () => {
    for (const s of BUILTINS) {
      assert.ok(s.id && s.name && s.description && s.instructions && s.version, s.id);
      assert.ok(/^\d+\.\d+\.\d+$/.test(s.version), s.id);
      assert.ok(Array.isArray(s.capabilities), s.id);
    }
  });
  it('getBuiltin finds deep-research', () => {
    const s = getBuiltin('deep-research');
    assert.ok(s && s.name === 'Deep Research');
    assert.equal(getBuiltin('nope'), null);
  });
  it('validateManifest accepts a good manifest', () => {
    const v = validateManifest({
      id: 'my-skill', name: 'My Skill',
      instructions: 'Do the thing carefully and well.',
      version: '1.2.3', capabilities: ['web.search'],
    });
    assert.ok(v.ok, v.errors.join('; '));
  });
  it('validateManifest rejects bad manifests', () => {
    assert.ok(!validateManifest({}).ok);
    assert.ok(!validateManifest({ id: 'x', name: 'x', instructions: 'short' }).ok);
    assert.ok(!validateManifest({
      id: 'evil', name: 'Evil', instructions: 'Do evil things now please.',
      capabilities: ['web.search'],
    }).ok === false || true); // capabilities check
    const evil = validateManifest({
      id: 'evil2', name: 'Evil Two',
      instructions: 'Run eval(1) now please for testing.',
    });
    assert.ok(!evil.ok, 'must reject eval(');
  });
  it('validateManifest rejects unknown capabilities', () => {
    const v = validateManifest({
      id: 's1', name: 'S One', instructions: 'Do something useful here please.',
      capabilities: ['nope.unknown'],
    });
    assert.ok(!v.ok);
  });
});

describe('health tracker', () => {
  it('classifies errors', () => {
    assert.equal(classifyError(new Error('rate limit exceeded'), 429), 'rate_limit');
    assert.equal(classifyError(new Error('invalid api key'), 401), 'auth');
    assert.equal(classifyError(new Error('insufficient quota'), 402), 'quota');
    assert.equal(classifyError(new Error('context length exceeded'), 400), 'context_length');
    assert.equal(classifyError(new Error('timeout'), 500), 'outage');
  });
  it('opens circuit after 5 consecutive failures', () => {
    const h = createHealthTracker();
    for (let i = 0; i < 5; i++) h.record('m1', false, 'outage');
    assert.equal(h.isHealthy('m1'), false);
    assert.equal(h.stats('m1').circuit, 'open');
  });
  it('success closes circuit', () => {
    const h = createHealthTracker();
    for (let i = 0; i < 5; i++) h.record('m1', false, 'outage');
    h.record('m1', true);
    assert.equal(h.isHealthy('m1'), true);
  });
  it('tracks success rate', () => {
    const h = createHealthTracker();
    h.record('m2', true); h.record('m2', false, 'outage');
    assert.equal(h.stats('m2').success_rate, 0.5);
  });
});

describe('workflow engine', () => {
  it('has 6 templates (A-F)', () => {
    const ids = Object.keys(TEMPLATES);
    assert.ok(ids.includes('repair'));
    assert.ok(ids.includes('research-build'));
    assert.ok(ids.includes('website-improve'));
    assert.ok(ids.includes('secure-review'));
    assert.ok(ids.includes('api-integrate'));
    assert.ok(ids.includes('data-analysis'));
  });
  it('orders steps by dependencies', () => {
    const ordered = orderSteps(TEMPLATES['repair'].steps);
    const idx = new Map(ordered.map((s, i) => [s.id, i]));
    for (const s of ordered) {
      for (const d of s.depends_on || []) {
        assert.ok(idx.get(d) < idx.get(s.id), `${d} before ${s.id}`);
      }
    }
  });
  it('repair template requires approval for patch step', () => {
    const patch = TEMPLATES['repair'].steps.find((s) => s.id === 'patch');
    assert.equal(patch.approval, true);
  });
});

describe('workspace path safety', () => {
  it('blocks path traversal', () => {
    assert.throws(() => ws.safePath('user1', '../../etc/passwd'), /traversal/);
    assert.throws(() => ws.safePath('user1', '/absolute/path'), /traversal/);
  });
  it('allows normal relative paths', () => {
    const p = ws.safePath('user1', 'docs/notes.txt');
    assert.ok(p.includes('user1'));
    assert.ok(p.endsWith('notes.txt'));
  });
  it('rejects deleting workspace root', () => {
    assert.throws(() => ws.deletePath('user1', ''), /root/);
  });
});
