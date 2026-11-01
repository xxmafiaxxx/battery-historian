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

/**
 * Timeline: a canvas-rendered, pan/zoom-able event chart over the historian
 * CSV logs. Each visible series gets a lane; the battery level series renders
 * as a line overlay. Wheel zooms around the cursor, drag pans, hover shows a
 * tooltip for the nearest event.
 *
 * This is the modernized successor of the d3/Closure bars.js + level.js
 * rendering: the same data contract, rendered directly to canvas for smooth
 * zooming with tens of thousands of events.
 */

const LEVEL_SERIES = Metric.BATTERY_LEVEL;

/**
 * Legacy-timeline lane order (top to bottom). Series not listed here are
 * appended, sorted by event count. The legacy UI also showed a few derived
 * groups (Kernel only uptime, Userspace wakelocks, Long Wakelocks) computed
 * from raw metrics; those are not raw CSV series, so unknown names no-op.
 */
const SERIES_ORDER = [
  'CPU running',
  'App Processor wakeup',
  'Kernel only uptime',
  'Userspace wakelocks',
  'Wakelock In',
  'Wakelock Out',
  'Long Wakelocks',
  'Screen',
  'Top app',
  'Top Application',
  'Active process',
  'Crashes (logcat)',
  'AM Low Memory / ANR',
  'Doze',
  'JobScheduler Job',
  'Sync App',
  'SyncManager',
  'GPS',
  'GPS is on',
  'BLE scanning',
  'Phone scanning',
  'Phone state',
  'Network connectivity',
  'Mobile radio active',
  'Mobile signal strength',
  'Mobile network type',
  'Wifi full lock',
  'Wifi scan',
  'Wifi supplicant',
  'Wifi radio',
  'Wifi signal strength',
  'Wifi running',
  'Wifi on',
  'Audio',
  'Video',
  'Camera',
  'Flashlight on',
  'Sensor',
  'Battery Saver',
  'Plug',
  'Charging status',
  'Foreground process',
  'Coulomb charge',
  'Brightness',
  'Voltage',
  'Temperature',
];

/** Series whose lanes are on by default (everything in this set). */
const ALWAYS_ON_SERIES = new Set(SERIES_ORDER);

const LANE_HEIGHT = 18;
const LANE_GAP = 6;
const MARGIN = { top: 24, right: 16, bottom: 28, left: 150 };
/** Hard cap on rendered lanes; everything else stays available in the menu. */
const MAX_LANES = 44;

interface SeriesLane {
  name: string;
  entries: HistorianEntry[];
  on: boolean;
}

