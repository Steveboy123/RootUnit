import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, sanitizeLayout, type DashboardLayout } from '@headunit/shared';
import { canMovePage, findFreeSpot, movePage, placeWidget } from './layout';

describe('widget placement', () => {
  it('finds the first free slot', () => {
    expect(findFreeSpot([], 4, 4)).toEqual({ x: 0, y: 0 });
    expect(findFreeSpot([{ x: 0, y: 0, w: 4, h: 4 }], 4, 4)).toEqual({ x: 4, y: 0 });
  });
  it('wraps to the next row and reports a full page', () => {
    const full = [
      { x: 0, y: 0, w: 12, h: 3 },
      { x: 0, y: 3, w: 12, h: 3 },
    ];
    expect(findFreeSpot(full, 1, 1)).toBeNull();
    expect(findFreeSpot([{ x: 0, y: 0, w: 12, h: 3 }], 6, 3)).toEqual({ x: 0, y: 3 });
  });
  it('shrinks to fit down to the minimum size', () => {
    const w = [{ x: 0, y: 0, w: 12, h: 5 }];
    expect(placeWidget(w, { w: 4, h: 4 }, { w: 2, h: 1 })).toEqual({ x: 0, y: 5, w: 4, h: 1 });
    expect(placeWidget(w, { w: 4, h: 4 }, { w: 2, h: 2 })).toBeNull();
  });
});

describe('page order: movePage', () => {
  const page = (id: string) => ({ id, name: id.toUpperCase(), widgets: [{ id: `w-${id}`, type: 'clock', x: 0, y: 0, w: 3, h: 2 }] });
  const three: DashboardLayout = { version: 1, pages: [page('a'), page('b'), page('c')] };
  const order = (l: DashboardLayout) => l.pages.map((p) => p.id);
  const frozen = <T>(v: T): T => {
    if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const x of Object.values(v)) frozen(x);
    }
    return v;
  };

  it('swaps a page with its neighbour: earlier (-1) or later (1)', () => {
    expect(order(movePage(three, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(order(movePage(three, 'b', 1))).toEqual(['a', 'c', 'b']);
    expect(order(movePage(three, 'a', 1))).toEqual(['b', 'a', 'c']);
    expect(order(movePage(three, 'c', -1))).toEqual(['a', 'c', 'b']);
  });

  it('cannot move past either end: the same layout comes back, and the button for it is disabled', () => {
    expect(movePage(three, 'a', -1)).toBe(three);
    expect(movePage(three, 'c', 1)).toBe(three);
    expect([canMovePage(three, 'a', -1), canMovePage(three, 'a', 1)]).toEqual([false, true]);
    expect([canMovePage(three, 'b', -1), canMovePage(three, 'b', 1)]).toEqual([true, true]);
    expect([canMovePage(three, 'c', -1), canMovePage(three, 'c', 1)]).toEqual([true, false]);
  });

  it('a page that is not there, or the only page, cannot move', () => {
    expect(movePage(three, 'zzz', 1)).toBe(three);
    expect(canMovePage(three, 'zzz', -1)).toBe(false);
    const one: DashboardLayout = { version: 1, pages: [page('a')] };
    expect(movePage(one, 'a', 1)).toBe(one);
    expect(movePage(one, 'a', -1)).toBe(one);
  });

  it('is copy-on-write: a frozen layout is not touched, and the pages are the same objects in a new list', () => {
    const f = frozen(structuredClone(three));
    const next = movePage(f, 'a', 1);
    expect(next).not.toBe(f);
    expect(next.pages).not.toBe(f.pages);
    expect(order(f)).toEqual(['a', 'b', 'c']);
    expect(next.pages[1]).toBe(f.pages[0]);
    expect(next.pages[0]).toBe(f.pages[1]);
  });

  it('keeps the selected page selected: pages are found by id, so the page being looked at is where the id says wherever it moves', () => {
    const selected = 'b';
    const after = movePage(three, selected, -1);
    expect(after.pages.findIndex((p) => p.id === selected)).toBe(0);
    expect(after.pages.find((p) => p.id === selected)).toBe(three.pages[1]);
    // moving a page other than the selected one leaves the selected page's own contents alone, too
    expect(movePage(three, 'a', 1).pages.find((p) => p.id === selected)).toBe(three.pages[1]);
  });

  it('what it returns is a layout the server accepts, with every page and widget still there', () => {
    const next = movePage(DEFAULT_LAYOUT, DEFAULT_LAYOUT.pages[1]!.id, -1);
    expect(sanitizeLayout(next)).not.toBeNull();
    expect(order(next).sort()).toEqual(order(DEFAULT_LAYOUT).sort());
    expect(next.pages.flatMap((p) => p.widgets).length).toBe(DEFAULT_LAYOUT.pages.flatMap((p) => p.widgets).length);
  });

  it('a layout the server would refuse (two pages with one id) is not "moved": the layout comes back unchanged', () => {
    const bad = { version: 1, pages: [page('a'), page('b'), page('a')] } as DashboardLayout;
    expect(movePage(bad, 'b', 1)).toBe(bad);
  });

  it('moving a page and moving it back is a round trip', () => {
    expect(movePage(movePage(three, 'a', 1), 'a', -1)).toEqual(three);
  });
});
