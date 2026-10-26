import type { WeatherLocation, WeatherState } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const FILE = 'weather.json';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const USER_AGENT = 'RPI-Head-Unit/2.0';
const FRESH_MS = 15 * 60_000;
/** Driving this far from where the forecast was fetched makes it a different forecast. */
const MOVED_KM = 15;
const BACKOFF_MS = [60_000, 120_000, 300_000, 600_000, 900_000];

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordinates are rounded to two decimals (about 1 km) before they go anywhere: a forecast does not need a street address. */
export const roundCoord = (v: number) => Math.round(v * 100) / 100 || 0; // `|| 0`: never "-0"

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Open-Meteo's answer, checked field by field. Returns null if the parts we need are not there. */
export function parseOpenMeteo(json: unknown): Pick<WeatherState, 'current' | 'daily'> | null {
  if (typeof json !== 'object' || json === null) return null;
  const { current: c, daily: d } = json as { current?: Record<string, unknown>; daily?: Record<string, unknown[]> };
  if (!c || typeof c !== 'object') return null;
  const temp = num(c.temperature_2m);
  const feels = num(c.apparent_temperature);
  const code = num(c.weather_code);
  const wind = num(c.wind_speed_10m);
  const humidity = num(c.relative_humidity_2m);
  if (temp === null || code === null) return null;
  const current = { tempC: temp, feelsC: feels ?? temp, code, isDay: c.is_day !== 0, windKmh: wind ?? 0, humidityPct: humidity ?? 0 };

  const daily: WeatherState['daily'] = [];
  if (d && Array.isArray(d.time)) {
    for (let i = 0; i < Math.min(d.time.length, 7); i++) {
      const date = d.time[i];
      const max = num(d.temperature_2m_max?.[i]);
      const min = num(d.temperature_2m_min?.[i]);
      const dayCode = num(d.weather_code?.[i]);
      const sunrise = d.sunrise?.[i];
      const sunset = d.sunset?.[i];
      if (typeof date !== 'string' || max === null || min === null || dayCode === null || typeof sunrise !== 'string' || typeof sunset !== 'string') continue;
      daily.push({ date, code: dayCode, maxC: max, minC: min, rainPct: num(d.precipitation_probability_max?.[i]), sunrise, sunset });
    }
  }
  return { current, daily };
}

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

/** Open-Meteo's geocoder, reduced to what a "pick your town" list needs. */
export function parseGeocoding(json: unknown): Place[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: Place[] = [];
  for (const r of results.slice(0, 8)) {
    if (typeof r !== 'object' || r === null) continue;
    const { name, latitude, longitude, country, admin1 } = r as Record<string, unknown>;
    if (typeof name !== 'string' || num(latitude) === null || num(longitude) === null) continue;
    if (Math.abs(latitude as number) > 90 || Math.abs(longitude as number) > 180) continue;
    out.push({ name: name.slice(0, 60), detail: [admin1, country].filter((x): x is string => typeof x === 'string').join(', ').slice(0, 80), lat: roundCoord(latitude as number), lon: roundCoord(longitude as number) });
  }
  return out;
}

export interface WeatherDeps {
  store: JsonStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Where the car is right now according to GPS, or null without a fix. */
  position: () => { lat: number; lon: number } | null;
  /** Settings → Weather. Nothing leaves the Pi while it is off. */
  enabled: () => boolean;
}

interface Saved {
  place: { lat: number; lon: number; name?: string; manual: boolean } | null;
  cache: { at: number; lat: number; lon: number; current: WeatherState['current']; daily: WeatherState['daily'] } | null;
}

export class WeatherService {
  readonly state = new Observable<WeatherState>({ status: 'no-location', location: null, current: null, daily: [], fetchedAt: null });
  private saved: Saved = { place: null, cache: null };
  private timer: NodeJS.Timeout | null = null;
  private lastAttempt = 0;
  private failures = 0;
  private fetching = false;
  private lastError: string | null = null;
  private inflight: Promise<void> | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;

