import type { Route } from '../store';

/** Moving at least this fast (km/h), for long enough, counts as setting off. */
export const DRIVE_START_KMH = 15;
export const DRIVE_START_HOLD_MS = 5000;
/** Below this the car is taken to have stopped, and the Drive screen may trigger again on the next journey. */
export const DRIVE_REARM_KMH = 5;

export interface DriveAutoState {
  movingSince: number | null;
  armed: boolean;
}

/**
 * "Open the Drive screen by itself when the car gets moving", at most once per journey: it fires after DRIVE_START_HOLD_MS of
 * steady movement, then not again until the car has stopped (so leaving the screen on purpose is respected).
 */
export function stepDriveAuto(state: DriveAutoState, kmh: number | null, now: number): { state: DriveAutoState; trigger: boolean } {
  if (kmh === null || kmh < DRIVE_REARM_KMH) return { state: { movingSince: null, armed: true }, trigger: false };
  if (kmh < DRIVE_START_KMH) return { state: { ...state, movingSince: null }, trigger: false };
  const movingSince = state.movingSince ?? now;
  if (state.armed && now - movingSince >= DRIVE_START_HOLD_MS) return { state: { movingSince, armed: false }, trigger: true };
  return { state: { ...state, movingSince }, trigger: false };
}

export interface StandbyInput {
  /** How long since the screen was last touched, ms. */
  idleMs: number;
  /** Settings, minutes; 0 = never. */
  standbyMin: number;
  /** The car's speed, or null when unknown. */
  speedKmh: number | null;
  route: Route;
  standby: boolean;
  cameraActive: boolean;
  projectionActive: boolean;
}

/** Should the standby clock come up now? Only when parked (or speed unknown), idle long enough, and nothing more important is on screen. */
export function shouldEnterStandby(i: StandbyInput): boolean {
  if (i.standbyMin <= 0 || i.standby || i.cameraActive || i.projectionActive) return false;
  if (i.route === 'aa') return false;
  if (i.speedKmh !== null && i.speedKmh > 2) return false;
  return i.idleMs >= i.standbyMin * 60_000;
}

/** Standby ends by itself the moment the car is moving: a clock must never be the thing on screen at speed. */
export function shouldLeaveStandby(i: Pick<StandbyInput, 'standby' | 'speedKmh' | 'cameraActive' | 'projectionActive'>): boolean {
  return i.standby && (i.cameraActive || i.projectionActive || (i.speedKmh !== null && i.speedKmh > 5));
}
