import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { consumeClick, CLICK_SUPPRESS_MS, GUARD_MAX_HOLD_MS, guardNextClick, LONG_PRESS_CUE_MS, LONG_PRESS_MS, LONG_PRESS_SLOP, PRESS_IDLE, pressStep, useLongPress, type GuardHost, type LongPressProps, type PressConfig, type PressEvent, type PressState } from './longPress';

const cfg: PressConfig = { ms: LONG_PRESS_MS, slop: LONG_PRESS_SLOP };

/** Feed events in order; returns the final state and how many times it fired. A `tick` is only sent where the test says so. */
function run(events: PressEvent[], config: PressConfig = cfg, from: PressState = PRESS_IDLE) {
  let state = from;
  let fires = 0;
  let wake: number | null = null;
  for (const ev of events) {
    const step = pressStep(state, ev, config);
    state = step.state;
    wake = step.wake;
    if (step.fire) fires++;
  }
  return { state, fires, wake };
}
const down = (at = 0, id = 1, x = 100, y = 100): PressEvent => ({ type: 'down', id, x, y, at });

describe('long press: the numbers', () => {
  it('is 800 ms, 8 px, a cue from 300 ms, and a 450 ms click window', () => {
    expect([LONG_PRESS_MS, LONG_PRESS_SLOP, LONG_PRESS_CUE_MS, CLICK_SUPPRESS_MS]).toEqual([800, 8, 300, 450]);
  });
});

describe('long press: firing', () => {
  it('fires at 800 ms and not a moment before', () => {
    expect(run([down(), { type: 'tick', at: 799 }]).fires).toBe(0);
    expect(run([down(), { type: 'tick', at: 800 }]).fires).toBe(1);
  });

  it('fires once, even if the timer is late or ticks again', () => {
    const r = run([down(), { type: 'tick', at: 3000 }, { type: 'tick', at: 3001 }, { type: 'tick', at: 9000 }]);
    expect(r.fires).toBe(1);
    expect(r.state.phase).toBe('fired');
  });

  it('asks for the next tick at the cue, then at the fire (so a timer can be set from it alone)', () => {
    const a = pressStep(PRESS_IDLE, down(1000), cfg);
    expect(a.wake).toBe(300);
    const b = pressStep(a.state, { type: 'tick', at: 1300 }, cfg);
    expect(b.wake).toBe(500);
    const c = pressStep(b.state, { type: 'tick', at: 1450 }, cfg); // an early tick: asks for the rest
    expect(c.wake).toBe(350);
    expect(pressStep(c.state, { type: 'tick', at: 1800 }, cfg).wake).toBeNull();
  });

  it('honours its own hold time and slop', () => {
    const quick: PressConfig = { ms: 200, slop: 2 };
    expect(run([down(), { type: 'tick', at: 200 }], quick).fires).toBe(1);
    expect(run([down(), { type: 'move', id: 1, x: 103, y: 100, at: 50 }, { type: 'tick', at: 200 }], quick).fires).toBe(0);
  });

  it('with a hold shorter than the cue time there is still a cue-less fire at the hold time', () => {
    const r = run([down(), { type: 'tick', at: 50 }], { ms: 50, slop: 8, cueMs: 300 });
    expect(r.fires).toBe(1);
  });
});

describe('long press: the cue', () => {
  it('turns on at 300 ms and not before, and is off again once it fires', () => {
    const d = pressStep(PRESS_IDLE, down(), cfg).state;
    expect(d.cue).toBe(false);
    expect(pressStep(d, { type: 'tick', at: 299 }, cfg).state.cue).toBe(false);
    const cued = pressStep(d, { type: 'tick', at: 300 }, cfg).state;
    expect(cued.cue).toBe(true);
    expect(pressStep(cued, { type: 'tick', at: 800 }, cfg).state.cue).toBe(false);
  });

  it('goes away when the hold is cancelled', () => {
    const cued = run([down(), { type: 'tick', at: 400 }]).state;
    expect(cued.cue).toBe(true);
    for (const end of [{ type: 'up', id: 1, at: 500 }, { type: 'cancel', at: 500 }, { type: 'move', id: 1, x: 200, y: 100, at: 500 }] as const) {
      expect(pressStep(cued, end, cfg).state.cue, end.type).toBe(false);
    }
  });
});

