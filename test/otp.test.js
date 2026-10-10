'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('crypto: encrypt/decrypt roundtrip', async () => {
  const { encrypt, decrypt } = require('../lib/crypto');
  const enc = encrypt('test-secret-123', 'sk-my-api-key');
  assert.ok(enc.startsWith('gcm1.'));
  assert.equal(decrypt('test-secret-123', enc), 'sk-my-api-key');
  assert.equal(decrypt('wrong-secret', enc), null);
  assert.equal(decrypt('test-secret-123', null), null);
});

test('auth: otp token roundtrip', async () => {
  const { createAuth } = require('../lib/auth');
  const auth = createAuth({ sessionSecret: 'x'.repeat(32), sessionDays: 30, isProd: false });
  const tok = auth.makeOtpToken('User@Test.com', 'signup');
  assert.equal(auth.readOtpToken(tok, 'signup'), 'user@test.com');
  assert.equal(auth.readOtpToken(tok, 'login'), null); // wrong purpose
  assert.equal(auth.readOtpToken('garbage', 'signup'), null);
});

test('otp: request + verify flow (pg-mem)', async () => {
  const { newDb } = require('pg-mem');
  const fs = require('fs');
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = fs.readFileSync('./lib/migrations/003_otp.sql', 'utf8');
  for (const stmt of sql.split(/;[ \t]*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
  const { requestOtp, verifyOtp } = require('../lib/otp');
  const { createAuth } = require('../lib/auth');
  const auth = createAuth({ sessionSecret: 'x'.repeat(32), sessionDays: 30, isProd: false });
  const sent = [];
  const mailer = { send: async (to, subject, html) => { sent.push({ to, html }); return { ok: true }; } };
  await requestOtp(pool, auth, mailer, 'u@test.com', 'signup');
  assert.equal(sent.length, 1);
  const m = sent[0].html.match(/(\d{6})/);
  assert.ok(m, 'code in email');
  const code = m[1];
  const bad = await verifyOtp(pool, auth, 'u@test.com', '000000', 'signup');
  assert.equal(bad.ok, false);
  const good = await verifyOtp(pool, auth, 'u@test.com', code, 'signup');
  assert.equal(good.ok, true);
  const reuse = await verifyOtp(pool, auth, 'u@test.com', code, 'signup');
  assert.equal(reuse.ok, false);
  await pool.end();
});

test('gateway: resolve + fallback chain (pg-mem)', async () => {
  const { newDb } = require('pg-mem');
  const fs = require('fs');
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const sql = fs.readFileSync('./lib/migrations/004_gateway.sql', 'utf8');
  for (const stmt of sql.split(/;[ \t]*\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    try { await pool.query(stmt); } catch (e) { /* ON CONFLICT etc */ }
  }
  const { createGateway } = require('../lib/gateway');
  const gw = createGateway({ pool, config: { sessionSecret: 'x'.repeat(32), tokenHarborKey: 'th-key' } });
  await gw.refresh();
  // Seeded provider + models resolve
  const r = await gw.resolve('claude-haiku-5.5:free');
  assert.ok(r, 'resolves seeded model');
  assert.equal(r.provider.id, 'tokenharbor');
  assert.equal(r.apiKey, 'th-key'); // env fallback
  // Unknown model -> null
  assert.equal(await gw.resolve('nope:free'), null);
  // Fallback chain empty when flag off (default)
  assert.deepEqual(await gw.fallbackChain('claude-haiku-5.5:free', 'free'), []);
  // Enable flag + add chain
  await pool.query("UPDATE feature_flags SET enabled = TRUE WHERE id = 'auto_model_switch'");
  await pool.query(
    "INSERT INTO model_fallbacks (plan_id, model_id, fallback_model_id, position) VALUES (NULL, 'claude-haiku-5.5:free', 'deepseek-v4.1-flash:free', 1)"
  );
  await gw.refresh();
  assert.deepEqual(await gw.fallbackChain('claude-haiku-5.5:free', 'free'), ['deepseek-v4.1-flash:free']);
  // Flags
  assert.equal(await gw.flag('chat_enabled', false), true);
  assert.equal(await gw.flag('auto_model_switch', false), true);
  await pool.end();
});
