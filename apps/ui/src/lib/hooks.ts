import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Live content-box size of an element (layout px, unaffected by CSS transform scale). */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Re-renders on a wall-clock aligned interval. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: number;
    const tick = () => {
      setNow(new Date());
      t = window.setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [intervalMs]);
  return now;
}

/** requestAnimationFrame-driven clock for smooth progress bars. */
export function useFrameTime(active: boolean) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setT(Date.now()); // don't leave a stale timestamp from before we were paused
    let id: number;
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 250) {
        last = ts;
        setT(Date.now());
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
  return t;
}
