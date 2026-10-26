import { describe, expect, it } from 'vitest';
import { addDaysIso, addMonthsIso, daysBetweenIso, daysInMonth, formatDate, formatDateShort, parseIso, whenText, todayIso, toIso, withPart } from './dates';

describe('parseIso / toIso', () => {
  it('round-trips a real date and refuses anything else', () => {
    expect(parseIso('2024-06-19')).toEqual({ y: 2024, m: 6, d: 19 });
    expect(toIso({ y: 2024, m: 6, d: 9 })).toBe('2024-06-09');
    for (const bad of ['', '2024-6-19', '2024-02-30', '2023-02-29', '2024-13-01', '2024-00-10', 'tomorrow', '19/06/2024']) expect(parseIso(bad), bad).toBeNull();
    expect(parseIso('2024-02-29')).not.toBeNull();
  });
});

describe('daysInMonth', () => {
  it('knows leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2024, 4)).toBe(30);
    expect(daysInMonth(2024, 12)).toBe(31);
  });
});

describe('withPart', () => {
  it('changes one part and keeps the day inside the month', () => {
    expect(withPart('2024-01-31', 'm', 2)).toBe('2024-02-29');
    expect(withPart('2023-01-31', 'm', 2)).toBe('2023-02-28');
    expect(withPart('2024-02-29', 'y', 2025)).toBe('2025-02-28');
    expect(withPart('2024-06-10', 'd', 31)).toBe('2024-06-30');
    expect(withPart('2024-06-10', 'd', 0)).toBe('2024-06-01');
  });
  it('keeps the year and month in range', () => {
    expect(withPart('2024-06-10', 'y', 3000)).toBe('2100-06-10');
    expect(withPart('2024-06-10', 'y', 1800)).toBe('1990-06-10');
    expect(withPart('2024-06-10', 'm', 13)).toBe('2024-12-10');
  });
});

describe('adding', () => {
  it('months clamp to the end of a shorter month', () => {
    expect(addMonthsIso('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsIso('2024-11-15', 3)).toBe('2025-02-15');
    expect(addMonthsIso('2024-06-10', -6)).toBe('2023-12-10');
    expect(addMonthsIso('2024-06-10', 12)).toBe('2025-06-10');
  });
  it('days cross months and years', () => {
    expect(addDaysIso('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDaysIso('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDaysIso('2024-06-19', 0)).toBe('2024-06-19');
  });
  it('counts days between', () => {
    expect(daysBetweenIso('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetweenIso('2024-03-01', '2024-02-28')).toBe(-2);
    expect(daysBetweenIso('2024-06-19', '2024-06-19')).toBe(0);
    expect(daysBetweenIso('nope', '2024-06-19')).toBe(0);
  });
});

describe('todayIso / formatDate', () => {
  it('uses the local calendar date', () => {
    expect(todayIso(new Date(2024, 5, 19, 23, 59))).toBe('2024-06-19');
    expect(todayIso(new Date(2024, 0, 1, 0, 0))).toBe('2024-01-01');
  });
  it('writes a date for people', () => {
    expect(formatDate('2024-06-19', 'en-GB')).toBe('19 Jun 2024');
    expect(formatDate('garbage')).toBe('garbage');
  });
  it('a short date has no year and no stray punctuation, in any language', () => {
    expect(formatDateShort('2024-06-19', 'en-GB')).toBe('19 Jun');
    expect(formatDateShort('2024-06-19', 'en-US')).toBe('Jun 19');
    expect(formatDateShort('x')).toBe('x');
  });
});

describe('whenText', () => {
  const now = new Date(2026, 5, 10, 15, 0).getTime();
  it('says today and yesterday', () => {
    expect(whenText(new Date(2026, 5, 10, 8, 5), now, 'en-GB')).toBe('today 08:05');
    expect(whenText(new Date(2026, 5, 9, 23, 59), now, 'en-GB')).toBe('yesterday 23:59');
  });
  it('treats just past midnight as a new day, not “24 hours ago”', () => {
    const justAfterMidnight = new Date(2026, 5, 10, 0, 1).getTime();
    expect(whenText(new Date(2026, 5, 9, 23, 59), justAfterMidnight, 'en-GB')).toBe('yesterday 23:59');
  });
  it('spells out older days', () => {
    expect(whenText(new Date(2026, 5, 3, 9, 12), now, 'en-GB')).toMatch(/Wed.*3.*Jun.*09:12/);
  });
});
