/**
 * Time and size formatting, ported from js/time.js and js/utils.js so the
 * modern UI reads exactly like the legacy one.
 */

const MSECS_IN_SEC = 1000;
const SECS_IN_MIN = 60;
const MINS_IN_HOUR = 60;
const MSECS_IN_MIN = MSECS_IN_SEC * SECS_IN_MIN;
const MSECS_IN_HOUR = MSECS_IN_MIN * MINS_IN_HOUR;

/** formatDuration renders a millisecond duration as e.g. "1h 3m 2s 400ms". */
export function formatDuration(duration: number): string {
  const ms = duration % MSECS_IN_SEC;
  const s = Math.floor((duration / MSECS_IN_SEC) % SECS_IN_MIN);
  const m = Math.floor((duration / MSECS_IN_MIN) % MINS_IN_HOUR);
  const h = Math.floor(duration / MSECS_IN_HOUR);

  let formatted = '';
  if (h > 0) {
    formatted += `${h}h `;
  }
  if (m > 0 || h > 0) {
    formatted += `${m}m `;
  }
  if (s > 0 || m > 0 || h > 0) {
    formatted += `${s}s `;
  }
  if (ms > 0 || formatted.length === 0) {
    // Only show decimals for fractional components (microsecond-derived ms).
    if (Math.round(ms) !== ms) {
      formatted += `${ms.toFixed(2)}ms`;
    } else {
      formatted += `${ms}ms`;
    }
  }
  return formatted.trim();
}

/** Formats a Unix millisecond timestamp in the given IANA time zone. */
export function formatTime(ms: number, timeZone: string): string {
  if (!ms || ms <= 0) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/** describeBytes renders a byte count as e.g. "1.2 MB", ported from utils.js. */
export function describeBytes(bytes: number): string {
  if (bytes >= GB) {
    return `${round2(bytes / GB)} GB`;
  } else if (bytes >= MB) {
    return `${round2(bytes / MB)} MB`;
  } else if (bytes >= KB) {
    return `${round2(bytes / KB)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Formats a float mAh value for tables. */
export function formatMah(mah: number | undefined | null): string {
  if (mah === undefined || mah === null || Number.isNaN(mah)) {
    return '—';
  }
  return `${round2(mah)} mAh`;
}
