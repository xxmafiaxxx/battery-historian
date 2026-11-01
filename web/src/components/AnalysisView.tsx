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
import { LevelChart } from './LevelChart';
import { formatMah } from '../data/time';

export function AnalysisView({ data }: { data: UploadResponse }) {
  const tz = data.location || 'UTC';

  // Go nil slices marshal as null; never assume arrays from the wire.
  const appStats = data.appStats ?? [];
  const logs = data.historianV2Logs ?? [];
  const levelCsv = data.levelSummaryCsv ?? '';

  const parsedLogs = useMemo(
    () =>
      logs
        .filter(l => l.csv && l.csv.trim() !== '')
        .map(l => ({ source: l.source, startMs: l.startMs, ...parseHistorianCsv(l.csv, l.source) })),
    [logs],
  );

  const totalEntries = parsedLogs.reduce((n, l) => n + l.entries.length, 0);
  const levelEntries = parsedLogs
    .flatMap(l => l.entries)
    .filter(e => e.seriesName === 'Battery Level');
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

      <section className="stat-tiles">
        <div className="tile tile-blue">
          <div className="tile-label">Time on battery</div>
          <div className="tile-value">{timeOnBattery > 0 ? formatDuration(timeOnBattery) : '—'}</div>
        </div>
        <div className="tile tile-green">
          <div className="tile-label">Est. capacity</div>
          <div className="tile-value">{battery?.estimated_battery_capacity_mah ? `${Math.round(battery.estimated_battery_capacity_mah)} mAh` : formatMah(data.deviceCapacity || undefined)}</div>
        </div>
        <div className="tile tile-amber">
          <div className="tile-label">Screen on</div>
          <div className="tile-value">{data.checkinSummary?.ScreenOnTimePercentage ? `${Math.round(data.checkinSummary.ScreenOnTimePercentage)}%` : '—'}</div>
        </div>
        <div className="tile tile-purple">
          <div className="tile-label">Discharge (screen off)</div>
          <div className="tile-value">{data.checkinSummary?.ScreenOffDischargeRatePerHr?.V ? `${Math.round(data.checkinSummary.ScreenOffDischargeRatePerHr.V * 10) / 10}%/hr` : '—'}</div>
        </div>
      </section>

      {levelEntries.length > 1 && (
        <section className="card">
          <h3>Battery level</h3>
          <LevelChart entries={levelEntries} timeZone={tz} />
        </section>
      )}

      {parsedLogs.some(l => l.entries.length > 0) ? (
        <Timeline logs={parsedLogs} timeZone={tz} />
      ) : (
        data.criticalError === '' && (
          <div className="banner banner-warn">No timeline events were parsed from this bug report.</div>
        )
      )}

      <nav className="analysis-jump" aria-label="Sections">
        <a href="#timeline">Timeline</a>
        <a href="#level-summary">Level summary</a>
        <a href="#system-stats">System stats {data.checkinSummary ? `· ${data.checkinSummary.ReportVersion ? `v${data.checkinSummary.ReportVersion}` : ''}` : ''}</a>
        <a href="#app-stats">App stats · {appStats.length} apps</a>
        <a href="#historian-logs">Logs · {totalEntries} events</a>
      </nav>

      <section className="card" id="level-summary">
        <h3>Battery level summaries</h3>
        <LevelSummaryTable summary={parseLevelSummary(levelCsv)} />
      </section>

      <div id="system-stats">
        <SystemStats stats={data.batteryStats?.system ?? null} checkin={data.checkinSummary} />
      </div>

      <div id="app-stats">
        <AppStats appStats={appStats} />
      </div>

      <section className="card" id="historian-logs">
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
                  onClick={() => downloadText(`${l.source.replace(/\s+/g, '_')}.csv`, (data.historianV2Logs ?? []).find(x => x.source === l.source)?.csv ?? '')}
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
