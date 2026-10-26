import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TripRecord } from '@headunit/shared';
import { JsonStore } from '../store';
import { TripRecorder, sanitizeTrip, type TripSample } from './trips';

let dir: string;
let store: JsonStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trips-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  await store.flush();
  await rm(dir, { recursive: true, force: true });
});

// Local-time dates so the day/week/month totals do not depend on the machine's time zone.
const T0 = new Date(2024, 5, 19, 8, 0, 0).getTime(); // Wednesday 19 June 2024, 08:00

/** Drives a recorder through a made-up journey, one reading per second. */
function rig(config = {}) {
  let now = T0;
  const ended: TripRecord[] = [];
  let n = 0;
  const rec = new TripRecorder(store, { now: () => now, config, onTripEnded: (t) => ended.push(t), newId: () => `t${++n}` });
  const at = () => now;
  const feed = (seconds: number, speedKmh: number, extra: Partial<TripSample> = {}) => {
    for (let i = 0; i < seconds; i++) {
      rec.ingest({ at: now, speedKmh, source: 'obd', ...extra });
      now += 1000;
    }
  };
  /** Ramp the speed in a straight line, like a real acceleration. */
  const ramp = (seconds: number, from: number, to: number) => {
    for (let i = 0; i < seconds; i++) {
      rec.ingest({ at: now, speedKmh: from + ((to - from) * i) / Math.max(1, seconds - 1), source: 'obd' });
      now += 1000;
    }
  };
  return { rec, ended, feed, ramp, at, skip: (ms: number) => void (now += ms) };
}

describe('TripRecorder: starting and ending', () => {
  it('records nothing for a car that is parked', () => {
    const r = rig();
    r.feed(120, 0);
    expect(r.rec.state.get().active).toBeNull();
    expect(r.ended).toEqual([]);
  });

  it('does not start a trip for a few seconds of rolling (moving off the driveway)', () => {
    const r = rig();
    r.feed(5, 12);
    r.feed(400, 0);
    expect(r.ended).toEqual([]);
    expect(r.rec.state.get().recent).toEqual([]);
  });

  it('only shows an active trip once the car has really got going', () => {
    const r = rig();
    r.feed(6, 40); // 6 s: still just moving off
    expect(r.rec.state.get().active).toBeNull();
    r.feed(6, 40); // past the 8 s hold
    expect(r.rec.state.get().active).not.toBeNull();
  });

  it('records a drive: distance from speed over time, ends after the car has stood still for five minutes', async () => {
    const r = rig();
    r.feed(10, 0);
    r.feed(600, 60); // 10 minutes at 60 km/h = 10 km
    expect(r.rec.state.get().active).toMatchObject({ distanceKm: expect.any(Number), paused: false });
    r.feed(299, 0); // stopped, but not for long enough yet
    expect(r.ended).toEqual([]);
    r.feed(2, 0);
    expect(r.ended).toHaveLength(1);
    const trip = r.ended[0]!;
    expect(trip.distanceKm).toBeCloseTo(10, 0);
    expect(trip.maxSpeedKmh).toBe(60);
    expect(trip.avgSpeedKmh).toBeCloseTo(60, 0);
    // The trip ends where the car came to rest, not five minutes later.
    expect(trip.durationS).toBeGreaterThan(595);
    expect(trip.durationS).toBeLessThan(620);
    expect(r.rec.state.get().active).toBeNull();
    expect(r.rec.state.get().recent[0]?.id).toBe('t1');
    await store.flush();
    expect(await store.read('trips.json')).toMatchObject({ version: 1, trips: [{ id: 't1' }] });
  });

  it('a red light does not end the trip, and the stop is not counted as moving time', () => {
    const r = rig();
    r.feed(120, 50);
    r.feed(90, 0); // 90 s at a red light
    expect(r.rec.state.get().active).toMatchObject({ paused: true });
    r.feed(120, 50);
    r.feed(400, 0);
    expect(r.ended).toHaveLength(1);
    const trip = r.ended[0]!;
    expect(trip.movingS).toBeCloseTo(240, -1);
    expect(trip.durationS).toBeGreaterThan(trip.movingS + 80);
    expect(trip.avgSpeedKmh).toBeCloseTo(50, 0); // average of the moving time
  });

  it('drops a trip that was too short to mean anything', () => {
    const r = rig();
    r.feed(30, 20); // 30 s at 20 km/h is 0.17 km
    r.feed(400, 0);
    expect(r.ended).toEqual([]);
    expect(r.rec.state.get().recent).toEqual([]);
  });

  it('uses hysteresis: a slow crawl above the stop speed keeps the trip alive', () => {
    const r = rig();
    r.feed(120, 40);
    r.feed(600, 3); // crawling at 3 km/h in a queue: above stopKmh (2), so not "stopped"
    expect(r.ended).toEqual([]);
    r.feed(400, 0);
    expect(r.ended).toHaveLength(1);
  });

  it('reports the fuel used and where the trip began and ended', () => {
    const r = rig();
    r.feed(60, 60, { fuelPct: 80, pos: { lat: 51.5, lon: 0 } });
    r.feed(60, 60, { fuelPct: 79.2, pos: { lat: 51.6, lon: 0.1 } });
    r.feed(400, 0, { fuelPct: 79.2 });
    expect(r.ended[0]).toMatchObject({ start: { lat: 51.5, lon: 0 }, end: { lat: 51.6, lon: 0.1 }, fuelUsedPct: 0.8 });
  });

  it('ignores impossible readings instead of recording a 900 km/h top speed', () => {
    const r = rig();
    r.feed(60, 50);
    r.rec.ingest({ at: r.at(), speedKmh: 900, source: 'obd' });
    r.rec.ingest({ at: r.at() + 500, speedKmh: -4, source: 'obd' });
    r.rec.ingest({ at: r.at() + 800, speedKmh: Number.NaN, source: 'obd' });
    r.skip(1000);
    r.feed(60, 50);
    r.feed(400, 0);
    expect(r.ended[0]!.maxSpeedKmh).toBe(50);
  });
});

