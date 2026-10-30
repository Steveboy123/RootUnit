import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonStore } from '../store';
import { WeatherService, distanceKm, parseGeocoding, parseOpenMeteo, roundCoord } from './weather';

// Shaped like a real api.open-meteo.com/v1/forecast answer.
const FORECAST = {
  latitude: 51.48,
  longitude: 0,
  current: { time: '2024-06-21T12:00', temperature_2m: 19.4, apparent_temperature: 18.1, relative_humidity_2m: 58, weather_code: 3, is_day: 1, wind_speed_10m: 14.2 },
  daily: {
    time: ['2024-06-21', '2024-06-22', '2024-06-23', '2024-06-24'],
    weather_code: [3, 61, 80, 1],
    temperature_2m_max: [21.3, 18.9, 17.2, 22.0],
    temperature_2m_min: [12.1, 11.8, 10.4, 12.5],
    precipitation_probability_max: [10, 70, 85, null],
    sunrise: ['2024-06-21T04:43', '2024-06-22T04:43', '2024-06-23T04:43', '2024-06-24T04:44'],
    sunset: ['2024-06-21T21:21', '2024-06-22T21:21', '2024-06-23T21:21', '2024-06-24T21:21'],
  },
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('parseOpenMeteo', () => {
  it('reads the current weather and the days', () => {
    const w = parseOpenMeteo(FORECAST)!;
    expect(w.current).toEqual({ tempC: 19.4, feelsC: 18.1, code: 3, isDay: true, windKmh: 14.2, humidityPct: 58 });
    expect(w.daily).toHaveLength(4);
    expect(w.daily[1]).toEqual({ date: '2024-06-22', code: 61, maxC: 18.9, minC: 11.8, rainPct: 70, sunrise: '2024-06-22T04:43', sunset: '2024-06-22T21:21' });
    expect(w.daily[3]!.rainPct).toBeNull(); // not every model has a rain probability
  });

  it('is_day 0 is night', () => {
    expect(parseOpenMeteo({ ...FORECAST, current: { ...FORECAST.current, is_day: 0 } })!.current!.isDay).toBe(false);
  });

  it('skips a broken day but keeps the rest, and refuses an answer with no current weather', () => {
    const broken = { ...FORECAST, daily: { ...FORECAST.daily, temperature_2m_max: [21.3, 'warm', 17.2, 22.0] } };
    expect(parseOpenMeteo(broken)!.daily.map((d) => d.date)).toEqual(['2024-06-21', '2024-06-23', '2024-06-24']);
    for (const bad of [null, 'x', {}, { current: {} }, { current: { temperature_2m: 'hot', weather_code: 1 } }]) expect(parseOpenMeteo(bad)).toBeNull();
  });
});

describe('parseGeocoding', () => {
  it('lists places with their region and rounded coordinates', () => {
    const r = parseGeocoding({ results: [{ name: 'Greenwich', latitude: 51.48208, longitude: -0.00463, country: 'United Kingdom', admin1: 'England' }, { name: 'Nowhere' }, null, { name: 'Bad', latitude: 999, longitude: 0 }] });
    expect(r).toEqual([{ name: 'Greenwich', detail: 'England, United Kingdom', lat: 51.48, lon: 0 }]);
  });
  it('is empty for anything else', () => {
    expect(parseGeocoding({})).toEqual([]);
    expect(parseGeocoding(null)).toEqual([]);
  });
});

describe('geometry', () => {
  it('distance between London and Paris is about 344 km', () => {
    expect(distanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })).toBeGreaterThan(340);
    expect(distanceKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })).toBeLessThan(348);
  });
  it('rounds to about a kilometre', () => {
    expect(roundCoord(51.477928)).toBe(51.48);
    expect(roundCoord(-0.0046)).toBe(0); // never "-0"
    expect(Object.is(roundCoord(-0.0046), 0)).toBe(true);
  });
});

