import { useMemo, useState } from 'react';
import { fetchCallHistory, fetchSmsHistory, downloadText } from '../api/client';
import type { CallRecord, SmsRecord } from '../api/client';
import { useCollapsible } from './Collapsible';
import { click } from '../sound';

function formatDur(s: number): string {
  if (s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

export function CommsPanel({ serial }: { serial: string }) {
  const [tab, setTab] = useState<'calls' | 'sms'>('calls');
  const [calls, setCalls] = useState<CallRecord[] | null>(null);
  const [sms, setSms] = useState<SmsRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(300);
  const [open, setOpen] = useCollapsible('comms', true);

  const load = async (which: 'calls' | 'sms') => {
    click();
    setBusy(true);
    setError('');
    try {
      if (which === 'calls') {
        const r = await fetchCallHistory(serial, limit);
        setCalls(r.calls);
        setTab('calls');
      } else {
        const r = await fetchSmsHistory(serial, limit);
        setSms(r.messages);
        setTab('sms');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    if (!q.trim()) return calls;
    const qq = q.toLowerCase();
    return calls.filter(c => `${c.number} ${c.name} ${c.typeLabel} ${c.date}`.toLowerCase().includes(qq));
  }, [calls, q]);

  const filteredSms = useMemo(() => {
    if (!sms) return [];
    if (!q.trim()) return sms;
    const qq = q.toLowerCase();
    return sms.filter(m => `${m.address} ${m.body} ${m.typeLabel} ${m.date}`.toLowerCase().includes(qq));
  }, [sms, q]);

  const downloadCsv = (which: 'calls' | 'sms') => {
    if (which === 'calls' && filteredCalls.length) {
      const header = 'number,name,date,durationSec,type,typeLabel';
      const rows = filteredCalls.map(c => [JSON.stringify(c.number), JSON.stringify(c.name), JSON.stringify(c.date), String(c.durationSec), String(c.type), JSON.stringify(c.typeLabel)].join(','));
      downloadText(`calls-${serial}.csv`, [header, ...rows].join('\n'));
    } else if (which === 'sms' && filteredSms.length) {
      const header = 'address,body,date,type,typeLabel,read';
      const rows = filteredSms.map(m => [JSON.stringify(m.address), JSON.stringify(m.body), JSON.stringify(m.date), String(m.type), JSON.stringify(m.typeLabel), String(m.read)].join(','));
      downloadText(`messages-${serial}.csv`, [header, ...rows].join('\n'));
    }
  };

  return (
    <section className="card card-collapsible" id="comms-history">
      <div className="card-head" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }} aria-expanded={open} aria-controls="comms-body">
        <h3>Calls &amp; messages <span className="chip">live via ADB</span></h3>
        <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{open ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={open ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{open ? '▾' : '▸'}</button></span>
      </div>
      <div id="comms-body" className="collapsible-body" hidden={!open}>
      <p className="hint">Reads <code>content://call_log/calls</code> and <code>content://sms</code> directly from the connected phone (no root, no backup). Only works on the device you have plugged in over ADB.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 10px' }}>
        <button className={`btn ${tab === 'calls' ? 'btn-primary' : ''}`} onClick={() => load('calls')} disabled={busy || !serial}>📞 {calls ? 'Refresh calls' : 'Load calls'}</button>
        <button className={`btn ${tab === 'sms' ? 'btn-primary' : ''}`} onClick={() => load('sms')} disabled={busy || !serial}>💬 {sms ? 'Refresh messages' : 'Load messages'}</button>
        <select className="app-search" value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ maxWidth: 110 }}>
          <option value={100}>100</option>
          <option value={300}>300</option>
          <option value={600}>600</option>
          <option value={1000}>1000</option>
        </select>
        <span className="hint" style={{ marginLeft: 'auto' }}>{serial ? `device ${serial}` : 'no device selected'} {busy ? '· loading…' : ''}</span>
      </div>

      {error && <div className="banner banner-warn" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {(calls || sms) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-small ${tab === 'calls' ? 'btn-primary' : ''}`} onClick={() => setTab('calls')}>Calls {calls ? `· ${calls.length}` : ''}</button>
            <button className={`btn btn-small ${tab === 'sms' ? 'btn-primary' : ''}`} onClick={() => setTab('sms')}>Messages {sms ? `· ${sms.length}` : ''}</button>
          </div>
          <input className="app-search" placeholder={tab === 'calls' ? 'Search number / name…' : 'Search address / message…'} value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 260, flex: 1 }} />
          <button className="btn btn-small" onClick={() => downloadCsv(tab)} disabled={tab === 'calls' ? filteredCalls.length === 0 : filteredSms.length === 0}>Download CSV</button>
          <span className="hint">{tab === 'calls' ? `${filteredCalls.length}/${calls?.length ?? 0}` : `${filteredSms.length}/${sms?.length ?? 0}`} shown</span>
        </div>
      )}

      {tab === 'calls' && calls && (
        filteredCalls.length === 0 ? <p className="empty">No calls match the filter.</p> : (
          <div className="table-scroll" style={{ maxHeight: 520 }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Number</th><th>Name</th><th>Type</th><th>Duration</th></tr></thead>
              <tbody>
                {filteredCalls.slice(0, 800).map((c, i) => (
                  <tr key={`${c.dateMs}-${c.number}-${i}`}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{c.date || new Date(c.dateMs).toLocaleString()}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>{c.number || '—'}</td>
                    <td>{c.name || <span className="hint">—</span>}</td>
                    <td><span className="chip" style={{
                      background: c.type === 3 ? 'rgba(239,68,68,0.15)' : c.type === 1 ? 'rgba(74,222,128,0.15)' : 'rgba(96,165,250,0.12)',
                      color: c.type === 3 ? '#fecaca' : c.type === 1 ? '#bbf7d0' : '#93c5fd',
                      borderColor: c.type === 3 ? 'rgba(239,68,68,0.3)' : 'rgba(74,222,128,0.25)'
                    }}>{c.typeLabel}</span></td>
                    <td className="mono">{formatDur(c.durationSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'calls' && !calls && !error && <p className="hint">Tap <em>Load calls</em> to pull the call log from the connected phone. The phone stays awake — data never leaves your machine except as this table/CSV.</p>}

      {tab === 'sms' && sms && (
        filteredSms.length === 0 ? <p className="empty">No messages match the filter.</p> : (
          <div className="table-scroll" style={{ maxHeight: 520 }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Address</th><th>Direction</th><th>Message</th></tr></thead>
              <tbody>
                {filteredSms.slice(0, 800).map((m, i) => (
                  <tr key={`${m.dateMs}-${m.address}-${i}`}>
                    <td className="mono" style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>{m.date || new Date(m.dateMs).toLocaleString()}</td>
                    <td className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{m.address || '—'}</td>
                    <td style={{ verticalAlign: 'top' }}><span className="chip" style={{ background: m.type === 1 ? 'rgba(74,222,128,0.12)' : 'rgba(96,165,250,0.12)', color: m.type === 1 ? '#bbf7d0' : '#93c5fd' }}>{m.typeLabel}</span></td>
                    <td style={{ maxWidth: 560, whiteSpace: 'pre-wrap', wordBreak: 'break-word', verticalAlign: 'top' }}>{m.body || <span className="hint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'sms' && !sms && !error && <p className="hint">Tap <em>Load messages</em> to pull SMS from the phone. MMS is not included (structured separately via <code>content://mms</code>).</p>}
      </div>
    </section>
  );
}
