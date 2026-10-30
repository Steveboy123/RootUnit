import { describe, expect, it } from 'vitest';
import { ARM_GUARD_MS, ARM_WINDOW_MS, armedAt, DISARMED, tapArmed, type ArmedState } from './armed';

const arm = (id: string, at: number): ArmedState => ({ id, at });

describe('the armed stepper: scenes and actions need a second, deliberate tap', () => {
  it('uses the specified windows', () => {
    expect(ARM_WINDOW_MS).toBe(3500);
    expect(ARM_GUARD_MS).toBe(350);
  });

  it('the first tap arms, and nothing runs', () => {
    const r = tapArmed(DISARMED, 'night', 1000);
    expect(r.effect).toBe('arm');
    expect(r.state).toEqual({ id: 'night', at: 1000 });
    expect(armedAt(r.state, 1000)).toBe('night');
  });

  it('ignores a second tap within 350 ms of the first, and does not restart the window', () => {
    const first = tapArmed(DISARMED, 'night', 1000).state;
    for (const dt of [0, 1, 100, 349]) {
      const r = tapArmed(first, 'night', 1000 + dt);
      expect(r.effect, `+${dt}`).toBe('ignore');
      expect(r.state).toBe(first); // untouched: the very same object
    }
    // The ignored taps did not extend the window: it still closes 3.5 s after the FIRST tap.
    expect(tapArmed(first, 'night', 1000 + 3500).effect).toBe('arm');
  });

  it('runs on a deliberate second tap (350 ms or more, under 3.5 s later) and then disarms', () => {
    const first = tapArmed(DISARMED, 'night', 1000).state;
    for (const dt of [350, 351, 1200, 3499]) {
      const r = tapArmed(first, 'night', 1000 + dt);
      expect(r.effect, `+${dt}`).toBe('run');
      expect(r.state).toBe(DISARMED);
    }
  });

  it('expires at exactly 3.5 s: the next tap arms again instead of running', () => {
    const first = tapArmed(DISARMED, 'night', 0).state;
    expect(armedAt(first, 3499)).toBe('night');
    expect(armedAt(first, 3500)).toBeNull();
    const r = tapArmed(first, 'night', 3500);
    expect(r.effect).toBe('arm');
    expect(r.state).toEqual({ id: 'night', at: 3500 });
    expect(tapArmed(first, 'night', 60_000).effect).toBe('arm');
  });

  it('only one item is armed at a time: tapping another moves the arming, and the first needs two taps again', () => {
    const a = tapArmed(DISARMED, 'night', 0).state;
    const b = tapArmed(a, 'garage', 500);
    expect(b.effect).toBe('arm');
    expect(armedAt(b.state, 600)).toBe('garage');
    expect(tapArmed(b.state, 'night', 1000).effect).toBe('arm'); // night is no longer armed
  });

  it('after running, the same item must be armed again (no repeat-run on a held finger)', () => {
    const ran = tapArmed(tapArmed(DISARMED, 'night', 0).state, 'night', 400);
    expect(ran.effect).toBe('run');
    expect(tapArmed(ran.state, 'night', 800).effect).toBe('arm');
  });

  it('a clock that goes backwards counts as expired, never as armed forever', () => {
    const first = arm('night', 5000);
    expect(armedAt(first, 4000)).toBeNull();
    expect(tapArmed(first, 'night', 4000).effect).toBe('arm');
  });

  it('nothing is armed in the starting state', () => {
    expect(armedAt(DISARMED, 0)).toBeNull();
    expect(armedAt(DISARMED, 10_000)).toBeNull();
  });

  it('never changes the state it is given (a frozen state passes through every branch)', () => {
    const state = Object.freeze(arm('night', 1000));
    expect(() => {
      tapArmed(state, 'night', 1100); // ignore
      tapArmed(state, 'night', 1500); // run
      tapArmed(state, 'other', 1500); // re-arm elsewhere
      tapArmed(state, 'night', 9000); // expired
    }).not.toThrow();
    expect(state).toEqual({ id: 'night', at: 1000 });
  });
});
