/**
 * The Tools app's sums: unit conversion (with the car's own units, tyre pressure and fuel economy, alongside the everyday ones), a
 * bill split and what a journey will cost in fuel. Pure functions, so every number on that page is tested.
 */

export type Quantity = 'length' | 'speed' | 'temperature' | 'volume' | 'pressure' | 'economy' | 'mass';

interface LinearUnit {
  id: string;
  label: string;
  /** How many base units one of these is (the base is the first unit of each quantity). */
  k: number;
}

export interface QuantityDef {
  id: Quantity;
  label: string;
  units: ReadonlyArray<{ id: string; label: string }>;
}

const LINEAR: Partial<Record<Quantity, LinearUnit[]>> = {
  length: [
    { id: 'km', label: 'km', k: 1 },
    { id: 'mi', label: 'miles', k: 1.609344 },
    { id: 'm', label: 'm', k: 0.001 },
    { id: 'ft', label: 'ft', k: 0.0003048 },
  ],
  speed: [
    { id: 'kmh', label: 'km/h', k: 1 },
    { id: 'mph', label: 'mph', k: 1.609344 },
    { id: 'ms', label: 'm/s', k: 3.6 },
    { id: 'kn', label: 'knots', k: 1.852 },
  ],
  volume: [
    { id: 'l', label: 'litres', k: 1 },
    { id: 'galus', label: 'US gal', k: 3.785411784 },
    { id: 'galuk', label: 'UK gal', k: 4.54609 },
  ],
  pressure: [
    { id: 'bar', label: 'bar', k: 1 },
    { id: 'psi', label: 'psi', k: 0.0689475729 },
    { id: 'kpa', label: 'kPa', k: 0.01 },
  ],
  mass: [
    { id: 'kg', label: 'kg', k: 1 },
    { id: 'lb', label: 'lb', k: 0.45359237 },
  ],
};

export const QUANTITIES: QuantityDef[] = [
  { id: 'length', label: 'Distance', units: LINEAR.length! },
  { id: 'speed', label: 'Speed', units: LINEAR.speed! },
  { id: 'temperature', label: 'Temperature', units: [{ id: 'c', label: '°C' }, { id: 'f', label: '°F' }] },
  { id: 'volume', label: 'Volume', units: LINEAR.volume! },
  { id: 'pressure', label: 'Tyre pressure', units: LINEAR.pressure! },
  { id: 'economy', label: 'Fuel economy', units: [{ id: 'l100', label: 'L/100 km' }, { id: 'mpgus', label: 'mpg (US)' }, { id: 'mpguk', label: 'mpg (UK)' }, { id: 'kml', label: 'km/L' }] },
  { id: 'mass', label: 'Weight', units: LINEAR.mass! },
];

/** km per litre for one unit of each economy unit (L/100 km is the odd one out: bigger is worse). */
const KML_PER: Record<string, number> = { mpgus: 1.609344 / 3.785411784, mpguk: 1.609344 / 4.54609, kml: 1 };

function economyToL100(v: number, from: string): number | null {
  if (from === 'l100') return v;
  const k = KML_PER[from];
  if (k === undefined || v <= 0) return null;
  return 100 / (v * k);
}

function l100To(v: number, to: string): number | null {
  if (to === 'l100') return v;
  const k = KML_PER[to];
  if (k === undefined || v <= 0) return null;
  return 100 / v / k;
}

/** `value` in `from` as `to`, or null when it has no answer (an unknown unit, or zero fuel economy). */
export function convertUnit(q: Quantity, value: number, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null;
  if (from === to) return value;
  if (q === 'temperature') {
    const c = from === 'c' ? value : from === 'f' ? ((value - 32) * 5) / 9 : null;
    if (c === null) return null;
    return to === 'c' ? c : to === 'f' ? (c * 9) / 5 + 32 : null;
  }
  if (q === 'economy') {
    const l100 = economyToL100(value, from);
    return l100 === null ? null : l100To(l100, to);
  }
  const units = LINEAR[q];
  const a = units?.find((u) => u.id === from);
  const b = units?.find((u) => u.id === to);
  if (!a || !b) return null;
  return (value * a.k) / b.k;
}

