/**
 * Parser for the level summary CSV (parseutils.BatteryLevelSummariesToCSV):
 * a header row of dimension names (with ".num"/".dur" expansions) followed by
 * one row per battery-level drop since the last full charge.
 */

import { parseCsvRows } from './historianCsv';

export interface LevelSummaryRow {
  [dimension: string]: string;
}

export function parseLevelSummary(csv: string): { header: string[]; rows: LevelSummaryRow[] } {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    return { header: [], rows: [] };
  }
  const header = rows[0];
  if (!header) {
    return { header: [], rows: [] };
  }
  const out: LevelSummaryRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols || cols.length !== header.length) {
      continue;
    }
    const row: LevelSummaryRow = {};
    header.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    out.push(row);
  }
  return { header, rows: out };
}
