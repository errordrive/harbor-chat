'use strict';
/**
 * Cloudflare Turnstile verification. If no secret key is configured the
 * check is SKIPPED (with a warning) so deploys work before keys exist —
 * set TURNSTLE_SECRET_KEY for production.
 */
const https = require('https');
const log = require('./log');

let warned = false;
function verifyTurnstile(secretKey, token, ip) {
  return new Promise((resolve) => {
    if (!secretKey) {
      if (!warned) { warned = true; log.warn('TURNSTLE_SECRET_KEY unset — captcha skipped'); }
      return resolve(true);
    }
    if (!token) return resolve(false);
    const body = new URLSearchParams({ secret: secretKey, response: token, remoteip: ip || '' }).toString();
    const req = https.request(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).success === true);
          } catch (e) { resolve(false); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

module.exports = { verifyTurnstile };
