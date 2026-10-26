import { describe, expect, it } from 'vitest';
import { fits, gridMetrics, movedBy, overlaps, rectToPx, resizedBy, swipePage } from './grid';

const m = gridMetrics(12 * 80 + 11 * 10, 6 * 70 + 5 * 10, 10);

describe('dashboard grid', () => {
  it('measures cells from the container and the gap', () => {
    expect(m).toEqual({ cellW: 80, cellH: 70, gap: 10 });
    expect(rectToPx({ x: 1, y: 2, w: 3, h: 2 }, m)).toEqual({ left: 90, top: 160, width: 260, height: 150 });
  });

  it('detects overlap edge-exclusively', () => {
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
  });

  it('only fits inside the grid and clear of others', () => {
    expect(fits({ x: 10, y: 0, w: 3, h: 1 }, [])).toBe(false);
    expect(fits({ x: 0, y: 5, w: 1, h: 2 }, [])).toBe(false);
    expect(fits({ x: 0, y: 0, w: 2, h: 2 }, [{ x: 1, y: 1, w: 1, h: 1 }])).toBe(false);
    expect(fits({ x: 0, y: 0, w: 2, h: 2 }, [{ x: 2, y: 0, w: 1, h: 1 }])).toBe(true);
  });

  it('moves by whole cells and never off the grid', () => {
    expect(movedBy({ x: 2, y: 1, w: 3, h: 2 }, 95, -40, m)).toEqual({ x: 3, y: 1, w: 3, h: 2 });
    expect(movedBy({ x: 2, y: 1, w: 3, h: 2 }, 5000, 5000, m)).toEqual({ x: 9, y: 4, w: 3, h: 2 });
    expect(movedBy({ x: 2, y: 1, w: 3, h: 2 }, -5000, -5000, m)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('resizes from the corner within the minimum and the grid', () => {
    expect(resizedBy({ x: 0, y: 0, w: 3, h: 2 }, 180, 80, m, { w: 2, h: 1 })).toEqual({ x: 0, y: 0, w: 5, h: 3 });
    expect(resizedBy({ x: 0, y: 0, w: 3, h: 2 }, -900, -900, m, { w: 2, h: 1 })).toEqual({ x: 0, y: 0, w: 2, h: 1 });
    expect(resizedBy({ x: 10, y: 5, w: 2, h: 1 }, 900, 900, m, { w: 1, h: 1 })).toEqual({ x: 10, y: 5, w: 2, h: 1 });
  });

  it('turns a long horizontal swipe into a page change, and nothing else', () => {
    expect(swipePage(-120, 10)).toBe(1);
    expect(swipePage(120, -10)).toBe(-1);
    expect(swipePage(60, 0)).toBe(0);
    expect(swipePage(120, 100)).toBe(0);
  });
});
