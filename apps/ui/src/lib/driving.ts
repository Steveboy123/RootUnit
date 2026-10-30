import { useEffect, useReducer } from 'react';
import { DRIVING_SPEED_KMH } from '@headunit/shared';
import { useHeadUnit } from '../store';

/**
 * Should text entry be locked right now? True while the car is moving (live speed above the
 * threshold), the setting is on, and nobody has said "I'm a passenger". With no live speed
 * (no live OBD connection) it's never locked — we won't lock people out on a guess.
 */
export function isLocked(opts: { lockSetting: boolean; connected: boolean; speedKmh: number; passenger: boolean }): boolean {
  return opts.lockSetting && !opts.passenger && opts.connected && opts.speedKmh > DRIVING_SPEED_KMH;
}

export interface BestSpeed {
  kmh: number;
  /** Where the number comes from: the car (OBD) or the satellites (GPS). */
  source: 'obd' | 'gps';
}

/**
 * The speed to trust right now: the car's own (OBD) when it is connected, otherwise the GPS's. Null when neither is live, and then
 * nothing is locked and no speedometer is drawn (a guess is never shown as a measurement).
 */
export function bestSpeed(vehicle: { connected: boolean; speedKmh: number; unsupported?: string[] } | null | undefined, gps: { fix: boolean; speedKmh: number | null } | null | undefined): BestSpeed | null {
  if (vehicle?.connected && !vehicle.unsupported?.includes('speedKmh')) return { kmh: vehicle.speedKmh, source: 'obd' };
  if (gps?.fix && gps.speedKmh !== null) return { kmh: gps.speedKmh, source: 'gps' };
  return null;
}

export const liveSpeedKmh = (vehicle: Parameters<typeof bestSpeed>[0], gps: Parameters<typeof bestSpeed>[1]): number | null => bestSpeed(vehicle, gps)?.kmh ?? null;

/** The live best speed, kept current. */
export function useBestSpeed(): BestSpeed | null {
  const vehicle = useHeadUnit((s) => s.vehicle);
  const gps = useHeadUnit((s) => s.svc.gps);
  return bestSpeed(vehicle, gps);
}

/**
 * A speed that disappears right after the car was moving (a tunnel, a GPS dropout, an OBD adapter that lost its link) is not a stopped
 * car: for this long after the last reading above the driving threshold it still counts as moving. With no recent movement an unknown
 * speed still never locks (we will not lock people out on a guess), and any real reading at or below the threshold ends the hold at once.
 */
/** What every refused arrangement edit says: why, and the way out for someone who is not driving. */
export const EDIT_LOCKED_MESSAGE = 'Pull over to customise navigation, or tap “I’m a passenger” in the Quick Panel.';
export const MOVING_HOLD_MS = 60_000;
let lastMovingAt: number | null = null;

/** Feed every speed reading in (null = unknown). Anything known replaces the memory: above the threshold it is "moving now", else cleared. */
export function noteSpeed(kmh: number | null, now: number): void {
  if (kmh === null) return;
  lastMovingAt = kmh > DRIVING_SPEED_KMH ? now : null;
}

/** How much longer an unknown speed still counts as moving (0 when it does not). */
export function holdRemainingMs(now: number): number {
  return lastMovingAt === null ? 0 : Math.max(0, lastMovingAt + MOVING_HOLD_MS - now);
}

/** For tests: forget the last movement. */
export function resetSpeedMemory(): void {
  lastMovingAt = null;
}

type LockInputs = Pick<ReturnType<typeof useHeadUnit.getState>, 'vehicle' | 'svc' | 'settings' | 'passenger'>;

/** Is editing (typing, rearranging navigation) locked right now? The live speed, or the recent past of it; the setting; the passenger override. */
export function lockedFor(st: LockInputs, now: number = Date.now()): boolean {
  const speed = liveSpeedKmh(st.vehicle, st.svc.gps);
  noteSpeed(speed, now);
  const held = speed === null && holdRemainingMs(now) > 0;
  return isLocked({ lockSetting: st.settings?.lockWhileDriving ?? true, connected: speed !== null || held, speedKmh: held ? DRIVING_SPEED_KMH + 1 : (speed ?? 0), passenger: st.passenger });
}

/** The same answer for code that is not a component (opening the editor from a long-press). */
export const isEditLocked = (): boolean => lockedFor(useHeadUnit.getState());

// Watch every reading, not only when something happens to ask: "how long ago was it moving" needs the whole history.
useHeadUnit.subscribe((s) => noteSpeed(liveSpeedKmh(s.vehicle, s.svc.gps), Date.now()));

const selectTypingLocked = (s: LockInputs): boolean => lockedFor(s);

/**
 * True while editing should be refused. It subscribes to the yes/no answer, not to the speed, so a screen only re-renders when the lock
 * flips (not at every vehicle tick); while a dropout is being held it wakes itself when the hold ends.
 */
export function useTypingLocked(): boolean {
  const locked = useHeadUnit(selectTypingLocked);
  const [, wake] = useReducer((n: number) => n + 1, 0);
  const left = locked ? holdRemainingMs(Date.now()) : 0;
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(wake, left + 50);
    return () => window.clearTimeout(id);
  }, [left]);
  return locked;
}
