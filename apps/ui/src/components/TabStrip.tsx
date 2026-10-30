import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Which way a strip scrolls. The status bar's tabs run along x; the navigation dock's buttons along y. */
export type StripAxis = 'x' | 'y';

/** Which ends of a scrolling strip still have items hidden behind them (1px of slack for sub-pixel scrolling). The same maths on either axis. */
export function edgeFade(scrollPos: number, clientSize: number, scrollSize: number): { start: boolean; end: boolean } {
  const room = scrollSize - clientSize;
  if (room <= 1) return { start: false, end: false };
  return { start: scrollPos > 1, end: scrollPos < room - 1 };
}

/** Which edges of a horizontally scrolling strip still have tabs hidden behind them. */
export function stripFade(scrollLeft: number, clientWidth: number, scrollWidth: number): { start: boolean; end: boolean } {
  return edgeFade(scrollLeft, clientWidth, scrollWidth);
}

/**
 * The new scroll position that brings an item (its two edges, in the strip's own coordinates) fully into view, or the current one when it
 * already is. `inset` keeps it that far inside the edges, so an item is not left under a fade.
 */
export function revealOffset(opts: { scroll: number; from: number; to: number; itemFrom: number; itemTo: number; inset?: number }): number {
  const { scroll, itemFrom, itemTo, inset = 0 } = opts;
  const from = opts.from + inset;
  const to = opts.to - inset;
  if (itemFrom < from) return Math.max(0, Math.round(scroll - (from - itemFrom)));
  if (itemTo > to) return Math.round(scroll + (itemTo - to));
  return scroll;
}

/** The new scrollLeft that brings a tab (left/right edges in the strip's own coordinates) fully into view, or the current one when it already is. */
export function scrollToReveal(opts: { scrollLeft: number; stripLeft: number; stripRight: number; tabLeft: number; tabRight: number }): number {
  const { scrollLeft, stripLeft, stripRight, tabLeft, tabRight } = opts;
  return revealOffset({ scroll: scrollLeft, from: stripLeft, to: stripRight, itemFrom: tabLeft, itemTo: tabRight });
}

/** Scroll `el` along `axis` so its `[data-active="true"]` child is in view. Measures on screen and converts back, so a scaled preview works. */
export function revealActive(el: HTMLElement, axis: StripAxis, inset = 0): void {
  const item = el.querySelector<HTMLElement>('[data-active="true"]');
  if (!item) return;
  const s = el.getBoundingClientRect();
  const t = item.getBoundingClientRect();
  const x = axis === 'x';
  const screen = x ? s.width : s.height;
  const k = screen > 0 ? (x ? el.clientWidth : el.clientHeight) / screen : 1; // layout px per screen px
  const now = x ? el.scrollLeft : el.scrollTop;
  const to = revealOffset({ scroll: now, from: x ? s.left : s.top, to: x ? s.right : s.bottom, itemFrom: x ? t.left : t.top, itemTo: x ? t.right : t.bottom, inset: inset / (k || 1) });
  if (to === now) return;
  const next = now + (to - now) * k;
  if (x) el.scrollLeft = next;
  else el.scrollTop = next;
}

/** A row of tabs that scrolls sideways when they do not fit, fades the edge that hides more, and keeps the selected tab in view. */
export function TabStrip({ children, activeKey, className = '' }: { children: ReactNode; activeKey: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setFade(stripFade(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    revealActive(el, 'x', 24);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey, update, Children.count(children)]);
  return (
    <div ref={ref} className={`tabs ${className}`} role="tablist" onScroll={update} data-fade-start={fade.start} data-fade-end={fade.end}>
      {children}
    </div>
  );
}
