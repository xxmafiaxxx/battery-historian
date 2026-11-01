import { useMemo, useRef, useState } from 'react';
import type { HistorianEntry } from '../data/historianCsv';
import { formatTime } from '../data/time';
import { generateDerivative, type LevelPoint } from '../data/levelUtils';

interface Props {
  entries: HistorianEntry[];
  timeZone: string;
  domain: { min: number; max: number } | null;
  rateOfChange: boolean;
  onDomainChange: (d: { min: number; max: number }) => void;
}

export function LevelChart({ entries, timeZone, domain, rateOfChange, onDomainChange }: Props) {
  const wrapRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<{ x: number; t: number; v: number } | null>(null);

  const W = 900;
  const H = 220;
  const PAD = { top: 12, right: 14, bottom: 26, left: 40 };

  const model = useMemo(() => {
    let pts: LevelPoint[] = entries
      .filter(e => e.startTime > 0)
      .map(e => ({ t: e.startTime, v: Number(e.value) }))
      .filter(p => Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2) return null;
    if (rateOfChange) {
      pts = generateDerivative(pts);
      if (pts.length < 2) return null;
      const maxAbs = Math.max(...pts.map(p => Math.abs(p.v)), 1);
      const vLo = -maxAbs;
      const vHi = maxAbs;
      const tMin = pts[0]!.t;
      const tMax = pts[pts.length - 1]!.t;
      const effMin = domain ? domain.min : tMin;
      const effMax = domain ? domain.max : tMax;
      const x = (t: number) => PAD.left + ((t - effMin) / Math.max(1, effMax - effMin)) * (W - PAD.left - PAD.right);
      const y = (v: number) => PAD.top + (1 - (v - vLo) / Math.max(1, vHi - vLo)) * (H - PAD.top - PAD.bottom);
      const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
      const area = `${line} L${x(tMax).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(tMin).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;
      return { pts, tMin, tMax, vLo, vHi, x, y, line, area, isROC: true as const };
    }
    const tMinD = domain ? domain.min : pts[0]!.t;
    const tMaxD = domain ? domain.max : pts[pts.length - 1]!.t;
    const vLo = Math.max(0, Math.min(...pts.map(p => p.v)) - 2);
    const vHi = Math.min(100, Math.max(...pts.map(p => p.v)) + 2);
    const x = (t: number) => PAD.left + ((t - tMinD) / Math.max(1, tMaxD - tMinD)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - vLo) / Math.max(1, vHi - vLo)) * (H - PAD.top - PAD.bottom);
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(tMaxD).toFixed(1)},${(H - PAD.bottom).toFixed(1)} L${x(tMinD).toFixed(1)},${(H - PAD.bottom).toFixed(1)} Z`;
    return { pts, tMin: tMinD, tMax: tMaxD, vLo, vHi, x, y, line, area, isROC: false as const };
  }, [entries, domain, rateOfChange]);

  if (!model) return null;

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.left || px > W - PAD.right) { setCursor(null); return; }
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const t = model.tMin + frac * (model.tMax - model.tMin);
    let best = model.pts[0]!;
    for (const p of model.pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setCursor({ x: model.x(best.t), t: best.t, v: best.v });
  };

  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault();
    if (!domain) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
    const time = model.tMin + frac * (model.tMax - model.tMin);
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    let min = time - (time - domain.min) * factor;
    let max = time + (domain.max - time) * factor;
    onDomainChange({ min, max });
  };

  const gridLevels = model.isROC
    ? [model.vLo, 0, model.vHi].filter(v => v >= model.vLo && v <= model.vHi)
    : [0, 25, 50, 75, 100].filter(v => v >= model.vLo && v <= model.vHi);

  return (
    <div className="level-chart-wrap">
      <svg ref={wrapRef} viewBox={`0 0 ${W} ${H}`} className="level-chart" onMouseMove={onMove} onMouseLeave={() => setCursor(null)} onWheel={onWheel}>
        <defs>
          <linearGradient id="lvlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridLevels.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={model.y(v)} y2={model.y(v)} stroke="#232c42" strokeWidth={1} />
            <text x={PAD.left - 6} y={model.y(v) + 3} textAnchor="end" className="chart-tick">{model.isROC ? `${v.toFixed(1)}` : v}</text>
          </g>
        ))}
        {[0,1,2,3,4].map(i => {
          const t = model.tMin + ((model.tMax - model.tMin) * i) / 4;
          return <text key={i} x={model.x(t)} y={H - 6} textAnchor={i===0?'start':i===4?'end':'middle'} className="chart-tick">{formatTime(t, timeZone)}</text>;
        })}
        <path d={model.area} fill="url(#lvlFill)" />
        <path d={model.line} fill="none" stroke={model.isROC ? '#fbbf24' : '#4ade80'} strokeWidth={2} />
        {cursor && (
          <g>
            <line x1={cursor.x} x2={cursor.x} y1={PAD.top} y2={H - PAD.bottom} stroke="#93a0b8" strokeDasharray="3 3" />
            <circle cx={cursor.x} cy={model.y(cursor.v)} r={4} fill={model.isROC ? '#fbbf24' : '#4ade80'} stroke="#0b1020" strokeWidth={2} />
          </g>
        )}
      </svg>
      {cursor && (
        <div className="level-chart-tip">
          {formatTime(cursor.t, timeZone)} · {model.isROC ? `${cursor.v.toFixed(1)}%/hr` : `${cursor.v}%`} {model.isROC ? '(rate of change)' : ''}
        </div>
      )}
    </div>
  );
}
