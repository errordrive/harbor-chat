'use strict';
/**
 * Email OTP: 6-digit codes, scrypt-hashed at rest, 10-minute expiry,
 * max 5 attempts. Used for signup + login email verification.
 */
const log = require('./log');

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode() {
  // 6 digits, no leading zero issues for UX (100000-999999).
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function requestOtp(pool, auth, mailer, email, purpose) {
  const code = generateCode();
  const codeHash = await auth.hashPassword(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  // Invalidate older pending codes for this email+purpose.
  await pool.query('DELETE FROM email_otps WHERE email = $1 AND purpose = $2', [email, purpose]);
  await pool.query(
    'INSERT INTO email_otps (email, code_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)',
    [email, codeHash, purpose, expiresAt]
  );
  const subject = purpose === 'login' ? 'Your Harbor Chat login code' : 'Your Harbor Chat verification code';
  const html = `<p>Your verification code is:</p><h1 style="letter-spacing: 8px;">${code}</h1><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p>`;
  try {
    await mailer.send(email, subject, html);
  } catch (e) {
    log.error('otp email failed', { email, error: e.message });
    throw new Error('Could not send the verification email. Please try again later.');
  }
  log.info('otp sent', { email, purpose });
  return { ok: true };
}

async function verifyOtp(pool, auth, email, code, purpose) {
  const { rows } = await pool.query(
    `SELECT * FROM email_otps WHERE email = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'No code was requested for this email.' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM email_otps WHERE id = $1', [row.id]);
    return { ok: false, error: 'Code expired. Please request a new one.' };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query('DELETE FROM email_otps WHERE id = $1', [row.id]);
    return { ok: false, error: 'Too many wrong attempts. Please request a new code.' };
  }
  const ok = await auth.verifyPassword(String(code).trim(), row.code_hash);
  if (!ok) {
    await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { ok: false, error: 'Wrong code. Please try again.' };
  }
  await pool.query('DELETE FROM email_otps WHERE id = $1', [row.id]);
  return { ok: true };
}

module.exports = { requestOtp, verifyOtp, OTP_TTL_MS };
