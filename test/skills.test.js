'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILTINS } = require('../lib/skills-lib');

test('built-in skills registry has unique ids and actionable guidance', () => {
  assert.equal(BUILTINS.length, 15);
  const ids = BUILTINS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const skill of BUILTINS) {
    assert.match(skill.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(skill.name.length >= 3);
    assert.ok(skill.description.length >= 10);
    assert.ok(skill.instructions.length >= 40);
    assert.ok(Array.isArray(skill.capabilities));
  }
});
