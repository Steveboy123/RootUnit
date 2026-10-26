import type { JsonStore } from '../store';
import { localIsoDate } from '../features/garage';

const DAY = 86_400_000;

/** A small deterministic generator, so the demo looks the same every time it is seeded. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const isoDaysAgo = (now: number, days: number) => localIsoDate(now - days * DAY);
const isoDaysAhead = (now: number, days: number) => localIsoDate(now + days * DAY);
const isoMonthsAgo = (now: number, months: number) => {
  const d = new Date(now);
  return localIsoDate(new Date(d.getFullYear(), d.getMonth() - months, Math.min(d.getDate(), 28)).getTime());
};

/**
 * Give a fresh demo data folder something to show: a garage with a fuel log, a service that is due and a document about to expire,
 * two weeks of trips, and a couple of notes. Written only when there is no garage yet, so edits made in the demo are kept.
 * Demo mode keeps its own data folder (data-demo/), so none of this can ever reach a real head unit.
 */
export async function seedDemoData(store: JsonStore, now = Date.now()): Promise<boolean> {
  // Lyrics are off by default (they send the song's name to a service). The demo's service is simulated, so show the feature.
  if ((await store.read('settings.json')) === null) await store.write('settings.json', { lyrics: true });
  if ((await store.read('garage.json')) !== null) return false;
  const rand = rng(42);

  // Fuel: a fill roughly every 9 days, 520-620 km apart, mostly to the brim.
  const fuel: unknown[] = [];
  let odo = 48_730;
  const fills = 9;
  const dates = Array.from({ length: fills }, (_, i) => fills - 1 - i).map((i) => i * 11 + 2);
  const kmPerLeg = Array.from({ length: fills }, () => 480 + Math.round(rand() * 140));
  const legs: number[] = [];
  let back = odo;
  for (let i = fills - 1; i >= 0; i--) {
    legs[i] = back;
    back -= kmPerLeg[i]!;
  }
  for (let i = 0; i < fills; i++) {
    const km = kmPerLeg[i]!;
    const lPer100 = 6.4 + rand() * 1.5;
    const liters = Math.round(((km * lPer100) / 100) * 10) / 10;
    const price = 1.68 + rand() * 0.16;
    fuel.push({ date: isoDaysAgo(now, dates[i]!), odometerKm: legs[i], liters, cost: Math.round(liters * price * 100) / 100, full: i % 4 !== 2, note: '' });
  }
  odo = legs[fills - 1]!;

  await store.write('garage.json', {
    version: 1,
    vehicle: { name: 'Demo Hatchback', plate: 'DEMO 123', fuelType: 'petrol', tankL: 50, odometerKm: odo, odometerAt: now },
    fuel,
    services: [
      { name: 'Oil & filter', everyKm: 15_000, everyMonths: 12, lastKm: odo - 13_800, lastDate: isoMonthsAgo(now, 11), note: '' },
      { name: 'Brake fluid', everyKm: null, everyMonths: 24, lastKm: null, lastDate: isoMonthsAgo(now, 25), note: '' },
      { name: 'Tyre rotation', everyKm: 10_000, everyMonths: null, lastKm: odo - 4_200, lastDate: isoMonthsAgo(now, 4), note: '' },
      { name: 'Air filter', everyKm: 30_000, everyMonths: 24, lastKm: odo - 9_000, lastDate: isoMonthsAgo(now, 8), note: '' },
    ],
    docs: [
      { name: 'Insurance', expires: isoDaysAhead(now, 23), note: '' },
      { name: 'Inspection', expires: isoDaysAhead(now, 281), note: '' },
      { name: 'Road tax', expires: isoDaysAhead(now, 152), note: '' },
    ],
  });

  // Trips: commutes, a few errands and a longer weekend drive over the last 14 days.
  const trips: unknown[] = [];
  for (let d = 0; d < 14; d++) {
    const day = new Date(now - d * DAY);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const plan = weekend ? [{ h: 10, km: 38 + rand() * 90 }] : [{ h: 8, km: 14 + rand() * 6 }, { h: 17, km: 14 + rand() * 6 }, ...(rand() > 0.6 ? [{ h: 12, km: 3 + rand() * 5 }] : [])];
    for (const t of plan) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.h, Math.floor(rand() * 40)).getTime();
      if (start > now) continue;
      const avg = weekend ? 62 + rand() * 18 : 32 + rand() * 14;
      const movingS = Math.round((t.km / avg) * 3600);
      const durationS = movingS + Math.round(rand() * 240);
      trips.push({
        id: `demo${String(trips.length).padStart(4, '0')}`,
        startedAt: start,
        endedAt: start + durationS * 1000,
        distanceKm: Math.round(t.km * 10) / 10,
        durationS,
        movingS,
        avgSpeedKmh: Math.round(avg * 10) / 10,
        maxSpeedKmh: Math.round(avg + 25 + rand() * (weekend ? 45 : 20)),
        source: 'obd',
      });
    }
  }
  trips.sort((a, b) => (b as { startedAt: number }).startedAt - (a as { startedAt: number }).startedAt);
  await store.write('trips.json', { version: 1, trips });

  await store.write('notes.json', {
    notes: [
      {
        id: 'demonote01',
        title: 'Road trip packing',
        kind: 'list',
        text: '',
        pinned: true,
        updatedAt: now - 3600_000,
        items: [
          { id: 'di000001', text: 'Phone charger and cable', done: true },
          { id: 'di000002', text: 'Water and snacks', done: true },
          { id: 'di000003', text: 'First-aid kit', done: false },
          { id: 'di000004', text: 'Paper map (just in case)', done: false },
          { id: 'di000005', text: 'Sunglasses', done: false },
        ],
      },
      { id: 'demonote02', title: 'Ideas', kind: 'note', text: 'Fit a USB-C PD charger.\nCheck the dashcam angle before the long drive.', pinned: false, updatedAt: now - 86_400_000, items: [] },
    ],
  });
  await store.flush();
  return true;
}
