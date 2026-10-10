'use strict';
/**
 * Disposable/throwaway email domain blocklist (anti multi-account abuse).
 * A compact curated list — extend as needed. Checked against the domain part
 * of the address (case-insensitive).
 */
const DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com',
  'guerrillamail.net', '10minutemail.com', '10minutemail.net', 'throwawaymail.com',
  'trashmail.com', 'trashmail.net', 'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'getnada.com', 'mohmal.com', 'emailondeck.com', 'fakeinbox.com', 'sharklasers.com',
  'grr.la', 'guerrillamailblock.com', 'pokemail.net', 'spam4.me', 'bccto.me',
  'chacuo.net', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com',
  'mytrashmail.com', 'no-spam.ws', 'nobulk.com', 'noclickemail.com', 'nospam.ze.tc',
  'spamfree24.org', 'spammotel.com', 'trashmail.me', 'wegwerfmail.de', 'wegwerfmail.net',
  'jetable.org', 'tempinbox.com', 'tempemail.net', 'tempmailaddress.com', 'mailcatch.com',
  'mailtemp.net', 'tmail.com', 'emailtemporanea.net', 'correotemporal.org',
]);

function isDisposable(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return false;
  return DOMAINS.has(String(email).slice(at + 1).toLowerCase());
}

module.exports = { isDisposable, count: DOMAINS.size };
