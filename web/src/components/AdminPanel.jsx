import { useState, useEffect, useCallback } from 'react';
import { tr } from '../lib/i18n';
import { IconLogo } from './icons';

async function adminGet(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
async function adminPost(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
async function adminPut(path, body) {
  const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

const fmt = (n) => Number(n || 0).toLocaleString();

function Stat({ label, value, warn }) {
  return (
    <div className={`admin-stat${warn ? ' warn' : ''}`}>
      <div className="admin-stat-v">{value}</div>
      <div className="admin-stat-l">{label}</div>
    </div>
  );
}

function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminGet('/api/admin/stats').then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="auth-err">{err}</div>;
  if (!s) return <div className="typing-dots"><i /><i /><i /></div>;
  return (
    <div>
      <div className="admin-stats">
        <Stat label={tr('admin_users')} value={fmt(s.users)} />
        <Stat label={tr('admin_signups_24h')} value={fmt(s.signups24h)} />
        <Stat label={tr('admin_tokens_24h')} value={fmt(s.tokens24h)} />
        <Stat label={tr('admin_calls_24h')} value={fmt(s.calls24h)} />
        <Stat label={tr('admin_pool_left')} value={fmt(s.pool.remaining)} warn={s.pool.strained} />
      </div>
      {s.pool.strained && (
        <div className="auth-note">{s.pool.critical ? tr('admin_pool_critical') : tr('admin_pool_strained')}</div>
      )}
      <h3>{tr('admin_by_plan')}</h3>
      <table className="admin-table">
        <thead><tr><th>{tr('admin_plan')}</th><th>{tr('admin_users')}</th></tr></thead>
        <tbody>
          {s.byPlan.map((r) => <tr key={r.plan_id}><td>{r.plan_id}</td><td>{fmt(r.n)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await adminGet('/api/admin/users?search=' + encodeURIComponent(search) + '&limit=30');
      setUsers(j.users); setTotal(j.total); setErr('');
    } catch (e) { setErr(e.message); }
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const act = async (u, action, value) => {
    const key = u.id + action;
    setBusy(key);
    try {
      if (action === 'plan') await adminPost('/api/admin/users/plan', { user_id: u.id, plan_id: value });
      if (action === 'ban') await adminPost('/api/admin/users/ban', { user_id: u.id, banned: value });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <div>
      <div className="admin-row">
        <input className="admin-search" placeholder={tr('admin_search_ph')}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="admin-muted">{fmt(total)} {tr('admin_users')}</span>
      </div>
      {err && <div className="auth-err">{err}</div>}
      <table className="admin-table">
        <thead><tr>
          <th>{tr('admin_email')}</th><th>{tr('admin_plan')}</th>
          <th>{tr('admin_today')}</th><th>{tr('admin_status')}</th><th></th>
        </tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.banned ? 'banned' : ''}>
              <td><div>{u.email}</div><small className="admin-muted">{u.name}</small></td>
              <td>
                <select value={u.plan_id} disabled={busy === u.id + 'plan'}
                  onChange={(e) => act(u, 'plan', e.target.value)}>
                  <option value="free">free</option>
                  <option value="plus">plus</option>
                  <option value="pro">pro</option>
                </select>
              </td>
              <td><small>{fmt(u.tokens_today)} tok<br />{u.agent_runs_today} agent</small></td>
              <td>{u.banned ? tr('admin_banned') : u.is_admin ? tr('admin_is_admin') : '—'}</td>
              <td>
                <button className="admin-btn" disabled={!!busy}
                  onClick={() => act(u, 'ban', !u.banned)}>
                  {busy ? '…' : u.banned ? tr('admin_unban') : tr('admin_ban')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Plans() {
  const [plans, setPlans] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { adminGet('/api/admin/plans').then((j) => setPlans(j.plans)).catch((e) => setErr(e.message)); }, []);

  const set = (id, field, value) => {
    setPlans((ps) => ps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const save = async (p) => {
    setBusy(true); setErr(''); setOk('');
    try {
      const j = await adminPut('/api/admin/plans', {
        plan: {
          id: p.id, name: p.name,
          daily_credits: parseInt(p.daily_credits, 10),
          max_output_tokens: parseInt(p.max_output_tokens, 10),
          context_tokens: parseInt(p.context_tokens, 10),
          agent_runs_day: parseInt(p.agent_runs_day, 10),
          price_bdt: parseInt(p.price_bdt, 10),
        },
      });
      setPlans(j.plans);
      setOk(tr('admin_saved'));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const fields = [
    ['name', 'admin_f_name', false],
    ['daily_credits', 'admin_f_daily', true],
    ['max_output_tokens', 'admin_f_maxout', true],
    ['context_tokens', 'admin_f_context', true],
    ['agent_runs_day', 'admin_f_agent', true],
    ['price_bdt', 'admin_f_price', true],
  ];

  return (
    <div>
      {err && <div className="auth-err">{err}</div>}
      {ok && <div className="auth-note">{ok}</div>}
      {plans.map((p) => (
        <div className="admin-plan" key={p.id}>
          <h3>{p.id}</h3>
          <div className="admin-grid">
            {fields.map(([f, labelKey, num]) => (
              <label key={f}>
                <span>{tr(labelKey)}</span>
                <input type={num ? 'number' : 'text'} value={p[f] ?? ''}
                  onChange={(e) => set(p.id, f, e.target.value)} />
              </label>
            ))}
          </div>
          <button className="auth-submit admin-save" disabled={busy} onClick={() => save(p)}>
            {tr('admin_save')}
          </button>
        </div>
      ))}
      <p className="admin-muted">{tr('admin_plans_note')}</p>
    </div>
  );
}

function Ledger() {
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { adminGet('/api/admin/events?limit=50').then((j) => setEvents(j.events)).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="auth-err">{err}</div>;
  return (
    <table className="admin-table">
      <thead><tr>
        <th>ID</th><th>{tr('admin_email')}</th><th>{tr('admin_model')}</th>
        <th>{tr('admin_kind')}</th><th>{tr('admin_tokens')}</th><th>{tr('admin_when')}</th>
      </tr></thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td>{e.id}</td>
            <td><small>{e.email || e.user_id}</small></td>
            <td><small>{e.model}</small></td>
            <td>{e.kind}</td>
            <td>{fmt(e.prompt_tokens + e.completion_tokens)}</td>
            <td><small>{new Date(e.created_at).toLocaleString()}</small></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diagnostics() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminGet('/api/admin/diagnostics').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="auth-err">{err}</div>;
  if (!data) return <div className="typing-dots"><i /><i /><i /></div>;
  return (
    <div>
      <p className="admin-muted">Provider health (no secrets shown). Auto-switch: {data.auto_switch ? 'ON' : 'OFF'}</p>
      <table className="admin-table">
        <thead><tr><th>Model</th><th>Provider</th><th>Calls</th><th>Success</th><th>Circuit</th><th>Errors</th></tr></thead>
        <tbody>
          {(data.models || []).map((m) => (
            <tr key={m.id}>
              <td><small>{m.display_name || m.id}</small></td>
              <td><small>{m.provider_id}</small></td>
              <td>{m.health.calls}</td>
              <td>{(m.health.success_rate * 100).toFixed(0)}%</td>
              <td><span className={`status ${m.health.circuit}`}>{m.health.circuit}</span></td>
              <td><small>{Object.entries(m.health.by_category || {}).map(([k, v]) => `${k}:${v}`).join(', ') || '—'}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditLog() {
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { adminGet('/api/admin/audit?limit=50').then((j) => setEvents(j.events)).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="auth-err">{err}</div>;
  return (
    <table className="admin-table">
      <thead><tr><th>ID</th><th>Action</th><th>User</th><th>IP</th><th>When</th></tr></thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td>{e.id}</td>
            <td><code>{e.action}</code></td>
            <td><small>{e.email || e.user_id || '—'}</small></td>
            <td><small>{e.ip || '—'}</small></td>
            <td><small>{new Date(e.created_at).toLocaleString()}</small></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminPanel({ onBack }) {
  const [tab, setTab] = useState('dash');
  const tabs = [
    ['dash', tr('admin_tab_dash')],
    ['users', tr('admin_tab_users')],
    ['plans', tr('admin_tab_plans')],
    ['ledger', tr('admin_tab_ledger')],
    ['providers', tr('admin_tab_providers')],
    ['models', tr('admin_tab_models')],
    ['fallbacks', tr('admin_tab_fallbacks')],
    ['features', tr('admin_tab_features')],
    ['diagnostics', 'Diagnostics'],
    ['audit', 'Audit Log'],
  ];
  return (
    <div className="admin-wrap">
      <header className="admin-head">
        <div className="auth-logo"><IconLogo width={36} height={36} /></div>
        <h2>{tr('admin_title')}</h2>
        <button className="tool-btn" onClick={onBack}>{tr('admin_back')}</button>
      </header>
      <nav className="admin-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      <main className="admin-main">
        {tab === 'dash' && <Dashboard />}
        {tab === 'users' && <Users />}
        {tab === 'plans' && <Plans />}
        {tab === 'ledger' && <Ledger />}
        {tab === 'providers' && <Providers />}
        {tab === 'models' && <Models />}
        {tab === 'fallbacks' && <Fallbacks />}
        {tab === 'features' && <Features />}
        {tab === 'diagnostics' && <Diagnostics />}
        {tab === 'audit' && <AuditLog />}
      </main>
    </div>
  );
}

function Providers() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ id: '', name: '', base_url: '', api_key: '' });
  const [busy, setBusy] = useState(false);

  const load = () => adminGet('/api/admin/providers').then((j) => setList(j.providers)).catch((e) => setErr(e.message));
  useEffect(load, []);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await adminPost('/api/admin/providers', form);
      setForm({ id: '', name: '', base_url: '', api_key: '' });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const toggle = async (p) => {
    try { await adminPost('/api/admin/providers/toggle', { id: p.id, enabled: !p.enabled }); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div>
      {err && <div className="auth-err">{err}</div>}
      <table className="admin-table">
        <thead><tr><th>ID</th><th>{tr('admin_name')}</th><th>URL</th><th>{tr('admin_key')}</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={p.enabled ? '' : 'banned'}>
              <td><code>{p.id}</code></td>
              <td>{p.name}</td>
              <td><small>{p.base_url}</small></td>
              <td>{p.has_key ? '✓' : '—'}</td>
              <td><button className="admin-btn" onClick={() => toggle(p)}>{p.enabled ? tr('admin_disable') : tr('admin_enable')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{tr('admin_add_provider')}</h3>
      <div className="admin-grid">
        <label><span>ID</span><input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="openrouter" /></label>
        <label><span>{tr('admin_name')}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="OpenRouter" /></label>
        <label><span>Base URL</span><input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://openrouter.ai/api/v1" /></label>
        <label><span>{tr('admin_key')}</span><input type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-…" /></label>
      </div>
      <button className="auth-submit admin-save" disabled={busy || !form.id || !form.name || !form.base_url} onClick={save}>{tr('admin_save')}</button>
      <p className="admin-muted">{tr('admin_key_note')}</p>
    </div>
  );
}

function Models() {
  const [list, setList] = useState([]);
  const [providers, setProviders] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ id: '', provider_id: 'tokenharbor', display_name: '', is_free: true });
  const [busy, setBusy] = useState(false);

  const load = () => {
    adminGet('/api/admin/models').then((j) => setList(j.models)).catch((e) => setErr(e.message));
    adminGet('/api/admin/providers').then((j) => setProviders(j.providers)).catch(() => {});
  };
  useEffect(load, []);

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await adminPost('/api/admin/models', form);
      setForm({ id: '', provider_id: 'tokenharbor', display_name: '', is_free: true });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const toggle = async (m) => {
    try { await adminPost('/api/admin/models/toggle', { id: m.id, enabled: !m.enabled }); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div>
      {err && <div className="auth-err">{err}</div>}
      <table className="admin-table">
        <thead><tr><th>{tr('admin_model')}</th><th>{tr('admin_provider')}</th><th>{tr('admin_free')}</th><th></th></tr></thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id} className={m.enabled ? '' : 'banned'}>
              <td><code>{m.id}</code><br /><small className="admin-muted">{m.display_name}</small></td>
              <td><small>{m.provider_name}</small></td>
              <td>{m.is_free ? '✓' : '—'}</td>
              <td><button className="admin-btn" onClick={() => toggle(m)}>{m.enabled ? tr('admin_disable') : tr('admin_enable')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{tr('admin_add_model')}</h3>
      <div className="admin-grid">
        <label><span>ID</span><input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="model-name:free" /></label>
        <label><span>{tr('admin_provider')}</span>
          <select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label><span>{tr('admin_display')}</span><input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
        <label><span>{tr('admin_free')}</span>
          <select value={form.is_free ? '1' : '0'} onChange={(e) => setForm({ ...form, is_free: e.target.value === '1' })}>
            <option value="1">{tr('admin_yes')}</option><option value="0">{tr('admin_no')}</option>
          </select>
        </label>
      </div>
      <button className="auth-submit admin-save" disabled={busy || !form.id} onClick={save}>{tr('admin_save')}</button>
    </div>
  );
}

function Fallbacks() {
  const [list, setList] = useState([]);
  const [models, setModels] = useState([]);
  const [flags, setFlags] = useState([]);
  const [err, setErr] = useState('');
  const [chain, setChain] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    adminGet('/api/admin/fallbacks').then((j) => setList(j.fallbacks)).catch((e) => setErr(e.message));
    adminGet('/api/admin/models').then((j) => setModels(j.models.filter((m) => m.enabled))).catch(() => {});
    adminGet('/api/admin/flags').then((j) => setFlags(j.flags)).catch(() => {});
  };
  useEffect(load, []);

  const autoSwitch = flags.find((f) => f.id === 'auto_model_switch');
  const toggleAuto = async () => {
    try { await adminPost('/api/admin/flags', { id: 'auto_model_switch', enabled: !autoSwitch?.enabled }); await load(); }
    catch (e) { setErr(e.message); }
  };

  const save = async () => {
    const ids = chain.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length < 2) { setErr('Enter at least 2 model ids, comma-separated.'); return; }
    setBusy(true); setErr('');
    try {
      await adminPost('/api/admin/fallbacks', { plan_id: null, chain: ids });
      setChain('');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  // Group by model_id for display.
  const groups = {};
  for (const r of list) {
    (groups[r.model_id] = groups[r.model_id] || []).push(r.fallback_model_id);
  }

  return (
    <div>
      {err && <div className="auth-err">{err}</div>}
      <div className="admin-row">
        <strong>{tr('admin_auto_switch')}</strong>
        <button className={'admin-btn' + (autoSwitch?.enabled ? ' on' : '')} onClick={toggleAuto}>
          {autoSwitch?.enabled ? tr('admin_on') : tr('admin_off')}
        </button>
      </div>
      <p className="admin-muted">{tr('admin_auto_note')}</p>
      <table className="admin-table">
        <thead><tr><th>{tr('admin_model')}</th><th>{tr('admin_fallback_chain')}</th></tr></thead>
        <tbody>
          {Object.entries(groups).map(([mid, fbs]) => (
            <tr key={mid}><td><code>{mid}</code></td><td><small>{fbs.join(' → ')}</small></td></tr>
          ))}
          {!Object.keys(groups).length && <tr><td colSpan={2} className="admin-muted">{tr('admin_no_fallbacks')}</td></tr>}
        </tbody>
      </table>
      <h3>{tr('admin_set_chain')}</h3>
      <p className="admin-muted">{tr('admin_chain_hint')}</p>
      <input className="admin-search" value={chain} onChange={(e) => setChain(e.target.value)}
        placeholder="claude-haiku-5.5:free, deepseek-v4.1-flash:free, mimo-v2.6-flash:free" list="admin-models" />
      <datalist id="admin-models">{models.map((m) => <option key={m.id} value={m.id} />)}</datalist>
      <div style={{ marginTop: 8 }}>
        <button className="auth-submit admin-save" disabled={busy} onClick={save}>{tr('admin_save')}</button>
      </div>
    </div>
  );
}

function Features() {
  const [flags, setFlags] = useState([]);
  const [err, setErr] = useState('');
  const load = () => adminGet('/api/admin/flags').then((j) => setFlags(j.flags)).catch((e) => setErr(e.message));
  useEffect(load, []);

  const toggle = async (f) => {
    try { await adminPost('/api/admin/flags', { id: f.id, enabled: !f.enabled }); await load(); }
    catch (e) { setErr(e.message); }
  };

  const labels = {
    chat_enabled: 'admin_f_chat',
    agent_enabled: 'admin_f_agent_mode',
    auto_model_switch: 'admin_auto_switch',
  };

  return (
    <div>
      {err && <div className="auth-err">{err}</div>}
      <table className="admin-table">
        <thead><tr><th>{tr('admin_feature')}</th><th>{tr('admin_status')}</th><th></th></tr></thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.id}>
              <td>{tr(labels[f.id] || f.id)}</td>
              <td>{f.enabled ? tr('admin_on') : tr('admin_off')}</td>
              <td><button className="admin-btn" onClick={() => toggle(f)}>{f.enabled ? tr('admin_disable') : tr('admin_enable')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
