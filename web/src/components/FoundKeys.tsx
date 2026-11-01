import { useMemo, useState } from 'react';
import { useCollapsible } from './Collapsible';

export interface SecretFind {
  kind: string;
  raw?: string;
  masked: string;
  context: string;
  count: number;
  severity: string;
}

const SEV_COLOR: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#64748b',
};

export function FoundKeys({ secrets }: { secrets: SecretFind[] | null | undefined }) {
  const list = secrets ?? [];
  const [q, setQ] = useState('');
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [limit, setLimit] = useState(40);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(true);
  const [open, setOpen] = useCollapsible('found-keys', true);

  const filtered = useMemo(() => {
    let out = list;
    if (sevFilter !== 'all') out = out.filter(s => s.severity === sevFilter);
    if (q.trim()) {
      const qq = q.toLowerCase();
      out = out.filter(s => s.kind.toLowerCase().includes(qq) || (s.raw ?? s.masked).toLowerCase().includes(qq) || s.context.toLowerCase().includes(qq));
    }
    return out;
  }, [list, q, sevFilter]);

  const shown = filtered.slice(0, limit);
  const highCount = list.filter(s => s.severity === 'high').length;

  return (
    <section className="card card-collapsible" id="found-keys">
      <div className="card-head" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }} aria-expanded={open} aria-controls="found-keys-body">
        <h3>
          Found keys / secrets <span className="chip">{list.length} findings</span>
          {highCount > 0 && <span className="chip" style={{ background: 'rgba(239,68,68,0.15)', color: '#fecaca', borderColor: 'rgba(239,68,68,0.3)' }}>{highCount} high</span>}
        </h3>
        <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{open ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{open ? '▾' : '▸'}</button></span>
      </div>
      <div id="found-keys-body" className="collapsible-body" hidden={!open}>
      <p className="hint">
        Scan of the raw report text. Values are shown in full — use the eye button per row or the master toggle to hide them.
        Only analyze reports from devices you own or have permission to inspect. If you find real keys, rotate them and strip the report before sharing.
      </p>
      <div className="banner banner-warn" style={{ margin: '8px 0 10px', fontSize: 12, lineHeight: 1.5 }}>
        Bugreports can dump app logs, intent extras, and config. Treat any <code>AKIA*</code>, <code>AIza*</code>, JWT, or <code>password=</code> hit as a leak until proven otherwise.
        Use the <em>Timeline</em> regexp filter to locate the originating package, and the per-app table to confirm which app emitted it.
      </div>

      <div className="app-toolbar" style={{ marginBottom: 6, gap: 8 }}>
        <input className="app-search" placeholder="Filter kind / context…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <select className="app-search" value={sevFilter} onChange={e => setSevFilter(e.target.value)} style={{ maxWidth: 140 }}>
          <option value="all">All severities</option>
          <option value="high">High only</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <span className="hint">{filtered.length} shown · {list.length} total</span>
        <button className="btn btn-small" onClick={() => setShowAll(v => !v)} title="Toggle hide/show for all secret values">{showAll ? '🙈 Hide all' : '👁 Show all'}</button>
        <button className="btn btn-small" style={{ marginLeft: 'auto' }} onClick={() => setLimit(l => Math.min(filtered.length, l + 40))} disabled={shown.length >= filtered.length}>Show more</button>
        <button className="btn btn-small" onClick={() => {
          const csv = ['kind,severity,count,value,context', ...filtered.map(s => `${JSON.stringify(s.kind)},${s.severity},${s.count},${JSON.stringify(s.raw ?? s.masked)},${JSON.stringify(s.context)}`)].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'found-keys.csv'; a.click(); URL.revokeObjectURL(url);
        }}>Download CSV</button>
      </div>

      {list.length === 0 ? (
        <p className="empty">No key-like patterns were found. This is a heuristic scan — absence doesn't prove there are no secrets; private keys, tokens in binary blobs, or obfuscated values may not match.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No findings match the filter.</p>
      ) : (
        <div className="table-scroll app-table-wrap" style={{ maxHeight: 440 }}>
          <table className="data-table app-table">
            <thead><tr><th>Severity</th><th>Kind</th><th>Value</th><th></th><th>Count</th><th>Context</th></tr></thead>
            <tbody>
              {shown.map((s, i) => {
                const key = `${s.kind}-${s.masked}-${i}`;
                const isMasked = showAll ? revealed.has(key) : !revealed.has(key);
                const display = isMasked ? s.masked : (s.raw ?? s.masked);
                return (
                <tr key={key}>
                  <td><span className="chip" style={{ background: `${SEV_COLOR[s.severity] ?? '#64748b'}22`, color: SEV_COLOR[s.severity] ?? '#94a3b8', borderColor: `${SEV_COLOR[s.severity] ?? '#64748b'}55` }}>{s.severity}</span></td>
                  <td className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.kind}</td>
                  <td className="mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-all' }} title={display}>{display}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-small" onClick={() => setRevealed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })} title={isMasked ? 'Show raw value' : 'Hide value'}>{isMasked ? '👁 Show' : '🙈 Hide'}</button></td>
                  <td className="mono">{s.count}</td>
                  <td className="mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.context}>{s.context}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>Patterns: <code>AKIA[0-9A-Z]&#123;16&#125;</code> · <code>AIza[0-9A-Za-z-_&#123;35&#125;]</code> · JWT · <code>-----BEGIN * PRIVATE KEY-----</code> · generic <code>(api_key|secret|password|token)=value</code>. Values shown raw — use Hide to mask.</p>
      </div>
    </section>
  );
}
