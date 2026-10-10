'use strict';
/**
 * Auth routes: signup (with Turnstile + disposable-email block + email
 * verification), login, logout, me, verify-email, resend-verification,
 * forgot-password, reset-password.
 */
const { readJson, sendJson, getClientIp, createRateLimiter } = require('../lib/http');
const validate = require('../lib/validate');
const { isDisposable } = require('../lib/disposable');
const { verifyTurnstile } = require('../lib/turnstile');
const otp = require('../lib/otp');
const { audit } = require('../lib/audit');
const log = require('../lib/log');

const E429 = {
  en: 'Too many attempts. Please wait a bit and try again.',
  bn: 'অনেকবার চেষ্টা করা হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন।',
};

function mount(add, ctx) {
  const { pool, auth, config, mailer } = ctx;
  const rlSignup = createRateLimiter({ windowMs: 3600000, max: 8 });
  const rlLogin = createRateLimiter({ windowMs: 300000, max: 15 });
  const rlForgot = createRateLimiter({ windowMs: 3600000, max: 8 });
  const rlVerify = createRateLimiter({ windowMs: 3600000, max: 20 });

  const needCsrf = (req, res) => {
    const { csrfOk } = require('../lib/http');
    if (!csrfOk(req)) { sendJson(res, 403, { error: 'CSRF check failed' }); return false; }
    return true;
  };
  const rateLimited = (req, res, limiter) => {
    const ip = getClientIp(req, config.trustProxyHops);
    if (!limiter.check('ip:' + ip)) {
      sendJson(res, 429, { error: E429.en, error_bn: E429.bn });
      return true;
    }
    return false;
  };

  // ---- OTP: request code ----
  add('POST', '/api/auth/otp/request', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlSignup)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const emailErr = validate.email(body.email);
    if (emailErr) return sendJson(res, 400, { error: emailErr });
    const purpose = body.purpose === 'login' ? 'login' : 'signup';
    const email = body.email.trim().toLowerCase();
    if (purpose === 'signup' && isDisposable(email)) {
      return sendJson(res, 400, {
        error: 'Disposable email addresses are not allowed. Please use a real email.',
        error_bn: 'অস্থায়ী ইমেইল ঠিকানা গ্রহণযোগ্য নয়। আসল ইমেইল ব্যবহার করুন।',
      });
    }
    const ip = getClientIp(req, config.trustProxyHops);
    if (!(await verifyTurnstile(config.turnstileSecretKey, body.turnstileToken, ip))) {
      return sendJson(res, 400, { error: 'Captcha verification failed. Please try again.' });
    }
    // For login OTP, don't reveal whether the email exists — but don't send either.
    if (purpose === 'login') {
      const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (!rows.length) {
        await auth.dummyHash(); // burn comparable time
        return sendJson(res, 200, { ok: true });
      }
    }
    try {
      await otp.requestOtp(pool, auth, mailer, email, purpose);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 503, { error: e.message });
    }
  });

  // ---- OTP: verify code -> otp_token ----
  add('POST', '/api/auth/otp/verify', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlLogin)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const emailErr = validate.email(body.email);
    if (emailErr) return sendJson(res, 400, { error: emailErr });
    const purpose = body.purpose === 'login' ? 'login' : 'signup';
    const email = body.email.trim().toLowerCase();
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return sendJson(res, 400, { error: 'Enter the 6-digit code.' });
    const result = await otp.verifyOtp(pool, auth, email, code, purpose);
    if (!result.ok) return sendJson(res, 400, { error: result.error });
    return sendJson(res, 200, { ok: true, otp_token: auth.makeOtpToken(email, purpose) });
  });

  // ---- signup (OTP-verified) ----
  add('POST', '/api/auth/signup', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlSignup)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const emailErr = validate.email(body.email);
    if (emailErr) return sendJson(res, 400, { error: emailErr });
    const passErr = validate.password(body.password);
    if (passErr) return sendJson(res, 400, { error: passErr });
    const email = body.email.trim().toLowerCase();
    // The OTP proof is mandatory: it proves the user owns this email address.
    const otpEmail = auth.readOtpToken(body.otp_token, 'signup');
    if (!otpEmail || otpEmail !== email) {
      return sendJson(res, 400, {
        error: 'Email verification required. Please verify the code sent to your email first.',
        error_bn: 'ইমেইল ভেরিফিকেশন প্রয়োজন। আগে আপনার ইমেইলে পাঠানো কোডটি যাচাই করুন।',
      });
    }
    if (isDisposable(email)) {
      return sendJson(res, 400, {
        error: 'Disposable email addresses are not allowed. Please use a real email.',
        error_bn: 'অস্থায়ী ইমেইল ঠিকানা গ্রহণযোগ্য নয়। আসল ইমেইল ব্যবহার করুন।',
      });
    }
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) {
      return sendJson(res, 400, { error: 'This email is already registered. Please sign in.' });
    }
    const name = validate.name(body.name) || email.split('@')[0].slice(0, 40);
    const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const pass = await auth.hashPassword(body.password);
    const isAdminEmail = config.adminEmails.includes(email);
    await pool.query(
      'INSERT INTO users (id, email, name, pass, plan_id, email_verified, is_admin) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, email, name, pass, 'free', true, isAdminEmail]
    );
    log.info('user signup (otp)', { userId: id });
    audit(pool, { userId: id, action: 'signup', ip: getClientIp(req, config.trustProxyHops) });
    const u = (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    res.setHeader('Set-Cookie', auth.sessionCookie(req, auth.makeSession(u), config.sessionDays * 86400));
    return sendJson(res, 200, { ok: true, user: auth.publicUser(u) });
  });

  // ---- verify email ----
  add('GET', '/api/auth/verify', async (req, res, query) => {
    if (rateLimited(req, res, rlVerify)) return;
    const raw = String(query.token || '');
    if (validate.token(raw)) return sendJson(res, 400, { error: 'Invalid token.' });
    const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
    const { rows } = await pool.query(
      `SELECT v.user_id, u.email_verified FROM email_verifications v
       JOIN users u ON u.id = v.user_id
       WHERE v.token_hash = $1 AND v.expires_at > now()`,
      [hash]
    );
    if (!rows.length) {
      return sendJson(res, 400, {
        error: 'This verification link is invalid or expired.',
        error_bn: 'এই ভেরিফিকেশন লিংকটি ভুল বা মেয়াদোত্তীর্ণ।',
      });
    }
    const userId = rows[0].user_id;
    await pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
    const u = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
    res.setHeader('Set-Cookie', auth.sessionCookie(req, auth.makeSession(u), config.sessionDays * 86400));
    log.info('email verified', { userId });
    return sendJson(res, 200, { ok: true, user: auth.publicUser(u) });
  });

  // ---- resend verification ----
  add('POST', '/api/auth/resend-verification', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlVerify)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (validate.email(body.email)) return sendJson(res, 400, { error: 'Enter a valid email address.' });
    const email = body.email.trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const u = rows[0];
    // Always respond ok (don't leak which emails exist).
    if (u && !u.email_verified) {
      const tok = auth.newToken();
      await pool.query(
        `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '24 hours')
         ON CONFLICT (user_id) DO UPDATE SET token_hash = $2, expires_at = now() + interval '24 hours'`,
        [u.id, tok.hash]
      );
      await mailer.send({ to: email, ...mailer.verificationEmail(u.name, mailer.link('/verify-email?token=' + tok.raw)) });
    }
    return sendJson(res, 200, { ok: true });
  });

  // ---- login (password OR otp_token) ----
  add('POST', '/api/auth/login', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlLogin)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (validate.email(body.email) || (typeof body.password !== 'string' && typeof body.otp_token !== 'string')) {
      return sendJson(res, 400, { error: 'Enter a valid email and password.' });
    }
    const email = body.email.trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const u = rows[0];
    let ok = false;
    if (typeof body.otp_token === 'string') {
      // Passwordless OTP login: the otp_token proves email ownership.
      const otpEmail = auth.readOtpToken(body.otp_token, 'login');
      ok = !!(otpEmail && otpEmail === email && u);
    } else {
      const ip = getClientIp(req, config.trustProxyHops);
      if (!(await verifyTurnstile(config.turnstileSecretKey, body.turnstileToken, ip))) {
        return sendJson(res, 400, { error: 'Captcha verification failed. Please try again.' });
      }
      ok = u ? await auth.verifyPassword(body.password, u.pass) : await auth.dummyHash().then(() => false);
    }
    if (!ok || !u) {
      log.warn('login failed', { email });
      return sendJson(res, 401, {
        error: 'Wrong email or password.',
        error_bn: 'ইমেইল বা পাসওয়ার্ড ভুল।',
      });
    }
    if (u.banned) return sendJson(res, 403, { error: 'This account has been disabled.' });
    // Auto-promote ADMIN_EMAILS on login (covers accounts registered after boot).
    if (config.adminEmails.includes(email) && !u.is_admin) {
      await pool.query('UPDATE users SET is_admin = TRUE WHERE id = $1', [u.id]).catch(() => {});
      u.is_admin = true;
      log.info('admin auto-promoted on login', { userId: u.id });
    }
    res.setHeader('Set-Cookie', auth.sessionCookie(req, auth.makeSession(u), config.sessionDays * 86400));
    log.info('login', { userId: u.id });
    audit(pool, { userId: u.id, action: 'login', ip: getClientIp(req, config.trustProxyHops) });
    return sendJson(res, 200, { ok: true, user: auth.publicUser(u) });
  });

  // ---- logout ----
  add('POST', '/api/auth/logout', async (req, res) => {
    if (!needCsrf(req, res)) return;
    res.setHeader('Set-Cookie', auth.sessionCookie(req, '', 0));
    return sendJson(res, 200, { ok: true });
  });

  // ---- delete account (password confirmation required) ----
  add('POST', '/api/auth/delete', async (req, res) => {
    if (!needCsrf(req, res)) return;
    const user = await auth.getAuthUser(pool, req).catch(() => null);
    if (!user) return sendJson(res, 401, { error: 'Please sign in.' });
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (typeof body.password !== 'string') return sendJson(res, 400, { error: 'Password required.' });
    const ok = await auth.verifyPassword(body.password, user.pass);
    if (!ok) return sendJson(res, 401, { error: 'Wrong password.' });
    if (body.confirm !== 'DELETE') {
      return sendJson(res, 400, { error: 'Type DELETE to confirm.' });
    }
    const { audit } = require('../lib/audit');
    audit(pool, { userId: user.id, action: 'account_delete', ip: getClientIp(req, config.trustProxyHops) });
    // Cascading deletes handle user_skills, skill_installations, etc.
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    res.setHeader('Set-Cookie', auth.sessionCookie(req, '', 0));
    return sendJson(res, 200, { ok: true });
  });

  // ---- me ----
  const handleMe = async (req, res) => {
    const u = await auth.getAuthUser(pool, req).catch(() => null);
    if (!u) return sendJson(res, 401, { error: 'Not signed in.' });
    const plan = ctx.plans.get(u.plan_id);
    return sendJson(res, 200, { ok: true, user: { ...auth.publicUser(u), plan: plan.id, planName: plan.name } });
  };
  add('GET', '/api/auth/me', handleMe);
  add('GET', '/api/me', handleMe); // legacy alias used by the web UI

  // ---- forgot password ----
  add('POST', '/api/auth/forgot', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlForgot)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (validate.email(body.email)) return sendJson(res, 200, { ok: true }); // don't leak
    const email = body.email.trim().toLowerCase();
    const ip = getClientIp(req, config.trustProxyHops);
    if (!(await verifyTurnstile(config.turnstileSecretKey, body.turnstileToken, ip))) {
      return sendJson(res, 400, { error: 'Captcha verification failed. Please try again.' });
    }
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const u = rows[0];
    if (u) {
      const tok = auth.newToken();
      await pool.query(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')',
        [tok.hash, u.id]
      );
      const resetUrl = mailer.link('/reset-password?token=' + tok.raw);
      const sent = await mailer.send({ to: email, ...mailer.resetEmail(u.name, resetUrl) });
      if (config.allowMailLog) {
        log.info('password reset link (dev)', { userId: u.id, resetUrl: 'REDACTED_IN_PROD' });
        return sendJson(res, 200, { ok: true, devResetUrl: resetUrl });
      }
      if (!sent.ok && !sent.disabled) log.error('reset email failed', { userId: u.id });
    }
    // Always ok — never reveal whether the email exists.
    return sendJson(res, 200, { ok: true });
  });

  // ---- reset password ----
  add('POST', '/api/auth/reset', async (req, res) => {
    if (!needCsrf(req, res) || rateLimited(req, res, rlForgot)) return;
    let body;
    try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (validate.token(body.token)) return sendJson(res, 400, { error: 'Invalid token.' });
    const passErr = validate.password(body.password);
    if (passErr) return sendJson(res, 400, { error: passErr });
    const hash = require('crypto').createHash('sha256').update(String(body.token).trim()).digest('hex');
    const { rows } = await pool.query(
      'SELECT user_id FROM password_resets WHERE token_hash = $1 AND expires_at > now()',
      [hash]
    );
    if (!rows.length) {
      return sendJson(res, 400, {
        error: 'This reset link is invalid or expired.',
        error_bn: 'এই রিসেট লিংকটি ভুল বা মেয়াদোত্তীর্ণ।',
      });
    }
    const userId = rows[0].user_id;
    const pass = await auth.hashPassword(body.password);
    // Bump sv to invalidate all existing sessions.
    await pool.query('UPDATE users SET pass = $1, sv = sv + 1 WHERE id = $2', [pass, userId]);
    await pool.query('DELETE FROM password_resets WHERE token_hash = $1', [hash]);
    log.info('password reset', { userId });
    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { mount };
