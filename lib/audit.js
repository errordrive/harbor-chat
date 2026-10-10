'use strict';
/**
 * Harbor Chat v4.0 — audit logging for security-sensitive actions.
 * Fire-and-forget: never blocks the request.
 */
function audit(pool, { userId, action, detail, ip }) {
  try {
    pool.query(
      'INSERT INTO audit_log(user_id, action, detail, ip) VALUES($1,$2,$3,$4)',
      [userId || null, String(action).slice(0, 60), JSON.stringify(detail || {}), String(ip || '').slice(0, 45)]
    ).catch(() => {});
  } catch (e) { /* never throw */ }
}

module.exports = { audit };
