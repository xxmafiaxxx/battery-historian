import { useEffect, useMemo, useRef, useState } from 'react';
import { pollLiveBattery, type LiveReading } from '../api/client';
import { LevelChart } from './LevelChart';
import type { HistorianEntry } from '../data/historianCsv';
import { click } from '../sound';

export function LivePanel({ serial, timeZone }: { serial: string; timeZone: string }) {
  const [live, setLive] = useState(false);
  const [intervalMs, setIntervalMs] = useState(2000);
  const [readings, setReadings] = useState<LiveReading[]>([]);
  const [error, setError] = useState('');
  const [following, setFollowing] = useState(true);
  const latest = readings[readings.length - 1] ?? null;
  const timerRef = useRef<number | null>(null);

  // Poll loop
  useEffect(() => {
    if (!live || !serial) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await pollLiveBattery(serial);
        if (cancelled) return;
        setReadings(prev => {
          const next = [...prev, r];
          // cap ~20 min at 2s = 600 pts
          if (next.length > 600) next.splice(0, next.length - 600);
          return next;
        });
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    timerRef.current = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [live, serial, intervalMs]);

  const entries: HistorianEntry[] = useMemo(
    () =>
      readings.map(r => ({
        seriesName: 'Battery Level',
        type: 'int' as const,
        startTime: r.timestampMs,
        endTime: r.timestampMs,
        value: String(r.level),
        source: 'Live',
        opt: '',
        uid: null,
      })),
    [readings],
  );

  const domain = useMemo(() => {
    if (!following || readings.length < 2) return null;
    const last = readings[readings.length - 1]!.timestampMs;
    const span = Math.max(2 * 60 * 1000, last - readings[0]!.timestampMs);
    // keep ~2 min window minimum, otherwise show collected range + 30s ahead
    const windowMs = Math.min(span + 30_000, 10 * 60 * 1000);
    return { min: last - windowMs, max: last + 5_000 };
  }, [readings, following]);

  const toggle = () => {
    click();
    setLive(v => !v);
  };

  return (
    <section className="card live-panel">
      <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`live-dot ${live ? 'live-dot-on' : ''}`} aria-hidden>●</span> Live
          <span className="chip" style={{ fontWeight: 400 }}>
            {live ? `polling every ${intervalMs / 1000}s` : 'paused'} · {readings.length} pts
          </span>
        </h3>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className={`btn ${live ? '' : 'btn-primary'}`} onClick={toggle}>
            {live ? '⏸ Pause' : '▶ Start live'}
          </button>
          <button type="button" className="btn" onClick={() => setReadings([])} disabled={readings.length === 0}>
            Clear
          </button>
          <select value={intervalMs} onChange={e => setIntervalMs(Number(e.target.value))} title="Poll interval">
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
          </select>
          <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={following} onChange={e => setFollowing(e.target.checked)} /> follow
          </label>
        </div>
      </div>

      {/* Current reading strip */}
      {latest ? (
        <div className="live-stats">
          <div className="live-stat">
            <span className="live-stat-k">Battery</span>
            <span className="live-stat-v">{latest.level}%</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-k">Status</span>
            <span className="live-stat-v live-stat-v--sm">{latest.statusLabel}</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-k">Voltage</span>
            <span className="live-stat-v">{(latest.voltageMv / 1000).toFixed(2)} V</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-k">Temp</span>
            <span className="live-stat-v">{latest.tempC.toFixed(1)}°C</span>
          </div>
          <div className="live-stat">
            <span className="live-stat-k">Plugged</span>
            <span className="live-stat-v live-stat-v--sm">{latest.plugged ? (latest.acPowered ? 'AC' : latest.usbPowered ? 'USB' : 'wireless') : 'no'}</span>
          </div>
        </div>
      ) : (
        <p className="hint" style={{ margin: '8px 0' }}>
          {live ? 'Waiting for first reading…' : `Hit Start live to stream battery level from ${serial} via ADB.`}
        </p>
      )}

      {error && <div className="banner banner-warn" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {entries.length >= 2 ? (
        <LevelChart entries={entries} timeZone={timeZone} domain={domain} rateOfChange={false} onDomainChange={() => setFollowing(false)} />
      ) : (
        <div className="hint" style={{ padding: '12px 0', textAlign: 'center' }}>
          {live ? 'Collecting…' : 'Start live to see the battery level trace update in real time.'}
        </div>
      )}
      <p className="hint" style={{ marginTop: 6 }}>Live data is `adb shell dumpsys battery` polled locally — no bugreport, no upload. Keep the phone awake.</p>
    </section>
  );
}
