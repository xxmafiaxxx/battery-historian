import { useMemo, useRef, useState } from 'react';
import type { HistorianEntry } from '../data/historianCsv';
import { formatTime } from '../data/time';

/**
 * Interactive battery-level chart: SVG area chart with a gradient fill and a
 * mouse crosshair showing the exact time + level under the cursor. This is
 * the zoomed-out companion to the full timeline (which shows every event).
 */
export function LevelChart({ entries, timeZone }: { entries: HistorianEntry[]; timeZone: string }) {
  const wrapRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<{ x: number; t: number; v: number } | null>(null);

  const W = 900;
  const H = 220;
  const PAD = { top: 12, right: 14, bottom: 26, left: 40 };

  const model = useMemo(() => {
    const pts = entries
      .filter(e => e.startTime > 0)
      .map(e => ({ t: e.startTime, v: Number(e.value) }))
      .filter(p => Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last || pts.length < 2) {
      return null;
    }
    const tMin = first.t;
    const tMax = last.t;
    const vLo = Math.max(0, Math.min(...pts.map(p => p.v)) - 2);
    const vHi = Math.min(100, Math.max(...pts.map(p => p.v)) + 2);
    const x = (t: number) => PAD.left + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - vLo) / Math.max(1, vHi - vLo)) * (H - PAD.top - PAD.bottom);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(tMax).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(tMin).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;
    return { pts, tMin, tMax, vLo, vHi, x, y, line, area };
  }, [entries]);

  if (!model) {
    return null;
  }

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.left || px > W - PAD.right) {
      setCursor(null);
      return;
    }
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const t = model.tMin + frac * (model.tMax - model.tMin);
    // Nearest sampled point.
    const firstPt = model.pts[0];
    if (!firstPt) return;
    let best = firstPt;
    for (const p of model.pts) {
      if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    }
    setCursor({ x: model.x(best.t), t: best.t, v: best.v });
  };

  const gridLevels = [0, 25, 50, 75, 100].filter(v => v >= model.vLo && v <= model.vHi);
  const ticks = 4;

  return (
    <div className="level-chart-wrap">
      <svg
        ref={wrapRef}
        viewBox={`0 0 ${W} ${H}`}
        className="level-chart"
        onMouseMove={onMove}
        onMouseLeave={() => setCursor(null)}
      >
        <defs>
          <linearGradient id="lvlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridLevels.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={model.y(v)} y2={model.y(v)} stroke="#232c42" strokeWidth={1} />
            <text x={PAD.left - 6} y={model.y(v) + 3} textAnchor="end" className="chart-tick">
              {v}
            </text>
          </g>
        ))}
        {[0, 1, 2, 3, 4].map(i => {
          const t = model.tMin + ((model.tMax - model.tMin) * i) / ticks;
          return (
            <text
              key={i}
              x={model.x(t)}
              y={H - 6}
              textAnchor={i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}
              className="chart-tick"
            >
              {formatTime(t, timeZone)}
            </text>
          );
        })}
        <path d={model.area} fill="url(#lvlFill)" />
        <path d={model.line} fill="none" stroke="#4ade80" strokeWidth={2} />
        {cursor && (
          <g>
            <line x1={cursor.x} x2={cursor.x} y1={PAD.top} y2={H - PAD.bottom} stroke="#93a0b8" strokeDasharray="3 3" />
            <circle cx={cursor.x} cy={model.y(cursor.v)} r={4} fill="#4ade80" stroke="#0b1020" strokeWidth={2} />
          </g>
        )}
      </svg>
      {cursor && (
        <div className="level-chart-tip">
          {formatTime(cursor.t, timeZone)} · {cursor.v}%
        </div>
      )}
    </div>
  );
}
