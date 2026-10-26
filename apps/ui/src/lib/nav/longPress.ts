import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react';

export interface LongPressOptions {
  onLongPress(): void;
  /** False: no timer ever starts (the car is moving, or the editor is open). */
  enabled?: boolean;
  /** Hold time. Default 800 ms. */
  ms?: number;
  /** Movement allowed before it counts as a drag. Default 8 px. */
  slop?: number;
}

export interface LongPressProps {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  onPointerCancel(e: PointerEvent): void;
  onPointerLeave(e: PointerEvent): void;
  /** Swallows the click that follows a long press, so the item under the finger is not also run. */
  onClickCapture(e: MouseEvent): void;
  onContextMenu(e: MouseEvent): void;
}

export const LONG_PRESS_MS = 800;
export const LONG_PRESS_SLOP = 8;
/** The hold shows itself (a button fades) from here, so a person who did not mean to hold sees it and lets go. */
export const LONG_PRESS_CUE_MS = 300;
/** After a long press, the click the browser sends on release is swallowed for this long. */
export const CLICK_SUPPRESS_MS = 450;

/**
 * The whole decision, with no timers and no DOM, so it is tested with a made-up clock. Times are in ms on any one clock.
 * idle: nothing is pressed · holding: one finger is down and still · fired: the hold completed (waiting for the finger to lift).
 */
export interface PressState {
  readonly phase: 'idle' | 'holding' | 'fired';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly since: number;
  /** True from the cue time until the hold ends: draw the "something is about to happen" fade. */
  readonly cue: boolean;
  /** A click before this time is the tail of a long press and is swallowed. 0: none. */
  readonly suppressUntil: number;
}
export const PRESS_IDLE: PressState = { phase: 'idle', id: -1, x: 0, y: 0, since: 0, cue: false, suppressUntil: 0 };

export type PressEvent =
  | { type: 'down'; id: number; x: number; y: number; at: number; primary?: boolean }
  | { type: 'move'; id: number; x: number; y: number; at: number }
  | { type: 'up'; id: number; at: number }
  /** pointercancel (the browser took the touch to scroll) or pointerleave (the finger slid off the rail). */
  | { type: 'cancel'; at: number }
  /** Time has passed: the hold may be complete. */
  | { type: 'tick'; at: number };

export interface PressStep {
  state: PressState;
  /** The long press just completed: do the thing, once. */
  fire: boolean;
  /** Ask for a `tick` after this many ms (the next moment that matters), or null for none. */
  wake: number | null;
}

export interface PressConfig {
  ms: number;
  slop: number;
  cueMs?: number;
  suppressMs?: number;
}

const stop = (state: PressState): PressStep => ({ state, fire: false, wake: null });
const release = (state: PressState, keep: number): PressState => ({ ...PRESS_IDLE, suppressUntil: keep > state.suppressUntil ? keep : state.suppressUntil });

/** One event in, the next state out. A hold is cancelled by lifting, the browser cancelling, leaving the rail, a second finger or moving past the slop. */
export function pressStep(state: PressState, ev: PressEvent, cfg: PressConfig): PressStep {
  const cueMs = Math.min(cfg.cueMs ?? LONG_PRESS_CUE_MS, cfg.ms);
  const suppressMs = cfg.suppressMs ?? CLICK_SUPPRESS_MS;
  // An event that leaves the hold as it was must still say when to wake: the driver drops its timer on every event and only sets the
  // next one from this, so a `wake: null` here (a 1 px jitter, another finger lifting) would silently end a hold that is still going.
  const keep = (at: number): PressStep => ({ state, fire: false, wake: state.phase === 'holding' ? Math.max(0, (state.cue ? cfg.ms : cueMs) - (at - state.since)) : null });
  switch (ev.type) {
    case 'down': {
      // A second finger (or any non-primary pointer) is a pinch or a stray palm, not a hold: end the one in progress and start nothing.
      if (state.phase !== 'idle' || ev.primary === false) return stop(state.phase === 'holding' ? release(state, 0) : state);
      return { state: { ...state, phase: 'holding', id: ev.id, x: ev.x, y: ev.y, since: ev.at, cue: cueMs <= 0 }, fire: false, wake: Math.max(0, cueMs > 0 ? cueMs : cfg.ms) };
    }
    case 'move': {
      if (state.phase !== 'holding' || ev.id !== state.id) return keep(ev.at);
      const moved = Math.hypot(ev.x - state.x, ev.y - state.y);
      return moved > cfg.slop ? stop(release(state, 0)) : keep(ev.at);
    }
    case 'up': {
      if (ev.id !== state.id) return keep(ev.at);
      if (state.phase === 'holding') return stop(release(state, 0));
      // The hold had completed: the click that follows the release must not run whatever is under the finger.
      if (state.phase === 'fired') return stop(release(state, ev.at + suppressMs));
      return stop(state);
    }
    case 'cancel':
      return stop(state.phase === 'idle' ? state : release(state, 0));
    case 'tick': {
      if (state.phase !== 'holding') return stop(state);
      const elapsed = ev.at - state.since;
      if (elapsed >= cfg.ms) return { state: { ...state, phase: 'fired', cue: false, suppressUntil: ev.at + suppressMs }, fire: true, wake: null };
      const cue = elapsed >= cueMs;
      return { state: cue === state.cue ? state : { ...state, cue }, fire: false, wake: Math.max(0, (cue ? cfg.ms : cueMs) - elapsed) };
    }
  }
}