/** A converted number for the screen: about four significant figures, never "1e-7", trailing zeros dropped. */
export function shownNumber(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return Number(v.toFixed(digits)).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export interface Split {
  tip: number;
  total: number;
  perPerson: number;
}

/** A bill with a tip, shared between `people` (at least one). Per-person rounds up to the cent, so the bill is always covered. */
export function tipSplit(bill: number, tipPct: number, people: number): Split | null {
  if (!Number.isFinite(bill) || bill < 0 || !Number.isFinite(tipPct) || tipPct < 0) return null;
  const n = Math.max(1, Math.floor(people));
  const tip = Math.round(bill * tipPct) / 100;
  const total = Math.round((bill + tip) * 100) / 100;
  const perPerson = Math.ceil((total / n) * 100 - 1e-9) / 100;
  return { tip, total, perPerson };
}

export interface TripCost {
  litres: number;
  cost: number;
  perPerson: number;
}

/** What a journey costs in fuel: `km` at `lPer100`, fuel at `pricePerLitre`, shared by `people`. */
export function tripCost(km: number, lPer100: number, pricePerLitre: number, people = 1): TripCost | null {
  if (![km, lPer100, pricePerLitre].every((v) => Number.isFinite(v) && v >= 0)) return null;
  const litres = (km * lPer100) / 100;
  const cost = litres * pricePerLitre;
  return { litres: Math.round(litres * 10) / 10, cost: Math.round(cost * 100) / 100, perPerson: Math.round((cost / Math.max(1, Math.floor(people))) * 100) / 100 };
}

/** Cities for the world clocks: a name a person knows and its IANA zone. */
export const WORLD_CITIES: ReadonlyArray<{ city: string; zone: string }> = [
  { city: 'London', zone: 'Europe/London' },
  { city: 'Paris', zone: 'Europe/Paris' },
  { city: 'Berlin', zone: 'Europe/Berlin' },
  { city: 'Johannesburg', zone: 'Africa/Johannesburg' },
  { city: 'Cairo', zone: 'Africa/Cairo' },
  { city: 'Dubai', zone: 'Asia/Dubai' },
  { city: 'Mumbai', zone: 'Asia/Kolkata' },
  { city: 'Singapore', zone: 'Asia/Singapore' },
  { city: 'Hong Kong', zone: 'Asia/Hong_Kong' },
  { city: 'Tokyo', zone: 'Asia/Tokyo' },
  { city: 'Sydney', zone: 'Australia/Sydney' },
  { city: 'Auckland', zone: 'Pacific/Auckland' },
  { city: 'Honolulu', zone: 'Pacific/Honolulu' },
  { city: 'Los Angeles', zone: 'America/Los_Angeles' },
  { city: 'Denver', zone: 'America/Denver' },
  { city: 'Chicago', zone: 'America/Chicago' },
  { city: 'New York', zone: 'America/New_York' },
  { city: 'São Paulo', zone: 'America/Sao_Paulo' },
];

/** The time in `zone` at `at`, and how far it is from here in hours ("+2 h", "−5.5 h", "same time"). */
export function zoneTime(zone: string, at: Date, h24: boolean): { time: string; day: string; offset: string } {
  const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: !h24 }).format(at);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short' }).format(at);
  const offsetMin = zoneOffsetMinutes(zone, at) - -at.getTimezoneOffset();
  const h = offsetMin / 60;
  const offset = offsetMin === 0 ? 'same time' : `${h > 0 ? '+' : '−'}${Math.abs(h) % 1 === 0 ? Math.abs(h) : Math.abs(h).toFixed(1)} h`;
  return { time, day, offset };
}

/** Minutes `zone` is ahead of UTC at `at`. */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}
