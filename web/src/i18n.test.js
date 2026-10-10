import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tr, getLang, setLang } from './lib/i18n.js';

// i18n uses localStorage; provide a minimal mock for the node test env.
const store = {};
vi.stubGlobal('localStorage', {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
});

describe('i18n', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; setLang('en'); });

  it('returns English strings by default', () => {
    expect(tr('auth_login')).toBe('Sign in');
    expect(tr('auth_verify_notice')).toContain('verification link');
  });

  it('switches to Bangla', () => {
    setLang('bn');
    expect(getLang()).toBe('bn');
    expect(tr('auth_login')).toBe('সাইন ইন');
    expect(tr('auth_verify_notice')).toContain('ভেরিফিকেশন');
  });

  it('falls back to English for missing Bangla keys', () => {
    setLang('bn');
    // every key used by the new auth flows must exist in both languages
    for (const k of ['auth_forgot', 'auth_send_reset', 'auth_back_login', 'auth_verify_notice',
      'auth_resend', 'auth_reset_sent', 'auth_verify_ok', 'auth_verify_fail',
      'auth_reset_title', 'auth_reset_done']) {
      expect(tr(k), `missing bn: ${k}`).not.toBe(k);
    }
  });

  it('returns the key itself for unknown keys', () => {
    expect(tr('no_such_key_xyz')).toBe('no_such_key_xyz');
  });
});
