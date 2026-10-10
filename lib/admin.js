'use strict';
/**
 * Admin helpers: promote ADMIN_EMAILS to is_admin on boot, and the
 * requireAdmin gate for admin routes.
 */
const { sendJson } = require('./http');
const log = require('./log');

async function syncAdmins(pool, adminEmails) {
  if (!adminEmails || !adminEmails.length) return;
  try {
    const { rowCount } = await pool.query(
      'UPDATE users SET is_admin = TRUE WHERE email = ANY($1) AND is_admin = FALSE',
      [adminEmails]
    );
    if (rowCount > 0) log.info('promoted admins', { count: rowCount });
  } catch (e) {
    log.error('syncAdmins failed', { error: e.message });
  }
}

async function requireAdmin(pool, auth, req, res) {
  const user = await auth.getAuthUser(pool, req).catch(() => null);
  if (!user) {
    sendJson(res, 401, { error: 'Please sign in.' });
    return null;
  }
  if (!user.is_admin) {
    sendJson(res, 403, { error: 'Admin only.' });
    return null;
  }
  return user;
}

module.exports = { syncAdmins, requireAdmin };
