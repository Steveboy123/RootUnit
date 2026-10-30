import { randomUUID } from 'node:crypto';
import {
  GARAGE_LIMITS,
  ID_RE,
  isIsoDate,
  sanitizeDocItem,
  sanitizeFuelEntry,
  sanitizeServiceItem,
  sanitizeVehicleProfile,
  type DocItem,
  type DueItem,
  type FuelEntry,
  type FuelStats,
  type GarageState,
  type ServiceItem,
  type VehicleProfile,
} from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const FILE = 'garage.json';
const DAY = 86_400_000;

export const EMPTY_VEHICLE: VehicleProfile = { name: '', plate: '', fuelType: null, tankL: null, odometerKm: null, odometerAt: null };

// ---------------------------------------------------------------------------
// Dates (calendar days, so time zones and daylight saving never shift a deadline by one)
// ---------------------------------------------------------------------------

const utcDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDay(b) - utcDay(a)) / DAY);
}

/** `iso` plus whole months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const day = Number(iso.slice(8, 10));
  const target = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export const localIsoDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Fuel economy
// ---------------------------------------------------------------------------

/** Anything outside this is a typo (a missed digit in the odometer), not a car. */
const PLAUSIBLE_L_PER_100 = { min: 0.5, max: 100 };

/**
 * Consumption by the full-to-full method, the only honest way to measure it from a log: between two fills to the brim, the litres
 * put in (including any part-fills in between) are what the distance consumed. Part-fills on their own say nothing.
 */
