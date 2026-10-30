import { describe, expect, it } from 'vitest';
import { isNightAt, sunTimes } from '@headunit/shared';

const minutes = (a: Date | null, b: string) => Math.abs((a!.getTime() - Date.parse(b)) / 60_000);

// Reference values from the US Naval Observatory / timeanddate.com (UTC). The algorithm is good to about a minute; allow 4.
describe('sunTimes', () => {
  it('Greenwich, summer solstice 2024', () => {
    const t = sunTimes(new Date('2024-06-21T12:00:00Z'), 51.4779, 0.0015);
    expect(minutes(t.sunrise, '2024-06-21T03:43:00Z')).toBeLessThan(4);
    expect(minutes(t.sunset, '2024-06-21T20:21:00Z')).toBeLessThan(4);
  });

  it('Greenwich, winter solstice 2024', () => {
    const t = sunTimes(new Date('2024-12-21T12:00:00Z'), 51.4779, 0.0015);
    expect(minutes(t.sunrise, '2024-12-21T08:04:00Z')).toBeLessThan(4);
    expect(minutes(t.sunset, '2024-12-21T15:53:00Z')).toBeLessThan(4);
  });

  it('the equator at the March equinox is about 12 hours of daylight', () => {
    const t = sunTimes(new Date('2024-03-20T12:00:00Z'), 0, 0);
    const hours = (t.sunset!.getTime() - t.sunrise!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThan(12.15);
  });

  it('works west of Greenwich: New York at the September equinox (sunrise about 10:46 UTC, a little over 12 h of daylight)', () => {
    const t = sunTimes(new Date('2024-09-22T17:00:00Z'), 40.7128, -74.006);
    expect(minutes(t.sunrise, '2024-09-22T10:46:00Z')).toBeLessThan(5);
    const hours = (t.sunset!.getTime() - t.sunrise!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(12.05);
    expect(hours).toBeLessThan(12.25);
  });

  it('works east of Greenwich: Tokyo, 2024-06-21 (sunrise 19:25 UTC the day before, sunset 10:00 UTC)', () => {
    const t = sunTimes(new Date('2024-06-21T03:00:00Z'), 35.6762, 139.6503);
    expect(minutes(t.sunrise, '2024-06-20T19:25:00Z')).toBeLessThan(5);
    expect(minutes(t.sunset, '2024-06-21T10:00:00Z')).toBeLessThan(5);
  });

  it('reports midnight sun and polar night instead of inventing times', () => {
    expect(sunTimes(new Date('2024-06-21T12:00:00Z'), 78.2232, 15.6267)).toEqual({ sunrise: null, sunset: null, polar: 'day' });
    expect(sunTimes(new Date('2024-12-21T12:00:00Z'), 78.2232, 15.6267)).toEqual({ sunrise: null, sunset: null, polar: 'night' });
  });
});

describe('isNightAt', () => {
  const lat = 51.4779;
  const lon = 0.0015;
  it('is dark at midnight and light at noon', () => {
    expect(isNightAt(new Date('2024-06-21T00:30:00Z'), lat, lon)).toBe(true);
    expect(isNightAt(new Date('2024-06-21T12:00:00Z'), lat, lon)).toBe(false);
    expect(isNightAt(new Date('2024-12-21T12:00:00Z'), lat, lon)).toBe(false);
    expect(isNightAt(new Date('2024-12-21T22:00:00Z'), lat, lon)).toBe(true);
  });

  it('switches to the night look a margin before sunset and back a margin after sunrise', () => {
    // Sunset at about 15:53 UTC in December: 15:40 is 13 minutes before sunset, inside the 20 minute margin.
    expect(isNightAt(new Date('2024-12-21T15:40:00Z'), lat, lon, 20)).toBe(true);
    expect(isNightAt(new Date('2024-12-21T15:40:00Z'), lat, lon, 0)).toBe(false);
    // Sunrise at about 08:04 UTC: 08:15 is 11 minutes after it, still inside the margin.
    expect(isNightAt(new Date('2024-12-21T08:15:00Z'), lat, lon, 20)).toBe(true);
    expect(isNightAt(new Date('2024-12-21T08:15:00Z'), lat, lon, 0)).toBe(false);
  });

  it('follows the season at the poles', () => {
    expect(isNightAt(new Date('2024-06-21T00:00:00Z'), 78.2, 15.6)).toBe(false);
    expect(isNightAt(new Date('2024-12-21T12:00:00Z'), 78.2, 15.6)).toBe(true);
  });

  it('is right across the date line and in the southern hemisphere', () => {
    // Sydney, local noon (02:00 UTC) and local midnight (14:00 UTC) in January.
    expect(isNightAt(new Date('2025-01-15T02:00:00Z'), -33.87, 151.21)).toBe(false);
    expect(isNightAt(new Date('2025-01-15T14:00:00Z'), -33.87, 151.21)).toBe(true);
  });
});
