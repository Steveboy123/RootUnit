import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocItem, FuelEntry, ServiceItem } from '@headunit/shared';
import { JsonStore } from '../store';
import { Garage, GarageError, addMonths, computeDue, computeFuelStats, daysBetween } from './garage';

const fuel = (date: string, odometerKm: number, liters: number, full = true, cost: number | null = null): FuelEntry => ({ id: `f${odometerKm}`, date, odometerKm, liters, cost, full, note: '' });

describe('dates', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2024-03-01', '2024-03-31')).toBe(30);
    expect(daysBetween('2024-03-31', '2024-03-01')).toBe(-30);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // leap year
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
    expect(daysBetween('2024-03-30', '2024-04-01')).toBe(2); // across the clock change: still whole days
  });

  it('adds months and clamps to the end of a shorter month', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-11-15', 3)).toBe('2025-02-15');
    expect(addMonths('2024-06-10', 12)).toBe('2025-06-10');
    expect(addMonths('2024-03-31', 6)).toBe('2024-09-30');
  });
});

describe('computeFuelStats: full-to-full', () => {
  it('measures litres per 100 km between two fills to the brim', () => {
    // 500 km driven, 35 L needed to top up again: 7.0 L/100 km.
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40), fuel('2024-05-10', 10_500, 35)], 2024);
    expect(s.series).toEqual([{ date: '2024-05-10', lPer100: 7, km: 500, liters: 35, cost: null }]);
    expect(s.lastLPer100).toBe(7);
    expect(s.avgLPer100).toBe(7);
  });

  it('the first fill is only a baseline: one entry measures nothing', () => {
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40)], 2024);
    expect(s.series).toEqual([]);
    expect(s.lastLPer100).toBeNull();
    expect(s.avgLPer100).toBeNull();
  });

  it('counts part-fills in between towards the interval and ignores them as an end point', () => {
    // 10,000 full (baseline) -> 10,200 part 20 L -> 10,400 part 15 L -> 10,600 full 20 L: 55 L over 600 km = 9.1667
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40), fuel('2024-05-05', 10_200, 20, false), fuel('2024-05-08', 10_400, 15, false), fuel('2024-05-12', 10_600, 20)], 2024);
    expect(s.series).toHaveLength(1);
    expect(s.series[0]).toMatchObject({ km: 600, liters: 55 });
    expect(s.series[0]!.lPer100).toBeCloseTo(9.17, 2);
  });

  it('does not use a part-fill as the baseline', () => {
    // The first entry is a part-fill, so nothing can be measured until the first full one.
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 20, false), fuel('2024-05-05', 10_400, 30, true)], 2024);
    expect(s.series).toEqual([]);
  });

  it('orders by odometer, not by the order they were typed', () => {
    const s = computeFuelStats([fuel('2024-05-10', 10_500, 35), fuel('2024-05-01', 10_000, 40)], 2024);
    expect(s.series[0]).toMatchObject({ km: 500, lPer100: 7 });
  });

  it('throws out an interval with a typo in the odometer but measures the next one from that fill', () => {
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40), fuel('2024-05-05', 1_050, 30), fuel('2024-05-09', 1_450, 28)], 2024);
    // sorted by odometer: 1,050 (baseline) -> 1,450 (400 km, 28 L = 7 L/100) -> 10,000 (8,550 km, 40 L = 0.47 L/100: implausible, dropped)
    expect(s.series.map((x) => x.lPer100)).toEqual([7]);
  });

  it('ignores a zero-distance interval (two fills at the same odometer reading)', () => {
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40), fuel('2024-05-01', 10_000, 5)], 2024);
    expect(s.series).toEqual([]);
  });

  it('averages the last five intervals weighted by distance, not the plain mean', () => {
    const entries = [fuel('2024-01-01', 0, 40)];
    // Six intervals: five of 100 km at 5 L (5 L/100), one of 1000 km at 100 L (10 L/100).
    let odo = 0;
    for (let i = 0; i < 5; i++) entries.push(fuel(`2024-02-0${i + 1}`, (odo += 100), 5));
    entries.push(fuel('2024-03-01', (odo += 1000), 100));
    const s = computeFuelStats(entries, 2024);
    expect(s.series).toHaveLength(6);
    // last five: four at 100 km / 5 L, one at 1000 km / 100 L => 120 L over 1400 km = 8.571 L/100
    expect(s.avgLPer100).toBeCloseTo(8.57, 2);
    expect(s.lastLPer100).toBe(10);
  });

  it('works out cost per km only over intervals where every fill has a cost', () => {
    const s = computeFuelStats([fuel('2024-05-01', 10_000, 40, true, 60), fuel('2024-05-10', 10_500, 35, true, 56), fuel('2024-05-20', 11_000, 36, true, null)], 2024);
    expect(s.series[0]!.cost).toBe(56);
    expect(s.series[1]!.cost).toBeNull();
    expect(s.costPerKm).toBeCloseTo(0.112, 3); // 56 EUR over 500 km
  });

  it('totals what was spent this year and the litres overall', () => {
    const s = computeFuelStats([fuel('2023-12-30', 9_500, 40, true, 70), fuel('2024-05-01', 10_000, 40, true, 60), fuel('2024-05-10', 10_500, 35, true, 56)], 2024);
    expect(s.spentThisYear).toBe(116);
    expect(s.totalLiters).toBe(115);
  });
});

