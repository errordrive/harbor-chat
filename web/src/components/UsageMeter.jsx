function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export default function UsageMeter({ usage, onClick }) {
  if (!usage || !usage.daily) return null;
  const { used, limit } = usage.daily;
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const cls = pct >= 95 ? 'crit' : pct >= 75 ? 'warn' : '';
  return (
    <div className="usage-meter" onClick={onClick} title="Free usage — tap for details">
      <div className="row">
        <span className="lbl">Free usage · today</span>
        <span className="num">{fmt(used)} / {fmt(limit)}</span>
      </div>
      <div className="bar"><i className={cls} style={{ width: pct + '%' }} /></div>
    </div>
  );
}

export function UsageDetail({ usage }) {
  if (!usage || !usage.daily) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Usage data unavailable.</p>;
  const d = usage.daily;
  const dpct = Math.min(100, (d.used / Math.max(1, d.limit)) * 100);
  return (
    <div className="usage-detail">
      <div className="urow"><span>Today (all models)</span><b>{d.used.toLocaleString()} / {d.limit.toLocaleString()}</b></div>
      <div className="ubar"><i style={{ width: dpct + '%' }} /></div>
      <div className="urow"><span>Resets in</span><b>{d.resetIn || '—'}</b></div>
      {(usage.models || []).filter((m) => m.used > 0).map((m) => {
        const p = Math.min(100, (m.used / Math.max(1, m.limit)) * 100);
        return (
          <div key={m.id} style={{ marginTop: 10 }}>
            <div className="urow">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{m.label || m.id}</span>
              <b>{m.used.toLocaleString()} / {(m.limit / 1000).toFixed(0)}K</b>
            </div>
            <div className="ubar"><i style={{ width: p + '%' }} /></div>
            <div className="urow" style={{ fontSize: 11 }}><span>{m.windowDays || 28}-day window</span></div>
          </div>
        );
      })}
      <div className="urow" style={{ fontSize: 11, marginTop: 8 }}>
        <span>Token counts are estimated (chars ÷ 4). Limits keep free-tier usage safely inside the 1M/model allowance.</span>
      </div>
    </div>
  );
}
