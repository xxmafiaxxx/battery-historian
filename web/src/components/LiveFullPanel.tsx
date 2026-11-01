import { useEffect, useRef, useState } from 'react';
import { pollLiveReport } from '../api/client';
import type { UploadResponse } from '../api/types';
import { AnalysisView } from './AnalysisView';
import { click } from '../sound';

export function LiveFullPanel({ serial, timeZone }: { serial: string; timeZone: string }) {
  const [live, setLive] = useState(false);
  const [intervalMs, setIntervalMs] = useState(12000);
  const [data, setData] = useState<UploadResponse | null>(null);
  const [error, setError] = useState('');
  const [tickCount, setTickCount] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!live || !serial) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await pollLiveReport(serial);
        if (cancelled) return;
        // Extract single (pollLiveReport unwraps compare already)
        const single = (res as any).single as UploadResponse | undefined;
        if (single) setData(single);
        else setData((res as any) as UploadResponse);
        setError('');
        setTickCount(c => c + 1);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    timerRef.current = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [live, serial, intervalMs]);

  return (
    <section className="card live-panel" style={{ borderColor: 'rgba(96,165,250,0.35)' }}>
      <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`live-dot ${live ? 'live-dot-on' : ''}`} style={{ color: live ? '#60a5fa' : undefined }}>●</span> Live Historian
          <span className="chip" style={{ fontWeight: 400 }}>
            {live ? `refresh ${intervalMs / 1000}s · ${tickCount} polls` : 'paused'} · full report
          </span>
        </h3>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className={`btn ${live ? '' : 'btn-primary'}`} onClick={() => { click(); setLive(v => !v); }}>
            {live ? '⏸ Pause' : '▶ Start live report'}
          </button>
          <select value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))} title="Refresh interval">
            <option value={8000}>8s</option>
            <option value={12000}>12s</option>
            <option value={20000}>20s</option>
            <option value={30000}>30s</option>
          </select>
        </div>
      </div>

      {!live && !data && <p className="hint" style={{ margin: '8px 0' }}>Streams the same System/App stats + Timeline + Battery chart as a bugreport, but live from `dumpsys batterystats -c --history`. Heavy — polls every 12s.</p>}
      {error && <div className="banner banner-warn" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
      {live && !data && !error && <p className="hint">Collecting first live report… (takes ~3–5s)</p>}

      {data && (
        <div style={{ marginTop: 8 }}>
          <div className="hint" style={{ marginBottom: 8 }}>Live from <code>{serial}</code> · {new Date().toLocaleTimeString()} · <span style={{ color: '#4ade80' }}>{data.fileName ?? 'live'}</span></div>
          <AnalysisView data={data} timeZoneOverride={timeZone} />
        </div>
      )}
      <p className="hint" style={{ marginTop: 6 }}>Live data is `dumpsys batterystats -c --history` polled locally — identical parsing to bugreport upload. Keep the phone awake & unlocked.</p>
    </section>
  );
}
