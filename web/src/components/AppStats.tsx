import { useState } from 'react';
import type { AppStat } from '../api/types';
import { formatDuration, formatMah, describeBytes } from '../data/time';

/**
 * Per-app stats, mirroring the app service/wakelock/cpu/network views of the
 * legacy app_stats.js, driven by the appStats JSON array.
 */
export function AppStats({ appStats }: { appStats: AppStat[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  const rows = appStats
    .map(s => ({
      name: s.RawStats?.name?.[s.RawStats.name.length - 1] ?? s.RawStats?.name?.[0] ?? `uid ${s.RawStats?.uid ?? '?'}`,
      uid: s.RawStats?.uid ?? 0,
      power: s.DevicePowerPrediction,
      stat: s,
    }))
    .sort((a, b) => b.power - a.power);

  const sel = rows.find(r => `${r.uid}` === selected) ?? null;

  return (
    <section className="card">
      <h3>App stats</h3>
      {rows.length === 0 ? (
        <p className="empty">No per-app stats were parsed. If the bug report is missing package/appops dumps, UID→app mapping is unavailable.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>App</th>
              <th>UID</th>
              <th>Est. power</th>
              <th>CPU power</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.uid}
                className={selected === `${r.uid}` ? 'row-selected' : undefined}
                onClick={() => setSelected(selected === `${r.uid}` ? null : `${r.uid}`)}
              >
                <td>{r.name}</td>
                <td>{r.uid}</td>
                <td>{formatMah(r.power)}</td>
                <td>{formatMah(r.stat.CPUPowerPrediction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sel && <AppDetail stat={sel.stat} name={sel.name} />}
    </section>
  );
}

function AppDetail({ stat, name }: { stat: AppStat; name: string }) {
  const raw = stat.RawStats;
  const fgs = raw?.foreground_service;
  const fg = raw?.foreground;
  const cpu = raw?.cpu;
  const net = raw?.network;
  return (
    <div className="app-detail">
      <h4>{name} details</h4>
      <div className="detail-grid">
        <DetailBlock title="Foreground service">
          {fgs ? `${formatDuration(fgs.total_time_msec ?? 0)} × ${fgs.count ?? 0}` : '—'}
        </DetailBlock>
        <DetailBlock title="Foreground">
          {fg ? `${formatDuration(fg.total_time_msec ?? 0)} × ${fg.count ?? 0}` : '—'}
        </DetailBlock>
        <DetailBlock title="Audio / Camera / Video / Flashlight">
          {[
              raw?.audio ? `audio ${formatDuration(raw.audio.total_time_msec ?? 0)}` : null,
              raw?.camera ? `camera ${formatDuration(raw.camera.total_time_msec ?? 0)}` : null,
              raw?.video ? `video ${formatDuration(raw.video.total_time_msec ?? 0)}` : null,
              raw?.flashlight ? `flashlight ${formatDuration(raw.flashlight.total_time_msec ?? 0)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
        </DetailBlock>
        <DetailBlock title="CPU">
          {cpu ? `user ${formatDuration(cpu.user_time_msec ?? 0)} · system ${formatDuration(cpu.system_time_msec ?? 0)}` : '—'}
        </DetailBlock>
        <DetailBlock title="Mobile data">
          {net ? `↓ ${describeBytes(net.mobile_bytes_rx ?? 0)} / ↑ ${describeBytes(net.mobile_bytes_tx ?? 0)}` : '—'}
        </DetailBlock>
        <DetailBlock title="Wi-Fi data">
          {net ? `↓ ${describeBytes(net.wifi_bytes_rx ?? 0)} / ↑ ${describeBytes(net.wifi_bytes_tx ?? 0)}` : '—'}
        </DetailBlock>
      </div>

      {(raw?.wakelock?.length ?? 0) > 0 && (
        <>
          <h5>Wakelocks</h5>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Partial time</th>
                <th>Count</th>
                <th>Background time</th>
              </tr>
            </thead>
            <tbody>
              {raw?.wakelock?.map((w, i) => (
                <tr key={i}>
                  <td>{w.name}</td>
                  <td>{formatDuration(w.partial_time_msec ?? 0)}</td>
                  <td>{w.partial_count ?? 0}</td>
                  <td>{formatDuration(w.background_time_msec ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-block">
      <div className="detail-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}
