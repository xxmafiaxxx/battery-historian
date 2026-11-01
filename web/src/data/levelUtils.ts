// Ported from js/utils.js + js/level_data.js + js/metrics.js
export const ROC_SUFFIX = ' (Rate of change)';
const MSECS_IN_HOUR = 3600 * 1000;

export interface LevelPoint { t: number; v: number }

/** Mirrors historian.utils.generateDerivative (utils.js:351) — units: value / hour. */
export function generateDerivative(pts: LevelPoint[]): LevelPoint[] {
  const out: LevelPoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const dy = next.v - cur.v;
    const dx = (next.t - cur.t) / MSECS_IN_HOUR;
    out.push({ t: cur.t, v: dx === 0 ? 0 : dy / dx });
  }
  return out;
}

export function isScreenOffDischargeMetric(name: string): boolean {
  return name.includes('Screen Off Discharge') || name.includes('Discharge') && name.includes('Screen Off');
}

export function isValidRegExp(s: string): boolean {
  if (s === '') return true;
  try { new RegExp(s); return true; } catch { return false; }
}