describe('long press: what cancels a hold', () => {
  it('moving more than 8 px (a drag or a scroll), measured as distance, not per axis', () => {
    const at = (x: number, y: number): PressEvent => ({ type: 'move', id: 1, x, y, at: 100 });
    expect(run([down(), at(108, 100), { type: 'tick', at: 800 }]).fires).toBe(1); // exactly 8 px: still a hold
    expect(run([down(), at(100, 108.01), { type: 'tick', at: 800 }]).fires).toBe(0);
    expect(run([down(), at(106, 106), { type: 'tick', at: 800 }]).fires).toBe(0); // 8.49 px on the diagonal
    expect(run([down(), at(94, 94), { type: 'tick', at: 800 }]).fires).toBe(0);
  });

  it('small jitter around the start never cancels', () => {
    const moves = [101, 99, 103, 98, 104, 100].map((x, i): PressEvent => ({ type: 'move', id: 1, x, y: 100 + (i % 2), at: 50 * (i + 1) }));
    expect(run([down(), ...moves, { type: 'tick', at: 800 }]).fires).toBe(1);
  });

  it('pointercancel (the browser took the touch to scroll) and pointerleave (slid off the rail)', () => {
    expect(run([down(), { type: 'cancel', at: 400 }, { type: 'tick', at: 800 }]).fires).toBe(0);
  });

  it('an early release', () => {
    const r = run([down(), { type: 'up', id: 1, at: 500 }, { type: 'tick', at: 800 }]);
    expect(r.fires).toBe(0);
    expect(r.state).toEqual(PRESS_IDLE);
    // ...and an ordinary tap's click is not swallowed
    expect(consumeClick(r.state, 510).swallow).toBe(false);
  });

  it('a second finger (a different pointer, or one that is not primary)', () => {
    expect(run([down(0, 1), down(100, 2), { type: 'tick', at: 800 }]).fires).toBe(0);
    expect(run([down(0, 1), { type: 'down', id: 2, x: 50, y: 50, at: 100, primary: false }, { type: 'tick', at: 800 }]).fires).toBe(0);
  });

  it('a stray non-primary touch with nothing pressed starts nothing', () => {
    const r = run([{ type: 'down', id: 2, x: 0, y: 0, at: 0, primary: false }, { type: 'tick', at: 800 }]);
    expect(r.fires).toBe(0);
    expect(r.state.phase).toBe('idle');
  });

  it('other pointers moving or lifting do not disturb the hold', () => {
    const r = run([down(0, 1), { type: 'move', id: 7, x: 500, y: 500, at: 100 }, { type: 'up', id: 7, at: 200 }, { type: 'tick', at: 800 }]);
    expect(r.fires).toBe(1);
  });

  it('events with nothing pressed are harmless', () => {
    for (const ev of [{ type: 'move', id: 1, x: 5, y: 5, at: 1 }, { type: 'up', id: 1, at: 1 }, { type: 'cancel', at: 1 }, { type: 'tick', at: 1 }] as const) {
      expect(pressStep(PRESS_IDLE, ev, cfg)).toEqual({ state: PRESS_IDLE, fire: false, wake: null });
    }
  });

  it('a new hold can start after a cancelled one', () => {
    expect(run([down(0), { type: 'cancel', at: 100 }, down(1000), { type: 'tick', at: 1800 }]).fires).toBe(1);
  });
});

