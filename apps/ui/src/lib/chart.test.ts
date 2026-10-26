import { describe, expect, it } from 'vitest';
import { barPath, compact, linePath, nearestIndex, niceMax, xPositions, yScale } from './chart';

describe('niceMax', () => {
  it('rounds up to a tidy axis end', () => {
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.2)).toBe(2);
    expect(niceMax(2.3)).toBe(2.5);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7.9)).toBe(10);
    expect(niceMax(87)).toBe(100);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(0.034)).toBe(0.05);
  });
  it('never returns zero, NaN or something below the value', () => {
    for (const bad of [0, -5, Number.NaN, Infinity]) expect(niceMax(bad)).toBe(1);
    for (const v of [0.01, 0.5, 4.99, 5.01, 99.9, 1234, 98765]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });
});

describe('compact', () => {
  it('shortens thousands', () => {
    expect(compact(0)).toBe('0');
    expect(compact(950)).toBe('950');
    expect(compact(1000)).toBe('1K');
    expect(compact(2500)).toBe('2.5K');
    expect(compact(12.34)).toBe('12.3');
  });
});

describe('barPath', () => {
  it('rounds only the top corners and stands on the baseline', () => {
    expect(barPath(10, 20, 30, 100)).toBe('M10,100V34Q10,30 14,30H26Q30,30 30,34V100Z');
  });
  it('shrinks the radius for a narrow or a short bar instead of drawing a broken shape', () => {
    expect(barPath(0, 6, 90, 100)).toBe('M0,100V93Q0,90 3,90H3Q6,90 6,93V100Z'); // radius capped at half the width
    expect(barPath(0, 20, 98, 100)).toBe('M0,100V100Q0,98 2,98H18Q20,98 20,100V100Z'); // and at the height
  });
  it('draws nothing for a bar with no height or no width', () => {
    expect(barPath(0, 10, 100, 100)).toBe('');
    expect(barPath(0, 10, 120, 100)).toBe('');
    expect(barPath(0, 0, 10, 100)).toBe('');
  });
});

describe('yScale', () => {
  it('maps the range onto the pixels, high values up', () => {
    const s = yScale([0, 50, 100], 10, 110, { zero: true });
    expect(s.y(0)).toBe(110);
    expect(s.y(100)).toBe(10);
    expect(s.y(50)).toBe(60);
  });
  it('adds headroom to a line so it does not touch the edges', () => {
    const s = yScale([5, 7], 0, 100, { pad: 0.5 });
    expect(s.y(5)).toBeLessThan(100);
    expect(s.y(7)).toBeGreaterThan(0);
  });
  it('copes with a flat series, a single point and no data', () => {
    for (const vals of [[3, 3, 3], [3]]) {
      const s = yScale(vals, 0, 100);
      expect(s.y(3)).toBeGreaterThanOrEqual(0); // the one value there is stays on the chart, in the middle
      expect(s.y(3)).toBeLessThanOrEqual(100);
      expect(s.y(3)).toBeCloseTo(50, 5);
    }
    expect(Number.isFinite(yScale([], 0, 100).y(0))).toBe(true); // no data: a placeholder scale, never NaN
    expect(Number.isFinite(yScale([0, 0], 0, 100, { zero: true }).y(0))).toBe(true);
  });
  it('ignores values that are not numbers', () => {
    expect(yScale([1, Number.NaN, 3], 0, 100, { zero: true }).max).toBe(3);
  });
});

describe('xPositions, linePath, nearestIndex', () => {
  it('spreads points evenly', () => {
    expect(xPositions(3, 0, 100)).toEqual([0, 50, 100]);
    expect(xPositions(1, 0, 100)).toEqual([50]);
    expect(xPositions(0, 0, 100)).toEqual([]);
  });
  it('breaks the line at a gap rather than drawing across it', () => {
    expect(linePath([0, 10, 20, 30], [5, null, 7, 8])).toBe('M0,5M20,7L30,8');
    expect(linePath([0, 10], [1, 2])).toBe('M0,1L10,2');
    expect(linePath([], [])).toBe('');
    expect(linePath([0, 1], [Number.NaN, 4])).toBe('M1,4');
  });
  it('finds the nearest point to a tap', () => {
    const xs = [0, 40, 80, 120];
    expect(nearestIndex(xs, 5)).toBe(0);
    expect(nearestIndex(xs, 61)).toBe(2);
    expect(nearestIndex(xs, 500)).toBe(3);
    expect(nearestIndex(xs, -50)).toBe(0);
  });
});
