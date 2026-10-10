import { useEffect, useRef, useState } from 'react';
import { tr } from '../lib/i18n';
import { IconChevron, IconCheck } from './icons';

const PINNED_IDS = ['claude-haiku-5.5:free', 'deepseek-v4.1-flash:free', 'mimo-v2.6-flash:free'];

export function prettyName(id) {
  const map = {
    'claude-haiku-5.5:free': 'Claude Haiku 5.5',
    'deepseek-v4.1-flash:free': 'DeepSeek V4.1 Flash',
    'mimo-v2.6-flash:free': 'MiMo V2.6 Flash',
  };
  if (map[id]) return map[id];
  return id.replace(':free', '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function shortModel(id) {
  return id ? prettyName(id) : '';
}

export default function ModelPicker({ models, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pinned = PINNED_IDS.map((id) => ({ id }));
  const rest = models.filter((m) => !PINNED_IDS.includes(m.id));

  const item = (m) => (
    <button
      key={m.id}
      className={'mp-item' + (m.id === value ? ' sel' : '')}
      onClick={() => { onChange(m.id); setOpen(false); }}
    >
      <span className="nm">{prettyName(m.id)}</span>
      <span className="free">FREE</span>
      <span className="tick"><IconCheck /></span>
    </button>
  );

  return (
    <div className={'model-picker' + (open ? ' open' : '')} ref={ref}>
      <button className="mp-btn" onClick={() => setOpen(!open)} title={tr('model_choose')}>
        <span className="star">★</span>
        <span className="nm">{prettyName(value)}</span>
        <IconChevron className="chev" />
      </button>
      {open && (
        <div className="mp-menu">
          <div className="mp-group">{tr('model_pinned')}</div>
          {pinned.map(item)}
          {rest.length > 0 && <div className="mp-group">{tr('model_all_free')}</div>}
          {rest.map(item)}
        </div>
      )}
    </div>
  );
}