describe('long press: swallowing the click that follows', () => {
  const fired = () => run([down(), { type: 'tick', at: 800 }]).state;

  it('swallows only the very next click, within 450 ms', () => {
    const s = fired();
    const first = consumeClick(s, 801);
    expect(first.swallow).toBe(true);
    expect(consumeClick(first.state, 802).swallow).toBe(false);
  });

  it('measures the 450 ms from the moment the finger lifts (a long hold still has its click blocked)', () => {
    let s = fired();
    s = pressStep(s, { type: 'up', id: 1, at: 6000 }, cfg).state;
    expect(consumeClick(s, 6449).swallow).toBe(true);
    expect(consumeClick(s, 6450).swallow).toBe(false);
  });

  it('and from the fire itself if the click comes first', () => {
    const s = fired();
    expect(consumeClick(s, 1249).swallow).toBe(true);
    expect(consumeClick(s, 1250).swallow).toBe(false);
  });

  it('a cancelled hold leaves no window behind', () => {
    const s = run([down(), { type: 'tick', at: 400 }, { type: 'move', id: 1, x: 300, y: 300, at: 450 }]).state;
    expect(consumeClick(s, 460).swallow).toBe(false);
  });

  it('a click long after is a real tap', () => {
    let s = fired();
    s = pressStep(s, { type: 'up', id: 1, at: 900 }, cfg).state;
    expect(consumeClick(s, 900 + CLICK_SUPPRESS_MS).swallow).toBe(false);
  });

  it('the window survives a cancel that arrives after the fire (the finger slid off)', () => {
    const s = pressStep(fired(), { type: 'cancel', at: 900 }, cfg).state;
    expect(s.phase).toBe('idle');
    expect(consumeClick(s, 1000).swallow).toBe(true);
  });
});

describe('long press: never changes the state it is given', () => {
  it('a frozen state passes through every event', () => {
    const states = [PRESS_IDLE, run([down()]).state, run([down(), { type: 'tick', at: 900 }]).state].map((s) => Object.freeze({ ...s }));
    const events: PressEvent[] = [down(5), { type: 'move', id: 1, x: 300, y: 300, at: 1 }, { type: 'up', id: 1, at: 1 }, { type: 'cancel', at: 1 }, { type: 'tick', at: 2000 }];
    for (const s of states) for (const ev of events) expect(() => pressStep(s, ev, cfg)).not.toThrow();
    expect(() => consumeClick(Object.freeze({ ...PRESS_IDLE, suppressUntil: 10 }), 5)).not.toThrow();
  });
});

// ---- The window-level guard: the click that ends a hold lands on whatever the hold opened ----

