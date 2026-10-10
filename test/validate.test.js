'use strict';
/**
 * Input validation tests (Phase 1).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../lib/validate');
const { isDisposable } = require('../lib/disposable');
const accounting = require('../lib/accounting');

test('email validation', () => {
  assert.equal(validate.email('a@b.co'), null);
  assert.equal(validate.email('User@Example.COM'), null);
  assert.ok(validate.email('not-an-email'));
  assert.ok(validate.email('a@b'));
  assert.ok(validate.email(''));
  assert.ok(validate.email(null));
});

test('password validation', () => {
  assert.equal(validate.password('longenough1'), null);
  assert.ok(validate.password('short'));
  assert.ok(validate.password(''));
  assert.ok(validate.password('x'.repeat(129)));
});

test('model id validation', () => {
  assert.equal(validate.modelId('claude-haiku-5.5:free'), null);
  assert.ok(validate.modelId(''));
  assert.ok(validate.modelId('has space'));
  assert.ok(validate.modelId("a'; DROP TABLE users;--"));
});

test('messages validation', () => {
  const r = validate.messages(
    [{ role: 'user', content: 'hello' }],
    accounting.estimateTokens
  );
  assert.ok(!r.error);
  assert.equal(r.messages.length, 1);
  assert.ok(r.estPrompt > 0);

  assert.ok(validate.messages([], accounting.estimateTokens).error);
  assert.ok(validate.messages([{ role: 'user' }], accounting.estimateTokens).error);
  assert.ok(validate.messages([{ role: 'hacker', content: 'x' }], accounting.estimateTokens).error);
  assert.ok(validate.messages(new Array(201).fill({ role: 'user', content: 'x' }), accounting.estimateTokens).error);
});

test('disposable email blocklist', () => {
  assert.equal(isDisposable('user@mailinator.com'), true);
  assert.equal(isDisposable('user@tempmail.com'), true);
  assert.equal(isDisposable('user@gmail.com'), false);
  assert.equal(isDisposable('user@nayem.me'), false);
  assert.equal(isDisposable('not-an-email'), false);
});

test('token validation', () => {
  assert.equal(validate.token('abcDEF123-_'), null);
  assert.ok(validate.token(''));
  assert.ok(validate.token('has space'));
  assert.ok(validate.token('a'.repeat(300)));
});
