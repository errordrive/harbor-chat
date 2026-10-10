import { useState, useEffect } from 'react';
import { tr, getLang, setLang } from '../lib/i18n';
import { verifyEmail, resetPassword } from '../lib/api';
import { IconLogo, IconGlobe } from './icons';

function Shell({ children }) {
  const [, bump] = useState(0);
  const toggleLang = () => { setLang(getLang() === 'bn' ? 'en' : 'bn'); bump((n) => n + 1); };
  return (
    <div className="auth-wrap">
      <button className="tool-btn auth-lang" onClick={toggleLang} aria-label={tr('lang_toggle')}>
        <IconGlobe /><span className="lang-label">{getLang() === 'bn' ? 'EN' : 'বাং'}</span>
      </button>
      <div className="auth-card">
        <div className="auth-logo"><IconLogo width={56} height={56} /></div>
        <h1>Harbor Chat</h1>
        {children}
      </div>
    </div>
  );
}

export function VerifyEmailScreen({ token, onDone }) {
  const [state, setState] = useState('working'); // working | ok | fail
  useEffect(() => {
    verifyEmail(token)
      .then((j) => { setState('ok'); setTimeout(() => onDone(j.user), 1200); })
      .catch(() => setState('fail'));
  }, [token]);
  return (
    <Shell>
      {state === 'working' && <p className="auth-sub">{tr('auth_wait')}</p>}
      {state === 'ok' && <div className="auth-note"><p>{tr('auth_verify_ok')}</p></div>}
      {state === 'fail' && (
        <div className="auth-err" role="alert">
          <p>{tr('auth_verify_fail')}</p>
          <a href="/" className="auth-switch">{tr('auth_back_login')}</a>
        </div>
      )}
    </Shell>
  );
}

export function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(onDone, 1500);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Shell>
      <p className="auth-sub">{tr('auth_reset_title')}</p>
      {done
        ? <div className="auth-note"><p>{tr('auth_reset_done')}</p></div>
        : (
          <form onSubmit={submit}>
            {error && <div className="auth-err" role="alert">{error}</div>}
            <label className="auth-field">
              <span>{tr('auth_password')}</span>
              <input type="password" required minLength={8} maxLength={128}
                autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
              <small>{tr('auth_pw_hint')}</small>
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? tr('auth_wait') : tr('auth_reset_title')}
            </button>
          </form>
        )}
    </Shell>
  );
}
