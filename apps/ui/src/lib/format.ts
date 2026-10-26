import type { Settings } from '@headunit/shared';

type Units = Settings['units'];

export type Kind = 'speed' | 'temp' | 'pct' | 'volt' | 'rpm' | 'dist';

/** Convert a metric base value to the user's display units. */
export function convert(kind: Kind, units: Units, v: number): number {
  if (units === 'metric') return v;
  if (kind === 'speed' || kind === 'dist') return v * 0.621371;
  if (kind === 'temp') return (v * 9) / 5 + 32;
  return v;
}

export function unitLabel(kind: Kind, units: Units): string {
  switch (kind) {
    case 'speed':
      return units === 'metric' ? 'km/h' : 'mph';
    case 'dist':
      return units === 'metric' ? 'km' : 'mi';
    case 'temp':
      return units === 'metric' ? '°C' : '°F';
    case 'pct':
      return '%';
    case 'volt':
      return 'V';
    case 'rpm':
      return 'rpm';
  }
}

export function formatClock(d: Date, clock24h: boolean): { time: string; suffix: string } {
  const m = String(d.getMinutes()).padStart(2, '0');
  if (clock24h) return { time: `${String(d.getHours()).padStart(2, '0')}:${m}`, suffix: '' };
  const h = d.getHours() % 12 || 12;
  return { time: `${h}:${m}`, suffix: d.getHours() < 12 ? 'AM' : 'PM' };
}

/** 754 → "12:34", 3725 → "1:02:05" */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const formatMs = (ms: number) => formatDuration(ms / 1000);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