describe('computeDue', () => {
  const svc = (over: Partial<ServiceItem>): ServiceItem => ({ id: 's', name: 'Oil', everyKm: 15_000, everyMonths: 12, lastKm: 50_000, lastDate: '2024-01-10', note: '', ...over });
  const doc = (over: Partial<DocItem>): DocItem => ({ id: 'd', name: 'Insurance', expires: '2024-09-01', note: '', ...over });

  it('a service far from due is ok and says how far', () => {
    const [d] = computeDue([svc({})], [], 52_000, '2024-02-01');
    expect(d).toMatchObject({ status: 'ok', kmLeft: 13_000, daysLeft: 344 });
    expect(d!.detail).toBe('in 13,000 km · in 344 days');
  });

  it('is "soon" within the warning margin by distance (10 % of the interval, between 300 and 1500 km)', () => {
    expect(computeDue([svc({ everyMonths: null })], [], 64_000, '2024-02-01')[0]).toMatchObject({ status: 'soon', kmLeft: 1000 }); // interval 15,000: margin 1,500
    expect(computeDue([svc({ everyMonths: null })], [], 63_400, '2024-02-01')[0]).toMatchObject({ status: 'ok', kmLeft: 1600 });
    expect(computeDue([svc({ everyKm: 2000, everyMonths: null })], [], 51_800, '2024-02-01')[0]).toMatchObject({ status: 'soon', kmLeft: 200 }); // margin never below 300
  });

  it('is "soon" within 30 days and overdue the day after', () => {
    expect(computeDue([svc({ everyKm: null })], [], null, '2024-12-11')[0]).toMatchObject({ status: 'soon', daysLeft: 30 });
    expect(computeDue([svc({ everyKm: null })], [], null, '2025-01-10')[0]).toMatchObject({ status: 'soon', daysLeft: 0, detail: 'today' });
    expect(computeDue([svc({ everyKm: null })], [], null, '2025-01-11')[0]).toMatchObject({ status: 'overdue', daysLeft: -1, detail: '1 day overdue' });
  });

  it('whichever limit is reached first makes it overdue', () => {
    const [d] = computeDue([svc({})], [], 66_000, '2024-02-01'); // 1,000 km past the distance, plenty of time left
    expect(d).toMatchObject({ status: 'overdue', kmLeft: -1000 });
    expect(d!.detail).toContain('1,000 km overdue');
  });

  it('cannot judge a service with nothing to measure from, and says what is needed', () => {
    expect(computeDue([svc({ lastKm: null, lastDate: null })], [], 50_000, '2024-02-01')[0]).toMatchObject({ status: 'ok', detail: 'Mark it done once to start tracking' });
    expect(computeDue([svc({ everyMonths: null })], [], null, '2024-02-01')[0]).toMatchObject({ status: 'ok', detail: 'Set the odometer to start tracking' });
  });

  it('documents: ok, soon, expires today, expired', () => {
    expect(computeDue([], [doc({})], null, '2024-06-01')[0]).toMatchObject({ status: 'ok', detail: 'expires in 92 days' });
    expect(computeDue([], [doc({})], null, '2024-08-15')[0]).toMatchObject({ status: 'soon', detail: 'expires in 17 days' });
    expect(computeDue([], [doc({})], null, '2024-09-01')[0]).toMatchObject({ status: 'soon', detail: 'expires today' });
    expect(computeDue([], [doc({})], null, '2024-09-04')[0]).toMatchObject({ status: 'overdue', detail: 'expired 3 days ago' });
  });

  it('lists the most urgent first: overdue, then soon, then ok, nearest deadline first within each', () => {
    const due = computeDue(
      [svc({ id: 'a', name: 'Fine', lastDate: '2024-06-01', everyKm: null }), svc({ id: 'b', name: 'Late', lastDate: '2023-01-01', everyKm: null })],
      [doc({ id: 'c', name: 'Soon doc', expires: '2024-07-10' }), doc({ id: 'd', name: 'Soonest doc', expires: '2024-07-02' })],
      null,
      '2024-06-25',
    );
    expect(due.map((d) => d.name)).toEqual(['Late', 'Soonest doc', 'Soon doc', 'Fine']);
    expect(due.map((d) => d.status)).toEqual(['overdue', 'soon', 'soon', 'ok']);
  });
});