export function computeFuelStats(entries: readonly FuelEntry[], year: number): FuelStats {
  const sorted = [...entries].sort((a, b) => a.odometerKm - b.odometerKm || a.date.localeCompare(b.date));
  const series: FuelStats['series'] = [];
  let base = -1;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (!e.full) continue;
    if (base >= 0) {
      const km = e.odometerKm - sorted[base]!.odometerKm;
      let liters = 0;
      let cost: number | null = 0;
      for (let j = base + 1; j <= i; j++) {
        liters += sorted[j]!.liters;
        const c = sorted[j]!.cost;
        cost = cost !== null && c !== null ? cost + c : null;
      }
      const lPer100 = km > 0 ? (liters / km) * 100 : Number.NaN;
      if (Number.isFinite(lPer100) && lPer100 >= PLAUSIBLE_L_PER_100.min && lPer100 <= PLAUSIBLE_L_PER_100.max) {
        series.push({ date: e.date, lPer100: Math.round(lPer100 * 100) / 100, km: Math.round(km * 10) / 10, liters: Math.round(liters * 100) / 100, cost: cost === null ? null : Math.round(cost * 100) / 100 });
      }
    }
    base = i; // even a bad interval restarts from this fill: the next one is measured from here
  }

  const recent = series.slice(-5);
  const sumKm = recent.reduce((s, x) => s + x.km, 0);
  const sumL = recent.reduce((s, x) => s + x.liters, 0);
  const costed = series.filter((x) => x.cost !== null);
  const costKm = costed.reduce((s, x) => s + x.km, 0);
  const costSum = costed.reduce((s, x) => s + (x.cost ?? 0), 0);

  return {
    series,
    lastLPer100: series.at(-1)?.lPer100 ?? null,
    avgLPer100: sumKm > 0 ? Math.round((sumL / sumKm) * 10000) / 100 : null,
    costPerKm: costKm > 0 ? Math.round((costSum / costKm) * 1000) / 1000 : null,
    spentThisYear: Math.round(entries.filter((e) => e.date.startsWith(String(year))).reduce((s, e) => s + (e.cost ?? 0), 0) * 100) / 100,
    totalLiters: Math.round(entries.reduce((s, e) => s + e.liters, 0) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// What is due
// ---------------------------------------------------------------------------

const SOON_DAYS = 30;
const soonKm = (everyKm: number) => Math.min(1500, Math.max(300, everyKm * 0.1));
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const fmtKm = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('en-GB')} km`;

export function computeDue(services: readonly ServiceItem[], docs: readonly DocItem[], odometerKm: number | null, today: string): DueItem[] {
  const out: DueItem[] = [];

  for (const s of services) {
    const kmLeft = s.everyKm !== null && s.lastKm !== null && odometerKm !== null ? Math.round(s.lastKm + s.everyKm - odometerKm) : null;
    const daysLeft = s.everyMonths !== null && s.lastDate !== null ? daysBetween(today, addMonths(s.lastDate, s.everyMonths)) : null;
    if (kmLeft === null && daysLeft === null) {
      out.push({ kind: 'service', id: s.id, name: s.name, status: 'ok', detail: odometerKm === null && s.everyKm !== null && s.everyMonths === null ? 'Set the odometer to start tracking' : 'Mark it done once to start tracking', kmLeft: null, daysLeft: null });
      continue;
    }
    const overdue = (kmLeft !== null && kmLeft < 0) || (daysLeft !== null && daysLeft < 0);
    const soon = (kmLeft !== null && s.everyKm !== null && kmLeft <= soonKm(s.everyKm)) || (daysLeft !== null && daysLeft <= SOON_DAYS);
    const parts: string[] = [];
    if (kmLeft !== null) parts.push(kmLeft < 0 ? `${fmtKm(kmLeft)} overdue` : `in ${fmtKm(kmLeft)}`);
    if (daysLeft !== null) parts.push(daysLeft < 0 ? `${plural(-daysLeft, 'day')} overdue` : daysLeft === 0 ? 'today' : `in ${plural(daysLeft, 'day')}`);
    out.push({ kind: 'service', id: s.id, name: s.name, status: overdue ? 'overdue' : soon ? 'soon' : 'ok', detail: parts.join(' · '), kmLeft, daysLeft });
  }

  for (const d of docs) {
    const daysLeft = daysBetween(today, d.expires);
    out.push({
      kind: 'doc',
      id: d.id,
      name: d.name,
      status: daysLeft < 0 ? 'overdue' : daysLeft <= SOON_DAYS ? 'soon' : 'ok',
      detail: daysLeft < 0 ? `expired ${plural(-daysLeft, 'day')} ago` : daysLeft === 0 ? 'expires today' : `expires in ${plural(daysLeft, 'day')}`,
      kmLeft: null,
      daysLeft,
    });
  }

  const rank = { overdue: 0, soon: 1, ok: 2 } as const;
  const urgency = (d: DueItem) => d.daysLeft ?? (d.kmLeft ?? 0) / 40; // roughly 40 km a day, only to order a km-based item among day-based ones
  return out.sort((a, b) => rank[a.status] - rank[b.status] || urgency(a) - urgency(b));
}

// ---------------------------------------------------------------------------
// The garage
// ---------------------------------------------------------------------------

const newId = () => randomUUID().replace(/-/g, '').slice(0, 10);

/** A saved file read back: bad entries are dropped one by one, never the whole garage. */
function load(raw: unknown): { vehicle: VehicleProfile; fuel: FuelEntry[]; services: ServiceItem[]; docs: DocItem[] } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const idOf = (v: unknown) => (typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string' && ID_RE.test((v as { id: string }).id) ? (v as { id: string }).id : newId());
  const list = <T>(v: unknown, parse: (x: unknown) => Omit<T, 'id'> | null, max: number): T[] =>
    (Array.isArray(v) ? v : []).slice(0, max).flatMap((x) => {
      const p = parse(x);
      return p ? [{ ...p, id: idOf(x) } as T] : [];
    });
  const vehicle = sanitizeVehicleProfile(r.vehicle, EMPTY_VEHICLE);
  if (typeof (r.vehicle as VehicleProfile | undefined)?.odometerAt === 'number') vehicle.odometerAt = (r.vehicle as VehicleProfile).odometerAt;
  else if (vehicle.odometerKm === null) vehicle.odometerAt = null;
  return {
    vehicle,
    fuel: list<FuelEntry>(r.fuel, sanitizeFuelEntry, GARAGE_LIMITS.fuel),
    services: list<ServiceItem>(r.services, sanitizeServiceItem, GARAGE_LIMITS.services),
    docs: list<DocItem>(r.docs, sanitizeDocItem, GARAGE_LIMITS.docs),
  };
}

export class GarageError extends Error {}

export class Garage {
  readonly state: Observable<GarageState>;
  private data = load(null);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private store: JsonStore,
    private now: () => number = Date.now,
  ) {
    this.state = new Observable<GarageState>(this.compute());
  }

  async start(): Promise<void> {
    this.data = load(await this.store.read(FILE));
    this.publish();
    // Deadlines move with the calendar even when nothing is edited (and the clock is corrected after boot).
    this.timer = setInterval(() => this.publish(), 3600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** A finished trip adds to the odometer once the owner has told us where it stands. */
  addDistance(km: number): void {
    if (this.data.vehicle.odometerKm === null || !(km > 0)) return;
    this.data.vehicle.odometerKm = Math.round((this.data.vehicle.odometerKm + km) * 10) / 10;
    void this.save();
    this.publish();
  }

  async setVehicle(patch: unknown): Promise<void> {
    this.data.vehicle = sanitizeVehicleProfile(patch, this.data.vehicle);
    await this.commit();
  }

  async addFuel(input: unknown): Promise<FuelEntry> {
    if (this.data.fuel.length >= GARAGE_LIMITS.fuel) throw new GarageError('The fuel log is full. Delete old entries first.');
    const e = sanitizeFuelEntry(input);
    if (!e) throw new GarageError('Enter a date, the odometer reading and the litres.');
    const entry: FuelEntry = { ...e, id: newId() };
    this.data.fuel = [entry, ...this.data.fuel].sort((a, b) => b.date.localeCompare(a.date) || b.odometerKm - a.odometerKm);
    // A fill-up is the most reliable odometer reading there is.
    if (this.data.vehicle.odometerKm === null || entry.odometerKm > this.data.vehicle.odometerKm) {
      this.data.vehicle.odometerKm = entry.odometerKm;
      this.data.vehicle.odometerAt = this.now();
    }
    await this.commit();
    return entry;
  }

  async updateFuel(id: string, input: unknown): Promise<void> {
    const e = sanitizeFuelEntry(input);
    if (!e) throw new GarageError('Enter a date, the odometer reading and the litres.');
    if (!this.data.fuel.some((f) => f.id === id)) throw new GarageError('That entry no longer exists.');
    this.data.fuel = this.data.fuel.map((f) => (f.id === id ? { ...e, id } : f)).sort((a, b) => b.date.localeCompare(a.date) || b.odometerKm - a.odometerKm);
    await this.commit();
  }

  async deleteFuel(id: string): Promise<void> {
    this.data.fuel = this.data.fuel.filter((f) => f.id !== id);
    await this.commit();
  }

  async addService(input: unknown): Promise<ServiceItem> {
    if (this.data.services.length >= GARAGE_LIMITS.services) throw new GarageError('Too many service items. Delete one first.');
    const s = sanitizeServiceItem(input);
    if (!s) throw new GarageError('Give it a name and an interval in km, months or both.');
    const item: ServiceItem = { ...s, id: newId() };
    this.data.services = [...this.data.services, item];
    await this.commit();
    return item;
  }

  async updateService(id: string, input: unknown): Promise<void> {
    const s = sanitizeServiceItem(input);
    if (!s) throw new GarageError('Give it a name and an interval in km, months or both.');
    if (!this.data.services.some((x) => x.id === id)) throw new GarageError('That item no longer exists.');
    this.data.services = this.data.services.map((x) => (x.id === id ? { ...s, id } : x));
    await this.commit();
  }

  /** "I just did this": the interval restarts from today, at the odometer reading (or the one given). */
  async markServiceDone(id: string, opts: { km?: unknown; date?: unknown } = {}): Promise<void> {
    const s = this.data.services.find((x) => x.id === id);
    if (!s) throw new GarageError('That item no longer exists.');
    const km = typeof opts.km === 'number' && Number.isFinite(opts.km) && opts.km >= 0 ? Math.round(opts.km) : this.data.vehicle.odometerKm !== null ? Math.round(this.data.vehicle.odometerKm) : s.lastKm;
    const date = isIsoDate(opts.date) ? opts.date : localIsoDate(this.now());
    this.data.services = this.data.services.map((x) => (x.id === id ? { ...x, lastKm: km, lastDate: date } : x));
    await this.commit();
  }

  async deleteService(id: string): Promise<void> {
    this.data.services = this.data.services.filter((x) => x.id !== id);
    await this.commit();
  }

  async addDoc(input: unknown): Promise<DocItem> {
    if (this.data.docs.length >= GARAGE_LIMITS.docs) throw new GarageError('Too many documents. Delete one first.');
    const d = sanitizeDocItem(input);
    if (!d) throw new GarageError('Give it a name and an expiry date.');
    const item: DocItem = { ...d, id: newId() };
    this.data.docs = [...this.data.docs, item];
    await this.commit();
    return item;
  }

  async updateDoc(id: string, input: unknown): Promise<void> {
    const d = sanitizeDocItem(input);
    if (!d) throw new GarageError('Give it a name and an expiry date.');
    if (!this.data.docs.some((x) => x.id === id)) throw new GarageError('That document no longer exists.');
    this.data.docs = this.data.docs.map((x) => (x.id === id ? { ...d, id } : x));
    await this.commit();
  }

  async deleteDoc(id: string): Promise<void> {
    this.data.docs = this.data.docs.filter((x) => x.id !== id);
    await this.commit();
  }

  /** The whole garage as saved (for backups). */
  export(): unknown {
    return { version: 1, ...this.data };
  }

  /** Replace everything from a backup, validating every entry like a fresh load. */
  async restore(raw: unknown): Promise<void> {
    this.data = load(raw);
    await this.commit();
  }

  // ---- internals ----------------------------------------------------------

  private async commit(): Promise<void> {
    await this.save();
    this.publish();
  }

  private save(): Promise<void> {
    return this.store.writeOrThrow(FILE, { version: 1, ...this.data });
  }

  private publish(): void {
    this.state.set(this.compute());
  }

  private compute(): GarageState {
    const today = localIsoDate(this.now());
    return {
      vehicle: this.data.vehicle,
      fuel: this.data.fuel,
      services: this.data.services,
      docs: this.data.docs,
      stats: computeFuelStats(this.data.fuel, Number(today.slice(0, 4))),
      due: computeDue(this.data.services, this.data.docs, this.data.vehicle.odometerKm, today),
    };
  }
}