export function Timeline({ logs, timeZone }: { logs: ParsedLog[]; timeZone: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState<SeriesLane[]>([]);
  const [domain, setDomain] = useState<{ min: number; max: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const dragRef = useRef<{ x: number; min: number; max: number } | null>(null);

  const allEntries = useMemo(() => logs.flatMap(l => l.entries), [logs]);

  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const l of logs) {
      // A zero startMs from the backend means "not provided"; use the parsed extent.
      const s = l.startMs && l.startMs > 0 ? l.startMs : l.extent.min;
      if (s > 0 && s < min) min = s;
      if (l.extent.max > max) max = l.extent.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return { min: 0, max: 1 };
    }
    // Pad 2% on each side so first/last events aren't glued to the edges.
    const pad = (max - min) * 0.02;
    return { min: min - pad, max: max + pad };
  }, [logs]);

  // Build lanes once per parsed log set.
  useEffect(() => {
    const groups = groupBySeries(allEntries);
    const orderIdx = (name: string): number => {
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

  const visibleLanes = useMemo(() => {
    const on = lanes.filter(l => l.on);
    // Keep the lane count sane; the off-by-default tail is available in the menu.
    return on.slice(0, MAX_LANES);
  }, [lanes]);

  // Canvas draw effect.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !domain || domain.max <= domain.min) {
      return;
    }
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = wrap.clientWidth;
      // Always reserve at least one band so the battery level line has space
      // even when every bar series is toggled off.
      const bands = Math.max(visibleLanes.length, 1);
      const height = MARGIN.top + bands * (LANE_HEIGHT + LANE_GAP) + MARGIN.bottom;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const x = (t: number) => MARGIN.left + ((t - domain.min) / (domain.max - domain.min)) * (width - MARGIN.left - MARGIN.right);
      const t = (px: number) => domain.min + ((px - MARGIN.left) / (width - MARGIN.left - MARGIN.right)) * (domain.max - domain.min);

      // Grid + time axis (5 ticks).
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#8a93a5';
      ctx.strokeStyle = '#e8ebf0';
      for (let i = 0; i <= 5; i++) {
        const px = MARGIN.left + ((width - MARGIN.left - MARGIN.right) * i) / 5;
        const time = t(px);
        ctx.beginPath();
        ctx.moveTo(px, MARGIN.top);
        ctx.lineTo(px, height - MARGIN.bottom);
        ctx.stroke();
        ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center';
        ctx.fillText(formatTime(time, timeZone), px, height - 8);
      }

      // Series lanes.
      visibleLanes.forEach((lane, li) => {
        const y = MARGIN.top + li * (LANE_HEIGHT + LANE_GAP);
        ctx.fillStyle = '#5b6472';
        ctx.textAlign = 'right';
        ctx.fillText(truncate(lane.name, 20), MARGIN.left - 8, y + LANE_HEIGHT - 5);
        ctx.fillStyle = laneColor(li);
        for (const e of lane.entries) {
          const x0 = x(e.startTime);
          const x1 = x(Math.max(e.endTime, e.startTime + 1));
          if (x1 < MARGIN.left || x0 > width - MARGIN.right) continue;
          const w = Math.max(1.5, x1 - x0);
          ctx.fillRect(Math.max(MARGIN.left, x0), y, w, LANE_HEIGHT);
        }
      });

      // Battery level line overlay.
      if (levelEntries.length > 1) {
        ctx.strokeStyle = '#265a9e';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        let started = false;
        for (const e of levelEntries) {
          const px = x(e.startTime);
          if (px < MARGIN.left - 4 || px > width - MARGIN.right + 4) {
            started = false;
            continue;
          }
          const py = MARGIN.top + (100 - clamp(Number(e.value), 0, 100)) * 0.01 * (bands * (LANE_HEIGHT + LANE_GAP));
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [visibleLanes, levelEntries, domain, timeZone]);

  const xToTime = (clientX: number): { time: number; px: number } => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0);
    const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
    const time = domain!.min + ((px - MARGIN.left) / width) * (domain!.max - domain!.min);
    return { time, px };
  };

  if (allEntries.length === 0) {
    return null;
  }

  return (
    <section className="card timeline-card">
      <h3>
        Timeline <span className="chip">{allEntries.length} events</span>
      </h3>
      <div className="timeline-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          onWheel={e => {
            e.preventDefault();
            if (!domain) return;
            const { time } = xToTime(e.clientX);
            const factor = e.deltaY < 0 ? 0.8 : 1.25;
            let min = time - (time - domain.min) * factor;
            let max = time + (domain.max - time) * factor;
            if (max - min > (bounds.max - bounds.min) * 1.02) {
              min = bounds.min;
              max = bounds.max;
            }
            setDomain({ min, max });
          }}
          onMouseDown={e => {
            if (!domain) return;
            dragRef.current = { x: e.clientX, min: domain.min, max: domain.max };
          }}
          onMouseUp={() => {
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            dragRef.current = null;
            setHover(null);
          }}
          onMouseMove={e => {
            if (!domain) return;
            const drag = dragRef.current;
            if (drag) {
              const rect = canvasRef.current?.getBoundingClientRect();
              const width = (rect?.width ?? 1) - MARGIN.left - MARGIN.right;
              const dx = e.clientX - drag.x;
              const shift = (dx / width) * (drag.max - drag.min);
              setDomain({ min: drag.min - shift, max: drag.max - shift });
              setHover(null);
              return;
            }
            const { time, px } = xToTime(e.clientX);
            if (px < MARGIN.left) {
              setHover(null);
              return;
            }
            // Nearest entry across visible lanes for the tooltip.
            let best: HistorianEntry | null = null;
            for (const lane of visibleLanes) {
              for (const entry of lane.entries) {
                if (time >= entry.startTime - 2000 && time <= entry.endTime + 2000) {
                  if (!best || entry.startTime > best.startTime) best = entry;
                }
              }
            }
            if (best) {
              const rectY = e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0);
              setHover({
                x: px,
                y: rectY,
                text: [
                  best.seriesName,
                  best.value !== '' ? `value: ${String(best.value)}` : '',
                  `${formatTime(best.startTime, timeZone)} → ${formatTime(best.endTime, timeZone)} (${formatDuration(Math.max(0, best.endTime - best.startTime))})`,
                  best.uid !== null ? `uid ${best.uid}` : '',
                ].filter(Boolean),
              });
            } else {
              setHover(null);
            }
          }}
        />
        {hover && (
          <div className="timeline-tooltip" style={{ left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 260), top: hover.y + 16 }}>
            {hover.text.map((t, i) => (
              <div key={i}>{t}</div>
            ))}
          </div>
        )}
      </div>

      {levelEntries.length > 1 && <p className="hint">Blue line: battery level (0–100%). Scroll to zoom, drag to pan.</p>}

      <details className="series-menu">
        <summary>Series ({lanes.filter(l => l.on).length}/{lanes.length} shown)</summary>
        <div className="series-grid">
          {lanes.map(l => (
            <label key={l.name} className="check-row">
              <input
                type="checkbox"
                checked={l.on}
                onChange={() =>
                  setLanes(prev => prev.map(p => (p.name === l.name ? { ...p, on: !p.on } : p)))
                }
              />
              {l.name} <span className="count">({l.entries.length})</span>
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const LANE_COLORS = ['#265a9e', '#2e8b57', '#b8860b', '#8b4513', '#6a5acd', '#c71585', '#008b8b', '#d2691e', '#556b2f', '#483d8b', '#8fbc8f', '#cd853f', '#4682b4', '#9acd32', '#bc8f8f', '#20b2aa', '#daa520', '#7b68ee', '#3cb371', '#b22222', '#5f9ea0', '#ff8c00', '#9932cc', '#2f4f4f'];

function laneColor(i: number): string {
  const c = LANE_COLORS[i % LANE_COLORS.length];
  return c !== undefined ? c : '#265a9e';
}
