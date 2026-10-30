import { describe, expect, it } from 'vitest';
import { computeAlerts } from './alerts';
import { effectiveTheme, isNight, stepTime } from './theme';
import { metricById, reading } from './metrics';
import type { GarageState, HealthState, PhoneDevice, VehicleState, WeatherState } from '@headunit/shared';

const at = (h: number, m = 0) => new Date(2026, 5, 1, h, m);

describe('isNight', () => {
  it('handles a window that wraps past midnight', () => {
    expect(isNight(at(18, 59), '19:00', '06:30')).toBe(false);
    expect(isNight(at(19, 0), '19:00', '06:30')).toBe(true);
    expect(isNight(at(23, 59), '19:00', '06:30')).toBe(true);
    expect(isNight(at(0, 0), '19:00', '06:30')).toBe(true);
    expect(isNight(at(6, 29), '19:00', '06:30')).toBe(true);
    expect(isNight(at(6, 30), '19:00', '06:30')).toBe(false);
    expect(isNight(at(12), '19:00', '06:30')).toBe(false);
  });
  it('handles a same-day window and a zero-length window', () => {
    expect(isNight(at(14), '13:00', '15:00')).toBe(true);
    expect(isNight(at(16), '13:00', '15:00')).toBe(false);
    expect(isNight(at(3), '08:00', '08:00')).toBe(false);
  });
});

describe('effectiveTheme', () => {
  const base = { theme: 'carbon', autoTheme: false, dayTheme: 'daylight', nightTheme: 'ember', nightStart: '19:00', nightEnd: '06:30' } as const;
  it('uses the chosen theme when auto is off', () => expect(effectiveTheme(base, at(23))).toBe('carbon'));
  it('switches by schedule when auto is on', () => {
    expect(effectiveTheme({ ...base, autoTheme: true }, at(23))).toBe('ember');
    expect(effectiveTheme({ ...base, autoTheme: true }, at(12))).toBe('daylight');
  });
});

describe('effectiveTheme in sun mode', () => {
  // A zero-length clock window is "never night", so any night here can only have come from the sun.
  const sun = { theme: 'carbon', autoTheme: true, autoThemeMode: 'sun', dayTheme: 'daylight', nightTheme: 'ember', nightStart: '08:00', nightEnd: '08:00' } as const;
  const london = { lat: 51.5, lon: -0.12 };
  const sydney = { lat: -33.87, lon: 151.2 };
  const noon = new Date(Date.UTC(2026, 5, 1, 12, 0));
  const lateEvening = new Date(Date.UTC(2026, 5, 1, 23, 30));

  it('follows the sun where the car is', () => {
    expect(effectiveTheme(sun, noon, london)).toBe('daylight');
    expect(effectiveTheme(sun, lateEvening, london)).toBe('ember');
  });
  it('is dark in Sydney while it is midday in London, at the same instant', () => {
    expect(effectiveTheme(sun, noon, sydney)).toBe('ember');
    expect(effectiveTheme(sun, noon, london)).toBe('daylight');
  });
  it('uses the clock times when the position is not known yet', () => {
    expect(effectiveTheme(sun, lateEvening, null)).toBe('daylight');
    expect(effectiveTheme(sun, lateEvening)).toBe('daylight');
  });
  it('ignores the position in schedule mode', () => {
    expect(effectiveTheme({ ...sun, autoThemeMode: 'schedule' }, lateEvening, london)).toBe('daylight');
  });
  it('does nothing at all when automatic day/night is off', () => {
    expect(effectiveTheme({ ...sun, autoTheme: false }, lateEvening, london)).toBe('carbon');
  });
});

describe('stepTime', () => {
  it('steps and wraps both ways', () => {
    expect(stepTime('19:00', 30)).toBe('19:30');
    expect(stepTime('23:45', 30)).toBe('00:15');
    expect(stepTime('00:10', -30)).toBe('23:40');
    expect(stepTime('06:30', -30)).toBe('06:00');
  });
});

const vehicle = (over: Partial<VehicleState> = {}): VehicleState => ({
  source: 'obd', connected: true, speedKmh: 50, rpm: 2000, coolantC: 90, intakeC: 30, ambientC: 20, throttlePct: 10, loadPct: 30, fuelPct: 60, batteryV: 14.1,
  trip: { distanceKm: 0, durationS: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 }, ...over,
});
const phone = (battery?: PhoneDevice['battery']): PhoneDevice => ({ id: 'p', name: 'Pixel', platform: 'android', connected: true, active: true, transports: ['bluetooth'], battery });

