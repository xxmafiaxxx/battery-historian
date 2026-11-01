/**
 * Types mirroring the JSON the Go backend emits from analyzer/analyzer.go.
 *
 * Casing follows the wire format exactly:
 *  - analyzer.uploadResponse and historianV2Log use explicit lowerCamelCase
 *    json tags.
 *  - presenter.AppStat and the protobuf BatteryStats message are marshaled by
 *    encoding/json without tags, so their keys keep the exported Go field
 *    names (PascalCase).
 */

/** analyzer.historianV2Log */
export interface HistorianV2Log {
  source: string;
  csv: string;
  startMs?: number;
}

/** presenter.AppStat (no json tags: Go field names on the wire). */
export interface AppStat {
  DevicePowerPrediction: number;
  CPUPowerPrediction: number;
  RawStats: BatteryStatsApp | null;
  Sensor: SensorInfo[];
  UserActivity: unknown[];
}

export interface SensorInfo {
  Name: string;
  Type: string;
  Version: number;
  Number: number;
  TotalTimeMs: number;
  Count: number;
}

/**
 * Subset of the batterystats.BatteryStats proto JSON that the UI renders.
 * Field names follow the generated Go struct fields (encoding/json, no tags).
 */
export interface BatteryStats {
  report_version?: number;
  aggregation_type?: number;
  build?: { fingerprint?: string; device?: string; release?: string };
  system?: BatteryStatsSystem | null;
  app?: BatteryStatsApp[];
}

export interface BatteryStatsSystem {
  battery?: BatteryInfo | null;
  power_use_item?: PowerUseItem[];
  power_use_summary?: PowerUseSummary | null;
  battery_discharge?: BatteryDischarge | null;
  discharge_step?: DischargeStep[];
  charge_step?: DischargeStep[];
  kernel_wakelock?: KernelWakelock[];
  wakeup_reason?: WakeupReason[];
  misc?: MiscStats | null;
  screen_brightness?: NamedTimeCount[];
  signal_strength?: NamedTimeCount[];
  signal_scanning_time?: TimeCount | null;
  data_connection?: NamedTimeCount[];
  wifi_state?: NamedTimeCount[];
  wifi_supplicant_state?: NamedTimeCount[];
  wifi_signal_strength?: NamedTimeCount[];
  bluetooth_state?: NamedTimeCount[];
  global_wifi_controller?: ControllerActivity | null;
  global_bluetooth_controller?: ControllerActivity | null;
  global_modem_controller?: ControllerActivity | null;
  global_network?: GlobalNetwork | null;
  charge_time_remaining?: { usec?: number } | null;
  discharge_time_remaining?: { usec?: number } | null;
  resource_power_manager?: ResourcePowerManager[];
}

export interface BatteryInfo {
  start_count?: number;
  battery_realtime_msec?: number;
  battery_uptime_msec?: number;
  total_realtime_msec?: number;
  total_uptime_msec?: number;
  start_clock_time_msec?: number;
  screen_off_realtime_msec?: number;
  screen_off_uptime_msec?: number;
  estimated_battery_capacity_mah?: number;
  min_learned_battery_capacity_uah?: number;
  max_learned_battery_capacity_uah?: number;
}

export interface PowerUseItem {
  name?: number; // enum value of BatteryStats_System_PowerUseItem_Name
  uid?: number;
  computed_power_mah?: number;
  screen_power_mah?: number;
  proportional_smear_mah?: number;
  should_hide?: boolean;
}

export interface PowerUseSummary {
  battery_capacity_mah?: number;
  computed_power_mah?: number;
  min_drained_power_mah?: number;
  max_drained_power_mah?: number;
}

export interface BatteryDischarge {
  lower_bound?: number;
  upper_bound?: number;
}

export interface DischargeStep {
  time_msec?: number;
  level?: number;
  display_state?: number;
  power_save_mode?: number;
  idle_mode?: number;
}

export interface KernelWakelock {
  name?: string;
  time_msec?: number;
  count?: number;
  current_duration_msec?: number;
  max_duration_msec?: number;
  total_duration_msec?: number;
}

export interface WakeupReason {
  name?: string;
  time_msec?: number;
  count?: number;
}

export interface MiscStats {
  [key: string]: number | undefined;
}

export interface NamedTimeCount {
  name?: number;
  time_msec?: number;
  count?: number;
}

export interface TimeCount {
  time_msec?: number;
  count?: number;
}

export interface ControllerActivity {
  bluetooth_idle_time_msec?: number;
  bluetooth_rx_time_msec?: number;
  bluetooth_tx_time_msec?: number;
  bluetooth_power_mah?: number;
  modem_idle_time_msec?: number;
  modem_rx_time_msec?: number;
  modem_tx_time_msec?: number;
  modem_power_mah?: number;
  wifi_idle_time_msec?: number;
  wifi_rx_time_msec?: number;
  wifi_tx_time_msec?: number;
  wifi_power_mah?: number;
}

export interface GlobalNetwork {
  mobile_bytes_rx?: number;
  mobile_bytes_tx?: number;
  wifi_bytes_rx?: number;
  wifi_bytes_tx?: number;
  mobile_packets_rx?: number;
  mobile_packets_tx?: number;
  wifi_packets_rx?: number;
  wifi_packets_tx?: number;
  bt_bytes_rx?: number;
  bt_bytes_tx?: number;
}