describe('TripRecorder: data that goes missing', () => {
  it('bridges a short gap (a GPS tunnel) with the speeds on either side', () => {
    const r = rig();
    r.feed(60, 90);
    r.skip(60_000); // a minute without data
    r.feed(60, 90);
    r.feed(400, 0);
    // 120 s of data at 90 km/h = 3 km, plus the 60 s gap bridged at 90 km/h = 1.5 km
    expect(r.ended[0]!.distanceKm).toBeCloseTo(4.5, 0);
  });

  it('ends a trip when the speed source stays quiet (adapter unplugged), cut where it was last heard', () => {
    const r = rig();
    r.feed(120, 70);
    const lastHeard = r.at() - 1000;
    r.skip(10 * 60_000);
    r.rec.tick(r.at());
    expect(r.ended).toHaveLength(1);
    expect(r.ended[0]!.endedAt).toBe(lastHeard);
  });

  it('a long silence between two readings ends the first trip and does not stretch it', () => {
    const r = rig();
    r.feed(120, 70);
    r.skip(2 * 3600_000);
    r.feed(120, 70);
    r.feed(400, 0);
    expect(r.ended).toHaveLength(2);
    expect(r.ended[0]!.durationS).toBeLessThan(200);
  });

  it('survives the clock being set back', () => {
    const r = rig();
    r.feed(60, 70);
    r.skip(-3600_000);
    expect(() => r.feed(60, 70)).not.toThrow();
  });
});

describe('TripRecorder: power loss', () => {
  it('keeps a draft while driving and finishes the trip on the next boot', async () => {
    const r = rig({ draftEveryS: 5 });
    r.feed(10, 0);
    r.feed(300, 60);
    await store.flush();
    expect((await store.read('trips-draft.json')) as { run?: unknown }).toMatchObject({ run: { phase: 'driving' } });
    // ...the ignition goes off: the process dies without ever calling stop().
    const lastMoving = r.at() - 1000;

    const after = new TripRecorder(store, { now: () => lastMoving + 40_000, newId: () => 'recovered' });
    await after.start();
    after.stop();
    const trips = after.state.get().recent;
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ id: 'recovered', endedAt: lastMoving });
    expect(trips[0]!.distanceKm).toBeGreaterThan(4);
    await store.flush();
    expect(await store.read('trips-draft.json')).toEqual({});
  });

  it('a graceful stop while driving leaves the same draft behind', async () => {
    const r = rig({ draftEveryS: 1000 });
    r.feed(120, 60);
    r.rec.stop();
    await store.flush();
    expect((await store.read('trips-draft.json')) as { run?: unknown }).toMatchObject({ run: { phase: 'driving' } });
  });

  it('a stale draft too short to count is thrown away', async () => {
    await store.write('trips-draft.json', { run: { phase: 'driving', startedAt: T0, km: 0.01, movingS: 5, maxKmh: 10, idleS: 0, lastMovingAt: T0 + 5000, start: null, end: null, startFuel: null, lastFuel: null, source: 'obd' } });
    await store.flush();
    const rec = new TripRecorder(store, { now: () => T0 });
    await rec.start();
    rec.stop();
    expect(rec.state.get().recent).toEqual([]);
  });
});

