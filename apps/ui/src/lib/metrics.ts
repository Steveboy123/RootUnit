import type { VehicleKey, VehicleState } from '@headunit/shared';
import type { Kind } from './format';

export type Level = 'ok' | 'warn' | 'danger';

/** Ranges and thresholds are in metric base units; the gauge converts for display. */
export interface Metric {
  id: string;
  /** The reading on VehicleState this metric shows. */
  key: VehicleKey;
  label: string;
  kind: Kind;
  min: number;
  max: number;
  decimals: number;
  warnHigh?: number;
  dangerHigh?: number;
  warnLow?: number;
  dangerLow?: number;
  get(v: VehicleState): number;
}

export const METRICS: Metric[] = [
  { id: 'speed', key: 'speedKmh', label: 'Speed', kind: 'speed', min: 0, max: 240, decimals: 0, get: (v) => v.speedKmh },
  { id: 'rpm', key: 'rpm', label: 'RPM', kind: 'rpm', min: 0, max: 8000, decimals: 0, warnHigh: 6000, dangerHigh: 6500, get: (v) => v.rpm },
  { id: 'coolant', key: 'coolantC', label: 'Coolant', kind: 'temp', min: 40, max: 130, decimals: 0, warnHigh: 105, dangerHigh: 115, get: (v) => v.coolantC },
  { id: 'intake', key: 'intakeC', label: 'Intake air', kind: 'temp', min: 0, max: 80, decimals: 0, warnHigh: 60, dangerHigh: 70, get: (v) => v.intakeC },
  { id: 'ambient', key: 'ambientC', label: 'Outside', kind: 'temp', min: -20, max: 50, decimals: 1, warnLow: 2, get: (v) => v.ambientC },
  { id: 'throttle', key: 'throttlePct', label: 'Throttle', kind: 'pct', min: 0, max: 100, decimals: 0, get: (v) => v.throttlePct },
  { id: 'load', key: 'loadPct', label: 'Engine load', kind: 'pct', min: 0, max: 100, decimals: 0, warnHigh: 90, get: (v) => v.loadPct },
  { id: 'fuel', key: 'fuelPct', label: 'Fuel', kind: 'pct', min: 0, max: 100, decimals: 0, warnLow: 15, dangerLow: 8, get: (v) => v.fuelPct },
  { id: 'battery', key: 'batteryV', label: 'Battery', kind: 'volt', min: 10, max: 16, decimals: 1, warnLow: 12, dangerLow: 11.5, warnHigh: 14.8, dangerHigh: 15.5, get: (v) => v.batteryV },
];

/**
 * The live value of a metric, or null when there isn't one — no vehicle data yet, the link is down
 * (ignition off / adapter lost), or this car doesn't provide that reading. Callers show "—" for null,
 * never a stale or invented number.
 */
export function reading(v: VehicleState | null, m: Metric): number | null {
  if (!v || !v.connected || v.unsupported?.includes(m.key)) return null;
  return m.get(v);
}

export const metricById = (id: unknown): Metric => METRICS.find((m) => m.id === id) ?? METRICS[0]!;

export function metricLevel(m: Metric, value: number): Level {
  if ((m.dangerHigh !== undefined && value >= m.dangerHigh) || (m.dangerLow !== undefined && value <= m.dangerLow)) return 'danger';
  if ((m.warnHigh !== undefined && value >= m.warnHigh) || (m.warnLow !== undefined && value <= m.warnLow)) return 'warn';
  return 'ok';
}
