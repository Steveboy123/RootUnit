import { describe, expect, it } from 'vitest';
import { arcPath, niceStep, polar, ticks, valueToDeg } from './gauge';
import { clamp, convert, formatClock, formatDuration, unitLabel } from './format';
import { METRICS, metricById, metricLevel } from './metrics';

describe('units', () => {
  it('converts only in imperial', () => {
    expect(convert('speed', 'metric', 100)).toBe(100);
    expect(convert('speed', 'imperial', 100)).toBeCloseTo(62.1371, 3);
    expect(convert('temp', 'imperial', 100)).toBe(212);
    expect(convert('temp', 'imperial', 0)).toBe(32);
    expect(convert('pct', 'imperial', 50)).toBe(50);
    expect(unitLabel('speed', 'imperial')).toBe('mph');
  });
});

describe('time formatting', () => {
  it('formats 12h and 24h clocks', () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 5), false)).toEqual({ time: '12:05', suffix: 'AM' });
    expect(formatClock(new Date(2026, 0, 1, 13, 7), false)).toEqual({ time: '1:07', suffix: 'PM' });
    expect(formatClock(new Date(2026, 0, 1, 13, 7), true)).toEqual({ time: '13:07', suffix: '' });
    expect(formatClock(new Date(2026, 0, 1, 9, 3), true).time).toBe('09:03');
  });
  it('formats durations', () => {
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe('gauge geometry', () => {
  it('maps values onto the 270° sweep', () => {
    expect(valueToDeg(0, 0, 100)).toBe(135);
    expect(valueToDeg(50, 0, 100)).toBe(270);
    expect(valueToDeg(100, 0, 100)).toBe(405);
    expect(valueToDeg(999, 0, 100)).toBe(405);
    expect(valueToDeg(-5, 0, 100)).toBe(135);
  });
  it('places the arc start bottom-left and the apex at the top', () => {
    const [x, y] = polar(100, 100, 80, 135);
    expect(x).toBeCloseTo(43.43, 1);
    expect(y).toBeCloseTo(156.57, 1);
    const [tx, ty] = polar(100, 100, 80, 270);
    expect(tx).toBeCloseTo(100, 5);
    expect(ty).toBeCloseTo(20, 5);
    expect(arcPath(100, 100, 80, 135, 405)).toMatch(/^M 43\.43 156\.57 A 80 80 0 1 1 156\.57 156\.57$/);
  });
  it('generates ticks', () => {
    expect(ticks(0, 8, 1)).toHaveLength(9);
    expect(ticks(0, 240, 20)[12]).toBe(240);
    expect(niceStep(0, 240, 8)).toBe(20);
    expect(niceStep(0, 100, 5)).toBe(20);
  });
});

describe('metrics', () => {
  it('has unique ids and sane ranges', () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    for (const m of METRICS) expect(m.max).toBeGreaterThan(m.min);
  });
  it('flags warn/danger levels both directions', () => {
    expect(metricLevel(metricById('coolant'), 90)).toBe('ok');
    expect(metricLevel(metricById('coolant'), 108)).toBe('warn');
    expect(metricLevel(metricById('coolant'), 120)).toBe('danger');
    expect(metricLevel(metricById('fuel'), 10)).toBe('warn');
    expect(metricLevel(metricById('fuel'), 5)).toBe('danger');
    expect(metricLevel(metricById('battery'), 14.1)).toBe('ok');
    expect(metricById('nope').id).toBe('speed');
  });
});
