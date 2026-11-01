import { useMemo, useState } from 'react';
import type { AppStat } from '../api/types';
import { formatDuration, formatMah, describeBytes } from '../data/time';
import { useCollapsible } from './Collapsible';

type SortKey = 'power' | 'cpu' | 'name' | 'uid';

function displayName(s: AppStat): string {
  const raw: any = s.RawStats;
  if (!raw) return `uid ${s.RawStats?.uid ?? '?'}`;
  // Proto json uses lowercase `name`; tolerate Name, string or string[].
  let n: any = raw.name ?? raw.Name ?? '';
  if (Array.isArray(n)) n = n.length ? n[n.length - 1] : '';
  if (typeof n === 'string' && n && !n.startsWith('UNKNOWN_')) return n;
  // Fallback to child/head_child which carry the real package for shared UIDs.
  const child = raw.child ?? raw.Child;
  if (Array.isArray(child) && child[0]?.name) return child[0].name;
  if (Array.isArray(child) && child[0]?.Name) return child[0].Name;
  const head = raw.head_child ?? raw.headChild ?? raw.HeadChild;
  if (head?.name) return head.name;
  if (head?.Name) return head.Name;
  if (typeof n === 'string' && n) return n; // show UNKNOWN_xxx so uid is still findable
  return `uid ${raw.uid ?? raw.Uid ?? '?'}`;
}

function isUnknown(n: string) { return n.startsWith('UNKNOWN_') || n.startsWith('uid '); }
function pkgShort(n: string) {
  if (!n || isUnknown(n)) return n;
  const parts = n.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : n;
}

