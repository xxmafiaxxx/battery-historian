
import type { ActivityDataDiff, NetworkTrafficDataDiff, PowerUseDataDiff, RateDataDiff, UploadResponseCompare } from '../api/types';
import { formatDuration, formatMah, describeBytes } from '../data/time';

/** A/B comparison view, replacing the legacy compare templates + Flot charts. */
export function CompareView({ data }: { data: UploadResponseCompare }) {
  const [left, right] = data.UploadResponse ?? [];
  return (
    <div className="analysis">
      <section className="report-head">
        <h2>Comparison</h2>
        <div className="meta-row">
          <span className="chip">A: {left?.fileName}</span>
          <span className="chip">B: {right?.fileName}</span>
        </div>
      </section>

      {left?.criticalError && <div className="banner banner-error">A: {left.criticalError}</div>}
      {right?.criticalError && <div className="banner banner-error">B: {right.criticalError}</div>}
      {left?.note && <div className="banner banner-warn">A: {left.note}</div>}
      {right?.note && <div className="banner banner-warn">B: {right.note}</div>}

      <DiffSection title="Device power estimates" data={data.CombinedCheckin.DevicePowerEstimatesCombined ?? []} renderPower />
      <DiffSection title="Userspace wakelocks" data={data.CombinedCheckin.UserspaceWakelocksCombined ?? []} renderDuration />
      <DiffSection title="Kernel wakelocks" data={data.CombinedCheckin.KernelWakelocksCombined ?? []} renderDuration />
      <DiffSection title="Wakeup reasons" data={data.CombinedCheckin.WakeupReasonsCombined ?? []} renderDuration />
      <DiffSection title="Sync tasks" data={data.CombinedCheckin.SyncTasksCombined ?? []} renderDuration />
      <DiffSection title="App wakeups (alarms)" data={data.CombinedCheckin.AppWakeupsCombined ?? []} renderRate />
      <TrafficSection title="Top mobile traffic apps" data={data.CombinedCheckin.TopMobileTrafficAppsCombined ?? []} />
      <TrafficSection title="Top Wi-Fi traffic apps" data={data.CombinedCheckin.TopWifiTrafficAppsCombined ?? []} />
    </div>
  );
}

function DiffSection({
  title,
  data,
  renderDuration,
  renderRate,
  renderPower,
}: {
  title: string;
  data: AnyDiff[];
  renderDuration?: boolean;
  renderRate?: boolean;
  renderPower?: boolean;
}) {
  if (data.length === 0) {
    return null;
  }
  return (
    <section className="card">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>A</th>
              <th>B</th>
              <th>Δ (B−A)</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 25).map((d, i) => (
              <tr key={i}>
                <td>{labelOf(d)}</td>
                <td>{valueCell(d, 'Left', renderDuration, renderRate, renderPower)}</td>
                <td>{valueCell(d, 'Right', renderDuration, renderRate, renderPower)}</td>
                <td>{valueCell(d, 'Delta', renderDuration, renderRate, renderPower)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function labelOf(d: unknown): string {
  const o = d as { Label?: string; UniqueName?: string; Name?: string };
  return o.Label ?? o.UniqueName ?? o.Name ?? '';
}

type DiffKey = 'Left' | 'Right' | 'Delta';
type AnyDiff = ActivityDataDiff | RateDataDiff | PowerUseDataDiff | NetworkTrafficDataDiff;

function valueCell(d: AnyDiff, key: DiffKey, duration?: boolean, rate?: boolean, power?: boolean): string {
  const v = d[key];
  if (v === undefined || v === null) {
    return '—';
  }
  if (typeof v === 'number') {
    return power ? formatMah(v) : `${v}`;
  }
  const o = v as { TimeMs?: number; Count?: number; Bytes?: number; PacketCount?: number };
  if (o.Bytes !== undefined) {
    return `↓ ${describeBytes(o.Bytes)} (${o.PacketCount ?? 0} pkts)`;
  }
  if (rate && o.Count !== undefined) {
    return `${o.Count} (${o.TimeMs !== undefined ? formatDuration(o.TimeMs) : '—'})`;
  }
  if (duration && o.TimeMs !== undefined) {
    return `${formatDuration(o.TimeMs)}${o.Count !== undefined ? ` × ${o.Count}` : ''}`;
  }
  return o.Count !== undefined ? `${o.Count}` : JSON.stringify(v);
}

function TrafficSection({ title, data }: { title: string; data: NetworkTrafficDataDiff[] }) {
  if (data.length === 0) {
    return null;
  }
  return (
    <section className="card">
      <h3>{title}</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>App</th>
            <th>A</th>
            <th>B</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 15).map((d, i) => (
            <tr key={i}>
              <td>{labelOf(d)}</td>
              <td>{trafficCell(d.Left)}</td>
              <td>{trafficCell(d.Right)}</td>
              <td>{trafficCell(d.Delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function trafficCell(v: { Bytes?: number; PacketCount?: number } | undefined): string {
  if (!v) return '—';
  return `↓ ${describeBytes(v.Bytes ?? 0)} (${v.PacketCount ?? 0} pkts)`;
}
