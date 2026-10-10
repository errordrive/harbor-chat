// Auth is a signed HttpOnly session cookie set by the server — same-origin
// fetches send it automatically, so there is no token handling in JS.
let unauthorizedCb = null;
/** Registers a callback fired when the server says the session is gone (HTTP 401). */
export function setUnauthorizedHandler(fn) { unauthorizedCb = fn; }
function handle401(r) {
  if (r.status === 401 && unauthorizedCb) unauthorizedCb();
}

async function authPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
  return j;
}

export async function fetchMe() {
  const r = await fetch('/api/me');
  const j = await r.json();
  return j.user || null;
}
export const signup = (email, password, name, otpToken) =>
  authPost('/api/auth/signup', { email, password, name, otp_token: otpToken });
export const login = (email, password, turnstileToken) =>
  authPost('/api/auth/login', { email, password, turnstileToken });
export const loginWithOtp = (email, otpToken) =>
  authPost('/api/auth/login', { email, otp_token: otpToken });
export const requestOtp = (email, purpose, turnstileToken) =>
  authPost('/api/auth/otp/request', { email, purpose, turnstileToken });
export const verifyOtp = (email, code, purpose) =>
  authPost('/api/auth/otp/verify', { email, code, purpose });
export const logout = () => authPost('/api/auth/logout', {}).catch(() => {});
export const resendVerification = (email) =>
  authPost('/api/auth/resend-verification', { email });
export const forgotPassword = (email, turnstileToken) =>
  authPost('/api/auth/forgot', { email, turnstileToken });
export const resetPassword = (token, password) =>
  authPost('/api/auth/reset', { token, password });
export async function verifyEmail(token) {
  const r = await fetch('/api/auth/verify?token=' + encodeURIComponent(token));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Verification failed');
  return j;
}
export async function fetchPublicConfig() {
  const r = await fetch('/api/config');
  return r.json().catch(() => ({}));
}

export async function fetchModels() {
  const r = await fetch('/api/models');
  handle401(r);
  const j = await r.json();
  return j.models || [];
}

export async function fetchUsage() {
  const r = await fetch('/api/usage');
  handle401(r);
  if (!r.ok) throw new Error('usage failed');
  return r.json();
}

export async function checkHealth() {
  const r = await fetch('/api/health');
  return r.json();
}

/**
 * Streams a chat completion. Calls onToken(text) for each content delta.
 * Resolves with { full, usage } or throws { message, limit } on failure.
 */
export function streamChat({ model, messages, temperature, maxTokens, lang, signal, onToken, onFirstToken }) {
  return new Promise(async (resolve, reject) => {
    let full = '';
    let usage = null;
    let gotFirst = false;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: maxTokens, lang }),
        signal,
      });

      const ctype = r.headers.get('content-type') || '';
      if (!r.ok) {
        handle401(r);
        let msg = 'Request failed (' + r.status + ')';
        let limit = null;
        try {
          const j = await r.json();
          if (j.error) msg = j.error;
          if (j.limit) limit = j.limit;
        } catch (e) {}
        const err = new Error(msg);
        err.limit = limit;
        err.status = r.status;
        throw err;
      }

      if (ctype.includes('text/event-stream')) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop();
          for (const line of parts) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            const data = t.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (delta && typeof delta.content === 'string' && delta.content) {
                full += delta.content;
                if (!gotFirst) { gotFirst = true; onFirstToken && onFirstToken(); }
                onToken && onToken(full);
              }
              if (j.usage) usage = j.usage;
            } catch (e) { /* partial chunk */ }
          }
        }
      } else {
        const j = await r.json();
        full = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        usage = j.usage || null;
        onToken && onToken(full);
      }
      resolve({ full, usage });
    } catch (e) {
      if (e.name === 'AbortError') {
        const abort = new Error('aborted');
        abort.aborted = true;
        abort.partial = full;
        reject(abort);
      } else {
        reject(e);
      }
    }
  });
}

/**
 * Runs the agent (ReAct loop) on the server. Streams step events:
 *   { kind: 'thought', text } | { kind: 'action', tool, input } | { kind: 'observation', tool, text }
 * Calls onStep(step) for each. Resolves with { text } or throws { message, limit }.
 */
export function runAgent({ model, messages, systemPrompt, temperature, maxTokens, lang, signal, onStep }) {
  return new Promise(async (resolve, reject) => {
    try {
      const r = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, systemPrompt, temperature, max_tokens: maxTokens, lang }),
        signal,
      });

      const ctype = r.headers.get('content-type') || '';
      if (!r.ok) {
        handle401(r);
        let msg = 'Request failed (' + r.status + ')';
        let limit = null;
        try {
          const j = await r.json();
          if (j.error) msg = j.error;
          if (j.limit) limit = j.limit;
        } catch (e) {}
        const err = new Error(msg);
        err.limit = limit;
        err.status = r.status;
        throw err;
      }
      if (!ctype.includes('text/event-stream')) throw new Error('Bad response from server.');

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let final = null;
      const handleEvent = (event, data) => {
        if (!data || data === '[DONE]') return;
        let j;
        try { j = JSON.parse(data); } catch (e) { return; }
        if (event === 'step' && j && j.kind) onStep && onStep(j);
        else if (event === 'final') final = j;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = null;
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) handleEvent(event, data);
        }
      }

      if (!final) throw new Error('The agent returned nothing.');
      if (final.limit) {
        const err = new Error(final.text || 'Free limit reached.');
        err.limit = true;
        throw err;
      }
      if (final.error && !final.text) throw new Error(final.error);
      resolve({ text: final.text || '' });
    } catch (e) {
      if (e.name === 'AbortError') {
        const abort = new Error('aborted');
        abort.aborted = true;
        reject(abort);
      } else {
        reject(e);
      }
    }
  });
}


// Skills library API. Skill instructions are data only in this release; custom
// skills do not ship executable code or receive permissions automatically.
async function skillRequest(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  handle401(r); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Skill request failed.');
  return j;
}
export async function fetchSkills() {
  const r = await fetch('/api/skills'); handle401(r); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not load skills.'); return j.skills || [];
}
export const installSkill = (id) => skillRequest('/api/skills/install', { id });
export const uninstallSkill = (id) => skillRequest('/api/skills/uninstall', { id });
export const toggleSkill = (id, enabled) => skillRequest('/api/skills/toggle', { id, enabled });
export const createCustomSkill = (skill) => skillRequest('/api/skills/custom', skill);
export const updateCustomSkill = (skill) => fetch('/api/skills/custom', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(skill) }).then(async (r) => { handle401(r); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Update failed.'); return j; });
export const deleteCustomSkill = (id) => skillRequest('/api/skills/custom/delete', { id });
export const importSkill = (manifest) => skillRequest('/api/skills/import', { manifest });
export const testSkill = (id) => skillRequest('/api/skills/test', { id });
export async function fetchSkillVersions(id) {
  const r = await fetch('/api/skills/custom/versions?id=' + encodeURIComponent(id)); handle401(r);
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Failed.'); return j.versions || [];
}
export const rollbackSkill = (id, version) => skillRequest('/api/skills/custom/rollback', { id, version });
export async function fetchSkillHistory(limit = 30) {
  const r = await fetch('/api/skills/history?limit=' + limit); handle401(r);
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Failed.'); return j.history || [];
}
export async function exportSkill(id) {
  const r = await fetch('/api/skills/export?id=' + encodeURIComponent(id)); handle401(r);
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Failed.'); return j.manifest;
}
