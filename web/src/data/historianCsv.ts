/**
 * Parser for the historian CSV format produced by the Go backend
 * (csv.FileHeader: metric,type,start_time,end_time,value,opt).
 *
 * This is a direct port of the parsing done in js/data.js
 * (processHistorianV2Data's d3.csvParse callback), including the value
 * coercion rules per type.
 */

export interface HistorianEntry {
  seriesName: string;
  type: string;
  startTime: number;
  endTime: number;
  value: string | number;
  source: string;
  opt: string;
  uid: number | null;
}

export interface LogParseResult {
  entries: HistorianEntry[];
  /** Extent [minStart, maxEnd]; 0 where the log has no valid times. */
  extent: { min: number; max: number };
}

/** Metric names emitted by the Go csv writer that the UI treats specially. */
export const Metric = {
  BATTERY_LEVEL: 'Battery Level',
  TEMPERATURE: 'Temperature',
  CHARGING_STATUS: 'Charging status',
  POWER_MONITOR: 'Power Monitor',
  REBOOT: 'Reboot',
} as const;

/**
 * Parses a CSV string into rows of fields, handling quoted fields with
 * embedded commas/newlines/escaped quotes (RFC 4180, matching d3.csvParse).
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  // Normalize line endings; a trailing newline should not produce an empty row.
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Final field/row without trailing newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parses one historian CSV log into coerced entries.
 * The first row must be the header (metric,type,start_time,end_time,value,opt).
 */
export function parseHistorianCsv(csv: string, source: string): LogParseResult {
  const rows = parseCsvRows(csv);
  const entries: HistorianEntry[] = [];
  let min = 0;
  let max = 0;

  // Skip the header row; skip malformed rows the way d3.csvParse would not
  // produce them at all.
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (!cols || cols.length < 6) {
      continue;
    }
    const [metric, type, startTimeStr, endTimeStr, valueRaw, opt] = cols as [string, string, string, string, string, string];

    let v: string | number = valueRaw;
    switch (type) {
      case 'bool':
        // Boolean entries only ever carry "true"; the extra info lives in opt.
        v = opt;
        break;
      case 'int': {
        v = parseIntSafe(valueRaw);
        if (metric === Metric.TEMPERATURE) {
          // Temperature values are in deciCelcius.
          v = (v as number) / 10;
        }
        break;
      }
      case 'float':
        v = parseFloat(valueRaw);
        break;
      default:
        v = valueRaw;
    }

    const startTime = parseIntSafe(startTimeStr);
    const endTime = parseIntSafe(endTimeStr);
    if (startTime > 0 && (min === 0 || startTime < min)) {
      min = startTime;
    }
    if (endTime > max) {
      max = endTime;
    }

    const serviceLike = type === 'service' || isAppSpecificSeries(metric);
    entries.push({
      seriesName: metric,
      type,
      startTime,
      endTime,
      value: v,
      source,
      opt,
      uid: serviceLike && opt !== '' ? parseIntSafe(opt) : null,
    });
  }

  return { entries, extent: { min, max } };
}

// Series that carry a UID in the opt column (from js/metrics.js's
// appSpecificMetrics list; extend as the timeline grows to need them).
const APP_SPECIFIC_SERIES = new Set([
  'Wakelock for uid',
  'Wakelock In',
  'Wakelock Out',
  'Sync App',
  'Top Application',
  'JobScheduler Job',
  'Active Broadcast',
  'Broadcast to uid',
  'Foreground process',
  'GPS is on',
]);

function isAppSpecificSeries(name: string): boolean {
  return APP_SPECIFIC_SERIES.has(name);
}

function parseIntSafe(s: string): number {
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? 0 : v;
}

/** Groups entries by series name, preserving first-seen order. */
export function groupBySeries(entries: HistorianEntry[]): Map<string, HistorianEntry[]> {
  const groups = new Map<string, HistorianEntry[]>();
  for (const e of entries) {
    const list = groups.get(e.seriesName);
    if (list) {
      list.push(e);
    } else {
      groups.set(e.seriesName, [e]);
    }
  }
  return groups;
}
