import { useState, useEffect, useRef } from 'react';
import { tr, getLang, setLang } from '../lib/i18n';
import { signup, login, loginWithOtp, requestOtp, verifyOtp, forgotPassword, fetchPublicConfig } from '../lib/api';
import { IconLogo, IconGlobe } from './icons';

// Cloudflare Turnstile widget (only rendered when a site key is configured).
function Turnstile({ siteKey, onToken }) {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || widgetId.current !== null) return;
      try {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      } catch { /* widget failed; server will reject without token */ }
    };
    if (window.turnstile) { render(); return () => { cancelled = true; }; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true; s.defer = true;
    s.onload = render;
    document.head.appendChild(s);
    return () => { cancelled = true; };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div className="auth-turnstile" ref={ref} />;
}

// OTP code input: 6 boxes.
function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const set = (i, ch) => {
    const next = (value + '      ').slice(0, 6).split('');
    next[i] = ch.replace(/\D/g, '').slice(-1);
    onChange(next.join('').trim());
    if (ch && i < 5) refs.current[i + 1]?.focus();
  };
  return (
    <div className="otp-boxes">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)}
          className="otp-box" inputMode="numeric" maxLength={1}
          value={value[i] || ''} disabled={disabled}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus(); }} />
      ))}
    </div>
  );
}

export default function AuthScreen({ onAuthed, notice }) {
  // mode: login | signup | login-otp | forgot | reset-sent
  // step: 'email' | 'otp' | 'password' (for signup); login-otp uses email->otp
  const [mode, setMode] = useState('login');
  const [step, setStep] = useState('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [siteKey, setSiteKey] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [, bump] = useState(0);

  useEffect(() => {
    fetchPublicConfig().then((c) => setSiteKey(c.turnstileSiteKey || null)).catch(() => {});
  }, []);

  const switchMode = (m) => {
    setMode(m); setStep('email'); setError(''); setCode(''); setOtpToken(''); setPassword('');
  };

  const sendCode = async (purpose) => {
    setBusy(true); setError('');
    try {
      await requestOtp(email, purpose, turnstileToken);
      setStep('otp');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const confirmCode = async (purpose) => {
    setBusy(true); setError('');
    try {
      const j = await verifyOtp(email, code, purpose);
      setOtpToken(j.otp_token);
      if (purpose === 'signup') {
        setStep('password');
      } else {
        // Passwordless login.
        const r = await loginWithOtp(email, j.otp_token);
        onAuthed(r.user);
      }
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doSignup = async () => {
    setBusy(true); setError('');
    try {
      const r = await signup(email, password, name, otpToken);
      onAuthed(r.user);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const doPasswordLogin = async () => {
    setBusy(true); setError('');
    try {
      const r = await login(email, password, turnstileToken);
      onAuthed(r.user);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const toggleLang = () => { setLang(getLang() === 'bn' ? 'en' : 'bn'); bump((n) => n + 1); };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-top">
          <div className="auth-logo"><IconLogo width={44} height={44} /></div>
          <button className="tool-btn" onClick={toggleLang} title={tr('lang_toggle')}>
            <IconGlobe /><span className="lang-label">{getLang() === 'bn' ? 'EN' : 'বাং'}</span>
          </button>
        </div>
        <h1>{tr('app_name')}</h1>
        <p className="auth-sub">{tr('auth_tagline')}</p>

        {notice && <div className="auth-note">{notice}</div>}
        {error && <div className="auth-err">{error}</div>}

        <div className="auth-tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>{tr('auth_signin')}</button>
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>{tr('auth_signup')}</button>
        </div>

        {mode === 'signup' && (
          <>
            {step === 'email' && (
              <>
                <input className="auth-input" placeholder={tr('auth_name')} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                <input className="auth-input" placeholder={tr('auth_email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
                <button className="auth-submit" disabled={busy || !email} onClick={() => sendCode('signup')}>
                  {busy ? tr('auth_sending') : tr('auth_send_code')}
                </button>
              </>
            )}
            {step === 'otp' && (
              <>
                <p className="auth-sub">{tr('auth_code_sent').replace('{email}', email)}</p>
                <OtpInput value={code} onChange={setCode} disabled={busy} />
                <button className="auth-submit" disabled={busy || code.length !== 6} onClick={() => confirmCode('signup')}>
                  {busy ? tr('auth_verifying') : tr('auth_verify')}
                </button>
                <button className="auth-link" disabled={busy} onClick={() => sendCode('signup')}>{tr('auth_resend')}</button>
              </>
            )}
            {step === 'password' && (
              <>
                <p className="auth-sub">{tr('auth_email_ok')}</p>
                <input className="auth-input" placeholder={tr('auth_password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
                <button className="auth-submit" disabled={busy || password.length < 8} onClick={doSignup}>
                  {busy ? tr('auth_creating') : tr('auth_create')}
                </button>
              </>
            )}
          </>
        )}

        {mode === 'login' && (
          <>
            <input className="auth-input" placeholder={tr('auth_email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            <input className="auth-input" placeholder={tr('auth_password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
            <button className="auth-submit" disabled={busy || !email || !password} onClick={doPasswordLogin}>
              {busy ? tr('auth_signing_in') : tr('auth_signin')}
            </button>
            <div className="auth-alt">
              <button className="auth-link" onClick={() => switchMode('login-otp')}>{tr('auth_use_otp')}</button>
              <button className="auth-link" onClick={() => switchMode('forgot')}>{tr('auth_forgot')}</button>
            </div>
          </>
        )}

        {mode === 'login-otp' && (
          <>
            {step === 'email' && (
              <>
                <input className="auth-input" placeholder={tr('auth_email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />
                <button className="auth-submit" disabled={busy || !email} onClick={() => sendCode('login')}>
                  {busy ? tr('auth_sending') : tr('auth_send_code')}
                </button>
                <button className="auth-link" onClick={() => switchMode('login')}>{tr('auth_use_password')}</button>
              </>
            )}
            {step === 'otp' && (
              <>
                <p className="auth-sub">{tr('auth_code_sent').replace('{email}', email)}</p>
                <OtpInput value={code} onChange={setCode} disabled={busy} />
                <button className="auth-submit" disabled={busy || code.length !== 6} onClick={() => confirmCode('login')}>
                  {busy ? tr('auth_verifying') : tr('auth_signin')}
                </button>
                <button className="auth-link" disabled={busy} onClick={() => sendCode('login')}>{tr('auth_resend')}</button>
              </>
            )}
          </>
        )}

        {mode === 'forgot' && (
          <ForgotForm onBack={() => switchMode('login')} onSent={() => switchMode('reset-sent')} />
        )}
        {mode === 'reset-sent' && (
          <div className="auth-note">{tr('auth_reset_sent')}</div>
        )}
      </div>
    </div>
  );
}

function ForgotForm({ onBack, onSent }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await forgotPassword(email); onSent(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <>
      {error && <div className="auth-err">{error}</div>}
      <input className="auth-input" placeholder={tr('auth_email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      <button className="auth-submit" disabled={busy || !email} onClick={submit}>{tr('auth_send_reset')}</button>
      <button className="auth-link" onClick={onBack}>{tr('auth_back_login')}</button>
    </>
  );
}
