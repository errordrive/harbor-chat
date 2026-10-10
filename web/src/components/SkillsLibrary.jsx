import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSkills, installSkill, uninstallSkill, toggleSkill,
  createCustomSkill, updateCustomSkill, deleteCustomSkill,
  importSkill, exportSkill, testSkill,
  fetchSkillVersions, rollbackSkill, fetchSkillHistory,
} from '../lib/api';
import { tr } from '../lib/i18n';

const CATS = ['All', 'Research', 'Development', 'Productivity', 'Data', 'Automation', 'Design', 'Marketing', 'System', 'Custom'];
const GLYPHS = {
  globe: '◎', code: '</>', bug: '⌁', folder: '▰', file: '▤', chart: '▥',
  workflow: '⑂', shield: '◇', terminal: '›_', plug: '⎋', database: '▦',
  eye: '◉', search: '⌕', brain: '✦', check: '✓',
};

function SkillCard({ skill, onAction, busy }) {
  const [showPerms, setShowPerms] = useState(false);
  return (
    <div className="skill-card">
      <div className="skill-head">
        <span className="skill-icon">{GLYPHS[skill.icon] || '✦'}</span>
        <div>
          <strong>{skill.name}</strong>
          <small>v{skill.version} · {skill.category}</small>
        </div>
        {skill.custom && <span className="skill-badge">custom</span>}
      </div>
      <p>{skill.description}</p>
      {(skill.permissions?.length > 0 || skill.capabilities?.length > 0) && (
        <button className="auth-link" onClick={() => setShowPerms(!showPerms)}>
          {showPerms ? 'Hide' : 'Permissions'}
        </button>
      )}
      {showPerms && (
        <div className="skill-perms">
          <small>Caps: {(skill.capabilities || []).join(', ') || 'none'}</small><br />
          <small>Perms: {(skill.permissions || []).join(', ') || 'none'}</small>
        </div>
      )}
      <div className="skill-actions">
        {!skill.installed && !skill.custom && (
          <button className="admin-btn" disabled={busy} onClick={() => onAction('install', skill)}>Install</button>
        )}
        {(skill.installed || skill.custom) && (
          <button className="admin-btn" disabled={busy} onClick={() => onAction('toggle', skill)}>
            {skill.enabled ? 'Disable' : 'Enable'}
          </button>
        )}
        {!skill.custom && skill.installed && (
          <button className="admin-btn" disabled={busy} onClick={() => onAction('uninstall', skill)}>Uninstall</button>
        )}
        {skill.custom && (
          <>
            <button className="admin-btn" disabled={busy} onClick={() => onAction('edit', skill)}>Edit</button>
            <button className="admin-btn" disabled={busy} onClick={() => onAction('test', skill)}>Test</button>
            <button className="admin-btn" disabled={busy} onClick={() => onAction('export', skill)}>Export</button>
            <button className="admin-btn danger" disabled={busy} onClick={() => onAction('delete', skill)}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function SkillsLibrary({ onClose, onToast }) {
  const [skills, setSkills] = useState([]);
  const [tab, setTab] = useState('Discover');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', category: 'Custom' });
  const [history, setHistory] = useState([]);
  const [versions, setVersions] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const importRef = useRef(null);

  async function refresh() {
    setLoading(true); setError('');
    try { setSkills(await fetchSkills()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (tab === 'History') fetchSkillHistory().then(setHistory).catch(() => {});
  }, [tab ]);

  const filtered = useMemo(() => skills.filter((s) => {
    if (tab === 'Installed' && !s.installed) return false;
    if (tab === 'My Skills' && !s.custom) return false;
    if (category !== 'All' && s.category !== category) return false;
    const q = search.trim().toLowerCase();
    return !q || `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q);
  }), [skills, tab, category, search]);

  async function act(id, fn, success) {
    setBusy(id); setError('');
    try { await fn(); await refresh(); onToast?.(success); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(''); }
  }

  async function handleAction(action, skill) {
    if (action === 'install') return act(skill.id, () => installSkill(skill.id), 'Installed');
    if (action === 'uninstall') {
      if (!confirm(`Uninstall ${skill.name}?`)) return;
      return act(skill.id, () => uninstallSkill(skill.id), 'Uninstalled');
    }
    if (action === 'toggle') return act(skill.id, () => toggleSkill(skill.id, !skill.enabled), skill.enabled ? 'Disabled' : 'Enabled');
    if (action === 'delete') {
      if (!confirm(`Delete ${skill.name}? This cannot be undone.`)) return;
      return act(skill.id, () => deleteCustomSkill(skill.id), 'Deleted');
    }
    if (action === 'edit') {
      setEditing(skill);
      setDraft({ name: skill.name, description: skill.description, instructions: skill.instructions, category: skill.category });
      setShowCreate(true);
    }
    if (action === 'test') {
      setBusy(skill.id); setTestResult(null);
      try {
        const r = await testSkill(skill.id);
        setTestResult({ skill: skill.name, ...r });
      } catch (e) { setError(e.message); }
      setBusy('');
    }
    if (action === 'export') {
      try {
        const m = await exportSkill(skill.id);
        const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${skill.id}.skill.json`;
        a.click();
      } catch (e) { setError(e.message); }
    }
  }

  async function saveDraft() {
    const fn = editing
      ? () => updateCustomSkill({ id: editing.id, ...draft })
      : () => createCustomSkill(draft);
    const ok = await act('draft', fn, editing ? 'Updated' : 'Created');
    if (ok) { setShowCreate(false); setEditing(null); setDraft({ name: '', description: '', instructions: '', category: 'Custom' }); }
  }

  async function handleImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const manifest = JSON.parse(text);
      await act('import', () => importSkill(manifest), 'Imported');
    } catch (err) { setError('Import failed: ' + err.message); }
    e.target.value = '';
  }

  async function showVersions(skill) {
    try {
      const v = await fetchSkillVersions(skill.id);
      setVersions(v.map((x) => ({ ...x, skillId: skill.id })));
    } catch (e) { setError(e.message); }
  }

  const tabs = ['Discover', 'Installed', 'My Skills', 'History'];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal skills-lib" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Skills Library</h2>
          <button className="tool-btn" onClick={onClose}>✕</button>
        </div>
        <div className="admin-tabs">
          {tabs.map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        {tab !== 'History' && (
          <div className="admin-row">
            <input className="admin-search" placeholder="Search skills…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="admin-btn" onClick={() => { setEditing(null); setDraft({ name: '', description: '', instructions: '', category: 'Custom' }); setShowCreate(true); }}>+ Create</button>
            <button className="admin-btn" onClick={() => importRef.current?.click()}>Import</button>
            <input ref={importRef} type="file" accept=".json" hidden onChange={handleImport} />
          </div>
        )}
        {error && <div className="auth-err">{error}</div>}
        {testResult && (
          <div className={testResult.pass ? 'auth-note' : 'auth-err'}>
            <strong>{testResult.skill}: {testResult.pass ? 'PASS' : 'FAIL'}</strong>
            <ul>{testResult.checks.map((c, i) => <li key={i}>{c.name}: {c.pass ? '✓' : '✗'} — {c.detail}</li>)}</ul>
            <button className="auth-link" onClick={() => setTestResult(null)}>Dismiss</button>
          </div>
        )}
        {loading ? <div className="typing-dots"><i /><i /><i /></div> : tab === 'History' ? (
          <div className="history-list">
            {history.map((h) => (
              <div key={h.id} className="history-item">
                <strong>{h.skill_id}</strong> <small>v{h.skill_version}</small>
                <span className={`status ${h.status}`}>{h.status}</span>
                <small>{new Date(h.created_at).toLocaleString()}</small>
                <p>{h.output_summary}</p>
              </div>
            ))}
            {!history.length && <p className="admin-muted">No executions yet.</p>}
          </div>
        ) : (
          <div className="skills-grid">
            {filtered.map((s) => (
              <div key={s.id}>
                <SkillCard skill={s} busy={busy === s.id} onAction={handleAction} />
                {s.custom && (
                  <button className="auth-link" onClick={() => showVersions(s)}>Versions</button>
                )}
              </div>
            ))}
            {!filtered.length && <p className="admin-muted">No skills found.</p>}
          </div>
        )}
        {versions.length > 0 && (
          <div className="versions-panel">
            <h4>Version history</h4>
            {versions.map((v) => (
              <div key={v.version} className="admin-row">
                <code>v{v.version}</code>
                <small>{new Date(v.created_at).toLocaleString()}</small>
                <button className="admin-btn" onClick={() => act(v.skillId, () => rollbackSkill(v.skillId, v.version), 'Rolled back').then(() => setVersions([]))}>Rollback</button>
              </div>
            ))}
            <button className="auth-link" onClick={() => setVersions([])}>Close</button>
          </div>
        )}
        {showCreate && (
          <div className="skill-create">
            <h3>{editing ? 'Edit skill' : 'Create skill'}</h3>
            <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Description<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} /></label>
            <label>Instructions<textarea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} rows={6} placeholder="Describe what this skill does and how it should behave…" /></label>
            <label>Category
              <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {CATS.filter((c) => c !== 'All').map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="admin-row">
              <button className="auth-submit admin-save" disabled={busy === 'draft'} onClick={saveDraft}>{editing ? 'Save' : 'Create'}</button>
              <button className="admin-btn" onClick={() => { setShowCreate(false); setEditing(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
