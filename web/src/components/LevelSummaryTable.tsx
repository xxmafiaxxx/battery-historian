import type { LevelSummaryRow } from '../data/levelSummary';
import { formatDuration } from '../data/time';

/** Number of level-drop rows shown before the table scrolls. */
const MAX_ROWS = 40;

export function LevelSummaryTable({ summary }: { summary: { header: string[]; rows: LevelSummaryRow[] } }) {
  if (summary.rows.length === 0) {
    return <p className="empty">No battery level drops since the last full charge — the device was on charger the whole time, or the history was empty.</p>;
  }

  const shown = summary.rows.slice(0, MAX_ROWS);
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
            <th>Level</th>
            <th>%/hr</th>
            <th>Reason</th>
            <th>Screen on</th>
            <th>CPU running</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <td>{new Date(Number(r.StartTimeMs)).toLocaleString()}</td>
              <td>{new Date(Number(r.EndTimeMs)).toLocaleString()}</td>
              <td>{formatDuration(Number(r.Duration))}</td>
              <td>
                {r.InitialBatteryLevel} → {r.FinalBatteryLevel}
              </td>
              <td>{Number(r.LevelDropPerHour).toFixed(2)}</td>
              <td>{r.Reason}</td>
              <td>{summaryCell(r.ScreenOnSummary_num, r.ScreenOnSummary_dur)}</td>
              <td>{summaryCell(r.CPURunningSummary_num, r.CPURunningSummary_dur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.rows.length > MAX_ROWS && <p className="hint">{summary.rows.length - MAX_ROWS} more rows not shown.</p>}
    </div>
  );
}

function summaryCell(num: string | undefined, dur: string | undefined): string {
  if (num === undefined) {
    return '—';
  }
  const d = Number(dur ?? 0);
  return `${num}× ${formatDuration(d)}`;
}
