import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistorianEntry } from '../data/historianCsv';
import { Metric, groupBySeries } from '../data/historianCsv';
import { formatDuration, formatTime } from '../data/time';

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

// Semantic color + description for every legacy timeline series.
// Colors are chosen to BE the meaning: red = power/cost, blue = cpu,
// green = location/sensor, amber = warning. Fallback is a hashed palette
// for never-seen custom metrics.
type SeriesMeta = { color: string; desc: string; cat: string };
const SERIES_META: Record<string, SeriesMeta> = {
  'Battery Level': { color: '#4ade80', desc: 'Battery charge 0–100%. Thin green overlay line across the whole timeline.', cat: 'Battery' },
  'CPU running': { color: '#2563eb', desc: 'CPU awake. When absent the device is in deep sleep.', cat: 'CPU / Wakelocks' },
  'Kernel only uptime': { color: '#dc2626', desc: 'CPU awake but no userspace wakelock held — kernel work only.', cat: 'CPU / Wakelocks' },
  'Userspace wakelocks': { color: '#f97316', desc: 'At least one app wakelock held — the usual reason CPU stays awake.', cat: 'CPU / Wakelocks' },
  'Wakelock In': { color: '#fb923c', desc: 'Per-app partial wakelocks — bars stack by UID when many apps hold one.', cat: 'CPU / Wakelocks' },
  'Wakelock Out': { color: '#fdba74', desc: 'Wakelocks aggregated outward (the old "out" bucket).', cat: 'CPU / Wakelocks' },
  'Long Wakelocks': { color: '#991b1b', desc: 'Wakelocks that lasted unusually long — battery risk.', cat: 'CPU / Wakelocks' },
  'App Processor wakeup': { color: '#7c3aed', desc: 'AP wakeup reason that woke the Application Processor.', cat: 'CPU / Wakelocks' },
  'Screen': { color: '#ef4444', desc: 'Screen ON. Single biggest power draw while on.', cat: 'Display' },
  'Brightness': { color: '#facc15', desc: 'Screen brightness level (darker → brighter).', cat: 'Display' },
  'Top app': { color: '#a78bfa', desc: 'Foreground app (package in the value).', cat: 'Apps' },
  'Top Application': { color: '#a78bfa', desc: 'Foreground app (alias of Top app).', cat: 'Apps' },
  'Foreground process': { color: '#8b5cf6', desc: 'Process with foreground priority.', cat: 'Apps' },
  'Active process': { color: '#06b6d4', desc: 'Any active app process.', cat: 'Apps' },
  'Crashes (logcat)': { color: '#000000', desc: 'App or system crash (red in legacy).', cat: 'Health' },
  'AM Low Memory / ANR': { color: '#f97316', desc: 'Low-memory kill or ANR — system under pressure.', cat: 'Health' },
  'Doze': { color: '#475569', desc: 'Doze / light-doze device idle mode.', cat: 'Power saving' },
  'Battery Saver': { color: '#eab308', desc: 'Battery Saver active.', cat: 'Power saving' },
  'JobScheduler Job': { color: '#0ea5e9', desc: 'JobScheduler jobs running (deferred work).', cat: 'System' },
  'Sync App': { color: '#14b8a6', desc: 'Account sync running for an app.', cat: 'System' },
  'SyncManager': { color: '#14b8a6', desc: 'SyncManager activity.', cat: 'System' },
  'GPS': { color: '#10b981', desc: 'GPS hardware on.', cat: 'Location / Radio' },
  'GPS is on': { color: '#10b981', desc: 'GPS on (value = requesting package).', cat: 'Location / Radio' },
  'BLE scanning': { color: '#22d3ee', desc: 'Bluetooth LE scan active.', cat: 'Location / Radio' },
  'Phone scanning': { color: '#6366f1', desc: 'Cell radio scanning.', cat: 'Location / Radio' },
  'Phone state': { color: '#6366f1', desc: 'Cell state: in / out / off.', cat: 'Location / Radio' },
  'Network connectivity': { color: '#3b82f6', desc: 'Active network transport (WIFI / MOBILE / NONE).', cat: 'Connectivity' },
  'Mobile radio active': { color: '#ec4899', desc: 'Mobile radio powered and transferring.', cat: 'Connectivity' },
  'Mobile signal strength': { color: '#f43f5e', desc: 'Cell signal: none → great (white → red → green).', cat: 'Connectivity' },
  'Mobile network type': { color: '#8b5cf6', desc: 'Radio tech: lte / hspa / edge …', cat: 'Connectivity' },
  'Wifi full lock': { color: '#0ea5e9', desc: 'WIFI_MODE_FULL held.', cat: 'Wi-Fi' },
  'Wifi scan': { color: '#38bdf8', desc: 'Wi-Fi scan active.', cat: 'Wi-Fi' },
  'Wifi supplicant': { color: '#0284c7', desc: 'wpa_supplicant state (SCANNING / COMPLETED …).', cat: 'Wi-Fi' },
  'Wifi radio': { color: '#0ea5e9', desc: 'Wi-Fi radio on.', cat: 'Wi-Fi' },
  'Wifi signal strength': { color: '#f43f5e', desc: 'Wi-Fi signal: none → great.', cat: 'Wi-Fi' },
  'Wifi running': { color: '#0ea5e9', desc: 'Wi-Fi stack running.', cat: 'Wi-Fi' },
  'Wifi on': { color: '#0ea5e9', desc: 'Wi-Fi enabled.', cat: 'Wi-Fi' },
  'Audio': { color: '#f59e0b', desc: 'Audio playback active.', cat: 'Sensors' },
  'Video': { color: '#f59e0b', desc: 'Video playback.', cat: 'Sensors' },
  'Camera': { color: '#f59e0b', desc: 'Camera active.', cat: 'Sensors' },
  'Flashlight on': { color: '#fde047', desc: 'Flashlight/torch on.', cat: 'Sensors' },
  'Sensor': { color: '#84cc16', desc: 'Sensor active (number in value).', cat: 'Sensors' },
  'Plug': { color: '#22c55e', desc: 'Charger: ac / usb / wireless / none.', cat: 'Battery' },
  'Charging status': { color: '#16a34a', desc: 'Charging / discharging / full / not charging.', cat: 'Battery' },
  'Coulomb charge': { color: '#15803d', desc: 'Coulomb counter (mAh).', cat: 'Battery' },
  'Voltage': { color: '#16a34a', desc: 'Battery voltage (mV).', cat: 'Battery' },
  'Temperature': { color: '#dc2626', desc: 'Battery temperature (white → red → black by heat).', cat: 'Battery' },
};

