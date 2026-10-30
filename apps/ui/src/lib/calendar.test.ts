import { describe, expect, it } from 'vitest';
import { isoWeek, monthGrid } from './calendar';

describe('calendar', () => {
  it('lays a month out in whole weeks, Monday first', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const g = monthGrid(2026, 9, new Date(2026, 9, 26));
    expect(g).toHaveLength(5);
    expect(g[0]!.map((d) => d.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(g[0]!.map((d) => d.inMonth)).toEqual([false, false, false, true, true, true, true]);
    expect(g[4]!.map((d) => d.day)).toEqual([26, 27, 28, 29, 30, 31, 1]);
    const today = g.flat().filter((d) => d.today);
    expect(today).toEqual([{ day: 26, inMonth: true, today: true }]);
  });

  it('handles a February that fits in four weeks and a month that needs six', () => {
    expect(monthGrid(2021, 1, new Date(2021, 0, 1))).toHaveLength(4); // Feb 2021: Monday 1st, 28 days
    expect(monthGrid(2026, 2, new Date(2026, 0, 1))).toHaveLength(6); // Mar 2026: Sunday 1st, 31 days
  });

  it('numbers weeks the ISO way', () => {
    expect(isoWeek(new Date(2026, 9, 26))).toBe(44);
    expect(isoWeek(new Date(2021, 0, 3))).toBe(53); // Sunday 3 Jan 2021 belongs to 2020's week 53
    expect(isoWeek(new Date(2021, 0, 4))).toBe(1);
  });
});