describe('Garage', () => {
  let dir: string;
  let store: JsonStore;
  let now: number;
  const clock = () => now;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'garage-'));
    store = new JsonStore(dir);
    now = new Date(2024, 5, 20, 12, 0).getTime();
  });
  afterEach(async () => {
    await store.flush();
    await rm(dir, { recursive: true, force: true });
  });

  async function make() {
    const g = new Garage(store, clock);
    await g.start();
    return g;
  }

  it('a fuel entry sets the odometer, and a later trip adds to it', async () => {
    const g = await make();
    expect(g.state.get().vehicle.odometerKm).toBeNull();
    g.addDistance(12); // nothing is added before the owner has said where the odometer stands
    expect(g.state.get().vehicle.odometerKm).toBeNull();
    await g.addFuel({ date: '2024-06-20', odometerKm: 48_200, liters: 41.5, full: true, cost: 70 });
    expect(g.state.get().vehicle.odometerKm).toBe(48_200);
    g.addDistance(12.34);
    expect(g.state.get().vehicle.odometerKm).toBe(48_212.3);
  });

  it('an older fuel entry does not wind the odometer back', async () => {
    const g = await make();
    await g.addFuel({ date: '2024-06-20', odometerKm: 48_200, liters: 40 });
    g.addDistance(100);
    await g.addFuel({ date: '2024-05-01', odometerKm: 47_000, liters: 40 });
    expect(g.state.get().vehicle.odometerKm).toBe(48_300);
  });

  it('keeps the fuel log newest first', async () => {
    const g = await make();
    await g.addFuel({ date: '2024-05-01', odometerKm: 47_000, liters: 40 });
    await g.addFuel({ date: '2024-06-01', odometerKm: 47_600, liters: 38 });
    await g.addFuel({ date: '2024-05-15', odometerKm: 47_300, liters: 20, full: false });
    expect(g.state.get().fuel.map((f) => f.date)).toEqual(['2024-06-01', '2024-05-15', '2024-05-01']);
  });

  it('refuses bad input with a plain message and changes nothing', async () => {
    const g = await make();
    await expect(g.addFuel({ date: 'yesterday', odometerKm: 1, liters: 1 })).rejects.toBeInstanceOf(GarageError);
    await expect(g.addFuel({ date: '2024-02-30', odometerKm: 1, liters: 1 })).rejects.toThrow('date');
    await expect(g.addFuel({ date: '2024-06-01', odometerKm: -5, liters: 1 })).rejects.toThrow();
    await expect(g.addService({ name: 'Oil' })).rejects.toThrow('interval');
    await expect(g.addDoc({ name: 'Insurance', expires: 'soon' })).rejects.toThrow('expiry');
    await expect(g.updateFuel('missing', { date: '2024-06-01', odometerKm: 1, liters: 1 })).rejects.toThrow('no longer exists');
    expect(g.state.get().fuel).toEqual([]);
  });

  it('marks a service done at the current odometer and today, and the reminder resets', async () => {
    const g = await make();
    await g.setVehicle({ odometerKm: 60_000 });
    const s = await g.addService({ name: 'Oil & filter', everyKm: 15_000, everyMonths: 12, lastKm: 40_000, lastDate: '2023-01-01' });
    expect(g.state.get().due[0]).toMatchObject({ id: s.id, status: 'overdue' });
    await g.markServiceDone(s.id);
    expect(g.state.get().services[0]).toMatchObject({ lastKm: 60_000, lastDate: '2024-06-20' });
    expect(g.state.get().due[0]).toMatchObject({ status: 'ok', kmLeft: 15_000, daysLeft: 365 });
  });

  it('documents can be added, renewed and deleted', async () => {
    const g = await make();
    const d = await g.addDoc({ name: 'Inspection', expires: '2024-07-01' });
    expect(g.state.get().due[0]).toMatchObject({ kind: 'doc', status: 'soon' });
    await g.updateDoc(d.id, { name: 'Inspection', expires: '2026-07-01' });
    expect(g.state.get().due[0]).toMatchObject({ status: 'ok' });
    await g.deleteDoc(d.id);
    expect(g.state.get().docs).toEqual([]);
  });

  it('the days tick over by themselves as the date changes', async () => {
    const g = await make();
    await g.addDoc({ name: 'Insurance', expires: '2024-07-30' });
    expect(g.state.get().due[0]!.status).toBe('ok');
    now = new Date(2024, 6, 15, 12, 0).getTime();
    await g.start(); // what the hourly timer does
    expect(g.state.get().due[0]).toMatchObject({ status: 'soon', daysLeft: 15 });
    g.stop();
  });

  it('survives a restart with everything intact', async () => {
    const g = await make();
    await g.setVehicle({ name: 'Golf', plate: 'ab12 cde', fuelType: 'diesel', tankL: 50, odometerKm: 80_000 });
    await g.addFuel({ date: '2024-06-01', odometerKm: 80_100, liters: 42, cost: 75.5 });
    await g.addService({ name: 'Brake fluid', everyMonths: 24, lastDate: '2023-06-01' });
    await g.addDoc({ name: 'Road tax', expires: '2025-01-01' });
    g.stop();
    await store.flush();

    const again = await make();
    const s = again.state.get();
    expect(s.vehicle).toMatchObject({ name: 'Golf', plate: 'AB12 CDE', fuelType: 'diesel', tankL: 50, odometerKm: 80_100 });
    expect(s.fuel).toHaveLength(1);
    expect(s.services[0]).toMatchObject({ name: 'Brake fluid', everyMonths: 24, everyKm: null });
    expect(s.docs[0]).toMatchObject({ name: 'Road tax' });
    again.stop();
  });

  it('drops damaged entries from a file one by one and keeps the rest', async () => {
    await store.write('garage.json', {
      version: 1,
      vehicle: { name: 'Polo', tankL: 'lots', odometerKm: 1000 },
      fuel: [{ id: 'good00001', date: '2024-06-01', odometerKm: 1000, liters: 30, full: true, cost: null, note: '' }, { date: 'bad' }, 'junk', null],
      services: [{ name: 'Oil', everyKm: 10_000, everyMonths: null }, { name: '', everyKm: 1 }],
      docs: [{ name: 'MOT', expires: '2024-13-45' }],
    });
    await store.flush();
    const g = await make();
    const s = g.state.get();
    expect(s.vehicle).toMatchObject({ name: 'Polo', tankL: null, odometerKm: 1000 });
    expect(s.fuel.map((f) => f.id)).toEqual(['good00001']);
    expect(s.services.map((x) => x.name)).toEqual(['Oil']);
    expect(s.docs).toEqual([]);
    g.stop();
  });

  it('export and restore round-trip', async () => {
    const g = await make();
    await g.addFuel({ date: '2024-06-01', odometerKm: 5000, liters: 30 });
    const dump = JSON.parse(JSON.stringify(g.export()));
    const other = new Garage(new JsonStore(await mkdtemp(join(tmpdir(), 'garage2-'))), clock);
    await other.restore(dump);
    expect(other.state.get().fuel).toHaveLength(1);
    expect(other.state.get().vehicle.odometerKm).toBe(5000);
  });

  it('limits the log so the file cannot grow without end', async () => {
    const g = await make();
    for (let i = 0; i < 500; i++) g['data'].fuel.push({ id: `x${i}`.padEnd(6, '0'), date: '2024-01-01', odometerKm: i, liters: 1, cost: null, full: true, note: '' });
    await expect(g.addFuel({ date: '2024-06-01', odometerKm: 9999, liters: 30 })).rejects.toThrow('full');
  });
});
