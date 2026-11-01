import type { CheckinActivityData, CheckinSummary, MDuration, MFloat32 } from '../api/types';
import { describeBytes, formatDuration } from '../data/time';

/**
 * Aggregated Checkin Stats — the same Metric/Value table the legacy UI
 * rendered on its System Stats tab, computed server-side by
 * aggregated.ParseCheckinData and delivered in the uploadResponse JSON.
 */

interface Row {
  metric: string;
  value: string;
}

export function CheckinSummaryTable({ cs }: { cs: CheckinSummary }) {
  const rows = buildRows(cs);
  return (
    <>
      <h4>Aggregated Checkin Stats</h4>
      <div className="meta-row">
        {cs.Device && <span className="chip">{cs.Device}</span>}
        {cs.Build && <span className="chip">{cs.Build}</span>}
        <span className="chip">checkin v{cs.ReportVersion}</span>
        <span className="chip">duration {formatDuration(nsToMs(cs.Realtime))}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.metric}>
              <td>{r.metric}</td>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function buildRows(cs: CheckinSummary): Row[] {
  const rows: Row[] = [];
  const dur = (d: MDuration | undefined): string =>
    d ? formatDuration(nsToMs(d.V)) : '—';
  const durPct = (d: MDuration | undefined, pct: number | undefined): string => {
    if (!d || !pct) {
      return dur(d);
    }
    return `${dur(d)} (${formatPct(pct)})`;
  };
  const rate = (m: MFloat32 | undefined, unit: string): string =>
    m ? `${round2(m.V)} ${unit}` : '—';

  if (cs.ScreenOffDischargePoints > 0 || cs.ScreenOffDischargeRatePerHr?.V > 0) {
    rows.push({ metric: 'Screen Off Discharge Rate (%/hr)', value: rate(cs.ScreenOffDischargeRatePerHr, `(Discharged: ${round1(cs.ScreenOffDischargePoints)}%)`) });
  }
  if (cs.ScreenOnDischargePoints > 0 || cs.ScreenOnDischargeRatePerHr?.V > 0) {
    rows.push({ metric: 'Screen On Discharge Rate (%/hr)', value: rate(cs.ScreenOnDischargeRatePerHr, `(Discharged: ${round1(cs.ScreenOnDischargePoints)}%)`) });
  }
  rows.push(
    { metric: 'Screen On Time', value: durPct(cs.ScreenOnTime, cs.ScreenOnTimePercentage) },
    { metric: 'Screen Off Uptime', value: durPct(cs.ScreenOffUptime, cs.ScreenOffUptimePercentage) },
    { metric: 'Userspace Wakelock Time', value: durPct(cs.PartialWakelockTime, cs.PartialWakelockTimePercentage) },
    { metric: 'Full Wakelock Time', value: durPct(cs.FullWakelockTime, cs.FullWakelockTimePercentage) },
    { metric: 'Sync Activity', value: agg(cs.AggSyncTasks, 'times') },
    { metric: 'JobScheduler Activity', value: agg(cs.AggScheduledJobs, 'times') },
    { metric: 'App Wakeup Alarms', value: cs.AggAppWakeups ? `${formatNum(cs.AggAppWakeups.Count)} times (${round1(cs.AggAppWakeups.CountPerHr)}/hr)` : '—' },
    { metric: 'CPU Usage', value: cpuUsage(cs) },
    { metric: 'Kernel Overhead Time', value: durPct(cs.KernelOverheadTime, cs.KernelOverheadTimePercentage) },
    { metric: 'Kernel Wakelocks', value: agg(cs.AggKernelWakelocks, 'times') },
    { metric: 'Wakeup Reasons', value: agg(cs.AggWakeupReasons, 'times') },
    { metric: 'Mobile KBs/hr', value: rate(cs.MobileKiloBytesPerHr, 'KB/hr') },
    { metric: 'WiFi KBs/hr', value: rate(cs.WifiKiloBytesPerHr, 'KB/hr') },
    { metric: 'Total WiFi Scan Activity', value: agg(cs.AggWifiScanActivity, 'times') },
    { metric: 'Total WiFi Full Lock Activity', value: aggDuration(cs.AggWifiFullLockActivity) },
    { metric: 'Mobile Active Time', value: durPct(cs.MobileActiveTime, cs.MobileActiveTimePercentage) },
    { metric: 'Signal Scanning Time', value: durPct(cs.SignalScanningTime, cs.SignalScanningTimePercentage) },
    { metric: 'Interactive Time', value: durPct(cs.InteractiveTime, cs.InteractiveTimePercentage) },
    { metric: 'Total GPS Use', value: aggDuration(cs.AggGPSUse) },
    { metric: 'Camera Use', value: aggDuration(cs.AggCameraUse) },
    { metric: 'Flashlight Use', value: aggDuration(cs.AggFlashlightUse) },
    { metric: 'Phone Call Time', value: durPct(cs.PhoneCallTime, cs.PhoneCallTimePercentage) },
    { metric: 'Device Idling Time', value: durPct(cs.DeviceIdlingTime, cs.DeviceIdlingTimePercentage) },
    { metric: 'Doze (Idle Mode) Time', value: durPct(cs.DeviceIdleModeEnabledTime, cs.DeviceIdleModeEnabledTimePercentage) },
    { metric: 'WiFi On Time', value: durPct(cs.WifiOnTime, cs.WifiOnTimePercentage) },
    { metric: 'WiFi Transfer Time', value: durPct(cs.WifiTransferTime, cs.WifiTransferTimePercentage) },
    { metric: 'Bluetooth Transfer Time', value: durPct(cs.BluetoothTransferTime, cs.BluetoothTransferTimePercentage) },
    { metric: 'Modem Transfer Time', value: durPct(cs.ModemTransferTime, cs.ModemTransferTimePercentage) },
    { metric: 'Actual Discharge', value: cs.ActualDischarge ? `${round2(cs.ActualDischarge)} mAh` : '—' },
    { metric: 'Estimated Discharge', value: cs.EstimatedDischarge ? `${round2(cs.EstimatedDischarge)} mAh` : '—' },
  );
  if (cs.WifiDischargeRatePerHr?.V > 0) {
    rows.push({ metric: 'WiFi Discharge Rate (%/hr)', value: rate(cs.WifiDischargeRatePerHr, '') });
  }
  if (cs.BluetoothDischargeRatePerHr?.V > 0) {
    rows.push({ metric: 'Bluetooth Discharge Rate (%/hr)', value: rate(cs.BluetoothDischargeRatePerHr, '') });
  }
  if (cs.ModemDischargeRatePerHr?.V > 0) {
    rows.push({ metric: 'Modem Discharge Rate (%/hr)', value: rate(cs.ModemDischargeRatePerHr, '') });
  }
  return rows;
}

function agg(d: CheckinActivityData | undefined, unit: string): string {
  if (!d || (!d.Count && !d.Duration)) {
    return '—';
  }
  const parts: string[] = [];
  if (d.Duration > 0) {
    parts.push(formatDuration(nsToMs(d.Duration)));
  }
  if (d.Count > 0) {
    parts.push(`(${formatNum(d.Count)} ${unit})`);
  }
  return parts.join(' ') || '—';
}

function aggDuration(d: CheckinActivityData | undefined): string {
  if (!d || (!d.Count && !d.Duration)) {
    return '—';
  }
  const dur = d.Duration > 0 ? formatDuration(nsToMs(d.Duration)) : '';
  return d.Count > 0 ? `${dur} (${formatNum(d.Count)} times)` : dur;
}

function cpuUsage(cs: CheckinSummary): string {
  const c = cs.AggCPUUsage;
  if (!c || (!c.UserTime && !c.SystemTime)) {
    return '—';
  }
  return `${formatDuration(nsToMs(c.UserTime))} user time, ${formatDuration(nsToMs(c.SystemTime))} system time`;
}

function nsToMs(ns: number | undefined): number {
  return (ns ?? 0) / 1e6;
}

function formatPct(v: number): string {
  return `${round1(v)}%`;
}

function formatNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Re-exported for callers that want byte formatting parity with the legacy UI.
export { describeBytes };