describe('TripRecorder: totals', () => {
  const trip = (id: string, startedAt: number, km: number): TripRecord => ({
    id,
    startedAt,
    endedAt: startedAt + 600_000,
    distanceKm: km,
    durationS: 600,
    movingS: 580,
    avgSpeedKmh: 40,
    maxSpeedKmh: 90,
    source: 'obd',
  });

  it('adds up today, this week (from Monday), this month and everything, and charts the last 14 days', async () => {
    const wed = new Date(2024, 5, 19, 12, 0).getTime();
    await store.write('trips.json', {
      version: 1,
      trips: [
        trip('a', new Date(2024, 5, 19, 7, 0).getTime(), 10), // today
        trip('b', new Date(2024, 5, 17, 9, 0).getTime(), 20), // Monday: this week
        trip('c', new Date(2024, 5, 16, 9, 0).getTime(), 30), // Sunday: last week, same month
        trip('d', new Date(2024, 4, 1, 9, 0).getTime(), 40), // last month
      ],
    });
    await store.flush();
    const rec = new TripRecorder(store, { now: () => wed });
    await rec.start();
    rec.stop();
    const s = rec.state.get();
    expect(s.today).toEqual({ trips: 1, distanceKm: 10, durationS: 600 });
    expect(s.week).toEqual({ trips: 2, distanceKm: 30, durationS: 1200 });
    expect(s.month).toEqual({ trips: 3, distanceKm: 60, durationS: 1800 });
    expect(s.all).toEqual({ trips: 4, distanceKm: 100, durationS: 2400 });
    expect(s.daily).toHaveLength(14);
    expect(s.daily.at(-1)).toEqual({ day: '2024-06-19', km: 10 });
    expect(s.daily.find((d) => d.day === '2024-06-17')?.km).toBe(20);
    expect(s.daily.find((d) => d.day === '2024-06-18')?.km).toBe(0);
  });

  it('deletes one trip and clears all, persisting each', async () => {
    await store.write('trips.json', { version: 1, trips: [trip('a', T0, 5), trip('b', T0 + 1, 6)] });
    await store.flush();
    const rec = new TripRecorder(store, { now: () => T0 + 10_000 });
    await rec.start();
    expect(await rec.deleteTrip('a')).toBe(true);
    expect(await rec.deleteTrip('nope')).toBe(false);
    expect(rec.state.get().recent.map((t) => t.id)).toEqual(['b']);
    await rec.clear();
    expect(rec.state.get().recent).toEqual([]);
    expect(await store.read('trips.json')).toEqual({ version: 1, trips: [] });
    rec.stop();
  });
});

describe('sanitizeTrip', () => {
  const ok = { id: 'x', startedAt: 1, endedAt: 2, distanceKm: 3, durationS: 4, movingS: 3, avgSpeedKmh: 50, maxSpeedKmh: 80, source: 'gps' };
  it('keeps a good trip and drops nonsense', () => {
    expect(sanitizeTrip(ok)).toMatchObject({ id: 'x', source: 'gps' });
    for (const bad of [null, 5, 'x', {}, { ...ok, distanceKm: -1 }, { ...ok, endedAt: 0 }, { ...ok, id: 5 }, { ...ok, maxSpeedKmh: Number.NaN }]) expect(sanitizeTrip(bad)).toBeNull();
  });
  it('drops malformed points rather than keeping them', () => {
    expect(sanitizeTrip({ ...ok, start: { lat: 999, lon: 0 }, end: { lat: 1, lon: 2 } })).toEqual({ ...ok, end: { lat: 1, lon: 2 } });
  });
});
