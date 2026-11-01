import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistorianEntry } from '../data/historianCsv';
import { Metric, groupBySeries } from '../data/historianCsv';
import { formatDuration, formatTime } from '../data/time';
import { isValidRegExp } from '../data/levelUtils';
import type { TabConfig } from '../data/historianTabs';

export interface ParsedLog {
  source: string;
  entries: HistorianEntry[];
  extent: { min: number; max: number };
  startMs?: number;
}

const LEVEL_SERIES = Metric.BATTERY_LEVEL;

const SERIES_ORDER = [
  'CPU running','App Processor wakeup','Kernel only uptime','Userspace wakelocks','Wakelock In','Wakelock Out','Long Wakelocks',
  'Screen','Top app','Top Application','Active process','Crashes (logcat)','AM Low Memory / ANR','Doze','JobScheduler Job','Sync App','SyncManager',
  'GPS','GPS is on','BLE scanning','Phone scanning','Phone state','Network connectivity','Mobile radio active','Mobile signal strength','Mobile network type',
  'Wifi full lock','Wifi scan','Wifi supplicant','Wifi radio','Wifi signal strength','Wifi running','Wifi on',
  'Audio','Video','Camera','Flashlight on','Sensor','Battery Saver','Plug','Charging status','Foreground process','Coulomb charge','Brightness','Voltage','Temperature',
];

type SeriesMeta = { color: string; desc: string; cat: string };
const SERIES_META: Record<string, SeriesMeta> = {
  'Battery Level': { color: '#4ade80', desc: 'Battery charge 0–100%.', cat: 'Battery' },
  'CPU running': { color: '#2563eb', desc: 'CPU awake.', cat: 'CPU / Wakelocks' },
  'Kernel only uptime': { color: '#dc2626', desc: 'Kernel work only.', cat: 'CPU / Wakelocks' },
  'Userspace wakelocks': { color: '#f97316', desc: 'App wakelock held.', cat: 'CPU / Wakelocks' },
  'Wakelock In': { color: '#fb923c', desc: 'Per-app partial wakelocks.', cat: 'CPU / Wakelocks' },
  'Wakelock Out': { color: '#fdba74', desc: 'Aggregated outward bucket.', cat: 'CPU / Wakelocks' },
  'Long Wakelocks': { color: '#991b1b', desc: 'Unusually long.', cat: 'CPU / Wakelocks' },
  'App Processor wakeup': { color: '#7c3aed', desc: 'AP wakeup reason.', cat: 'CPU / Wakelocks' },
  'Screen': { color: '#ef4444', desc: 'Screen ON.', cat: 'Display' },
  'Brightness': { color: '#facc15', desc: 'Brightness.', cat: 'Display' },
  'Top app': { color: '#a78bfa', desc: 'Foreground app.', cat: 'Apps' },
  'Top Application': { color: '#a78bfa', desc: 'Foreground app.', cat: 'Apps' },
  'Foreground process': { color: '#8b5cf6', desc: 'Foreground priority.', cat: 'Apps' },
  'Active process': { color: '#06b6d4', desc: 'Active process.', cat: 'Apps' },
  'Crashes (logcat)': { color: '#000000', desc: 'Crash.', cat: 'Health' },
  'AM Low Memory / ANR': { color: '#f97316', desc: 'Low-memory/ANR.', cat: 'Health' },
  'Doze': { color: '#475569', desc: 'Doze.', cat: 'Power saving' },
  'Battery Saver': { color: '#eab308', desc: 'Battery Saver.', cat: 'Power saving' },
  'JobScheduler Job': { color: '#0ea5e9', desc: 'JobScheduler.', cat: 'System' },
  'Sync App': { color: '#14b8a6', desc: 'Account sync.', cat: 'System' },
  'SyncManager': { color: '#14b8a6', desc: 'SyncManager.', cat: 'System' },
  'GPS': { color: '#10b981', desc: 'GPS on.', cat: 'Location / Radio' },
  'GPS is on': { color: '#10b981', desc: 'GPS requesting.', cat: 'Location / Radio' },
  'BLE scanning': { color: '#22d3ee', desc: 'BLE scan.', cat: 'Location / Radio' },
  'Phone scanning': { color: '#6366f1', desc: 'Radio scanning.', cat: 'Location / Radio' },
  'Phone state': { color: '#6366f1', desc: 'Cell state.', cat: 'Location / Radio' },
  'Network connectivity': { color: '#3b82f6', desc: 'Transport.', cat: 'Connectivity' },
  'Mobile radio active': { color: '#ec4899', desc: 'Radio active.', cat: 'Connectivity' },
  'Mobile signal strength': { color: '#f43f5e', desc: 'Signal.', cat: 'Connectivity' },
  'Mobile network type': { color: '#8b5cf6', desc: 'Radio tech.', cat: 'Connectivity' },
  'Wifi full lock': { color: '#0ea5e9', desc: 'WIFI_MODE_FULL.', cat: 'Wi-Fi' },
  'Wifi scan': { color: '#38bdf8', desc: 'Wi-Fi scan.', cat: 'Wi-Fi' },
  'Wifi supplicant': { color: '#0284c7', desc: 'wpa state.', cat: 'Wi-Fi' },
  'Wifi radio': { color: '#0ea5e9', desc: 'Wi-Fi radio.', cat: 'Wi-Fi' },
  'Wifi signal strength': { color: '#f43f5e', desc: 'Wi-Fi signal.', cat: 'Wi-Fi' },
  'Wifi running': { color: '#0ea5e9', desc: 'Wi-Fi stack.', cat: 'Wi-Fi' },
  'Wifi on': { color: '#0ea5e9', desc: 'Wi-Fi enabled.', cat: 'Wi-Fi' },
  'Audio': { color: '#f59e0b', desc: 'Audio.', cat: 'Sensors' },
  'Video': { color: '#f59e0b', desc: 'Video.', cat: 'Sensors' },
  'Camera': { color: '#f59e0b', desc: 'Camera.', cat: 'Sensors' },
  'Flashlight on': { color: '#fde047', desc: 'Torch.', cat: 'Sensors' },
  'Sensor': { color: '#84cc16', desc: 'Sensor.', cat: 'Sensors' },
  'Plug': { color: '#22c55e', desc: 'Charger.', cat: 'Battery' },
  'Charging status': { color: '#16a34a', desc: 'Charging state.', cat: 'Battery' },
  'Coulomb charge': { color: '#15803d', desc: 'Coulomb.', cat: 'Battery' },
  'Voltage': { color: '#16a34a', desc: 'Voltage.', cat: 'Battery' },
  'Temperature': { color: '#dc2626', desc: 'Temperature.', cat: 'Battery' },
};

