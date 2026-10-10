'use strict';
/**
 * Structured JSON logging to stdout. One JSON object per line:
 * {"t":"...","lvl":"info","msg":"...","userId":"...", ...extra}
 * Render / any log aggregator can parse these directly.
 */
function write(lvl, msg, fields) {
  const rec = { t: new Date().toISOString(), lvl, msg };
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) {
      const v = fields[k];
      if (v === undefined) continue;
      rec[k] = v;
    }
  }
  // Never log secrets: drop anything that looks like one.
  for (const k of Object.keys(rec)) {
    if (/key|secret|token|password|pass|auth|cookie|session/i.test(k) && typeof rec[k] === 'string' && rec[k].length > 8) {
      rec[k] = '[redacted]';
    }
  }
  try {
    console.log(JSON.stringify(rec));
  } catch (e) {
    console.log(JSON.stringify({ t: rec.t, lvl, msg: String(msg) }));
  }
}

module.exports = {
  debug: (msg, fields) => { if (process.env.LOG_LEVEL === 'debug') write('debug', msg, fields); },
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
