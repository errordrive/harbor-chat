'use strict';
/**
 * Authentication: scrypt password hashing, HMAC-signed stateless sessions,
 * HttpOnly cookies. User records live in Postgres now.
 */
const crypto = require('crypto');

function createAuth({ sessionSecret, sessionDays, isProd }) {
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const hmac = (data) => crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

  function scrypt(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (err, key) => (err ? reject(err) : resolve(key)));
    });
  }
  async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt);
    return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
  }
  async function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'base64');
    const want = Buffer.from(parts[2], 'base64');
    const got = await scrypt(password, salt);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  // Burns comparable CPU for unknown emails (blunts account probing by timing).
  const dummyHash = () => hashPassword('harbor-dummy-password');

  function makeSession(user) {
    const payload = b64u(JSON.stringify({ u: user.id, e: Date.now() + sessionDays * 86400000, v: user.sv || 0 }));
    return payload + '.' + hmac(payload);
  }
  function readSession(token) {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const want = hmac(payload);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try {
      const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!j || typeof j.u !== 'string' || typeof j.e !== 'number' || j.e < Date.now()) return null;
      return j;
    } catch (e) { return null; }
  }

  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) { /* ignore malformed */ }
    }
    return out;
  }
  function isHttps(req) {
    return !!(req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  }
  function sessionCookie(req, value, maxAgeSec) {
    return `hc_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (isHttps(req) ? '; Secure' : '');
  }

  async function getAuthUser(pool, req) {
    const tok = parseCookies(req).hc_session;
    const s = readSession(tok);
    if (!s) return null;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [s.u]);
    const u = rows[0];
    if (!u || (u.sv || 0) !== s.v || u.banned) return null;
    return u;
  }

  const publicUser = (u) => ({
    id: u.id, email: u.email, name: u.name,
    plan: u.plan_id || 'free', emailVerified: !!u.email_verified,
    isAdmin: !!u.is_admin,
  });

  // Token helpers for email verification / password reset (sha256-hashed at rest).
  function newToken() {
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  // Short-lived OTP proof token: proves the email owner entered the right
  // code within the last 10 minutes. HMAC-signed, stateless.
  function makeOtpToken(email, purpose) {
    const payload = b64u(JSON.stringify({ e: email.toLowerCase(), p: purpose, x: Date.now() + 10 * 60 * 1000 }));
    return 'otp1.' + payload + '.' + hmac('otp1.' + payload);
  }
  function readOtpToken(token, purpose) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'otp1') return null;
    const want = hmac(parts[0] + '.' + parts[1]);
    if (parts[2].length !== want.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(want))) return null;
    try {
      const j = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!j || j.p !== purpose || typeof j.e !== 'string' || j.x < Date.now()) return null;
      return j.e;
    } catch (e) { return null; }
  }

  return {
    hashPassword, verifyPassword, dummyHash,
    makeSession, readSession, parseCookies, sessionCookie,
    getAuthUser, publicUser, newToken,
    makeOtpToken, readOtpToken,
  };
}

module.exports = { createAuth };
