import type { ParsedLog } from '../components/Timeline';

export type HistorianTabId = 'v2' | 'systemHealth' | 'eventLog' | 'custom';

export interface TabConfig {
  id: HistorianTabId;
  label: string;
  subtitle: string;
  barOrder: string[];
  logSources: string[];
  logSourcesHidden: string[];
  defaultXExtentLogs: string[];
  defaultLevel: string; // '' disables
}

// From js/historian.js:singleView_ and metrics.js:BATTERY_HISTORY_ORDER
const BATTERY_HISTORY_ORDER = [
  'Reboot','CPU running','App Processor wakeup','Kernel only uptime','Wakelock In','Wakelock Out','Long Wakelocks',
  'Kernel wakesource','Screen','Top Application','Crashes (logcat)','AM Low Memory / ANR','Brightness','Low Power Mode','Doze','JobScheduler Job',
  'Sync App','GPS is on','Sensor','BLE scanning','Phone scanning','Phone state','Network connectivity','Mobile radio active','Mobile signal strength',
  'Mobile network type','Wifi full lock','Wifi scan','Wifi supplicant','Wifi running','Audio','Video','Camera','Flashlight on',
  'Battery Level','Charging status','Plug','Battery Saver','Temperature','Voltage','Coulomb charge',
];

const SYSTEM_HEALTH_ORDER = [
  'AM PSS','AM Low Memory / ANR','LOW_MEMORY_KILLER','GC pause','AM Proc','Choreographer skipped','DVM lock sample',
  'StrictMode violation','Background compilation','Active Broadcast enqueued','Active Broadcast dispatched',
  'Broadcast enqueued','Broadcast dispatched','AM WTF','Crashes (logcat)','Selinux denial','Screen','Top Application',
];

export const TAB_CONFIGS: TabConfig[] = [
  {
    id: 'v2',
    label: 'Historian V2',
    subtitle: 'Battery history — curated lanes + battery level',
    barOrder: BATTERY_HISTORY_ORDER,
    logSources: ['Battery History'],
    logSourcesHidden: [],
    defaultXExtentLogs: ['Battery History','Power Monitor'],
    defaultLevel: 'Battery Level',
  },
  {
    id: 'systemHealth',
    label: 'System Health',
    subtitle: 'Memory / performance / broadcasts',
    barOrder: SYSTEM_HEALTH_ORDER,
    logSources: [],
    logSourcesHidden: [],
    defaultXExtentLogs: ['Broadcasts','Event Log','Kernel Dmesg','System Log'],
    defaultLevel: 'AM Proc',
  },
  {
    id: 'eventLog',
    label: 'Event Log',
    subtitle: 'Event Log source only',
    barOrder: ['AM Proc','AM Low Memory / ANR','AM WTF','DVM lock sample','App transitions','Event Log'],
    logSources: ['Event Log'],
    logSourcesHidden: ['Battery History'],
    defaultXExtentLogs: ['Event Log'],
    defaultLevel: '',
  },
  {
    id: 'custom',
    label: 'Custom',
    subtitle: 'Add any metric — start empty',
    barOrder: [],
    logSources: [],
    logSourcesHidden: [], // filled dynamically as all sources when needed
    defaultXExtentLogs: [],
    defaultLevel: '',
  },
];

export function getTabExtent(logs: ParsedLog[], tab: TabConfig): { min: number; max: number } | null {
  const pick = (names: string[]) => {
    for (const n of names) {
      const hit = logs.find(l => l.source === n);
      if (hit && hit.extent.max > hit.extent.min) return hit.extent;
    }
    return null;
  };
  const fromDefault = pick(tab.defaultXExtentLogs);
  if (fromDefault) return fromDefault;
  // Fallback: global bounds padded — caller does padding
  let min = Infinity, max = -Infinity;
  for (const l of logs) {
    const s = l.startMs && l.startMs > 0 ? l.startMs : l.extent.min;
    if (s > 0 && s < min) min = s;
    if (l.extent.max > max) max = l.extent.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const pad = (max - min) * 0.02;
  return { min: min - pad, max: max + pad };
}

export function filterLogsForTab(logs: ParsedLog[], tab: TabConfig): ParsedLog[] {
  if (tab.id === 'v2' || tab.id === 'systemHealth') return logs;
  if (tab.id === 'eventLog') return logs.filter(l => tab.logSources.includes(l.source));
  return logs; // custom shows all but starts empty — Timeline handles barOrder empty
}
