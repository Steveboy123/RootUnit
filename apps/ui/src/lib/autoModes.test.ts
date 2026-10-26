import { describe, expect, it } from 'vitest';
import { shouldEnterStandby, shouldLeaveStandby, stepDriveAuto, type DriveAutoState, type StandbyInput } from './autoModes';

const fresh = (): DriveAutoState => ({ movingSince: null, armed: true });

/** Run a series of [seconds, kmh] readings, one per second, and say when it triggered. */
function run(readings: Array<[number, number | null]>): number[] {
  let s = fresh();
  const fired: number[] = [];
  let t = 0;
  for (const [seconds, kmh] of readings) {
    for (let i = 0; i < seconds; i++) {
      const r = stepDriveAuto(s, kmh, t * 1000);
      s = r.state;
      if (r.trigger) fired.push(t);
      t++;
    }
  }
  return fired;
}

describe('stepDriveAuto', () => {
  it('fires once the car has been moving steadily for 5 seconds', () => {
    expect(run([[10, 40]])).toEqual([5]);
  });
  it('does not fire for a short burst', () => {
    expect(run([[3, 40], [10, 0]])).toEqual([]);
  });
  it('does not fire at crawling speed', () => {
    expect(run([[60, 10]])).toEqual([]);
  });
  it('fires only once per journey, even if the driver goes elsewhere on screen', () => {
    expect(run([[30, 60]])).toEqual([5]);
  });
  it('is ready again after the car has stopped', () => {
    expect(run([[10, 60], [5, 0], [10, 60]])).toEqual([5, 20]);
  });
  it('a slow-down in traffic (still rolling) does not re-arm it, a full stop does', () => {
    expect(run([[10, 60], [10, 8], [10, 60]])).toEqual([5]);
  });
  it('restarts the clock if speed drops in between (a stop-start crawl)', () => {
    // 3 s fast (t=0-2), 2 s crawling (t=3-4): the clock resets, the next fast run starts at t=5 and so fires at t=10, not t=5.
    expect(run([[3, 40], [2, 8], [3, 40], [10, 40]])).toEqual([10]);
  });
  it('unknown speed counts as stopped', () => {
    expect(run([[10, 60], [2, null], [10, 60]])).toEqual([5, 17]);
  });
});

describe('shouldEnterStandby', () => {
  const base: StandbyInput = { idleMs: 11 * 60_000, standbyMin: 10, speedKmh: 0, route: 'home', standby: false, cameraActive: false, projectionActive: false };
  it('comes up when parked and idle long enough', () => expect(shouldEnterStandby(base)).toBe(true));
  it('never when switched off', () => expect(shouldEnterStandby({ ...base, standbyMin: 0 })).toBe(false));
  it('not before the time', () => expect(shouldEnterStandby({ ...base, idleMs: 9 * 60_000 })).toBe(false));
  it('not while moving, but fine when the speed is unknown (a head unit with no OBD or GPS)', () => {
    expect(shouldEnterStandby({ ...base, speedKmh: 30 })).toBe(false);
    expect(shouldEnterStandby({ ...base, speedKmh: null })).toBe(true);
  });
  it('not over the camera, Android Auto, or when it is already up', () => {
    expect(shouldEnterStandby({ ...base, cameraActive: true })).toBe(false);
    expect(shouldEnterStandby({ ...base, projectionActive: true })).toBe(false);
    expect(shouldEnterStandby({ ...base, route: 'aa' })).toBe(false);
    expect(shouldEnterStandby({ ...base, standby: true })).toBe(false);
  });
});

describe('shouldLeaveStandby', () => {
  it('leaves for the camera, Android Auto, or any real movement', () => {
    const base = { standby: true, speedKmh: 0, cameraActive: false, projectionActive: false };
    expect(shouldLeaveStandby(base)).toBe(false);
    expect(shouldLeaveStandby({ ...base, cameraActive: true })).toBe(true);
    expect(shouldLeaveStandby({ ...base, projectionActive: true })).toBe(true);
    expect(shouldLeaveStandby({ ...base, speedKmh: 12 })).toBe(true);
    expect(shouldLeaveStandby({ ...base, speedKmh: null })).toBe(false);
    expect(shouldLeaveStandby({ ...base, standby: false, speedKmh: 50 })).toBe(false);
  });
});
