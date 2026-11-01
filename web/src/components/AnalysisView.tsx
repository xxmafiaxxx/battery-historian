import { useMemo } from 'react';
import type { UploadResponse } from '../api/types';
import { parseHistorianCsv } from '../data/historianCsv';
import { parseLevelSummary } from '../data/levelSummary';
import { formatDuration } from '../data/time';
import { downloadText } from '../api/client';
import { SystemStats } from './SystemStats';
import { AppStats } from './AppStats';
import { LevelSummaryTable } from './LevelSummaryTable';
import { Timeline } from './Timeline';

export function AnalysisView({ data }: { data: UploadResponse }) {
  const tz = data.location || 'UTC';

  const parsedLogs = useMemo(
    () =>
      data.historianV2Logs
        .filter(l => l.csv && l.csv.trim() !== '')
        .map(l => ({ source: l.source, startMs: l.startMs, ...parseHistorianCsv(l.csv, l.source) })),
    [data.historianV2Logs],
  );

  const totalEntries = parsedLogs.reduce((n, l) => n + l.entries.length, 0);
  const battery = data.batteryStats?.system?.battery ?? null;
  const timeOnBattery = battery?.battery_realtime_msec ?? 0;

  return (
    <div className="analysis">
      <section className="report-head">
        <h2>{data.fileName || 'Report'}</h2>
        <div className="meta-row">
          <span className="chip">SDK {data.sdkVersion}</span>
          <span className="chip">checkin v{data.reportVersion}</span>
          {data.deviceCapacity > 0 && <span className="chip">{Math.round(data.deviceCapacity)} mAh capacity</span>}
          <span className="chip">{tz}</span>
          {timeOnBattery > 0 && <span className="chip">on battery {formatDuration(timeOnBattery)}</span>}
        </div>
      </section>

      {data.criticalError && <div className="banner banner-error">{data.criticalError}</div>}
      {data.note && <div className="banner banner-warn">{data.note}</div>}

      {parsedLogs.some(l => l.entries.length > 0) ? (
        <Timeline logs={parsedLogs} timeZone={tz} />
      ) : (
        data.criticalError === '' && (
          <div className="banner banner-warn">No timeline events were parsed from this bug report.</div>
        )
      )}

      <section className="card">
        <h3>Battery level summaries</h3>
        <LevelSummaryTable summary={parseLevelSummary(data.levelSummaryCsv)} />
      </section>

      <SystemStats stats={data.batteryStats?.system ?? null} checkin={data.checkinSummary} />

      <AppStats appStats={data.appStats} />

      <section className="card">
        <h3>
          Historian logs <span className="chip">{totalEntries} entries</span>
        </h3>
        <ul className="logs-list">
          {parsedLogs.map(l => (
            <li key={l.source}>
              <strong>{l.source}</strong>: {l.entries.length} entries
              {l.entries.length > 0 && (
                <button
                  className="btn btn-small"
                  onClick={() => downloadText(`${l.source.replace(/\s+/g, '_')}.csv`, data.historianV2Logs.find(x => x.source === l.source)?.csv ?? '')}
                >
                  download CSV
                </button>
              )}
            </li>
          ))}
          {parsedLogs.length === 0 && <li>No historian logs were generated.</li>}
        </ul>
      </section>
    </div>
  );
}