describe('WeatherService', () => {
  let dir: string;
  let store: JsonStore;
  let now: number;
  let gps: { lat: number; lon: number } | null;
  let enabled: boolean;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'weather-'));
    store = new JsonStore(dir);
    now = 1_700_000_000_000;
    gps = { lat: 51.477928, lon: 0.0015 };
    enabled = true;
  });
  afterEach(async () => {
    await store.flush();
    await rm(dir, { recursive: true, force: true });
  });

  const make = (f: typeof fetch) => new WeatherService({ store, fetch: f, now: () => now, position: () => gps, enabled: () => enabled });

  it('fetches for the GPS position, rounded, and shows the result', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain('https://api.open-meteo.com/v1/forecast?latitude=51.48&longitude=0');
    expect(url).not.toContain('51.477928'); // never the exact position
    const s = w.state.get();
    expect(s).toMatchObject({ status: 'ok', location: { lat: 51.48, lon: 0, source: 'gps' }, fetchedAt: now });
    expect(s.current?.tempC).toBe(19.4);
    expect(s.daily).toHaveLength(4);
    w.stop();
  });

  it('sends nothing while weather is switched off in Settings', async () => {
    enabled = false;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh(true);
    expect(f).not.toHaveBeenCalled();
    expect(w.state.get()).toMatchObject({ status: 'off', location: null, current: null });
    w.stop();
  });

  it('says so when there is no place at all (no GPS fix, nothing saved)', async () => {
    gps = null;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh(true);
    expect(f).not.toHaveBeenCalled();
    expect(w.state.get().status).toBe('no-location');
    w.stop();
  });

  it('does not ask again while the forecast is fresh, but does once it is stale', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    now += 10 * 60_000;
    await w.refresh();
    expect(f).toHaveBeenCalledTimes(1);
    now += 6 * 60_000;
    await w.refresh();
    expect(f).toHaveBeenCalledTimes(2);
    w.stop();
  });

  it('asks again after the car has driven far from where the forecast was fetched', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    gps = { lat: 51.8, lon: 0.0015 }; // about 36 km north
    await w.refresh();
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1]![0])).toContain('latitude=51.8');
    w.stop();
  });

  it('keeps showing the last forecast when the network fails, and marks it as an error', async () => {
    let fail = false;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => {
      if (fail) throw new Error('offline');
      return ok(FORECAST);
    });
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    fail = true;
    now += 20 * 60_000;
    await w.refresh();
    const s = w.state.get();
    expect(s.status).toBe('error');
    expect(s.error).toBe('offline');
    expect(s.current?.tempC).toBe(19.4); // stale, but better than nothing in a tunnel
    w.stop();
  });

  it('an error is not erased by the next idle check, and a success clears it', async () => {
    let fail = true;
    const f = vi.fn(async (_url: string, _init?: RequestInit) => (fail ? new Response('nope', { status: 503 }) : ok(FORECAST)));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    expect(w.state.get()).toMatchObject({ status: 'error', error: 'The weather service answered 503.' });
    await w['tick'](); // inside the back-off window: it must not ask again, and must not forget the error
    expect(f.mock.calls.length).toBeLessThanOrEqual(2);
    expect(w.state.get().status).toBe('error');
    fail = false;
    await w.refresh(true);
    expect(w.state.get()).toMatchObject({ status: 'ok' });
    expect(w.state.get().error).toBeUndefined();
    w.stop();
  });

  it('refuses a response that is not weather', async () => {
    const w = make((async () => ok({ hello: 'world' })) as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    expect(w.state.get()).toMatchObject({ status: 'error', error: 'The weather service sent something unexpected.' });
    w.stop();
  });

  it('a chosen place beats GPS and is remembered; going back to GPS forgets it', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.setPlace(35.6762, 139.6503, 'Tokyo');
    // The boot-time GPS fetch may already be running; the new place is fetched after it, never swallowed by it.
    expect(String(f.mock.calls.at(-1)![0])).toContain('latitude=35.68&longitude=139.65');
    expect(w.state.get().location).toEqual({ lat: 35.68, lon: 139.65, source: 'manual', name: 'Tokyo' });
    await store.flush();

    const again = make(f as unknown as typeof fetch);
    await again.start();
    expect(again.state.get().location).toMatchObject({ source: 'manual', name: 'Tokyo' });
    await again.clearPlace();
    expect(again.state.get().location).toMatchObject({ source: 'gps', lat: 51.48 });
    again.stop();
    w.stop();
  });

  it('remembers where the car was, so the next boot has a forecast before the GPS has a fix', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    await store.flush();
    gps = null;
    const boot = make(f as unknown as typeof fetch);
    await boot.start();
    expect(boot.state.get()).toMatchObject({ status: 'ok', location: { source: 'saved', lat: 51.48 } });
    expect(boot.state.get().current?.tempC).toBe(19.4);
    boot.stop();
    w.stop();
  });

  it('does not show a forecast for a place the car is no longer anywhere near', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok(FORECAST));
    const w = make(f as unknown as typeof fetch);
    await w.start();
    await w.refresh();
    gps = { lat: 40.4, lon: -3.7 }; // Madrid
    w['publish']();
    expect(w.state.get().current).toBeNull();
    w.stop();
  });

  it('rejects an impossible place', async () => {
    const w = make((async () => ok(FORECAST)) as unknown as typeof fetch);
    await expect(w.setPlace(200, 0)).rejects.toThrow('not a place');
  });

  it('place search needs a couple of letters and is refused while weather is off', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok({ results: [{ name: 'Leeds', latitude: 53.8, longitude: -1.55, country: 'UK', admin1: 'England' }] }));
    const w = make(f as unknown as typeof fetch);
    expect(await w.searchPlaces('L')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await w.searchPlaces('Leeds')).toEqual([{ name: 'Leeds', detail: 'England, UK', lat: 53.8, lon: -1.55 }]);
    expect(String(f.mock.calls[0]![0])).toContain('geocoding-api.open-meteo.com/v1/search?name=Leeds');
    enabled = false;
    await expect(w.searchPlaces('Leeds')).rejects.toThrow('switched off');
  });

  it('encodes what was typed so it cannot add parameters', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => ok({ results: [] }));
    const w = make(f as unknown as typeof fetch);
    await w.searchPlaces('a&count=999#x');
    expect(String(f.mock.calls[0]![0])).toContain('name=a%26count%3D999%23x&count=6');
  });
});
