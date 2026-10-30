import { beforeEach, describe, expect, it } from 'vitest';
import { bestSpeed, holdRemainingMs, isLocked, liveSpeedKmh, lockedFor, MOVING_HOLD_MS, noteSpeed, resetSpeedMemory } from './driving';

describe('liveSpeedKmh', () => {
  it("prefers the car's own speed when it is connected", () => {
    expect(liveSpeedKmh({ connected: true, speedKmh: 52 }, { fix: true, speedKmh: 50 })).toBe(52);
  });
  it('falls back to GPS when the car is not connected', () => {
    expect(liveSpeedKmh({ connected: false, speedKmh: 0 }, { fix: true, speedKmh: 50 })).toBe(50);
    expect(liveSpeedKmh(null, { fix: true, speedKmh: 0 })).toBe(0);
  });
  it('is unknown without either, so nothing gets locked on a guess', () => {
    expect(liveSpeedKmh({ connected: false, speedKmh: 99 }, { fix: false, speedKmh: 40 })).toBeNull();
    expect(liveSpeedKmh(null, null)).toBeNull();
    expect(liveSpeedKmh(undefined, { fix: true, speedKmh: null })).toBeNull();
  });
});

describe('isLocked', () => {
  const base = { lockSetting: true, connected: true, speedKmh: 40, passenger: false };
  it('locks while moving', () => expect(isLocked(base)).toBe(true));
  it('not when parked, a passenger, switched off, or with no live speed', () => {
    expect(isLocked({ ...base, speedKmh: 3 })).toBe(false);
    expect(isLocked({ ...base, passenger: true })).toBe(false);
    expect(isLocked({ ...base, lockSetting: false })).toBe(false);
    expect(isLocked({ ...base, connected: false })).toBe(false);
  });
});

describe('bestSpeed', () => {
  it('says where the number came from', () => {
    expect(bestSpeed({ connected: true, speedKmh: 52 }, { fix: true, speedKmh: 50 })).toEqual({ kmh: 52, source: 'obd' });
    expect(bestSpeed({ connected: false, speedKmh: 0 }, { fix: true, speedKmh: 50 })).toEqual({ kmh: 50, source: 'gps' });
    expect(bestSpeed(null, null)).toBeNull();
  });
  it('skips a car that does not report speed', () => {
    expect(bestSpeed({ connected: true, speedKmh: 0, unsupported: ['speedKmh'] }, { fix: true, speedKmh: 33 })).toEqual({ kmh: 33, source: 'gps' });
  });
});

describe('a speed that drops out right after the car was moving', () => {
  const T = 1_000_000;
  const parked = { vehicle: null, svc: {}, settings: { lockWhileDriving: true }, passenger: false } as never;
  const withObd = (speedKmh: number) => ({ vehicle: { connected: true, speedKmh }, svc: {}, settings: { lockWhileDriving: true }, passenger: false }) as never;
  beforeEach(() => resetSpeedMemory());

  it('keeps counting as moving for a minute, then lets go', () => {
    expect(lockedFor(withObd(100), T)).toBe(true);
    expect(lockedFor(parked, T + 1)).toBe(true); // the adapter lost its link, no GPS fix: still moving
    expect(lockedFor(parked, T + MOVING_HOLD_MS - 1)).toBe(true);
    expect(lockedFor(parked, T + MOVING_HOLD_MS + 1)).toBe(false);
  });

  it('a real reading at or below the threshold ends the hold at once', () => {
    lockedFor(withObd(100), T);
    expect(lockedFor(withObd(5), T + 10)).toBe(false);
    expect(lockedFor(parked, T + 20)).toBe(false); // and a dropout after THAT is not "moving"
  });

  it('never locks on a speed that was never known, and the passenger or the setting still lift it', () => {
    expect(lockedFor(parked, T)).toBe(false);
    lockedFor(withObd(100), T);
    expect(lockedFor({ ...(parked as object), passenger: true } as never, T + 5)).toBe(false);
    expect(lockedFor({ ...(parked as object), settings: { lockWhileDriving: false } } as never, T + 5)).toBe(false);
  });

  it('tracks the remaining hold and forgets on reset', () => {
    noteSpeed(60, T);
    expect(holdRemainingMs(T + 10_000)).toBe(MOVING_HOLD_MS - 10_000);
    expect(holdRemainingMs(T + MOVING_HOLD_MS + 5)).toBe(0);
    noteSpeed(null, T + 100); // unknown readings change nothing
    expect(holdRemainingMs(T + 10_000)).toBe(MOVING_HOLD_MS - 10_000);
    resetSpeedMemory();
    expect(holdRemainingMs(T)).toBe(0);
  });
});