function metaFor(name: string): SeriesMeta {
  const m = SERIES_META[name];
  if (m) return m;
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const fallback = ['#6a5acd','#008b8b','#d2691e','#556b2f','#4682b4','#9acd32','#ff8c00','#9932cc','#5f9ea0','#c71585'][h % 10]!;
  return { color: fallback, desc: 'Metric.', cat: 'Other' };
}

const ALWAYS_ON_SERIES = new Set(SERIES_ORDER);
const LANE_HEIGHT = 18; const LANE_GAP = 6;
const MARGIN = { top: 24, right: 16, bottom: 28, left: 168 };
const MAX_LANES = 50;
interface SeriesLane { name: string; entries: HistorianEntry[]; on: boolean; }

interface Props {
  logs: ParsedLog[];
  timeZone: string;
  tab: TabConfig;
  domain: { min: number; max: number } | null;
  onDomainChange: (d: { min: number; max: number }) => void;
  domainKey: string;
  regexp: string;
  showRateOfChange: boolean;
  showBars: boolean;
}

export function Timeline({ logs, timeZone, tab, domain, onDomainChange, domainKey, regexp, showRateOfChange, showBars }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState<SeriesLane[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [hoverLane, setHoverLane] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);

  const allEntries = useMemo(() => logs.flatMap(l => l.entries), [logs]);

  // Tab filtering: restrict entries to tab's barOrder/logSources
  const tabEntries = useMemo(() => {
    if (tab.id === 'custom' && tab.barOrder.length === 0) {
      // Custom starts empty — show nothing until user adds via toolbar (future); for now show all
      return allEntries;
    }
    if (tab.barOrder.length === 0 && tab.logSources.length === 0) return allEntries;
    const allowed = new Set(tab.barOrder);
    const allowedSources = new Set(tab.logSources);
    const hiddenSources = new Set(tab.logSourcesHidden);
    return allEntries.filter(e => {
      if (hiddenSources.has(e.source)) return false;
      if (allowedSources.size > 0) {
        // Event Log tab: only Event Log source; but allow barOrder metrics even from other sources (AM_*)
        if (allowedSources.has(e.source)) return true;
        if (allowed.has(e.seriesName)) return true;
        return false;
      }
      if (allowed.size > 0) return allowed.has(e.seriesName) || e.seriesName === LEVEL_SERIES;
      return true;
    });
  }, [allEntries, tab]);

  const bounds = useMemo(() => {
    let min = Infinity; let max = -Infinity;
    for (const l of logs) {
      const s = l.startMs && l.startMs > 0 ? l.startMs : l.extent.min;
      if (s > 0 && s < min) min = s;
      if (l.extent.max > max) max = l.extent.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { min: 0, max: 1 };
    const pad = (max - min) * 0.02;
    return { min: min - pad, max: max + pad };
  }, [logs]);

  useEffect(() => {
    const groups = groupBySeries(tabEntries);
    const orderIdx = (name: string) => {
      const i = SERIES_ORDER.indexOf(name);
      return i === -1 ? SERIES_ORDER.length : i;
    };
    const sorted = [...groups.entries()]
      .filter(([name]) => name !== LEVEL_SERIES)
      .sort((a, b) => orderIdx(a[0]) - orderIdx(b[0]) || b[1].length - a[1].length)
      .map(([name, entries]): SeriesLane => ({ name, entries, on: ALWAYS_ON_SERIES.has(name) || tab.id !== 'v2' }));
    // For Custom empty, keep all on
    setLanes(sorted);
  }, [tabEntries, tab.id]);

  // Regexp filtering applied at lane entries level
  const regexpFilteredLanes = useMemo(() => {
    if (!regexp || !isValidRegExp(regexp)) return null;
    const re = new RegExp(regexp, 'i');
    return lanes.map(l => ({
      ...l,
      entries: l.entries.filter(e => {
        const v = String(e.value ?? e.opt ?? '');
        return re.test(v) || re.test(e.seriesName);
      }),
    }));
  }, [lanes, regexp]);

  const effectiveLanes = regexpFilteredLanes ?? lanes;
  const levelEntries = useMemo(
    () => tabEntries.filter(e => e.seriesName === LEVEL_SERIES && e.startTime > 0).sort((a, b) => a.startTime - b.startTime),
    [tabEntries],
  );
  const visibleLanes = useMemo(() => effectiveLanes.filter(l => l.on).slice(0, MAX_LANES), [effectiveLanes]);

  const effDomain = domain ?? bounds;

  const legendGroups = useMemo(() => {
    const cats = new Map<string, SeriesLane[]>();
    for (const l of effectiveLanes) {
      const c = metaFor(l.name).cat;
      const arr = cats.get(c) ?? []; arr.push(l); cats.set(c, arr);
    }
    return [...cats.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  }, [effectiveLanes]);

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap || effDomain.max <= effDomain.min) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = wrap.clientWidth;
      const bands = Math.max(visibleLanes.length, 1);
      const height = MARGIN.top + bands * (LANE_HEIGHT + LANE_GAP) + MARGIN.bottom;
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const x = (t: number) => MARGIN.left + ((t - effDomain.min) / (effDomain.max - effDomain.min)) * (width - MARGIN.left - MARGIN.right);
      const t = (px: number) => effDomain.min + ((px - MARGIN.left) / (width - MARGIN.left - MARGIN.right)) * (effDomain.max - effDomain.min);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#93a0b8'; ctx.strokeStyle = '#1e293b';
      for (let i = 0; i <= 5; i++) {
        const px = MARGIN.left + ((width - MARGIN.left - MARGIN.right) * i) / 5;
        const time = t(px);
        ctx.beginPath(); ctx.moveTo(px, MARGIN.top); ctx.lineTo(px, height - MARGIN.bottom); ctx.stroke();
        ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
        ctx.fillText(formatTime(time, timeZone), px, height - 8);
      }
      visibleLanes.forEach((lane, li) => {
        const y = MARGIN.top + li * (LANE_HEIGHT + LANE_GAP);
        const isHL = hoverLane === lane.name || pinned === lane.name;
        if (isHL) { ctx.fillStyle = 'rgba(96,165,250,0.16)'; ctx.fillRect(0, y - 1, MARGIN.left - 2, LANE_HEIGHT + 2); }
        ctx.fillStyle = isHL ? '#e2e8f0' : '#c7d2e8';
        ctx.textAlign = 'right';
        ctx.font = isHL ? '600 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
        ctx.fillText(truncate(lane.name, 22), MARGIN.left - 24, y + LANE_HEIGHT - 5);
        ctx.fillStyle = metaFor(lane.name).color;
        ctx.beginPath(); ctx.arc(MARGIN.left - 10, y + LANE_HEIGHT/2, 5, 0, Math.PI*2); ctx.fill();
        if (!showBars) return;
        ctx.fillStyle = metaFor(lane.name).color;
        ctx.globalAlpha = showRateOfChange ? 0.35 : (isHL || pinned ? 1 : 0.95);
        for (const e of lane.entries) {
          const x0 = x(e.startTime); const x1 = x(Math.max(e.endTime, e.startTime + 1));
          if (x1 < MARGIN.left || x0 > width - MARGIN.right) continue;
          const w = Math.max(1.5, x1 - x0);
          ctx.fillRect(Math.max(MARGIN.left, x0), y, w, LANE_HEIGHT);
        }
        ctx.globalAlpha = 1;
      });
      if (levelEntries.length > 1 && !showRateOfChange) {
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.6; ctx.beginPath(); let started = false;
        for (const e of levelEntries) {
          const px = x(e.startTime);
          if (px < MARGIN.left - 4 || px > width - MARGIN.right + 4) { started = false; continue; }
          const py = MARGIN.top + (100 - clamp(Number(e.value), 0, 100)) * 0.01 * (bands * (LANE_HEIGHT + LANE_GAP));
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke(); ctx.lineWidth = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(wrap);
    return () => ro.disconnect();
  }, [visibleLanes, levelEntries, effDomain, timeZone, hoverLane, pinned, showBars, showRateOfChange]);

  const xToTime = (clientX: number): { time: number; px: number } => {
    const canvas = canvasRef.current; const rect = canvas?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
    const time = effDomain.min + ((px - MARGIN.left) / width) * (effDomain.max - effDomain.min);
    return { time, px };
  };
  const laneAtY = (clientY: number): string | null => {
    const top = canvasRef.current?.getBoundingClientRect().top ?? 0;
    const y = clientY - top - MARGIN.top;
    const idx = Math.floor(y / (LANE_HEIGHT + LANE_GAP));
    if (idx < 0 || idx >= visibleLanes.length) return null;
    const lane = visibleLanes[idx]; return lane ? lane.name : null;
  };

  if (allEntries.length === 0) return null;

  return (
    <section className="timeline-card" id="timeline">
      <div className="timeline-wrap" ref={wrapRef} style={{ marginTop: 12 }}>
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          onWheel={e => {
            e.preventDefault();
            const { time } = xToTime(e.clientX);
            const factor = e.deltaY < 0 ? 0.8 : 1.25;
            let min = time - (time - effDomain.min) * factor;
            let max = time + (effDomain.max - time) * factor;
            if (max - min > (bounds.max - bounds.min) * 1.02) { min = bounds.min; max = bounds.max; }
            onDomainChange({ min, max });
          }}
          onMouseDown={e => { dragRef.current = { x: e.clientX, min: effDomain.min, max: effDomain.max }; }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; setHover(null); setHoverLane(null); }}
          onClick={e => {
            const lane = laneAtY(e.clientY);
            if (lane) setPinned(p => p === lane ? null : lane);
          }}
          onMouseMove={e => {
            const drag = dragRef.current;
            if (drag) {
              const rect = canvasRef.current?.getBoundingClientRect();
              const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
              const dx = e.clientX - drag.x;
              const shift = (dx / width) * (drag.max - drag.min);
              onDomainChange({ min: drag.min - shift, max: drag.max - shift });
              setHover(null); setHoverLane(null); return;
            }
            const laneName = laneAtY(e.clientY);
            setHoverLane(laneName);
            const { time, px } = xToTime(e.clientX);
            if (px < MARGIN.left) { setHover(null); return; }
            let best: HistorianEntry | null = null;
            const searchLanes: SeriesLane[] = laneName ? visibleLanes.filter(l => l.name === laneName) : visibleLanes;
            const pools: SeriesLane[][] = laneName ? [searchLanes, visibleLanes] : [searchLanes];
            for (const pool of pools) {
              for (const lane2 of pool) {
                const es = lane2.entries as unknown as HistorianEntry[];
                for (const ent of es) {
                  if (time >= (ent as HistorianEntry).startTime - 2000 && time <= (ent as HistorianEntry).endTime + 2000) {
                    if (!best || Math.abs((ent as HistorianEntry).startTime - time) < Math.abs(best.startTime - time)) best = ent as HistorianEntry;
                  }
                }
              }
              if (best) break;
            }
            if (best) {
              const rectY = e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0);
              const m = metaFor((best as HistorianEntry).seriesName);
              setHover({
                x: px, y: rectY,
                text: [
                  `${(best as HistorianEntry).seriesName} — ${m.desc}`,
                  (best as HistorianEntry).value !== '' ? `value: ${String((best as HistorianEntry).value)}` : '',
                  (best as HistorianEntry).opt ? `detail: ${(best as HistorianEntry).opt}` : '',
                  `${formatTime((best as HistorianEntry).startTime, timeZone)} → ${formatTime((best as HistorianEntry).endTime, timeZone)} (${formatDuration(Math.max(0, (best as HistorianEntry).endTime - (best as HistorianEntry).startTime))})`,
                  (best as HistorianEntry).uid !== null ? `uid ${(best as HistorianEntry).uid}` : '',
                ].filter(Boolean),
              });
            } else setHover(null);
          }}
        />
        {hover && (
          <div className="timeline-tooltip" style={{ left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 300), top: hover.y + 16 }}>
            {hover.text.map((t, i) => (
              <div key={i} style={i===0 ? {fontWeight:700, color: metaFor(hover.text[0]?.split(' — ')[0] ?? '').color} : undefined}>{t}</div>
            ))}
          </div>
        )}
      </div>
      {pinned && <p className="hint" style={{ margin: '6px 0 0' }}>Pinned: <strong>{pinned}</strong> — click again to unpin. {domainKey !== 'Default' ? `Domain: ${domainKey}` : ''}</p>}
      {regexp && <p className="hint" style={{ margin: '4px 0 0' }}>Regexp: <code>{regexp}</code> {regexpFilteredLanes ? `· ${visibleLanes.reduce((n,l)=>n+l.entries.length,0)} matches` : '· invalid'}</p>}

      <h4 style={{marginTop:16}}>Color key — what each lane means <span className="chip">{effectiveLanes.length} series</span></h4>
      <p className="hint">Click the swatch or bar to pin/highlight. Click swatch row to toggle.</p>
      {legendGroups.map(([cat, group]) => (
        <div key={cat} style={{marginBottom:10}}>
          <div className="detail-title" style={{margin:'10px 0 4px'}}>{cat}</div>
          <table className="data-table legend-table">
            <thead><tr><th style={{width:36}}></th><th>Series</th><th>What it is</th><th style={{width:70}}>Events</th><th style={{width:56}}>Show</th></tr></thead>
            <tbody>
              {group.sort((a,b) => a.name.localeCompare(b.name)).map(l => {
                const meta = metaFor(l.name);
                const on = l.on;
                const isPinned = pinned === l.name;
                return (
                  <tr key={l.name} className={on ? (isPinned ? 'row-selected' : undefined) : 'row-muted'} title={meta.desc}>
                    <td><span className="legend-swatch" style={{background: meta.color, cursor:'pointer', outline: isPinned ? '2px solid #60a5fa' : undefined}} onClick={() => setPinned(p => p===l.name?null:l.name)} /></td>
                    <td style={{fontWeight:600, color: on ? 'inherit' : '#93a0b8', cursor:'pointer'}} onClick={() => setPinned(p => p===l.name?null:l.name)}>{l.name}</td>
                    <td className="hint" style={{fontStyle:'normal', color:'#c7d2e8'}}>{meta.desc}</td>
                    <td className="count">{l.entries.length}</td>
                    <td><input type="checkbox" checked={on} onChange={() => setLanes(prev => prev.map(p => p.name===l.name ? {...p,on:!p.on}:p))} title={on ? 'Hide lane' : 'Show lane'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      <details className="series-menu" style={{marginTop:12}}>
        <summary>Quick toggles ({effectiveLanes.filter(l => l.on).length}/{effectiveLanes.length} shown)</summary>
        <div className="series-grid">
          {effectiveLanes.map(l => (
            <label key={l.name} className="check-row" title={metaFor(l.name).desc}>
              <span className="legend-swatch legend-swatch-sm" style={{background: metaFor(l.name).color, cursor:'pointer'}} onClick={() => setPinned(p => p===l.name?null:l.name)} />
              <input type="checkbox" checked={l.on} onChange={() => setLanes(prev => prev.map(p => (p.name === l.name ? { ...p, on: !p.on } : p)))} />
              {l.name} <span className="count">({l.entries.length})</span>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function truncate(s: string, n: number): string { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
