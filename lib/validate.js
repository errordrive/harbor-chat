'use strict';
/**
 * Centralized input validation. Every function returns null when valid,
 * or an error message string when invalid. Never throws on user input.
 */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const ROLES = new Set(['system', 'user', 'assistant']);

function email(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) return 'Enter a valid email address.';
  return null;
}

function password(v) {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 8) return 'Password must be at least 8 characters.';
  if (s.length > 128) return 'Password is too long (max 128).';
  return null;
}

function name(v) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
  return s; // always valid; may be empty (caller falls back to email prefix)
}

function modelId(v) {
  const s = typeof v === 'string' ? v.slice(0, 120) : '';
  if (!s || !MODEL_ID_RE.test(s)) return 'Invalid model id.';
  return null;
}

function lang(v) {
  return v === 'bn' ? 'bn' : 'en';
}

function temperature(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !(v >= 0 && v <= 2)) return 'temperature must be between 0 and 2.';
  return null;
}

function maxTokens(v, cap) {
  if (v === undefined || v === null) return null;
  if (!Number.isInteger(v) || v <= 0) return 'max_tokens must be a positive integer.';
  if (v > cap) return `max_tokens is too large (max ${cap}).`;
  return null;
}

// Validates the chat/agent messages array. Returns { error } or { messages, estPrompt }.
function messages(arr, estimateFn) {
  if (!Array.isArray(arr) || !arr.length || arr.length > 200) {
    return { error: 'messages must be a non-empty array (max 200)' };
  }
  const clean = [];
  let estPrompt = 0;
  for (const m of arr) {
    if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') {
      return { error: 'each message needs role + content strings' };
    }
    if (!ROLES.has(m.role)) return { error: 'invalid role: ' + m.role.slice(0, 20) };
    if (m.content.length > 200000) return { error: 'a message is too long (max 200k chars)' };
    estPrompt += estimateFn(m.content);
    clean.push({ role: m.role, content: m.content });
  }
  return { messages: clean, estPrompt };
}

function token(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 256 || !/^[A-Za-z0-9_-]+$/.test(s)) return 'Invalid token.';
  return null;
}

module.exports = { email, password, name, modelId, lang, temperature, maxTokens, messages, token, EMAIL_RE };