export function AppStats({ appStats }: { appStats: AppStat[] }) {
  const [open, setOpen] = useCollapsible('app-stats', true);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'power', dir: 'desc' });
  const [page, setPage] = useState(0);
  const PAGE = 30;

  const rows = useMemo(() => {
    const mapped = appStats.map(s => ({
      name: displayName(s),
      uid: (s.RawStats as any)?.uid ?? (s.RawStats as any)?.Uid ?? 0,
      power: s.DevicePowerPrediction,
      cpu: s.CPUPowerPrediction,
      stat: s,
    }));
    let filtered = q.trim()
      ? mapped.filter(r => r.name.toLowerCase().includes(q.toLowerCase()) || String(r.uid).includes(q.trim()))
      : mapped;
    filtered.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      if (sort.key === 'name') return dir * a.name.localeCompare(b.name);
      if (sort.key === 'uid') return dir * (a.uid - b.uid);
      if (sort.key === 'cpu') return dir * (a.cpu - b.cpu) || dir * (a.power - b.power);
      return dir * (a.power - b.power) || dir * (a.cpu - b.cpu);
    });
    return filtered;
  }, [appStats, q, sort]);

  // reset page when filter/sort changes
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(safePage * PAGE, (safePage + 1) * PAGE);
  const sel = rows.find(r => `${r.uid}` === selected) ?? null;

  const toggleSort = (k: SortKey) =>
    setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'name' ? 'asc' : 'desc' }));

  const hdr = (label: string, k: SortKey) => (
    <th onClick={() => toggleSort(k)} title="Click to sort" style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label} {sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
    </th>
  );

  return (
    <section className="card card-collapsible" id="app-stats">
      <div className="card-head" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }} aria-expanded={open} aria-controls="app-stats-body">
        <h3>App stats <span className="chip">{appStats.length} apps</span> <span className="chip" style={{ background: 'rgba(74,222,128,0.12)' }}>{rows.length} shown</span></h3>
        <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{open ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{open ? '▾' : '▸'}</button></span>
      </div>
      <div id="app-stats-body" className="collapsible-body" hidden={!open}>
      {appStats.length === 0 ? (
        <p className="empty">No per-app stats were parsed. Upload a full <code>adb bugreport</code> zip — the checkin section may be truncated or missing package/appops dumps.</p>
      ) : (
        <>
          <div className="app-toolbar">
            <input className="app-search" placeholder="Filter by app or UID…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
            <span className="hint">{rows.length} match · click a row for details</span>
            <span style={{ marginLeft: 'auto' }} className="hint">Sorted by {sort.key} {sort.dir}</span>
          </div>

          <div className="table-scroll app-table-wrap">
            <table className="data-table app-table">
              <thead>
                <tr>
                  {hdr('App', 'name')}
                  {hdr('UID', 'uid')}
                  {hdr('Est. power', 'power')}
                  {hdr('CPU power', 'cpu')}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => (
                  <tr
                    key={r.uid}
                    className={selected === `${r.uid}` ? 'row-selected' : undefined}
                    onClick={() => setSelected(selected === `${r.uid}` ? null : `${r.uid}`)}
                    title={isUnknown(r.name) ? `UID ${r.uid} — package name unavailable (system/shared UID)` : r.name}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className={`app-name ${isUnknown(r.name) ? 'app-name-unknown' : ''}`} title={r.name}>{pkgShort(r.name)}</span>
                      {!isUnknown(r.name) && r.name !== pkgShort(r.name) && <span className="hint" style={{ marginLeft: 6, fontSize: 11 }}>{r.name}</span>}
                      {isUnknown(r.name) && <span className="chip chip-warn">unknown</span>}
                    </td>
                    <td className="mono">{r.uid}</td>
                    <td>
                      <span className="mono">{formatMah(r.power)}</span>
                      <span className="power-mini" style={{ width: `${Math.min(100, Math.max(2, r.power * 8))}%` }} />
                    </td>
                    <td className="mono">{formatMah(r.cpu)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="app-pager">
              <button className="btn btn-small" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹ Prev</button>
              <span className="hint">Page {safePage + 1} / {totalPages} · {rows.length} apps</span>
              <button className="btn btn-small" disabled={safePage >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}

          {sel && <AppDetail stat={sel.stat} name={sel.name} onClose={() => setSelected(null)} />}
        </>
      )}
      </div>
    </section>
  );
}

function AppDetail({ stat, name, onClose }: { stat: AppStat; name: string; onClose: () => void }) {
  const raw: any = stat.RawStats;
  const fgs = raw?.foreground_service ?? raw?.foregroundService;
  const fg = raw?.foreground;
  const cpu = raw?.cpu;
  const net = raw?.network;
  const version = raw?.version_name ?? raw?.versionName ?? raw?.VersionName;
  const vcode = raw?.version_code ?? raw?.versionCode;
  const uid = raw?.uid ?? raw?.Uid;
  return (
    <div className="app-detail">
      <div className="app-detail-head">
        <h4 style={{ margin: 0 }}>{name} <span className="chip">uid {uid}</span> {version ? <span className="chip">{version} ({vcode})</span> : null}</h4>
        <button className="btn btn-small" onClick={onClose}>✕ Close</button>
      </div>
      <div className="detail-grid">
        <DetailBlock title="Foreground service">{fgs ? `${formatDuration(fgs.total_time_msec ?? fgs.totalTimeMsec ?? 0)} × ${fgs.count ?? 0}` : '—'}</DetailBlock>
        <DetailBlock title="Foreground">{fg ? `${formatDuration(fg.total_time_msec ?? fg.totalTimeMsec ?? 0)} × ${fg.count ?? 0}` : '—'}</DetailBlock>
        <DetailBlock title="Audio / Camera / Video / Flashlight">
          {[
            raw?.audio ? `audio ${formatDuration(raw.audio.total_time_msec ?? raw.audio.totalTimeMsec ?? 0)}` : null,
            raw?.camera ? `camera ${formatDuration(raw.camera.total_time_msec ?? raw.camera.totalTimeMsec ?? 0)}` : null,
            raw?.video ? `video ${formatDuration(raw.video.total_time_msec ?? raw.video.totalTimeMsec ?? 0)}` : null,
            raw?.flashlight ? `flashlight ${formatDuration(raw.flashlight.total_time_msec ?? raw.flashlight.totalTimeMsec ?? 0)}` : null,
          ].filter(Boolean).join(' · ') || '—'}
        </DetailBlock>
        <DetailBlock title="CPU">{cpu ? `user ${formatDuration(cpu.user_time_msec ?? cpu.userTimeMsec ?? 0)} · system ${formatDuration(cpu.system_time_msec ?? cpu.systemTimeMsec ?? 0)}${cpu.power_ma_ms ? ` · ${cpu.power_ma_ms} mA·ms` : ''}` : '—'}</DetailBlock>
        <DetailBlock title="Mobile data">{net ? `↓ ${describeBytes(net.mobile_bytes_rx ?? net.mobileBytesRx ?? 0)} / ↑ ${describeBytes(net.mobile_bytes_tx ?? net.mobileBytesTx ?? 0)}` : '—'}</DetailBlock>
        <DetailBlock title="Wi-Fi data">{net ? `↓ ${describeBytes(net.wifi_bytes_rx ?? net.wifiBytesRx ?? 0)} / ↑ ${describeBytes(net.wifi_bytes_tx ?? net.wifiBytesTx ?? 0)}` : '—'}</DetailBlock>
        <DetailBlock title="Mobile radio active">{net && ((net.mobile_active_time_msec ?? net.mobileActiveTimeMsec ?? 0) as number) > 0 ? `${formatDuration(net.mobile_active_time_msec ?? net.mobileActiveTimeMsec ?? 0)} × ${net.mobile_active_count ?? net.mobileActiveCount ?? 0}` : '—'}</DetailBlock>
        <DetailBlock title="Modem activity">{raw?.modem_controller ?? raw?.modemController ? `idle ${formatDuration((raw.modem_controller ?? raw.modemController).modem_idle_time_msec ?? 0)} · rx ${formatDuration((raw.modem_controller ?? raw.modemController).modem_rx_time_msec ?? 0)} · tx ${formatDuration((raw.modem_controller ?? raw.modemController).modem_tx_time_msec ?? 0)}` : '—'}</DetailBlock>
      </div>

      {(raw?.wakelock?.length ?? 0) > 0 && (
        <>
          <h5>Wakelocks · {raw.wakelock.length}</h5>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Partial</th><th>Count</th><th>Background</th></tr></thead>
              <tbody>
                {raw.wakelock.map((w: any, i: number) => (
                  <tr key={i}><td className="mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name ?? w.Name}</td><td>{formatDuration(w.partial_time_msec ?? w.partialTimeMsec ?? 0)}</td><td>{w.partial_count ?? w.partialCount ?? 0}</td><td>{formatDuration(w.background_time_msec ?? w.backgroundTimeMsec ?? 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(raw?.sensor?.length ?? 0) > 0 && (
        <>
          <h5>Sensor use · {raw.sensor.length}</h5>
          <div className="table-scroll" style={{ maxHeight: 220 }}>
            <table className="data-table"><thead><tr><th>Sensor #</th><th>Time</th><th>Count</th></tr></thead><tbody>{raw.sensor.map((sn: any, i: number) => (<tr key={i}><td>{sn.number ?? sn.Number}</td><td>{formatDuration(sn.total_time_msec ?? sn.totalTimeMsec ?? 0)}</td><td>{sn.count ?? sn.Count ?? 0}</td></tr>))}</tbody></table>
          </div>
        </>
      )}

      {(raw?.process?.length ?? 0) > 0 && (
        <>
          <h5>Processes · {raw.process.length}</h5>
          <div className="table-scroll" style={{ maxHeight: 260 }}>
            <table className="data-table"><thead><tr><th>Process</th><th>User</th><th>System</th><th>Starts</th></tr></thead><tbody>{raw.process.map((pr: any, i: number) => (<tr key={i}><td className="mono">{pr.name ?? pr.Name}</td><td>{formatDuration(pr.user_time_msec ?? pr.userTimeMsec ?? 0)}</td><td>{formatDuration(pr.system_time_msec ?? pr.systemTimeMsec ?? 0)}</td><td>{pr.starts ?? pr.Starts ?? '—'}</td></tr>))}</tbody></table>
          </div>
        </>
      )}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (<div className="detail-block"><div className="detail-title">{title}</div><div>{children}</div></div>);
}
