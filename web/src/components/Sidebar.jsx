import { tr } from '../lib/i18n';
import { IconPlus, IconGear, IconClose, IconBolt, IconLogo, IconLogout } from './icons';

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function UsageCard({ usage, onClick }) {
  if (!usage || !usage.daily) return null;
  const { used, limit } = usage.daily;
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const cls = pct >= 95 ? 'crit' : pct >= 75 ? 'warn' : '';
  return (
    <div className="usage-card" onClick={onClick} title={tr('usage_tap')}>
      <div className="row">
        <span className="lbl"><IconBolt />{tr('usage_today')}</span>
        <span className="num">{fmt(used)} / {fmt(limit)}</span>
      </div>
      <div className="bar"><i className={cls} style={{ width: pct + '%' }} /></div>
    </div>
  );
}

export function UsageDetail({ usage }) {
  if (!usage || !usage.daily) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>—</p>;
  const d = usage.daily;
  const dpct = Math.min(100, (d.used / Math.max(1, d.limit)) * 100);
  return (
    <div className="usage-detail">
      <div className="urow"><span>{tr('usage_day_row')}</span><b>{d.used.toLocaleString()} / {d.limit.toLocaleString()}</b></div>
      <div className="ubar"><i style={{ width: dpct + '%' }} /></div>
      <div className="urow"><span>{tr('usage_resets_in')}</span><b>{d.resetIn || '—'}</b></div>
      {(usage.models || []).filter((m) => m.used > 0).map((m) => {
        const p = Math.min(100, (m.used / Math.max(1, m.limit)) * 100);
        return (
          <div key={m.id} style={{ marginTop: 10 }}>
            <div className="urow">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>{m.label || m.id}</span>
              <b>{m.used.toLocaleString()} / {(m.limit / 1000).toFixed(0)}K</b>
            </div>
            <div className="ubar"><i style={{ width: p + '%' }} /></div>
            <div className="urow" style={{ fontSize: 11 }}><span>{tr('usage_window', { days: m.windowDays || 28 })}</span></div>
          </div>
        );
      })}
      <div className="urow" style={{ fontSize: 11, marginTop: 8 }}><span>{tr('usage_note')}</span></div>
    </div>
  );
}

function AccountRow({ user, onLogout }) {
  if (!user) return null;
  const plan = user.plan || 'free';
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
  return (
    <div className="acct">
      <div className="acct-av">{initial}</div>
      <div className="acct-meta">
        <b>{user.name || user.email}</b>
        <span>{user.email}</span>
      </div>
      <span className={'plan-pill ' + plan}>{tr('plan_' + plan)}</span>
      <button className="acct-out" onClick={onLogout} title={tr('logout')} aria-label={tr('logout')}>
        <IconLogout width={17} height={17} />
      </button>
    </div>
  );
}

export default function Sidebar({
  convos, activeId, onNew, onOpen, onDelete, onSettings,
  usage, user, onLogout, onUsageClick, onSkills, open, onClose,
}) {
  const sorted = [...convos].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <div className="brand">
        <IconLogo />
        <h1>Harbor Chat<small>{tr('app_tag')}</small></h1>
      </div>

      <button className="new-chat" onClick={onNew}>
        <IconPlus width={17} height={17} /> {tr('new_chat')}
      </button>
      <button className="skills-nav-btn" onClick={onSkills}><span className="skills-nav-icon">✦</span><span>Skills Library</span><span className="skills-nav-count">＋</span></button>

      <div className="convo-list">
        {sorted.length === 0 && (
          <div className="empty-hint">{tr('no_chats')}<br />{tr('no_chats_sub')}</div>
        )}
        {sorted.map((c) => (
          <div
            key={c.id}
            className={'convo' + (c.id === activeId ? ' active' : '')}
            onClick={() => onOpen(c.id)}
            title={c.title}
          >
            <span className="t">{c.title || tr('new_chat')}</span>
            <button
              className="x"
              title={tr('delete_all')}
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
            ><IconClose width={15} height={15} /></button>
          </div>
        ))}
      </div>

      <div className="side-foot">
        <UsageCard usage={usage} onClick={onUsageClick} />
        <AccountRow user={user} onLogout={onLogout} />
        <div className="side-actions">
          <button onClick={onSettings}><IconGear />{tr('settings')}</button>
        </div>
      </div>
    </aside>
  );
}
