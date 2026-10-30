import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the first tap keeps a scene or action armed. */
export const ARM_WINDOW_MS = 3500;
/**
 * A second tap this soon after the first is not a decision: it is one touch that bounced, or a double-tap by accident. It is ignored
 * (and does not restart the window), so a stray touch can never open a garage door.
 */
export const ARM_GUARD_MS = 350;

/** The clock the hook uses: monotonic, so a wall-clock change (the Pi syncing its time) can never leave something armed or expire it early. */
const monotonicNow = () => performance.now();

/** Which item is armed (at most one) and when it was armed. */
export interface ArmedState {
  readonly id: string | null;
  readonly at: number;
}
export const DISARMED: ArmedState = { id: null, at: 0 };

/** arm: first tap · run: a deliberate second tap · ignore: too soon after the first (nothing changes). */
export type ArmedEffect = 'arm' | 'run' | 'ignore';

/**
 * The id that is armed right now, or null once the window has closed. A clock that went backwards counts as closed: the monotonic clock
 * the hook uses never does that, but a test (or a different clock) must not be able to leave something armed forever.
 */
export function armedAt(state: ArmedState, now: number): string | null {
  return state.id !== null && now >= state.at && now - state.at < ARM_WINDOW_MS ? state.id : null;
}

/** One tap on item `id`. Pure: the clock is passed in. Tapping a different item moves the arming to it. */
export function tapArmed(state: ArmedState, id: string, now: number): { state: ArmedState; effect: ArmedEffect } {
  if (armedAt(state, now) !== id) return { state: { id, at: now }, effect: 'arm' };
  if (now - state.at < ARM_GUARD_MS) return { state, effect: 'ignore' };
  return { state: DISARMED, effect: 'run' };
}

/**
 * The stepper for the rail's scene and action buttons. `tap(id)` says what to do with the tap; `armedId` is what to draw as armed (it
 * falls back to null by itself after the window, with no tap needed). Only one item is armed at a time.
 */
export function useArmedStep(clock: () => number = monotonicNow) {
  const state = useRef<ArmedState>(DISARMED);
  const timer = useRef<number | undefined>(undefined);
  const [armedId, setArmedId] = useState<string | null>(null);

  const set = useCallback((next: ArmedState) => {
    state.current = next;
    window.clearTimeout(timer.current);
    setArmedId(next.id);
    if (next.id !== null) {
      timer.current = window.setTimeout(() => {
        state.current = DISARMED;
        setArmedId(null);
      }, ARM_WINDOW_MS);
    }
  }, []);

  const tap = useCallback(
    (id: string): ArmedEffect => {
      const r = tapArmed(state.current, id, clock());
      if (r.effect !== 'ignore') set(r.state);
      return r.effect;
    },
    [clock, set],
  );
  const clear = useCallback(() => {
    if (state.current.id !== null) set(DISARMED);
  }, [set]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { armedId, tap, clear };
}

/** A flag that falls back to false after the window (the "tap again to confirm" state of a single button). */
export function useArmed(): [boolean, (v: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), ARM_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, [armed]);
  return [armed, setArmed];
}
