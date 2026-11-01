import { useMemo, useState } from 'react';
import { describeBytes } from '../data/time';
import type { BatteryStats, AppStat } from '../api/types';
import { useCollapsible } from './Collapsible';

export interface NetworkSite {
  domain: string;
  count: number;
  exampleUrl: string;
  secure: boolean;
}

function appNetworkBytes(a: AppStat): number {
  const n: any = (a.RawStats as any)?.network ?? (a.RawStats as any)?.Network;
  if (!n) return 0;
  const rx = n.mobile_bytes_rx ?? n.mobileBytesRx ?? n.wifi_bytes_rx ?? n.wifiBytesRx ?? 0;
  const tx = n.mobile_bytes_tx ?? n.mobileBytesTx ?? n.wifi_bytes_tx ?? n.wifiBytesTx ?? 0;
  const wrx = n.wifi_bytes_rx ?? n.wifiBytesRx ?? 0;
  const wtx = n.wifi_bytes_tx ?? n.wifiBytesTx ?? 0;
  const mrx = n.mobile_bytes_rx ?? n.mobileBytesRx ?? 0;
  const mtx = n.mobile_bytes_tx ?? n.mobileBytesTx ?? 0;
  // sum distinct mobile+wifi (avoid double counting if rx already summed)
  return (mrx + mtx + wrx + wtx) || (rx + tx);
}

function displayNameRaw(s: AppStat): string {
  const raw: any = s.RawStats;
  if (!raw) return `uid ?`;
  let n: any = raw.name ?? raw.Name ?? '';
  if (Array.isArray(n)) n = n.length ? n[n.length - 1] : '';
  if (typeof n === 'string' && n && !n.startsWith('UNKNOWN_')) return n;
  const child = raw.child ?? raw.Child;
  if (Array.isArray(child) && child[0]?.name) return child[0].name;
  if (Array.isArray(child) && child[0]?.Name) return child[0].Name;
  const head = raw.head_child ?? raw.headChild ?? raw.HeadChild;
  if (head?.name) return head.name;
  if (head?.Name) return head.Name;
  if (typeof n === 'string' && n) return n;
  return `uid ${raw.uid ?? raw.Uid ?? '?'}`;
}

