import type { BatteryStatsSystem, CheckinSummary, PowerUseItem } from '../api/types';
import { formatDuration, formatMah, describeBytes } from '../data/time';
import { CheckinSummaryTable } from './CheckinSummaryTable';
import { PowerChart } from './PowerChart';

/** Enum values of BatteryStats_System_PowerUseItem_Name (pb/batterystats_proto). */
const POWER_USE_ITEM_NAMES: Record<number, string> = {
  0: 'default',
  1: 'idle',
  2: 'cell',
  3: 'phone',
  4: 'wifi',
  5: 'bluetooth',
  6: 'screen',
  7: 'app',
  8: 'user',
  9: 'unaccounted',
  10: 'overcounted',
  11: 'flashlight',
};

export function SystemStats({ stats, checkin }: { stats: BatteryStatsSystem | null; checkin?: CheckinSummary | null }) {
  if (!stats) {
    return (
      <section className="card" id="system-stats">
        <h3>System stats</h3>
        <p className="empty">No aggregated battery stats were parsed for this report. Try a full <code>adb bugreport</code> zip — the checkin section may have been truncated.</p>
      </section>
    );
  }

  const items = (stats.power_use_item ?? []).filter(i => !i.should_hide);
  const total = stats.power_use_summary?.computed_power_mah ?? 0;
  const battery = stats.battery;

  return (
    <section className="card" id="system-stats">
      {checkin && <CheckinSummaryTable cs={checkin} />}
      {battery && (
        <div className="meta-row">
          {battery.estimated_battery_capacity_mah ? <span className="chip">est. capacity {battery.estimated_battery_capacity_mah} mAh</span> : null}
          {battery.start_clock_time_msec ? (
            <span className="chip">since {new Date(battery.start_clock_time_msec ?? 0).toLocaleString()}</span>
          ) : null}
        </div>
      )}

      <PowerChart items={stats.power_use_item ?? []} />
      <table className="data-table">
        <thead>
          <tr>
            <th>Power use</th>
            <th>Computed</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className={it.name === 9 ? 'row-warn' : undefined}>
              <td>{itemLabel(it, items)}</td>
              <td>{formatMah(it.computed_power_mah)}</td>
            </tr>
          ))}
          <tr className="row-total">
            <td>Total</td>
            <td>{formatMah(total)}</td>
          </tr>
        </tbody>
      </table>

      {(stats.kernel_wakelock?.length ?? 0) > 0 && (
        <>
          <h4>Kernel wakelocks</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Time</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {[...(stats.kernel_wakelock ?? [])]
                .sort((a, b) => (b.time_msec ?? 0) - (a.time_msec ?? 0))
                .slice(0, 15)
                .map((k, i) => (
                  <tr key={i}>
                    <td>{k.name}</td>
                    <td>{formatDuration(k.time_msec ?? 0)}</td>
                    <td>{k.count ?? 0}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {(stats.resource_power_manager?.length ?? 0) > 0 && (
        <>
          <h4>Resource power manager (RPM)</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Total time</th>
                <th>Count</th>
                <th>Screen-off time</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {[...(stats.resource_power_manager ?? [])]
                .sort((a, b) => (b.total_time_msec ?? 0) - (a.total_time_msec ?? 0))
                .slice(0, 15)
                .map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{formatDuration(r.total_time_msec ?? 0)}</td>
                    <td>{r.total_count ?? 0}</td>
                    <td>{formatDuration(r.screen_off_time_msec ?? 0)}</td>
                    <td>{r.screen_off_count ?? 0}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {stats.global_network && (
        <>
          <h4>Network</h4>
          <table className="data-table">
            <tbody>
              <tr>
                <td>Mobile</td>
                <td>
                  ↓ {describeBytes(stats.global_network.mobile_bytes_rx ?? 0)} / ↑ {describeBytes(stats.global_network.mobile_bytes_tx ?? 0)}
                </td>
              </tr>
              <tr>
                <td>Wi-Fi</td>
                <td>
                  ↓ {describeBytes(stats.global_network.wifi_bytes_rx ?? 0)} / ↑ {describeBytes(stats.global_network.wifi_bytes_tx ?? 0)}
                </td>
              </tr>
              <tr>
                <td>Bluetooth</td>
                <td>
                  ↓ {describeBytes(stats.global_network.bt_bytes_rx ?? 0)} / ↑ {describeBytes(stats.global_network.bt_bytes_tx ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function itemLabel(it: PowerUseItem, all: PowerUseItem[]): string {
  const name = POWER_USE_ITEM_NAMES[it.name ?? 0] ?? `unknown (${it.name})`;
  if (name === 'app') {
    const uid = it.uid ?? 0;
    return `uid ${uid}`;
  }
  const apps = all.filter(x => x.name === 7);
  if (name === 'user' && apps.length > 0) {
    const appTotal = apps.reduce((n, a) => n + (a.computed_power_mah ?? 0), 0);
    const share = totalOf(all) > 0 ? ` (${Math.round((appTotal / totalOf(all)) * 100)}% apps)` : '';
    return `user${share}`;
  }
  return name;
}

function totalOf(items: PowerUseItem[]): number {
  return items.reduce((n, i) => n + (i.computed_power_mah ?? 0), 0);
}
