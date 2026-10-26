import { useCallback, useEffect, useRef, useState } from 'react';
import { edgeFade, revealActive } from '../../components/TabStrip';

/** How far inside the edge the current page's button is kept, so it is not left under the fade. Matches the fade height in nav.css. */
export const RAIL_FADE_PX = 24;

export interface RailFade {
  top: boolean;
  bottom: boolean;
}

/** Which ends of the rail's scrolling head have buttons behind them. The vertical twin of TabStrip's fade. */
export function railFade(scrollTop: number, clientHeight: number, scrollHeight: number): RailFade {
  const f = edgeFade(scrollTop, clientHeight, scrollHeight);
  return { top: f.start, bottom: f.end };
}

/**
 * The scrolling head of the rail: tells which ends fade out (data-fade-top / data-fade-bottom) and keeps the current page's button in
 * view whenever it changes. `activeKey` is anything that changes when the highlighted button does (or the buttons move).
 */
export function useRailScroll(activeKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<RailFade>({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = railFade(el.scrollTop, el.clientHeight, el.scrollHeight);
    setFade((f) => (f.top === next.top && f.bottom === next.bottom ? f : next));
  }, []);

  // Look again whenever the head or any button changes size (a size change, a label wrapping, the window or the keyboard resizing).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const b of Array.from(el.children)) ro.observe(b);
    return () => ro.disconnect();
  }, [activeKey, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    revealActive(el, 'y', RAIL_FADE_PX);
    measure();
  }, [activeKey, measure]);

  return { ref, fade, onScroll: measure };
}