describe('computeAlerts', () => {
  it('is quiet when everything is normal, and with no data', () => {
    expect(computeAlerts(vehicle(), phone({ percent: 80 }), 'metric')).toEqual([]);
    expect(computeAlerts(null, undefined, 'metric')).toEqual([]);
  });
  it('flags overheating with the right severity and units', () => {
    const a = computeAlerts(vehicle({ coolantC: 120 }), undefined, 'metric');
    expect(a[0]).toMatchObject({ id: 'coolant', level: 'danger' });
    expect(a[0]!.text).toContain('120°C');
    expect(computeAlerts(vehicle({ coolantC: 120 }), undefined, 'imperial')[0]!.text).toContain('248°F');
    expect(computeAlerts(vehicle({ coolantC: 108 }), undefined, 'metric')[0]!.level).toBe('warn');
  });
  it('flags low fuel and bad battery voltage', () => {
    expect(computeAlerts(vehicle({ fuelPct: 12 }), undefined, 'metric')[0]).toMatchObject({ id: 'fuel', level: 'warn' });
    expect(computeAlerts(vehicle({ fuelPct: 5 }), undefined, 'metric')[0]).toMatchObject({ id: 'fuel', level: 'danger' });
    expect(computeAlerts(vehicle({ batteryV: 11.2 }), undefined, 'metric')[0]!.text).toContain('Low battery voltage');
    expect(computeAlerts(vehicle({ batteryV: 15.8 }), undefined, 'metric')[0]!.text).toContain('High battery voltage');
  });
  it('warns about a low phone battery only if it is known and not charging', () => {
    expect(computeAlerts(null, phone({ percent: 9 }), 'metric')[0]).toMatchObject({ id: 'phone-p', level: 'warn' });
    expect(computeAlerts(null, phone({ percent: 9, charging: true }), 'metric')).toEqual([]);
    expect(computeAlerts(null, phone(undefined), 'metric')).toEqual([]); // unknown ≠ low
  });
  it('sorts danger before warn', () => {
    const a = computeAlerts(vehicle({ fuelPct: 12, coolantC: 120 }), undefined, 'metric');
    expect(a.map((x) => x.id)).toEqual(['coolant', 'fuel']);
  });

  it('warns about the check-engine lamp, singular and plural', () => {
    expect(computeAlerts(vehicle({ mil: { on: true, count: 1 } }), undefined, 'metric')[0]).toMatchObject({ id: 'mil', level: 'warn' });
    expect(computeAlerts(vehicle({ mil: { on: true, count: 1 } }), undefined, 'metric')[0]!.text).toContain('1 fault code (');
    expect(computeAlerts(vehicle({ mil: { on: true, count: 3 } }), undefined, 'metric')[0]!.text).toContain('3 fault codes');
    expect(computeAlerts(vehicle({ mil: { on: false, count: 0 } }), undefined, 'metric')).toEqual([]);
  });
  it('never alerts on a reading the car does not provide', () => {
    // fuelPct is 0 here only because there is no data — that must not read as "tank empty".
    expect(computeAlerts(vehicle({ fuelPct: 0, coolantC: 0, batteryV: 0, unsupported: ['fuelPct', 'coolantC', 'batteryV'] }), undefined, 'metric')).toEqual([]);
  });
  it('is silent about the car while there is no live data', () => {
    expect(computeAlerts(vehicle({ connected: false, coolantC: 130, fuelPct: 2, mil: { on: true, count: 1 } }), undefined, 'metric')).toEqual([]);
  });
});

