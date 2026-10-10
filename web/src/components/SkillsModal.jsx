import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSkills, installSkill, toggleSkill, createCustomSkill, deleteCustomSkill } from '../lib/api';

const CATS = ['All', 'Research', 'Development', 'Productivity', 'Data', 'Automation', 'Custom'];
const GLYPHS = { globe: '◎', code: '</>', bug: '⌁', folder: '▰', file: '▤', chart: '▥', workflow: '⑂', shield: '◇' };

export default function SkillsModal({ onClose, onToast }) {
  const [skills, setSkills] = useState([]);
  const [tab, setTab] = useState('Discover');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '' });
  const importRef = useRef(null);

  async function refresh() { setLoading(true); setError(''); try { setSkills(await fetchSkills()); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);
  const filtered = useMemo(() => skills.filter(s => {
    if (tab === 'Installed' && !s.installed) return false;
    if (tab === 'My Skills' && !s.custom) return false;
    if (category !== 'All' && s.category !== category) return false;
    const q = search.trim().toLowerCase();
    return !q || `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(q);
  }), [skills, tab, category, search]);

  async function act(id, fn, success) { setBusy(id); setError(''); try { await fn(); await refresh(); onToast?.(success); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(''); } }
  async function createSkill(data = draft) {
    const ok = await act('create', () => createCustomSkill(data), 'Skill created');
    if (ok) { setDraft({ name: '', description: '', instructions: '' }); setShowCreate(false); setTab('My Skills'); }
  }
  async function importSkill(file) {
    if (!file) return;
    try {
      const raw = await file.text(); const parsed = JSON.parse(raw);
      const skill = parsed.skill || parsed;
      await createSkill({ name: skill.name, description: skill.description || '', instructions: skill.instructions || skill.prompt || skill.content || '' });
    } catch (e) { setError(e instanceof SyntaxError ? 'Import expects a valid JSON skill manifest.' : e.message); }
    if (importRef.current) importRef.current.value = '';
  }

  return <div className="skills-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="skills-modal" role="dialog" aria-modal="true" aria-labelledby="skills-title">
      <header className="skills-head"><div className="skills-brand"><div className="skills-logo">✦</div><div><h2 id="skills-title">Skills Library</h2><p>Extend Harbor with reusable capabilities</p></div></div><button className="skills-close" onClick={onClose} aria-label="Close skills">×</button></header>
      <div className="skills-toolbar"><div className="skills-tabs">{['Discover', 'Installed', 'My Skills'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div><div className="skills-actions"><button className="skills-secondary" onClick={() => importRef.current?.click()}>↑ Import JSON</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e => importSkill(e.target.files?.[0])}/><button className="skills-primary" onClick={() => setShowCreate(v => !v)}>＋ Create skill</button></div></div>
      {showCreate && <form className="skill-create" onSubmit={e => { e.preventDefault(); createSkill(); }}><div className="skill-create-title">Create a custom skill <span>Instruction-only · no code execution</span></div><div className="skill-form-grid"><label>Skill name<input value={draft.name} maxLength={80} required onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Laravel Deployment Reviewer"/></label><label>Short description<input value={draft.description} maxLength={240} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What should this skill help with?"/></label></div><label>Instructions<textarea value={draft.instructions} required minLength={20} maxLength={12000} onChange={e => setDraft({ ...draft, instructions: e.target.value })} placeholder="Describe the skill's expertise, process, constraints, and expected output…" rows={4}/></label><div className="skill-form-foot"><span>Custom skills guide responses; they do not grant tools or permissions.</span><button className="skills-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Save skill'}</button></div></form>}
      <div className="skills-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills by name or capability"/><button onClick={() => { setSearch(''); setCategory('All'); }}>Clear</button></div>
      <div className="skills-categories">{CATS.map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>
      {error && <div className="skills-error" role="alert">{error}</div>}
      <div className="skills-list">{loading ? <div className="skills-empty">Loading skills…</div> : filtered.length ? filtered.map(s => <article className="skill-card" key={s.id}><div className="skill-icon">{GLYPHS[s.icon] || (s.custom ? '✧' : '✦')}</div><div className="skill-info"><div className="skill-title-row"><h3>{s.name}</h3>{s.custom && <span className="skill-tag custom">Custom</span>}{s.installed && <span className="skill-tag installed">Installed</span>}</div><p>{s.description || 'Custom reusable instructions for Harbor.'}</p><div className="skill-meta"><span>{s.category}</span><span>v{s.version || '1.0.0'}</span>{s.capabilities?.length > 0 && <span>{s.capabilities.length} capabilities declared</span>}</div></div><div className="skill-controls">{s.custom ? <div className="skill-control-stack"><button className={s.enabled ? 'skills-secondary' : 'skills-primary'} disabled={busy === s.id} onClick={() => act(s.id, () => toggleSkill(s.id, !s.enabled), s.enabled ? 'Skill disabled' : 'Skill enabled')}>{s.enabled ? 'Disable' : 'Enable'}</button><button className="skills-danger" disabled={busy === s.id} onClick={() => { if (window.confirm(`Delete custom skill “${s.name}”?`)) act(s.id, () => deleteCustomSkill(s.id), 'Skill deleted'); }}>Delete</button></div> : s.installed ? <button className="skills-secondary" disabled={busy === s.id} onClick={() => act(s.id, () => toggleSkill(s.id, false), 'Skill removed')}>Remove</button> : <button className="skills-primary" disabled={busy === s.id} onClick={() => act(s.id, () => installSkill(s.id), 'Skill installed')}>{busy === s.id ? 'Working…' : 'Install'}</button>}</div></article>) : <div className="skills-empty"><strong>No skills found</strong><span>Try another search or create your own custom skill.</span></div>}</div>
      <footer className="skills-footer"><span>Custom skills are private to your account.</span><span>{skills.filter(s => s.installed).length} installed · {skills.filter(s => s.custom).length} custom</span></footer>
    </section>
  </div>;
}