export function NetworkAccess({ batteryStats, appStats, sites, historianV2Logs }: {
  batteryStats: BatteryStats | null;
  appStats: AppStat[];
  sites: NetworkSite[] | null | undefined;
  historianV2Logs: { source: string; csv: string }[];
}) {
  const [q, setQ] = useState('');
  const [qApp, setQApp] = useState('');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useCollapsible('network-access', true);

  const netEvents = useMemo(() => {
    let n = 0;
    for (const l of historianV2Logs) {
      if (/network|connectivity|mobile|wifi/i.test(l.source)) {
        const lines = l.csv.trim().split('\n');
        // minus header
        n += Math.max(0, lines.length - 1);
      }
    }
    return n;
  }, [historianV2Logs]);

  const gn = (batteryStats?.system as any)?.global_network ?? (batteryStats?.system as any)?.globalNetwork;

  const appNetworkRows = useMemo(() => {
    const rows = appStats.map(a => {
      const n: any = (a.RawStats as any)?.network ?? (a.RawStats as any)?.Network;
      const mobileRx = n?.mobile_bytes_rx ?? n?.mobileBytesRx ?? 0;
      const mobileTx = n?.mobile_bytes_tx ?? n?.mobileBytesTx ?? 0;
      const wifiRx = n?.wifi_bytes_rx ?? n?.wifiBytesRx ?? 0;
      const wifiTx = n?.wifi_bytes_tx ?? n?.wifiBytesTx ?? 0;
      const total = mobileRx + mobileTx + wifiRx + wifiTx;
      return { name: displayNameRaw(a), uid: (a.RawStats as any)?.uid ?? 0, mobileRx, mobileTx, wifiRx, wifiTx, total, stat: a };
    }).filter(r => r.total > 0);
    rows.sort((a,b) => b.total - a.total);
    if (!qApp.trim()) return rows;
    const qq = qApp.toLowerCase();
    return rows.filter(r => r.name.toLowerCase().includes(qq) || String(r.uid).includes(qq));
  }, [appStats, qApp]);

  const filteredSites = useMemo(() => {
    const list = sites ?? [];
    if (!q.trim()) return list;
    const qq = q.toLowerCase();
    return list.filter(s => s.domain.toLowerCase().includes(qq) || s.exampleUrl.toLowerCase().includes(qq));
  }, [sites, q]);

  const shownSites = filteredSites.slice(0, limit);

  return (
    <section className="card card-collapsible" id="network-access">
      <div className="card-head" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }} aria-expanded={open} aria-controls="network-access-body">
        <h3>Network access <span className="chip">{appNetworkRows.length} apps with traffic</span> <span className="chip">{(sites?.length ?? 0)} domains found</span> <span className="chip">{netEvents} net events</span></h3>
        <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{open ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{open ? '▾' : '▸'}</button></span>
      </div>
      <div id="network-access-body" className="collapsible-body" hidden={!open}>
      <p className="hint">
        Bugreports don't dump Chrome history. Sites below are URLs/hostnames mined from the raw report text (logcat, dumpsys, net logs).
        Use <em>Timeline → filter</em> for <code>Network connectivity</code> / <code>Mobile radio active</code> / Wi-Fi lanes for the time graph.
      </p>

      {(gn) && (
        <div className="detail-grid" style={{ margin: '10px 0 12px' }}>
          <div className="detail-block"><div className="detail-title">Mobile</div><div className="mono">↓ {describeBytes(gn.mobile_bytes_rx ?? gn.mobileBytesRx ?? 0)} / ↑ {describeBytes(gn.mobile_bytes_tx ?? gn.mobileBytesTx ?? 0)}</div></div>
          <div className="detail-block"><div className="detail-title">Wi-Fi</div><div className="mono">↓ {describeBytes(gn.wifi_bytes_rx ?? gn.wifiBytesRx ?? 0)} / ↑ {describeBytes(gn.wifi_bytes_tx ?? gn.wifiBytesTx ?? 0)}</div></div>
          <div className="detail-block"><div className="detail-title">Bluetooth</div><div className="mono">↓ {describeBytes(gn.bt_bytes_rx ?? gn.btBytesRx ?? 0)} / ↑ {describeBytes(gn.bt_bytes_tx ?? gn.btBytesTx ?? 0)}</div></div>
          <div className="detail-block"><div className="detail-title">Info</div><div className="hint">Per-app traffic below is <code>mobile_*_rx/tx</code> + <code>wifi_*_rx/tx</code> from <code>BatteryStats</code>. Use search to narrow.</div></div>
        </div>
      )}

      <h4 style={{ marginTop: 8 }}>Per-app network traffic (by bytes)</h4>
      <div className="app-toolbar" style={{ marginBottom: 6 }}>
        <input className="app-search" placeholder="Filter apps…" value={qApp} onChange={e => setQApp(e.target.value)} style={{ maxWidth: 260 }} />
        <span className="hint">{appNetworkRows.length} apps</span>
        <span className="hint" style={{ marginLeft: 'auto' }}>Sorted by total bytes ↓</span>
      </div>
      {appNetworkRows.length === 0 ? (
        <p className="empty">No per-app network bytes in this report. Try a full <code>adb bugreport</code> zip.</p>
      ) : (
        <div className="table-scroll app-table-wrap" style={{ maxHeight: 380 }}>
          <table className="data-table app-table">
            <thead><tr><th>App</th><th>UID</th><th>Mobile ↓ / ↑</th><th>Wi-Fi ↓ / ↑</th><th>Total</th></tr></thead>
            <tbody>
              {appNetworkRows.slice(0, 80).map(r => (
                <tr key={r.uid} title={r.name}>
                  <td className="mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                  <td className="mono">{r.uid}</td>
                  <td className="mono">{describeBytes(r.mobileRx)} / {describeBytes(r.mobileTx)}</td>
                  <td className="mono">{describeBytes(r.wifiRx)} / {describeBytes(r.wifiTx)}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{describeBytes(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 style={{ marginTop: 16 }}>Sites / domains visited <span className="chip">{filteredSites.length} shown</span></h4>
      <div className="app-toolbar" style={{ marginBottom: 6 }}>
        <input className="app-search" placeholder="Filter domain…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <span className="hint">{(sites?.length ?? 0)} total · from log URLs & Host headers</span>
        <button className="btn btn-small" style={{ marginLeft: 'auto' }} onClick={() => setLimit(l => Math.min(filteredSites.length, l + 50))} disabled={shownSites.length >= filteredSites.length}>Show more</button>
        <button className="btn btn-small" onClick={() => {
          const csv = ['domain,count,secure,exampleUrl', ...filteredSites.map(s => `${s.domain},${s.count},${s.secure ? 'https' : 'http'},${JSON.stringify(s.exampleUrl)}`)].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'network-sites.csv'; a.click(); URL.revokeObjectURL(url);
        }}>Download CSV</button>
      </div>
      {!sites || sites.length === 0 ? (
        <p className="empty">
          No URLs were found in this bugreport's text. That's normal — many builds don't log URLs.
          Re-pull with a fresh bugreport and try browsing first so the report captures recent network logcat.
          You can still use the <strong>Historian Timeline</strong> Network / Wi-Fi lanes and the per-app traffic table above.
        </p>
      ) : (
        <div className="table-scroll app-table-wrap" style={{ maxHeight: 420 }}>
          <table className="data-table app-table">
            <thead><tr><th>Domain</th><th>Hits</th><th>TLS</th><th>Example URL</th></tr></thead>
            <tbody>
              {shownSites.map(s => (
                <tr key={s.domain}>
                  <td className="mono" style={{ fontWeight: 600 }}>{s.domain} <a href={s.exampleUrl} target="_blank" rel="noreferrer" title={s.exampleUrl} style={{ marginLeft: 6, fontSize: 11 }}>open ↗</a></td>
                  <td className="mono">{s.count}</td>
                  <td>{s.secure ? '🔒 https' : 'http'}</td>
                  <td className="mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.exampleUrl}>{s.exampleUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 8 }}>Tip: click a domain's <em>open ↗</em> to verify. Counts are URL occurrences in the report, not request counts.</p>
      </div>
    </section>
  );
}

function _unused_appNetworkBytes(a: AppStat) { return appNetworkBytes(a); }
void _unused_appNetworkBytes;