describe('computeAlerts: the rest of the head unit', () => {
  const health = (over: Partial<HealthState> = {}): HealthState => ({ available: true, model: 'Pi 5', cpuTempC: 50, cpuLoadPct: 10, memUsedPct: 30, memTotalMb: 8000, diskFreeGb: 40, diskTotalGb: 64, uptimeS: 100, throttle: null, updatedAt: 0, ...over });
  const due = (name: string, status: 'ok' | 'soon' | 'overdue') => ({ kind: 'service' as const, id: name, name, status, detail: '', kmLeft: null, daysLeft: null });
  const garage = (...d: ReturnType<typeof due>[]) => ({ due: d }) as unknown as GarageState;
  const weather = (code: number, fetchedAt: number | null, status: WeatherState['status'] = 'ok') =>
    ({ status, location: null, current: { tempC: 0, feelsC: 0, code, isDay: true, windKmh: 0, humidityPct: 0 }, daily: [], fetchedAt }) as WeatherState;
  const now = 1_000_000_000;

  it('passes on a hot or starved Pi, and is silent for a healthy one', () => {
    expect(computeAlerts(null, undefined, 'metric', { health: health() })).toEqual([]);
    expect(computeAlerts(null, undefined, 'metric', { health: health({ cpuTempC: 90 }) })[0]).toMatchObject({ id: 'pi-hot', level: 'danger' });
  });
  it('names what is overdue in the garage, and says nothing for things only coming up', () => {
    expect(computeAlerts(null, undefined, 'metric', { garage: garage(due('Oil change', 'soon')) })).toEqual([]);
    expect(computeAlerts(null, undefined, 'metric', { garage: garage(due('MOT', 'overdue')) })[0]).toMatchObject({ id: 'garage-overdue', text: 'MOT is overdue (open Garage)' });
    const many = computeAlerts(null, undefined, 'metric', { garage: garage(due('MOT', 'overdue'), due('Tyres', 'overdue'), due('Oil', 'overdue')) })[0]!;
    expect(many.text).toBe('3 things overdue: MOT, Tyres… (open Garage)');
  });
  it('warns of a road hazard from fresh weather only', () => {
    expect(computeAlerts(null, undefined, 'metric', { weather: weather(45, now - 600_000), now })[0]).toMatchObject({ id: 'weather-hazard' });
    expect(computeAlerts(null, undefined, 'metric', { weather: weather(45, now - 4 * 3600_000), now })).toEqual([]); // stale
    expect(computeAlerts(null, undefined, 'metric', { weather: weather(45, now - 600_000, 'error'), now })).toEqual([]);
    expect(computeAlerts(null, undefined, 'metric', { weather: weather(0, now - 600_000), now })).toEqual([]); // clear sky
  });
  it('still puts danger first across all sources', () => {
    const a = computeAlerts(vehicle({ fuelPct: 12 }), undefined, 'metric', { garage: garage(due('MOT', 'overdue')), health: health({ cpuTempC: 90 }), weather: weather(45, now - 1000), now });
    expect(a[0]!.level).toBe('danger');
    expect(a.map((x) => x.id)).toContain('weather-hazard');
  });
});

describe('reading()', () => {
  const fuel = metricById('fuel');
  it('returns the value only when it is live and provided', () => {
    expect(reading(vehicle({ fuelPct: 60 }), fuel)).toBe(60);
  });
  it('returns null (→ "—") for no data, a dead link, or an unsupported sensor', () => {
    expect(reading(null, fuel)).toBeNull();
    expect(reading(vehicle({ connected: false }), fuel)).toBeNull();
    expect(reading(vehicle({ unsupported: ['fuelPct'] }), fuel)).toBeNull();
    expect(reading(vehicle({ unsupported: ['rpm'] }), fuel)).toBe(60); // other sensors unaffected
  });
});

import { isLocked } from './driving';
describe('driving lockout', () => {
  const base = { lockSetting: true, connected: true, speedKmh: 50, passenger: false };
  it('locks while moving', () => expect(isLocked(base)).toBe(true));
  it('does not lock when parked or crawling under the threshold', () => {
    expect(isLocked({ ...base, speedKmh: 0 })).toBe(false);
    expect(isLocked({ ...base, speedKmh: 8 })).toBe(false);
    expect(isLocked({ ...base, speedKmh: 8.1 })).toBe(true);
  });
  it('honours the setting and the passenger override', () => {
    expect(isLocked({ ...base, lockSetting: false })).toBe(false);
    expect(isLocked({ ...base, passenger: true })).toBe(false);
  });
  it('never locks on a guess: no live speed means unlocked', () => {
    expect(isLocked({ ...base, connected: false, speedKmh: 120 })).toBe(false);
  });
});
