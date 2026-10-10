'use strict';
/**
 * AES-256-GCM encryption for provider API keys at rest.
 * Key derived from SESSION_SECRET via scrypt (never stored).
 */
const crypto = require('crypto');

function getKey(sessionSecret) {
  return crypto.scryptSync(String(sessionSecret || 'harbor-fallback'), 'harbor-gateway-salt', 32);
}

function encrypt(sessionSecret, plaintext) {
  if (!plaintext) return null;
  const key = getKey(sessionSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'gcm1.' + Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decrypt(sessionSecret, blob) {
  if (!blob) return null;
  try {
    const parts = String(blob).split('.');
    if (parts[0] !== 'gcm1') return null;
    const buf = Buffer.from(parts[1], 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const key = getKey(sessionSecret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
