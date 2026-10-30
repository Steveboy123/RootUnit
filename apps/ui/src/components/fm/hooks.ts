import { useEffect, useRef, useState } from 'react';
import type { FmState } from '@headunit/shared';
import { createTuner, fmCalls, type FmTuner } from '../../lib/fm';
import { useHeadUnit } from '../../store';

/**
 * The head unit's answer to a change is the newest word on the state, so it goes straight into the store: the dial and the switch
 * follow a tap at once, and the pushed state that follows it says the same.
 */
export function rememberFmState(state: FmState | null): void {
  if (state) useHeadUnit.setState((s) => ({ svc: { ...s.svc, fm: state } }));
}

/**
 * The frequency to show on the dial, and the two ways to change it. `shown` is the frequency just asked for while the head unit has not
 * confirmed it yet, otherwise the head unit's own (it may also be changed from another screen).
 */
export function useFmTuner(reported: number | null): { shown: number | null; step(to: number): void; jump(to: number): void } {
  const [pending, setPending] = useState<number | null>(null);
  const tuner = useRef<FmTuner | null>(null);
  if (tuner.current === null) {
    tuner.current = createTuner({
      send: async (f) => rememberFmState(await fmCalls.tune(f)),
      onPending: setPending,
      onError: (e) => useHeadUnit.getState().showToast(e instanceof Error ? e.message : 'That did not work.'),
    });
  }
  // Leaving the page with a tap still waiting: send it rather than lose it.
  useEffect(() => () => tuner.current?.flush(), []);
  const t = tuner.current;
  return { shown: pending ?? reported, step: (to) => t.set(to), jump: (to) => t.now(to) };
}
