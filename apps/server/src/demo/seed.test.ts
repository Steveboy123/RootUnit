import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@headunit/shared';
import { Garage } from '../features/garage';
import { NotesService } from '../features/notes';
import { TripRecorder } from '../features/trips';
import { JsonStore } from '../store';
import { seedDemoData } from './seed';

let dir: string;
let store: JsonStore;
const NOW = new Date(2024, 5, 20, 12, 0).getTime();
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seed-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  await store.flush();
  await rm(dir, { recursive: true, force: true });
});

describe('seedDemoData', () => {
  it('seeds a garage the real engines accept, with believable numbers', async () => {
    expect(await seedDemoData(store, NOW)).toBe(true);
    const g = new Garage(store, () => NOW);
    await g.start();
    const s = g.state.get();
    expect(s.vehicle).toMatchObject({ name: 'Demo Hatchback', fuelType: 'petrol', tankL: 50 });
    expect(s.fuel.length).toBeGreaterThanOrEqual(8);
    expect(s.stats.series.length).toBeGreaterThanOrEqual(4);
    for (const p of s.stats.series) {
      expect(p.lPer100).toBeGreaterThan(5);
      expect(p.lPer100).toBeLessThan(10);
    }
    // Something to look at in every state: overdue, soon and fine.
    const status = new Set(s.due.map((d) => d.status));
    expect([...status].sort()).toEqual(['ok', 'overdue', 'soon']);
    expect(s.due[0]!.status).toBe('overdue');
    // Odometer ahead of every fill-up.
    expect(Math.max(...s.fuel.map((f) => f.odometerKm))).toBeLessThanOrEqual(s.vehicle.odometerKm!);
    g.stop();
  });

  it('seeds two weeks of sensible trips and some notes', async () => {
    await seedDemoData(store, NOW);
    const t = new TripRecorder(store, { now: () => NOW });
    await t.start();
    t.stop();
    const s = t.state.get();
    expect(s.all.trips).toBeGreaterThanOrEqual(20);
    for (const trip of s.recent) {
      expect(trip.distanceKm).toBeGreaterThan(1);
      expect(trip.durationS).toBeGreaterThanOrEqual(trip.movingS);
      expect(trip.avgSpeedKmh).toBeLessThan(trip.maxSpeedKmh);
      expect(trip.startedAt).toBeLessThanOrEqual(NOW);
    }
    expect(s.daily).toHaveLength(14);
    expect(s.daily.some((d) => d.km > 0)).toBe(true);
    const n = new NotesService(store);
    await n.start();
    expect(n.list().map((x) => x.title)).toEqual(['Road trip packing', 'Ideas']);
  });

  it('is deterministic, and never overwrites what is already there', async () => {
    await seedDemoData(store, NOW);
    const first = JSON.stringify(await store.read('garage.json'));
    expect(await seedDemoData(store, NOW)).toBe(false);
    expect(JSON.stringify(await store.read('garage.json'))).toBe(first);
    const other = new JsonStore(await mkdtemp(join(tmpdir(), 'seed2-')));
    await seedDemoData(other, NOW);
    expect(JSON.stringify(await other.read('garage.json'))).toBe(first);
  });
});

describe('seedDemoData settings', () => {
  it('turns lyrics on for a fresh demo, with every other setting at its default', async () => {
    await seedDemoData(store, NOW);
    const s = sanitizeSettings(await store.read('settings.json'));
    expect(s.lyrics).toBe(true);
    expect({ ...s, lyrics: false }).toEqual({ ...DEFAULT_SETTINGS, lyrics: false });
  });
  it('never overwrites settings that already exist', async () => {
    await store.write('settings.json', { lyrics: false, units: 'imperial' });
    await seedDemoData(store, NOW);
    expect(sanitizeSettings(await store.read('settings.json'))).toMatchObject({ lyrics: false, units: 'imperial' });
  });
});
