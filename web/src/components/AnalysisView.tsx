import { useEffect, useMemo, useState } from 'react';
import type { UploadResponse } from '../api/types';
import { parseHistorianCsv } from '../data/historianCsv';
import { parseLevelSummary } from '../data/levelSummary';
import { formatDuration } from '../data/time';
import { downloadText } from '../api/client';
import { SystemStats } from './SystemStats';
import { AppStats } from './AppStats';
import { NetworkAccess } from './NetworkAccess';
import { FoundKeys } from './FoundKeys';
import { LevelSummaryTable } from './LevelSummaryTable';
import { Timeline } from './Timeline';
import { LevelChart } from './LevelChart';
import { HistorianTabs } from './HistorianTabs';
import { HistorianToolbar } from './HistorianToolbar';
import { useCollapsible } from './Collapsible';
import { formatMah } from '../data/time';
import { TAB_CONFIGS, getTabExtent, type HistorianTabId } from '../data/historianTabs';

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

  const [activeTab, setActiveTab] = useState<HistorianTabId>('v2');
  const [regexp, setRegexp] = useState('');
  const [showRate, setShowRate] = useState(false);
  const [showBars, setShowBars] = useState(true);
  const activeConfig = TAB_CONFIGS.find(t => t.id === activeTab) ?? TAB_CONFIGS[0]!;

  const [domainKey, setDomainKey] = useState<string>('Default');
  const [domain, setDomain] = useState<{ min: number; max: number } | null>(null);

  const [historianOpen, setHistorianOpen] = useCollapsible('historian', true);
  const [levelOpen, setLevelOpen] = useCollapsible('level-summary', true);
  const [logsOpen, setLogsOpen] = useCollapsible('historian-logs', true);

  // Global bounds for Default
  const globalBounds = useMemo(() => {
    let min = Infinity; let max = -Infinity;
    for (const l of parsedLogs) {
      const s = l.startMs && l.startMs > 0 ? l.startMs : l.extent.min;
      if (s > 0 && s < min) min = s;
      if (l.extent.max > max) max = l.extent.max;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    const pad = (max - min) * 0.02;
    return { min: min - pad, max: max + pad };
  }, [parsedLogs]);

  // Initialize / retime domain when tab or logs change and user is on Default
  useEffect(() => {
    const fromTab = getTabExtent(parsedLogs, activeConfig);
    if (fromTab) { setDomain(fromTab); setDomainKey('Default'); }
    else if (globalBounds) { setDomain(globalBounds); setDomainKey('Default'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, parsedLogs.length]);

  const handleDomainKeyChange = (key: string) => {
    setDomainKey(key);
    if (key === 'Default') {
      const fromTab = getTabExtent(parsedLogs, activeConfig);
      setDomain(fromTab ?? globalBounds);
      return;
    }
    if (key === 'Shown metrics') {
      // Leave as-is; Timeline will report its visible domain back via onDomainChange
      return;
    }
    const hit = parsedLogs.find(l => l.source === key);
    if (hit && hit.extent.max > hit.extent.min) setDomain({ ...hit.extent });
  };

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

      {/* Historian graphic: tabs + toolbar + shared time/battery graph */}
      <section className="card card-collapsible" id="historian">
        <div className="card-head" role="button" tabIndex={0} onClick={() => setHistorianOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHistorianOpen(o => !o); } }} aria-expanded={historianOpen} aria-controls="historian-body">
          <h3 style={{ margin: 0 }}>Historian <span className="chip">{totalEntries} events</span> <span className="chip">{parsedLogs.length} logs</span></h3>
          <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{historianOpen ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={historianOpen ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setHistorianOpen(o => !o); }}>{historianOpen ? '▾' : '▸'}</button></span>
        </div>
        <div id="historian-body" className="collapsible-body" hidden={!historianOpen}>
        <HistorianTabs active={activeTab} onChange={setActiveTab} />
        <p className="hint" style={{ margin: '6px 0 8px' }}>{activeConfig.subtitle}</p>
        <HistorianToolbar
          logs={parsedLogs}
          domain={domainKey}
          onDomainChange={handleDomainKeyChange}
          regexp={regexp}
          onRegexpChange={setRegexp}
          showRateOfChange={showRate}
          onRateChange={setShowRate}
          showBars={showBars}
          onShowBars={setShowBars}
        />
        {levelEntries.length > 1 && (
          <div style={{ marginTop: 10 }}>
            <LevelChart entries={levelEntries} timeZone={tz} domain={domain} rateOfChange={showRate} onDomainChange={setDomain} />
          </div>
        )}
        {parsedLogs.some(l => l.entries.length > 0) ? (
          <Timeline
            logs={parsedLogs}
            timeZone={tz}
            tab={activeConfig}
            domain={domain}
            onDomainChange={setDomain}
            domainKey={domainKey}
            regexp={regexp}
            showRateOfChange={showRate}
            showBars={showBars}
          />
        ) : (
          data.criticalError === '' && (
            <div className="banner banner-warn">No timeline events were parsed from this bug report.</div>
          )
        )}
        </div>
      </section>

      <nav className="analysis-jump" aria-label="Sections">
        <a href="#historian">Historian</a>
        <a href="#network-access">Network access</a>
        <a href="#found-keys">Found keys</a>
        <a href="#level-summary">Level summary</a>
        <a href="#system-stats">System stats {data.checkinSummary ? `· ${data.checkinSummary.ReportVersion ? `v${data.checkinSummary.ReportVersion}` : ''}` : ''}</a>
        <a href="#app-stats">App stats · {appStats.length} apps</a>
        <a href="#historian-logs">Logs · {totalEntries} events</a>
        <span className="hint" style={{ marginLeft: 'auto', fontSize: 11 }}>Click a panel header to collapse — saved per-panel</span>
      </nav>

      <NetworkAccess batteryStats={data.batteryStats ?? null} appStats={appStats} sites={data.networkSites ?? null} historianV2Logs={data.historianV2Logs ?? []} />

      <FoundKeys secrets={data.foundSecrets ?? null} />

      <section className="card card-collapsible" id="level-summary">
        <div className="card-head" role="button" tabIndex={0} onClick={() => setLevelOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLevelOpen(o => !o); } }} aria-expanded={levelOpen} aria-controls="level-summary-body">
          <h3>Battery level summaries</h3>
          <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{levelOpen ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={levelOpen ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setLevelOpen(o => !o); }}>{levelOpen ? '▾' : '▸'}</button></span>
        </div>
        <div id="level-summary-body" className="collapsible-body" hidden={!levelOpen}>
        <LevelSummaryTable summary={parseLevelSummary(levelCsv)} />
        </div>
      </section>

      <div id="system-stats">
        <SystemStats stats={data.batteryStats?.system ?? null} checkin={data.checkinSummary} />
      </div>

      <div id="app-stats">
        <AppStats appStats={appStats} />
      </div>

      <section className="card card-collapsible" id="historian-logs">
        <div className="card-head" role="button" tabIndex={0} onClick={() => setLogsOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLogsOpen(o => !o); } }} aria-expanded={logsOpen} aria-controls="historian-logs-body">
          <h3>
            Historian logs <span className="chip">{totalEntries} entries</span>
          </h3>
          <span className="collapse-actions"><span className="hint" style={{ fontSize: 11 }}>{logsOpen ? 'hide' : 'show'}</span><button className="collapse-toggle" aria-label={logsOpen ? 'Collapse' : 'Expand'} onClick={e => { e.stopPropagation(); setLogsOpen(o => !o); }}>{logsOpen ? '▾' : '▸'}</button></span>
        </div>
        <div id="historian-logs-body" className="collapsible-body" hidden={!logsOpen}>
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
        </div>
      </section>
    </div>
  );
}
