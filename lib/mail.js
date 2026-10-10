'use strict';
/**
 * Outgoing mail via Resend (free tier: 100 emails/day). Zero extra
 * dependencies — plain https.request.
 *
 * If RESEND_API_KEY is unset the mailer is disabled: callers decide what to
 * do (dev fallback via ALLOW_MAIL_LOG, otherwise a 503 to the user).
 */
const https = require('https');
const log = require('./log');

function createMailer({ resendApiKey, mailFrom, appBaseUrl }) {
  const enabled = !!resendApiKey;

  function send({ to, subject, html }) {
    return new Promise((resolve) => {
      if (!enabled) return resolve({ ok: false, disabled: true });
      const body = JSON.stringify({ from: mailFrom, to, subject, html });
      const req = https.request(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + resendApiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 15000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            if (!ok) log.warn('resend send failed', { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8').slice(0, 300) });
            resolve({ ok });
          });
        }
      );
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => { log.warn('resend request error', { error: e.message }); resolve({ ok: false, error: e.message }); });
      req.write(body);
      req.end();
    });
  }

  const link = (path) => (appBaseUrl || '').replace(/\/+$/, '') + path;

  function verificationEmail(name, verifyUrl) {
    return {
      subject: 'Verify your Harbor Chat email',
      html: `<p>Hi ${escape(name)},</p><p>Please verify your email to start chatting:</p>` +
        `<p><a href="${verifyUrl}">Verify email</a></p>` +
        `<p>This link expires in 24 hours. If you didn't sign up, ignore this email.</p>`,
    };
  }
  function resetEmail(name, resetUrl) {
    return {
      subject: 'Reset your Harbor Chat password',
      html: `<p>Hi ${escape(name)},</p><p>Reset your password with this link (expires in 1 hour):</p>` +
        `<p><a href="${resetUrl}">Reset password</a></p>` +
        `<p>If you didn't ask for this, ignore this email.</p>`,
    };
  }
  function escape(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { enabled, send, link, verificationEmail, resetEmail };
}

module.exports = { createMailer };