/** What the guard needs from `window`: tests hand it a fake. */
export interface GuardHost {
  addEventListener(type: string, fn: (e: Event) => void, capture: boolean): void;
  removeEventListener(type: string, fn: (e: Event) => void, capture: boolean): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number | undefined): void;
}
/** A hold that is never released (the element vanished, the page lost focus) stops guarding after this long. */
export const GUARD_MAX_HOLD_MS = 10_000;

/**
 * The release of a long press sends a click to whatever is under the finger BY THEN, and a hold often opens something right there (the
 * Apps tile menu, the editor): the click would land on its buttons or its backdrop. So the tile's own capture handler is not enough;
 * this stands on the window, in the capture phase, from the moment the hold fires. It swallows the first click that arrives within
 * `suppressMs` of the release (measured from the pointerup, wherever it happens) and then removes itself. Returns a function that removes it at once.
 */
export function guardNextClick(host: GuardHost, now: () => number, suppressMs: number = CLICK_SUPPRESS_MS): () => void {
  let until = Infinity;
  let done = false;
  let timer: number | undefined;
  const off = () => {
    if (done) return;
    done = true;
    host.removeEventListener('click', onClick, true);
    host.removeEventListener('pointerup', onRelease, true);
    host.removeEventListener('pointercancel', onRelease, true);
    host.clearTimeout(timer);
  };
  function onClick(e: Event) {
    if (now() < until) {
      e.stopPropagation();
      e.preventDefault();
    }
    off();
  }
  function onRelease() {
    until = now() + suppressMs;
    host.clearTimeout(timer);
    timer = host.setTimeout(off, suppressMs + 50);
  }
  host.addEventListener('click', onClick, true);
  host.addEventListener('pointerup', onRelease, true);
  host.addEventListener('pointercancel', onRelease, true);
  timer = host.setTimeout(off, GUARD_MAX_HOLD_MS);
  return off;
}

/** Is this click the tail of a long press? Only the first one after it is swallowed. */
export function consumeClick(state: PressState, at: number): { state: PressState; swallow: boolean } {
  if (at < state.suppressUntil) return { state: { ...state, suppressUntil: 0 }, swallow: true };
  return { state, swallow: false };
}

/**
 * Props for any element (or row of buttons) that should react to a held press: spread them on the container. The container's own
 * buttons keep working for a tap. `data-pressing` is set on the pressed button from the cue time and removed when the hold ends (CSS
 * fades it: opacity only); the browser's long-press menu is always blocked.
 */
export function useLongPress(options: LongPressOptions): LongPressProps {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const core = useRef({ state: PRESS_IDLE, timer: undefined as number | undefined, pressed: null as Element | null, marked: null as Element | null, cancel: () => {}, unguard: () => {} });

  const handlers = useMemo<LongPressProps>(() => {
    const c = core.current;
    const clock = () => performance.now();
    const mark = (el: Element | null) => {
      if (c.marked === el) return;
      c.marked?.removeAttribute('data-pressing');
      c.marked = el;
      el?.setAttribute('data-pressing', 'true');
    };
    const run = (ev: PressEvent) => {
      const cfg = { ms: latest.current.ms ?? LONG_PRESS_MS, slop: latest.current.slop ?? LONG_PRESS_SLOP };
      const step = pressStep(c.state, ev, cfg);
      c.state = step.state;
      window.clearTimeout(c.timer);
      // The next moment that matters (the cue, then the fire) is a timer; the machine is told what time it is when it goes off.
      c.timer = step.wake === null ? undefined : window.setTimeout(() => run({ type: 'tick', at: clock() }), step.wake);
      mark(step.state.cue ? c.pressed : null);
      if (step.state.phase === 'idle') c.pressed = null;
      if (step.fire) {
        // Before the hold's action (which may open something under the finger): the click that ends this press must not reach it.
        c.unguard();
        if (typeof window.addEventListener === 'function') c.unguard = guardNextClick(window as unknown as GuardHost, clock);
        latest.current.onLongPress();
      }
    };
    c.cancel = () => run({ type: 'cancel', at: clock() });
    // The cue goes on the button under the finger (or, in the padding between buttons, on the container).
    const holder = (e: PointerEvent): Element | null => (e.target instanceof Element ? (e.target.closest('button') ?? (e.currentTarget instanceof Element ? e.currentTarget : null)) : null);

    return {
      onPointerDown(e) {
        if (latest.current.enabled === false) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (c.state.phase === 'idle') c.pressed = holder(e);
        run({ type: 'down', id: e.pointerId, x: e.clientX, y: e.clientY, at: clock(), primary: e.isPrimary });
      },
      onPointerMove(e) {
        if (c.state.phase !== 'idle') run({ type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY, at: clock() });
      },
      onPointerUp(e) {
        if (c.state.phase !== 'idle') run({ type: 'up', id: e.pointerId, at: clock() });
      },
      onPointerCancel: () => c.cancel(),
      onPointerLeave: () => c.cancel(),
      onClickCapture(e) {
        const r = consumeClick(c.state, clock());
        c.state = r.state;
        if (!r.swallow) return;
        e.stopPropagation();
        e.preventDefault();
      },
      onContextMenu: (e) => e.preventDefault(),
    };
  }, []);

  // The editor opened (or the car started moving) while a finger was down: forget the hold. On unmount: no stray timer, no stuck cue.
  const enabled = options.enabled !== false;
  useEffect(() => {
    if (!enabled) core.current.cancel();
  }, [enabled]);
  useEffect(
    () => () => {
      const c = core.current;
      window.clearTimeout(c.timer);
      c.marked?.removeAttribute('data-pressing');
      c.marked = null;
    },
    [],
  );
  return handlers;
}
