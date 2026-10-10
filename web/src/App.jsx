import { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ModelPicker from './components/ModelPicker';
import MessageList from './components/MessageList';
import Composer from './components/Composer';
import SettingsModal from './components/SettingsModal';
import AuthScreen from './components/AuthScreen';
import { VerifyEmailScreen, ResetPasswordScreen } from './components/EmailFlows';
import AdminPanel from './components/AdminPanel';
import SkillsLibrary from './components/SkillsLibrary';
import { IconMenu, IconGear, IconSun, IconMoon, IconGlobe, IconLogo } from './components/icons';
import { fetchModels, fetchUsage, checkHealth, streamChat, fetchMe, logout, setUnauthorizedHandler } from './lib/api';
import { loadConvos, saveConvos, newConvo, titleFrom, setStoreUser } from './lib/store';
import { tr, getLang, setLang } from './lib/i18n';

const LS_MODEL = 'harbor_chat_model_v1';
const LS_SETTINGS = 'harbor_chat_settings_v1';
const LS_THEME = 'harbor_chat_theme_v1';
const DEFAULT_MODEL = 'claude-haiku-5.5:free';

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function ChatApp({ user, onLogout }) {
  const [convos, setConvos] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [settings, setSettings] = useState({ temperature: 0.7, maxTokens: 4096, systemPrompt: '' });
  const [usage, setUsage] = useState(null);
  const [healthOk, setHealthOk] = useState(null);
  const [streamingId, setStreamingId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [lang, setLangState] = useState(getLang());
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(LS_THEME) || 'light'; } catch (e) { return 'light'; }
  });
  const [skillsOpen, setSkillsOpen] = useState(false);

  const convosRef = useRef(convos);
  const activeIdRef = useRef(activeId);
  const modelRef = useRef(model);
  const settingsRef = useRef(settings);
  const abortRef = useRef(null);
  const toastTimer = useRef(null);

  convosRef.current = convos;
  activeIdRef.current = activeId;
  modelRef.current = model;
  settingsRef.current = settings;

  // Apply theme (GistVault-style data-theme attribute)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    try { localStorage.setItem(LS_THEME, theme); } catch (e) {}
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const toggleLang = () => {
    const next = getLang() === 'bn' ? 'en' : 'bn';
    setLang(next);
    setLangState(next);
  };

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const persist = (list) => { setConvos(list); saveConvos(list); };
  const activeConvo = () => convosRef.current.find((c) => c.id === activeIdRef.current) || null;

  const refreshUsage = useCallback(async () => {
    try { setUsage(await fetchUsage()); } catch (e) {}
  }, []);

  /* ---------------- init ---------------- */
  useEffect(() => {
    const saved = loadConvos();
    let s = { temperature: 0.7, maxTokens: 4096, systemPrompt: '' };
    try { Object.assign(s, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); } catch (e) {}
    setSettings(s);
    settingsRef.current = s;

    let cancelled = false;
    (async () => {
      try {
        const ms = await fetchModels();
        if (cancelled) return;
        const list = ms.length ? ms : [{ id: DEFAULT_MODEL }];
        setModels(list);
        const savedModel = localStorage.getItem(LS_MODEL);
        const want = savedModel && list.some((m) => m.id === savedModel) ? savedModel : DEFAULT_MODEL;
        setModel(want);
        modelRef.current = want;
      } catch (e) {
        if (!cancelled) setModels([{ id: DEFAULT_MODEL }]);
      }
      try {
        const h = await checkHealth();
        if (cancelled) return;
        setHealthOk(!!(h.ok && h.hasKey));
        if (!h.hasKey) showToast(tr('api_down'));
      } catch (e) { if (!cancelled) { setHealthOk(false); showToast(tr('api_unreachable')); } }
      if (!cancelled) refreshUsage();
    })();

    if (saved.length) {
      setConvos(saved);
      convosRef.current = saved;
      const latest = [...saved].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setActiveId(latest.id);
      activeIdRef.current = latest.id;
      if (latest.model) { setModel(latest.model); modelRef.current = latest.model; }
    }
    const iv = setInterval(refreshUsage, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [refreshUsage, showToast]);

  /* ---------------- convo ops ---------------- */
  const doNewChat = useCallback(() => {
    const c = newConvo(modelRef.current);
    const list = [c, ...convosRef.current];
    persist(list);
    setActiveId(c.id);
    activeIdRef.current = c.id;
    setSidebarOpen(false);
  }, []);

  const openConvo = useCallback((id) => {
    setActiveId(id);
    activeIdRef.current = id;
    const c = convosRef.current.find((x) => x.id === id);
    if (c && c.model) { setModel(c.model); modelRef.current = c.model; }
    setSidebarOpen(false);
  }, []);

  const deleteConvo = useCallback((id) => {
    const list = convosRef.current.filter((c) => c.id !== id);
    persist(list);
    if (activeIdRef.current === id) { setActiveId(null); activeIdRef.current = null; }
  }, []);

  const clearAll = useCallback(() => {
    if (!window.confirm(tr('confirm_delete_all'))) return;
    persist([]);
    setActiveId(null);
    activeIdRef.current = null;
    setSettingsOpen(false);
    showToast(tr('deleted_all'));
  }, [showToast]);

  const handleModelChange = useCallback((id) => {
    setModel(id);
    modelRef.current = id;
    try { localStorage.setItem(LS_MODEL, id); } catch (e) {}
    // The request always uses the convo's model — so the switch must update
    // the active conversation too, otherwise the picker shows the new model
    // while replies still come from the old one.
    const c = convosRef.current.find((x) => x.id === activeIdRef.current);
    if (c && c.model !== id) {
      persist(convosRef.current.map((x) => x.id === c.id ? { ...x, model: id } : x));
    }
  }, []);

  const copyText = useCallback((t) => {
    navigator.clipboard.writeText(t)
      .then(() => showToast(tr('copied')))
      .catch(() => showToast(tr('copy_fail')));
  }, [showToast]);

  /* ---------------- send flow ----------------
     Robust pattern: build the updated conversation as a LOCAL variable and
     persist the complete list. Never re-read convosRef after setState —
     React state updates are async, so the ref would be stale and the user
     message could be lost (or an empty payload sent to the server). */
  const updateMsg = (convoId, msgId, patch) => {
    setConvos((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convoId) return c;
        return {
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
        };
      });
      saveConvos(next);
      return next;
    });
  };

  const runSend = useCallback(async (text, regen = false) => {
    if (abortRef.current) return;

    // 1. Start from the current list (single ref read — ref is fresh here).
    const prevList = convosRef.current;
    let convo = prevList.find((x) => x.id === activeIdRef.current);
    let list = prevList;
    if (!convo) {
      convo = newConvo(modelRef.current);
      list = [convo, ...prevList];
      setActiveId(convo.id);
      activeIdRef.current = convo.id;
    }
    const convoId = convo.id;

    // 2. Apply the user message (or regen-trim) to the LOCAL convo object.
    if (!regen) {
      const um = { id: uid('m'), role: 'user', content: text };
      convo = {
        ...convo,
        updatedAt: Date.now(),
        messages: [...convo.messages, um],
        title: convo.messages.length === 0 ? titleFrom(text) : convo.title,
      };
    } else {
      const msgs = [...convo.messages];
      while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
      convo = { ...convo, updatedAt: Date.now(), messages: msgs };
    }
    list = list.map((x) => (x.id === convoId ? convo : x));
    persist(list);

    // 3. Assistant placeholder, also from the local object.
    // Stamp the generating model on the message so its label stays correct
    // even if the user switches models later in the conversation.
    const amId = uid('m');
    persist(list.map((x) => (x.id === convoId
      ? { ...x, messages: [...x.messages, { id: amId, role: 'assistant', content: '', model: convo.model }] }
      : x)));

    // 4. Payload built from the LOCAL convo — guaranteed to hold the user message.
    const payloadMsgs = [];
    const sp = (settingsRef.current.systemPrompt || '').trim();
    if (sp) payloadMsgs.push({ role: 'system', content: sp });
    for (const m of convo.messages) {
      if ((m.role === 'user' || m.role === 'assistant') && m.content && !m.limitNote && !m.errorNote) {
        payloadMsgs.push({ role: m.role, content: m.content });
      }
    }
    if (!payloadMsgs.length) {
      updateMsg(convoId, amId, { errorNote: true, content: 'Nothing to send.' });
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreamingId(amId);

    try {
      {
        const { full, usage: u } = await streamChat({
          model: convo.model,
          messages: payloadMsgs,
          temperature: settingsRef.current.temperature,
          maxTokens: settingsRef.current.maxTokens,
          lang,
          signal: ctrl.signal,
          onToken: (t) => updateMsg(convoId, amId, { content: t }),
        });
        const finalText = full.trim() ? full : tr('empty_response');
        updateMsg(convoId, amId, { content: finalText, usage: u || undefined });
        refreshUsage();
      }
    } catch (e) {
      if (e.aborted) {
        const partial = (e.partial || '').trim();
        updateMsg(convoId, amId, {
          content: partial ? partial + '\n\n' + tr('stopped') : tr('stopped_mid'),
        });
      } else if (e.limit) {
        updateMsg(convoId, amId, { limitNote: true, content: e.message });
        showToast(tr('limit_title'));
        refreshUsage();
      } else {
        updateMsg(convoId, amId, { errorNote: true, content: e.message || 'Error' });
        showToast(e.message || 'Error');
      }
    } finally {
      abortRef.current = null;
      setStreamingId(null);
    }
  }, [refreshUsage, showToast]);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const regenerate = useCallback(() => { runSend(null, true); }, [runSend]);

  const saveSettings = (s) => {
    setSettings(s);
    settingsRef.current = s;
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) {}
    setSettingsOpen(false);
    showToast(tr('saved'));
  };

  const convo = activeConvo();

  return (
    <div className="app">
      <Sidebar
        convos={convos}
        activeId={activeId}
        onNew={doNewChat}
        onOpen={openConvo}
        onDelete={deleteConvo}
        onSettings={() => setSettingsOpen(true)}
        onSkills={() => { setSkillsOpen(true); setSidebarOpen(false); }}
        usage={usage}
        user={user}
        onLogout={onLogout}
        onUsageClick={() => setSettingsOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className={'scrim' + (sidebarOpen ? ' show' : '')} onClick={() => setSidebarOpen(false)} />

      <div className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(true)} title={tr('menu')} aria-label={tr('menu')}>
            <IconMenu />
          </button>
          <IconLogo width={30} height={30} />
          <ModelPicker models={models} value={model} onChange={handleModelChange} />
          <div className="spacer" />
          <div className="title">{convo ? convo.title : 'Harbor Chat'}</div>
          <button className="tool-btn" onClick={toggleLang} title={tr('lang_toggle')} aria-label={tr('lang_toggle')}>
            <IconGlobe /><span className="lang-label">{getLang() === 'bn' ? 'EN' : 'বাং'}</span>
          </button>
          <button className="tool-btn" onClick={toggleTheme} title={tr('theme_toggle')} aria-label={tr('theme_toggle')}>
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button className="tool-btn" onClick={() => setSettingsOpen(true)} title={tr('settings')} aria-label={tr('settings')}>
            <IconGear />
          </button>
          {user.isAdmin && (
            <a className="tool-btn" href="/admin" title={tr('admin_title')} aria-label={tr('admin_title')}>
              ⚙
            </a>
          )}
          <div
            className={'status-dot' + (healthOk === null ? '' : healthOk ? ' ok' : ' bad')}
            title={healthOk ? 'OK' : healthOk === false ? tr('api_unreachable') : '…'}
          />
        </div>

        <MessageList
          convo={convo}
          streamingId={streamingId}
          onRegenerate={regenerate}
          onCopy={copyText}
          onSuggestion={(q) => runSend(q)}
        />

        <Composer
          onSend={(t) => runSend(t)}
          streaming={!!streamingId}
          onStop={stop}
        />
      </div>

      {skillsOpen && <SkillsLibrary onClose={() => setSkillsOpen(false)} onToast={showToast} />}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
          usage={usage}
          onClearAll={clearAll}
        />
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

/* ---------------- auth gate ----------------
   Every limit is tied to the signed-in user ID on the server. The chat UI only
   mounts once we have a user; ChatApp is keyed by user id so switching accounts
   remounts it with that account's chats. */
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [notice, setNotice] = useState('');

  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', localStorage.getItem(LS_THEME) === 'dark' ? 'dark' : 'light');
    } catch (e) {}
  }, []);

  const accept = useCallback((u) => {
    setStoreUser(u.id);
    setNotice('');
    setUser(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => { if (cancelled) return; if (u) accept(u); else setUser(null); })
      .catch(() => { if (!cancelled) setUser(null); });
    // Session expired / revoked mid-use -> back to the sign-in screen.
    setUnauthorizedHandler(() => { setNotice(tr('auth_session_expired')); setUser(null); });
    return () => { cancelled = true; setUnauthorizedHandler(null); };
  }, [accept]);

  const signOut = useCallback(async () => {
    await logout();
    setNotice('');
    setUser(null);
  }, []);

  if (user === undefined) return <div className="auth-wrap"><div className="typing-dots"><i /><i /><i /></div></div>;
  // Email verification / password reset links land here (server also serves
  // index.html for these paths via the SPA fallback).
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (url.pathname === '/verify-email' && q.get('token')) {
      const done = (u) => { window.history.replaceState(null, '', '/'); if (u) accept(u); else setUser(null); };
      return <VerifyEmailScreen token={q.get('token')} onDone={done} />;
    }
    if (url.pathname === '/reset-password' && q.get('token')) {
      const done = () => { window.history.replaceState(null, '', '/'); setUser(null); };
      return <ResetPasswordScreen token={q.get('token')} onDone={done} />;
    }
    if (url.pathname === '/admin') {
      if (!user) return <AuthScreen onAuthed={accept} notice={notice} />;
      if (!user.isAdmin) { window.history.replaceState(null, '', '/'); return <ChatApp key={user.id} user={user} onLogout={signOut} />; }
      const back = () => { window.history.replaceState(null, '', '/'); window.location.reload(); };
      return <AdminPanel onBack={back} />;
    }
  } catch (e) { /* fall through to normal auth */ }
  if (!user) return <AuthScreen onAuthed={accept} notice={notice} />;
  return <ChatApp key={user.id} user={user} onLogout={signOut} />;
}
