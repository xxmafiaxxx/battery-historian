import { useState } from 'react';
import type { PowerUseItem } from '../api/types';
import { formatMah } from '../data/time';

/** Enum values of BatteryStats_System_PowerUseItem_Name (pb/batterystats_proto). */
const ITEM_META: Record<number, { label: string; color: string }> = {
  0: { label: 'default', color: '#64748b' },
  1: { label: 'Idle', color: '#64748b' },
  2: { label: 'Cell radio', color: '#f97316' },
  3: { label: 'Phone', color: '#fb923c' },
  4: { label: 'Wi-Fi', color: '#38bdf8' },
  5: { label: 'Bluetooth', color: '#22d3ee' },
  6: { label: 'Screen', color: '#60a5fa' },
  7: { label: 'Apps', color: '#4ade80' },
  8: { label: 'User', color: '#a78bfa' },
  9: { label: 'Unaccounted', color: '#fbbf24' },
  10: { label: 'Over-counted', color: '#f87171' },
  11: { label: 'Flashlight', color: '#fde047' },
};

/**
 * Interactive horizontal share bars for the system power-use breakdown.
 * Hover a row for exact values; the bars animate in on mount.
 */
export function PowerChart({ items }: { items: PowerUseItem[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const visible = items
    .filter(i => !i.should_hide && (i.computed_power_mah ?? 0) > 0)
    .sort((a, b) => (b.computed_power_mah ?? 0) - (a.computed_power_mah ?? 0));
  if (visible.length === 0) {
    return null;
  }
  const total = visible.reduce((n, i) => n + (i.computed_power_mah ?? 0), 0);
  if (total <= 0) {
    return null;
  }

  return (
    <div className="power-chart" role="img" aria-label="Power use share by component">
      {visible.map((it, i) => {
        const mah = it.computed_power_mah ?? 0;
        const pct = (mah / total) * 100;
        const meta = ITEM_META[it.name ?? 0] ?? { label: `unknown (${it.name})`, color: '#94a3b8' };
        const label = meta.label === 'Apps' && it.uid ? `uid ${it.uid}` : meta.label;
        return (
          <div
            key={i}
            className={`power-row${hover === i ? ' power-row-hover' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="power-label">{label}</span>
            <span className="power-track">
              <span
                className="power-bar"
                style={{
                  width: `${Math.max(pct, 1.2)}%`,
                  background: `linear-gradient(90deg, ${meta.color}cc, ${meta.color})`,
                }}
              />
            </span>
            <span className="power-value">{formatMah(mah)}</span>
            <span className="power-pct">{pct.toFixed(1)}%</span>
            {hover === i && (
              <span className="power-tip">
                {label}: {formatMah(mah)} · {pct.toFixed(1)}% of {formatMah(total)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