export interface ResourcePowerManager {
  name?: string;
  total_time_msec?: number;
  total_count?: number;
  screen_off_time_msec?: number;
  screen_off_count?: number;
}

export interface BatteryStatsApp {
  uid?: number;
  name?: string[];
  apk?: {
    wakeups?: number;
    service?: { name?: string; wakeups?: number }[];
  } | null;
  process?: { name?: string; user_time_msec?: number; system_time_msec?: number; start_time?: string }[];
  wakelock?: {
    name?: string;
    full_time_msec?: number;
    full_count?: number;
    partial_time_msec?: number;
    partial_count?: number;
    background_time_msec?: number;
    background_count?: number;
    window_time_msec?: number;
    window_count?: number;
  }[];
  sensor?: { number?: number; total_time_msec?: number; count?: number; report_mode?: string }[];
  state_time?: { foreground_time_msec?: number; top_time_msec?: number; foreground_service_time_msec?: number; cached_time_msec?: number };
  cpu?: { user_time_msec?: number; system_time_msec?: number };
  network?: AppNetwork | null;
  user_activity?: unknown[];
  vibration?: { total_time_msec?: number; count?: number } | null;
  foreground?: { total_time_msec?: number; count?: number } | null;
  foreground_service?: { total_time_msec?: number; count?: number } | null;
  audio?: { total_time_msec?: number; count?: number } | null;
  camera?: { total_time_msec?: number; count?: number } | null;
  video?: { total_time_msec?: number; count?: number } | null;
  flashlight?: { total_time_msec?: number; count?: number } | null;
  bluetooth_misc?: { total_time_msec?: number; count?: number } | null;
  power_use_item?: { computed_power_mah?: number; screen_power_mah?: number } | null;
}

export interface AppNetwork {
  mobile_bytes_rx?: number;
  mobile_bytes_tx?: number;
  wifi_bytes_rx?: number;
  wifi_bytes_tx?: number;
  mobile_packets_rx?: number;
  mobile_packets_tx?: number;
  wifi_packets_rx?: number;
  wifi_packets_tx?: number;
  mobile_active_time_msec?: number;
  mobile_active_count?: number;
  bt_bytes_rx?: number;
  bt_bytes_tx?: number;
  mobile_wakeup_count?: number;
  wifi_wakeup_count?: number;
  mobile_bytes_bg_rx?: number;
  mobile_bytes_bg_tx?: number;
  wifi_bytes_bg_rx?: number;
  wifi_bytes_bg_tx?: number;
  mobile_packets_bg_rx?: number;
  mobile_packets_bg_tx?: number;
  wifi_packets_bg_rx?: number;
  wifi_packets_bg_tx?: number;
}

/** analyzer.uploadResponse */
export interface UploadResponse {
  sdkVersion: number;
  historianV2Logs: HistorianV2Log[];
  levelSummaryCsv: string;
  displayPowerMonitor: boolean;
  reportVersion: number;
  appStats: AppStat[];
  batteryStats: BatteryStats | null;
  deviceCapacity: number;
  histogramStats: unknown;
  timeToDelta: Record<string, string>;
  criticalError: string;
  note: string;
  fileName: string;
  location: string;
  overflowMs: number;
  isDiff: boolean;
}

/** analyzer.uploadResponseCompare */
export interface UploadResponseCompare {
  UploadResponse: UploadResponse[];
  HTML: string;
  UsingComparison: boolean;
  CombinedCheckin: CombinedCheckin;
}

export interface ActivityDataDiff {
  Name?: string;
  Uid?: number;
  UniqueName?: string;
  Left?: ActivityData;
  Right?: ActivityData;
  Delta?: ActivityData;
}

export interface ActivityData {
  TimeMs?: number;
  Count?: number;
  StartMs?: number;
}

export interface PowerUseDataDiff {
  Label?: string;
  Left?: number;
  Right?: number;
  Delta?: number;
}

export interface NetworkTrafficDataDiff {
  Label?: string;
  Left?: NetworkTrafficData;
  Right?: NetworkTrafficData;
  Delta?: NetworkTrafficData;
}

export interface NetworkTrafficData {
  Bytes?: number;
  PacketCount?: number;
}

export interface RateDataDiff {
  Label?: string;
  Left?: RateData;
  Right?: RateData;
  Delta?: RateData;
}

export interface RateData {
  Count?: number;
  TimeMs?: number;
}

export interface CombinedCheckin {
  UserspaceWakelocksCombined: ActivityDataDiff[];
  KernelWakelocksCombined: ActivityDataDiff[];
  SyncTasksCombined: ActivityDataDiff[];
  WakeupReasonsCombined: ActivityDataDiff[];
  TopMobileActiveAppsCombined: ActivityDataDiff[];
  TopMobileTrafficAppsCombined: NetworkTrafficDataDiff[];
  TopWifiTrafficAppsCombined: NetworkTrafficDataDiff[];
  DevicePowerEstimatesCombined: PowerUseDataDiff[];
  WifiFullLockActivityCombined: ActivityDataDiff[];
  GPSUseCombined: ActivityDataDiff[];
  CameraUseCombined: ActivityDataDiff[];
  FlashlightUseCombined: ActivityDataDiff[];
  AppWakeupsCombined: RateDataDiff[];
  ANRAndCrashCombined: unknown[];
  CPUUsageCombined: unknown[];
}