function metaFor(name: string): SeriesMeta {
  const m = SERIES_META[name];
  if (m) return m;
  // Stable hash fallback so custom/unknown series still get a distinct color.
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const fallback = ['#6a5acd','#008b8b','#d2691e','#556b2f','#4682b4','#9acd32','#ff8c00','#9932cc','#5f9ea0','#c71585'][h % 10]!;
  return { color: fallback, desc: 'Metric from the bugreport — no built-in description.', cat: 'Other' };
}

const ALWAYS_ON_SERIES = new Set(SERIES_ORDER);
const LANE_HEIGHT = 18; const LANE_GAP = 6;
const MARGIN = { top: 24, right: 16, bottom: 28, left: 168 };
const MAX_LANES = 50;
interface SeriesLane { name: string; entries: HistorianEntry[]; on: boolean; }

export function Timeline({ logs, timeZone }: { logs: ParsedLog[]; timeZone: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState<SeriesLane[]>([]);
  const [domain, setDomain] = useState<{ min: number; max: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const [hoverLane, setHoverLane] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);

  const allEntries = useMemo(() => logs.flatMap(l => l.entries), [logs]);
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
    const groups = groupBySeries(allEntries);
    const orderIdx = (name: string) => {
      const i = SERIES_ORDER.indexOf(name);
      return i === -1 ? SERIES_ORDER.length : i;
    };
    const sorted = [...groups.entries()]
      .filter(([name]) => name !== LEVEL_SERIES)
      .sort((a, b) => orderIdx(a[0]) - orderIdx(b[0]) || b[1].length - a[1].length)
      .map(([name, entries]): SeriesLane => ({ name, entries, on: ALWAYS_ON_SERIES.has(name) }));
    setLanes(sorted);
    setDomain(bounds);
  }, [allEntries, bounds]);

  const levelEntries = useMemo(
    () => allEntries.filter(e => e.seriesName === LEVEL_SERIES && e.startTime > 0).sort((a, b) => a.startTime - b.startTime),
    [allEntries],
  );
  const visibleLanes = useMemo(() => lanes.filter(l => l.on).slice(0, MAX_LANES), [lanes]);

  // legend grouped by category
  const legendGroups = useMemo(() => {
    const cats = new Map<string, SeriesLane[]>();
    for (const l of lanes) {
      const c = metaFor(l.name).cat;
      const arr = cats.get(c) ?? []; arr.push(l); cats.set(c, arr);
    }
    return [...cats.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  }, [lanes]);

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap || !domain || domain.max <= domain.min) return;
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
      const x = (t: number) => MARGIN.left + ((t - domain.min) / (domain.max - domain.min)) * (width - MARGIN.left - MARGIN.right);
      const t = (px: number) => domain.min + ((px - MARGIN.left) / (width - MARGIN.left - MARGIN.right)) * (domain.max - domain.min);
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
        const isHL = hoverLane === lane.name;
        // label bg highlight
        if (isHL) { ctx.fillStyle = 'rgba(96,165,250,0.12)'; ctx.fillRect(0, y - 1, MARGIN.left - 2, LANE_HEIGHT + 2); }
        ctx.fillStyle = isHL ? '#e2e8f0' : '#c7d2e8';
        ctx.textAlign = 'right';
        ctx.font = isHL ? '600 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
        ctx.fillText(truncate(lane.name, 22), MARGIN.left - 24, y + LANE_HEIGHT - 5);
        // color dot
        ctx.fillStyle = metaFor(lane.name).color;
        ctx.beginPath(); ctx.arc(MARGIN.left - 10, y + LANE_HEIGHT/2, 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = metaFor(lane.name).color;
        for (const e of lane.entries) {
          const x0 = x(e.startTime); const x1 = x(Math.max(e.endTime, e.startTime + 1));
          if (x1 < MARGIN.left || x0 > width - MARGIN.right) continue;
          const w = Math.max(1.5, x1 - x0);
          ctx.globalAlpha = isHL ? 1 : 0.95;
          ctx.fillRect(Math.max(MARGIN.left, x0), y, w, LANE_HEIGHT);
        }
        ctx.globalAlpha = 1;
      });
      if (levelEntries.length > 1) {
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
  }, [visibleLanes, levelEntries, domain, timeZone, hoverLane]);

  const xToTime = (clientX: number): { time: number; px: number } => {
    const canvas = canvasRef.current; const rect = canvas?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
    const time = domain!.min + ((px - MARGIN.left) / width) * (domain!.max - domain!.min);
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
    <section className="card timeline-card" id="timeline">
      <h3>Timeline <span className="chip">{allEntries.length} events · {visibleLanes.length} lanes</span></h3>
      <details className="legend-help" open>
        <summary>What am I looking at? — and how to use it</summary>
        <p className="hint" style={{margin:'8px 0 6px'}}>
          Each <strong>lane</strong> is one metric over time. A <strong>colored bar</strong> means the metric was active at that time;
          gaps mean idle. The thin <span style={{color:'#4ade80',fontWeight:700}}>green line</span> is battery level (0–100%).
          <strong> Wheel</strong> to zoom around the cursor, <strong>drag</strong> to pan, <strong>hover</strong> a bar for its exact value and duration.
          Toggle lanes below or in the legend table to declutter. Colors ARE the meaning — see the key.
        </p>
      </details>

      <div className="timeline-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          onWheel={e => {
            e.preventDefault(); if (!domain) return;
            const { time } = xToTime(e.clientX);
            const factor = e.deltaY < 0 ? 0.8 : 1.25;
            let min = time - (time - domain.min) * factor;
            let max = time + (domain.max - time) * factor;
            if (max - min > (bounds.max - bounds.min) * 1.02) { min = bounds.min; max = bounds.max; }
            setDomain({ min, max });
          }}
          onMouseDown={e => { if (!domain) return; dragRef.current = { x: e.clientX, min: domain.min, max: domain.max }; }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; setHover(null); setHoverLane(null); }}
          onMouseMove={e => {
            if (!domain) return;
            const drag = dragRef.current;
            if (drag) {
              const rect = canvasRef.current?.getBoundingClientRect();
              const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
              const dx = e.clientX - drag.x;
              const shift = (dx / width) * (drag.max - drag.min);
              setDomain({ min: drag.min - shift, max: drag.max - shift });
              setHover(null); setHoverLane(null); return;
            }
            const laneName = laneAtY(e.clientY);
            setHoverLane(laneName);
            const { time, px } = xToTime(e.clientX);
            if (px < MARGIN.left) { setHover(null); return; }
            let best: HistorianEntry | null = null;
            // Prefer the hovered lane's entries, then fall back to all visible lanes
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
      {levelEntries.length > 1 && <p className="hint">Green line: battery level 0–100%. Scroll to zoom, drag to pan. Hover any bar for what it means.</p>}

      {/* Color schema / legend table */}
      <h4 style={{marginTop:16}}>Color key — what each lane means <span className="chip">{lanes.length} series</span></h4>
      <p className="hint">Color is the identity — the bar and the swatch are the same. Hover a row for the plain-English meaning. Click to show/hide the lane.</p>
      {legendGroups.map(([cat, group]) => (
        <div key={cat} style={{marginBottom:10}}>
          <div className="detail-title" style={{margin:'10px 0 4px'}}>{cat}</div>
          <table className="data-table legend-table">
            <thead><tr><th style={{width:36}}></th><th>Series</th><th>What it is</th><th style={{width:70}}>Events</th><th style={{width:56}}>Show</th></tr></thead>
            <tbody>
              {group.sort((a,b) => a.name.localeCompare(b.name)).map(l => {
                const meta = metaFor(l.name);
                const on = l.on;
                return (
                  <tr key={l.name} className={on ? undefined : 'row-muted'} title={meta.desc}>
                    <td><span className="legend-swatch" style={{background: meta.color}} /></td>
                    <td style={{fontWeight:600, color: on ? 'inherit' : '#93a0b8'}}>{l.name}</td>
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
        <summary>Quick toggles ({lanes.filter(l => l.on).length}/{lanes.length} shown)</summary>
        <div className="series-grid">
          {lanes.map(l => (
            <label key={l.name} className="check-row" title={metaFor(l.name).desc}>
              <span className="legend-swatch legend-swatch-sm" style={{background: metaFor(l.name).color}} />
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