  constructor(private deps: WeatherDeps) {
    this.f = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  async start(): Promise<void> {
    const raw = (await this.deps.store.read(FILE)) as Partial<Saved> | null;
    const p = raw?.place;
    if (p && num(p.lat) !== null && num(p.lon) !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
      this.saved.place = { lat: p.lat, lon: p.lon, manual: p.manual === true, ...(typeof p.name === 'string' ? { name: p.name.slice(0, 60) } : {}) };
    }
    const c = raw?.cache;
    if (c && num(c.at) !== null && num(c.lat) !== null && num(c.lon) !== null && c.current) {
      this.saved.cache = { at: c.at, lat: c.lat, lon: c.lon, current: c.current, daily: Array.isArray(c.daily) ? c.daily : [] };
    }
    this.publish();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The place the forecast is for: the car's GPS position, otherwise the place the owner chose, otherwise the last one used. */
  location(): WeatherLocation | null {
    const gps = this.deps.position();
    if (gps && !this.saved.place?.manual) return { lat: roundCoord(gps.lat), lon: roundCoord(gps.lon), source: 'gps' };
    const p = this.saved.place;
    if (p) return { lat: p.lat, lon: p.lon, source: p.manual ? 'manual' : 'saved', ...(p.name ? { name: p.name } : {}) };
    if (gps) return { lat: roundCoord(gps.lat), lon: roundCoord(gps.lon), source: 'gps' };
    return null;
  }

  /** A fixed place instead of GPS (a parked car at home, or a head unit on a desk). */
  async setPlace(lat: number, lon: number, name?: string): Promise<void> {
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new Error('That is not a place on Earth.');
    this.saved.place = { lat: roundCoord(lat), lon: roundCoord(lon), manual: true, ...(name ? { name: name.slice(0, 60) } : {}) };
    this.saved.cache = null;
    await this.persist();
    await this.refresh(true);
  }

  /** Go back to following the car's GPS. */
  async clearPlace(): Promise<void> {
    this.saved.place = null;
    this.saved.cache = null;
    await this.persist();
    this.publish();
    await this.refresh(true);
  }

  async searchPlaces(query: string): Promise<Place[]> {
    const q = query.trim().slice(0, 60);
    if (q.length < 2) return [];
    if (!this.deps.enabled()) throw new Error('Weather is switched off in Settings.');
    const r = await this.f(`${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('The place search is not available right now.');
    return parseGeocoding(await r.json());
  }

  /**
   * Fetch when it is due (or `force`). Safe to call often: a plain call joins a fetch that is already running, but a forced one
   * (the place just changed) waits for it and then fetches again, because the running one is for the old place.
   */
  refresh(force = false): Promise<void> {
    if (this.inflight && !force) return this.inflight;
    const run = this.inflight ? this.inflight.then(() => this.doRefresh(force)) : this.doRefresh(force);
    const tracked: Promise<void> = run.finally(() => {
      if (this.inflight === tracked) this.inflight = null;
    });
    this.inflight = tracked;
    return tracked;
  }

  // ---- internals ----------------------------------------------------------

  private async tick(): Promise<void> {
    const loc = this.location();
    if (!this.deps.enabled() || !loc) return this.publish();
    const c = this.saved.cache;
    const stale = !c || this.now() - c.at > FRESH_MS || distanceKm(loc, c) > MOVED_KM;
    const backoff = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length) - 1] ?? 0;
    if (stale && this.now() - this.lastAttempt >= (this.failures > 0 ? backoff : 0)) await this.refresh();
    else this.publish();
  }

  private async doRefresh(force: boolean): Promise<void> {
    const loc = this.location();
    if (!this.deps.enabled() || !loc) return this.publish();
    const c = this.saved.cache;
    if (!force && c && this.now() - c.at <= FRESH_MS && distanceKm(loc, c) <= MOVED_KM) return this.publish();

    this.lastAttempt = this.now();
    this.fetching = true;
    this.publish();
    try {
      const url =
        `${FORECAST_URL}?latitude=${loc.lat}&longitude=${loc.lon}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset' +
        '&timezone=auto&forecast_days=4&wind_speed_unit=kmh';
      const r = await this.f(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`The weather service answered ${r.status}.`);
      const parsed = parseOpenMeteo(await r.json());
      if (!parsed) throw new Error('The weather service sent something unexpected.');
      this.saved.cache = { at: this.now(), lat: loc.lat, lon: loc.lon, current: parsed.current, daily: parsed.daily };
      // A forecast fetched at the GPS position remembers the place, so the next boot has weather before the GPS has a fix.
      if (loc.source === 'gps' && !this.saved.place?.manual) this.saved.place = { lat: loc.lat, lon: loc.lon, manual: false };
      this.failures = 0;
      this.lastError = null;
      void this.persist();
    } catch (err) {
      this.failures += 1;
      this.lastError = err instanceof Error ? err.message : 'The weather could not be loaded.';
    } finally {
      this.fetching = false;
      this.publish();
    }
  }

  private persist(): Promise<void> {
    return this.deps.store.write(FILE, this.saved);
  }

  private publish(): void {
    if (!this.deps.enabled()) return this.state.set({ status: 'off', location: null, current: null, daily: [], fetchedAt: null });
    const loc = this.location();
    const c = this.saved.cache;
    // Data for a different place than the one the car is at (or a different manual choice) is not shown.
    const usable = c && loc && distanceKm(loc, c) <= MOVED_KM * 2;
    const base = { location: loc, current: usable ? c.current : null, daily: usable ? c.daily : [], fetchedAt: usable ? c.at : null };
    if (!loc) return this.state.set({ status: 'no-location', ...base });
    // An error still shows the last good data (a forecast an hour old beats a blank widget in a tunnel).
    if (this.lastError && !this.fetching) return this.state.set({ status: 'error', ...base, error: this.lastError });
    this.state.set({ status: usable ? 'ok' : 'loading', ...base });
  }
}
