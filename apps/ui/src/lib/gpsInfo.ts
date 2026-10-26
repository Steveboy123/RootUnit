import type { GpsState } from '@headunit/shared';
import type { Tone } from '../components/ui';

export interface FixQuality {
  label: string;
  tone: Tone;
}

/** How much to trust the position right now, in words: the receiver's own estimate of its error decides. */
export function fixQuality(g: Pick<GpsState, 'connected' | 'fix' | 'accuracyM'>): FixQuality {
  if (!g.connected) return { label: 'No receiver', tone: 'danger' };
  if (!g.fix) return { label: 'Searching for satellites', tone: 'warn' };
  const a = g.accuracyM;
  if (a === null || !Number.isFinite(a)) return { label: 'Position found', tone: 'ok' };
  if (a <= 5) return { label: 'Excellent', tone: 'ok' };
  if (a <= 15) return { label: 'Good', tone: 'ok' };
  if (a <= 50) return { label: 'Fair', tone: 'warn' };
  return { label: 'Poor', tone: 'warn' };
}

/** Seconds since an ISO time, or null when there is none (or it is in the future by more than a clock hiccup). */
export function secondsSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

/** Altitude in the unit the driver reads: metres, or feet. */
export function altitudeText(m: number | null, metric: boolean): string {
  if (m === null || !Number.isFinite(m)) return '–';
  return metric ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`;
}