class FakeHost implements GuardHost {
  t = 0;
  listeners = new Map<string, Set<(e: Event) => void>>();
  timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  addEventListener(type: string, fn: (e: Event) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(id: number | undefined) {
    if (id !== undefined) this.timers.delete(id);
  }
  advance(ms: number) {
    this.t += ms;
    for (const [id, tm] of [...this.timers]) if (tm.at <= this.t) { this.timers.delete(id); tm.fn(); }
  }
  count = () => [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  /** Send an event through the capture listeners; true when something stopped it. */
  send(type: string) {
    const e = { stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e as never);
    return e;
  }
}

describe('guardNextClick', () => {
  const make = () => {
    const host = new FakeHost();
    const off = guardNextClick(host, () => host.t);
    return { host, off };
  };

  it('swallows the click that follows the release, wherever it lands, and then removes itself', () => {
    const { host } = make();
    host.advance(1200); // a long hold
    host.send('pointerup');
    host.advance(20);
    const click = host.send('click');
    expect(click.stopped && click.prevented).toBe(true);
    expect(host.count()).toBe(0);
    expect(host.send('click').stopped).toBe(false);
  });

  it('measures the window from the release, not from the start of the hold', () => {
    const { host } = make();
    host.advance(5000);
    host.send('pointerup');
    host.advance(449);
    expect(host.send('click').stopped).toBe(true);
  });

  it('a click that comes after the window is a real tap and is left alone', () => {
    const { host } = make();
    host.send('pointerup');
    host.advance(451);
    expect(host.send('click').stopped).toBe(false);
  });

  it('is gone by itself shortly after the release even if no click ever comes', () => {
    const { host } = make();
    host.send('pointerup');
    host.advance(600);
    expect(host.count()).toBe(0);
    expect(host.timers.size).toBe(0);
  });

  it('a pointercancel ends the press the same way', () => {
    const { host } = make();
    host.send('pointercancel');
    expect(host.send('click').stopped).toBe(true);
  });

  it('a hold that is never released stops guarding after a while (it must not eat a tap an hour later)', () => {
    const { host } = make();
    host.advance(GUARD_MAX_HOLD_MS);
    expect(host.count()).toBe(0);
    expect(host.send('click').stopped).toBe(false);
  });

  it('can be removed at once', () => {
    const { host, off } = make();
    off();
    off();
    expect(host.count()).toBe(0);
    expect(host.timers.size).toBe(0);
  });
});

// ---- The hook around it, driven by hand (the UI tests run in node: no DOM, so a fake element and a fake clock) ----

class FakeElement {
  attrs = new Map<string, string>();
  closest(sel: string): FakeElement | null {
    return sel === 'button' ? this : null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
}

describe('useLongPress (the hook)', () => {
  const realElement = (globalThis as { Element?: unknown }).Element;
  const realWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    (globalThis as { Element?: unknown }).Element = FakeElement;
    (globalThis as { window?: unknown }).window = globalThis;
  });
  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { Element?: unknown }).Element = realElement;
    (globalThis as { window?: unknown }).window = realWindow;
  });

  /** Render the hook once on the server (no effects run) and keep the handlers it returns. */
  function mount(options: Parameters<typeof useLongPress>[0]) {
    let handlers!: LongPressProps;
    function Probe() {
      handlers = useLongPress(options);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    return handlers;
  }
  const pointer = (over: Record<string, unknown> = {}) => ({ pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: 10, clientY: 10, target: new FakeElement(), currentTarget: new FakeElement(), ...over }) as never;

  it('calls onLongPress once after 800 ms, shows the cue on the pressed button from 300 ms, and swallows the next click', () => {
    const onLongPress = vi.fn();
    const h = mount({ onLongPress });
    const button = new FakeElement();
    h.onPointerDown(pointer({ target: button }));
    vi.advanceTimersByTime(299);
    expect(button.attrs.get('data-pressing')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(button.attrs.get('data-pressing')).toBe('true');
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(button.attrs.has('data-pressing')).toBe(false);
    h.onPointerUp(pointer());
    const click = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    h.onClickCapture(click as never);
    expect(click.stopPropagation).toHaveBeenCalledTimes(1);
    expect(click.preventDefault).toHaveBeenCalledTimes(1);
    const second = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    h.onClickCapture(second as never);
    expect(second.stopPropagation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled (the editor is open, the car is moving)', () => {
    const onLongPress = vi.fn();
    const h = mount({ onLongPress, enabled: false });
    const button = new FakeElement();
    h.onPointerDown(pointer({ target: button }));
    vi.advanceTimersByTime(2000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(button.attrs.size).toBe(0);
  });

  it('is cancelled by a drag, by a release, and by the pointer leaving, and the cue is removed', () => {
    for (const cancel of ['move', 'up', 'leave', 'cancel'] as const) {
      const onLongPress = vi.fn();
      const h = mount({ onLongPress });
      const button = new FakeElement();
      h.onPointerDown(pointer({ target: button }));
      vi.advanceTimersByTime(400);
      expect(button.attrs.get('data-pressing'), cancel).toBe('true');
      if (cancel === 'move') h.onPointerMove(pointer({ clientX: 10, clientY: 40 }));
      if (cancel === 'up') h.onPointerUp(pointer());
      if (cancel === 'leave') h.onPointerLeave(pointer());
      if (cancel === 'cancel') h.onPointerCancel(pointer());
      expect(button.attrs.has('data-pressing'), cancel).toBe(false);
      vi.advanceTimersByTime(2000);
      expect(onLongPress, cancel).not.toHaveBeenCalled();
    }
  });

  it('small movement inside the slop keeps the hold alive: the timer is re-armed, not dropped (a mouse always jitters)', () => {
    const onLongPress = vi.fn();
    const h = mount({ onLongPress });
    const button = new FakeElement();
    h.onPointerDown(pointer({ target: button }));
    vi.advanceTimersByTime(250);
    h.onPointerMove(pointer({ clientX: 11, clientY: 10 })); // 1 px, before the cue
    vi.advanceTimersByTime(100);
    expect(button.attrs.get('data-pressing')).toBe('true'); // the cue still comes at 300 ms
    h.onPointerMove(pointer({ clientX: 13, clientY: 14 })); // 5 px away, after the cue
    h.onPointerMove(pointer({ clientX: 12, clientY: 11 }));
    vi.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1); // and the fire still comes at 800 ms
  });

  it('another pointer lifting or moving does not drop the timer either', () => {
    const onLongPress = vi.fn();
    const h = mount({ onLongPress });
    h.onPointerDown(pointer());
    vi.advanceTimersByTime(100);
    h.onPointerMove(pointer({ pointerId: 7, clientX: 90, clientY: 90 }));
    h.onPointerUp(pointer({ pointerId: 7 }));
    vi.advanceTimersByTime(700);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('on fire it stands a guard on the window: the release click that lands on what the hold opened (a menu, a backdrop) is swallowed', () => {
    const host = new FakeHost();
    const realAdd = (globalThis as { addEventListener?: unknown }).addEventListener;
    const fakeWindow = { addEventListener: host.addEventListener.bind(host), removeEventListener: host.removeEventListener.bind(host), setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number | undefined) => globalThis.clearTimeout(id) };
    (globalThis as { window?: unknown }).window = fakeWindow;
    try {
      let opened = false;
      const h = mount({ onLongPress: () => { opened = host.count() > 0; } }); // the guard is up BEFORE the hold's action runs
      h.onPointerDown(pointer());
      vi.advanceTimersByTime(800);
      expect(opened).toBe(true);
      expect(host.count()).toBe(3);
      host.send('pointerup');
      const click = host.send('click'); // the click goes to the menu's button, not to the tile: the tile's own handler never sees it
      expect(click.stopped).toBe(true);
      expect(host.count()).toBe(0);
    } finally {
      (globalThis as { addEventListener?: unknown }).addEventListener = realAdd;
    }
  });

  it('a hold that is cancelled before it fires never stands a guard', () => {
    const host = new FakeHost();
    (globalThis as { window?: unknown }).window = { addEventListener: host.addEventListener.bind(host), removeEventListener: host.removeEventListener.bind(host), setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const h = mount({ onLongPress: vi.fn() });
    h.onPointerDown(pointer());
    vi.advanceTimersByTime(500);
    h.onPointerUp(pointer());
    vi.advanceTimersByTime(2000);
    expect(host.count()).toBe(0);
  });

  it('ignores a second finger and the right mouse button', () => {
    const onLongPress = vi.fn();
    const h = mount({ onLongPress });
    h.onPointerDown(pointer({ pointerType: 'mouse', button: 2 }));
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    h.onPointerDown(pointer({ pointerId: 1 }));
    h.onPointerDown(pointer({ pointerId: 2, isPrimary: false }));
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('puts the cue on the container when the finger lands between buttons', () => {
    const h = mount({ onLongPress: vi.fn() });
    const region = new FakeElement();
    const gap = { closest: () => null, setAttribute: () => {}, removeAttribute: () => {} };
    Object.setPrototypeOf(gap, FakeElement.prototype);
    h.onPointerDown(pointer({ target: gap, currentTarget: region }));
    vi.advanceTimersByTime(300);
    expect(region.attrs.get('data-pressing')).toBe('true');
  });

  it('always blocks the browser context menu', () => {
    const h = mount({ onLongPress: vi.fn(), enabled: false });
    const e = { preventDefault: vi.fn() };
    h.onContextMenu(e as never);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });
});
