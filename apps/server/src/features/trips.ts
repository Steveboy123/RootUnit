import { randomUUID } from 'node:crypto';
import type { ActiveTrip, TripPoint, TripRecord, TripTotals, TripsState } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

/** One reading of "how fast is the car going", from the best source there is right now. */
export interface TripSample {
  /** Epoch ms. */
  at: number;
  speedKmh: number;
  source: 'obd' | 'gps';
  /** Fuel level, percent, when the car reports one. */
  fuelPct?: number | null;
  pos?: TripPoint | null;
}

export interface TripConfig {
  /** Moving above this speed (km/h) can start a trip... */
  startKmh: number;
  /** ...and once driving, anything below this counts as stopped (hysteresis, so a crawl does not flap). */
  stopKmh: number;
  /** A trip starts only after this many seconds of continuous movement (a car rolling out of its space is not a trip). */
  startHoldS: number;
  /** A trip ends after this many seconds standing still: long enough for a red light or a drive-through, short enough for a shop. */
  endIdleS: number;
  /** Trips shorter than this are dropped (moving the car on the driveway). */
  minKm: number;
  minMovingS: number;
  /** Gaps in the data up to this long (a tunnel for GPS) are bridged using the speeds either side of them. */
  maxGapS: number;
  /** While driving, an unfinished copy is saved this often, so a power cut at ignition-off does not lose the trip. */
  draftEveryS: number;
  /** How many trips to keep on disk. */
  keep: number;
}

export const TRIP_DEFAULTS: TripConfig = { startKmh: 5, stopKmh: 2, startHoldS: 8, endIdleS: 300, minKm: 0.3, minMovingS: 45, maxGapS: 120, draftEveryS: 30, keep: 500 };

const FILE = 'trips.json';
const DRAFT_FILE = 'trips-draft.json';
const MAX_SPEED = 300;

interface Run {
  phase: 'candidate' | 'driving';
  startedAt: number;
  km: number;
  movingS: number;
  maxKmh: number;
  idleS: number;
  /** When the car was last moving: where a trip that ends by standing still is cut. */
  lastMovingAt: number;
  start: TripPoint | null;
  end: TripPoint | null;
  startFuel: number | null;
  lastFuel: number | null;
  source: 'obd' | 'gps';
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const emptyTotals = (): TripTotals => ({ trips: 0, distanceKm: 0, durationS: 0 });
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const validPoint = (p: unknown): p is TripPoint =>
  typeof p === 'object' && p !== null && typeof (p as TripPoint).lat === 'number' && typeof (p as TripPoint).lon === 'number' && Math.abs((p as TripPoint).lat) <= 90 && Math.abs((p as TripPoint).lon) <= 180;

/** A trip read back from disk: unusable ones are dropped, never repaired into plausible-looking nonsense. */
export function sanitizeTrip(raw: unknown): TripRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const nums = ['startedAt', 'endedAt', 'distanceKm', 'durationS', 'movingS', 'avgSpeedKmh', 'maxSpeedKmh'] as const;
  for (const k of nums) if (typeof r[k] !== 'number' || !Number.isFinite(r[k] as number) || (r[k] as number) < 0) return null;
  if (typeof r.id !== 'string' || (r.endedAt as number) < (r.startedAt as number)) return null;
  const trip: TripRecord = {
    id: r.id.slice(0, 40),
    startedAt: r.startedAt as number,
    endedAt: r.endedAt as number,
    distanceKm: r.distanceKm as number,
    durationS: r.durationS as number,
    movingS: r.movingS as number,
    avgSpeedKmh: r.avgSpeedKmh as number,
    maxSpeedKmh: r.maxSpeedKmh as number,
    source: r.source === 'gps' ? 'gps' : 'obd',
  };
  if (validPoint(r.start)) trip.start = { lat: r.start.lat, lon: r.start.lon };
  if (validPoint(r.end)) trip.end = { lat: r.end.lat, lon: r.end.lon };
  if (typeof r.fuelUsedPct === 'number' && Number.isFinite(r.fuelUsedPct)) trip.fuelUsedPct = r.fuelUsedPct;
  return trip;
}

export interface TripRecorderOptions {
  now?: () => number;
  config?: Partial<TripConfig>;
  /** Called when a trip is finished and kept (the garage adds its distance to the odometer). */
  onTripEnded?: (trip: TripRecord) => void;
  newId?: () => string;
}

/**
 * Turns a stream of speed readings into trips: starts when the car really moves, ends when it has stood still for a while,
 * keeps what happened, and totals it per day / week / month. Pure of any clock or sensor: `ingest` is given the time.
 */
export class TripRecorder {
  readonly state = new Observable<TripsState>({ active: null, recent: [], today: emptyTotals(), week: emptyTotals(), month: emptyTotals(), all: emptyTotals(), daily: [] });
  private history: TripRecord[] = [];
  private run: Run | null = null;
  private last: TripSample | null = null;
  private lastDraft = 0;
  private lastPublish = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly cfg: TripConfig;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private store: JsonStore,
    private opts: TripRecorderOptions = {},
  ) {
    this.cfg = { ...TRIP_DEFAULTS, ...opts.config };
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 12));
  }

  async start(): Promise<void> {
    const saved = (await this.store.read(FILE)) as { trips?: unknown[] } | null;
    if (saved && Array.isArray(saved.trips)) {
      this.history = saved.trips.map(sanitizeTrip).filter((t): t is TripRecord => t !== null).slice(0, this.cfg.keep);
    }
    // The car was switched off (the Pi lost power) while a trip was open: finish it where the car last moved.
    const draft = (await this.store.read(DRAFT_FILE)) as { run?: Run } | null;
    if (draft?.run && draft.run.phase === 'driving' && typeof draft.run.lastMovingAt === 'number' && typeof draft.run.startedAt === 'number') {
      this.run = draft.run;
      this.finish(draft.run.lastMovingAt);
      await this.store.write(DRAFT_FILE, {});
    }
    this.publish(true);
    this.timer = setInterval(() => this.tick(this.now()), 10_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Leave the open trip for the next start to finish (see start): the same path as a sudden power cut.
    if (this.run?.phase === 'driving') void this.saveDraft();
  }

  /** Feed one speed reading (about once a second). */
  ingest(s: TripSample): void {
    if (!Number.isFinite(s.speedKmh) || s.speedKmh < 0 || s.speedKmh > MAX_SPEED) return;
    const prev = this.last;
    let dt = prev ? (s.at - prev.at) / 1000 : 0;
    if (dt < 0) dt = 0; // the clock was set back (the Pi syncs its time after boot)
    if (this.run?.phase === 'driving' && prev && dt > this.cfg.endIdleS) {
      this.finish(prev.at); // the source went quiet for a long time: the trip ended when it was last heard
      dt = 0;
    }
    this.last = s;
    dt = Math.min(dt, this.cfg.maxGapS);

    const driving = this.run?.phase === 'driving';
    const moving = s.speedKmh >= (driving ? this.cfg.stopKmh : this.cfg.startKmh);

    if (!this.run) {
      if (moving) this.run = this.newRun(s);
      return this.publish();
    }
    const run = this.run;

    if (moving || run.phase === 'driving') {
      const avg = prev ? (prev.speedKmh + s.speedKmh) / 2 : s.speedKmh;
      run.km += (avg * dt) / 3600;
    }
    if (moving) {
      run.movingS += dt;
      run.idleS = 0;
      run.lastMovingAt = s.at;
      run.maxKmh = Math.max(run.maxKmh, s.speedKmh);
    } else if (run.phase === 'driving') {
      run.idleS += dt;
    }
    if (s.pos) run.end = s.pos;
    if (typeof s.fuelPct === 'number') run.lastFuel = s.fuelPct;

    if (run.phase === 'candidate') {
      if (!moving) this.run = null; // it did not get going
      else if (run.movingS >= this.cfg.startHoldS) run.phase = 'driving';
    } else if (run.idleS >= this.cfg.endIdleS) {
      this.finish(run.lastMovingAt);
    } else if (this.now() - this.lastDraft >= this.cfg.draftEveryS * 1000) {
      void this.saveDraft();
    }
    this.publish();
  }

  /** Called on a timer: a trip whose speed source disappeared (adapter unplugged, GPS lost) must still end. */
  tick(now: number): void {
    if (this.run?.phase === 'driving' && this.last && now - this.last.at > this.cfg.endIdleS * 1000) {
      this.finish(this.last.at);
      this.publish(true);
    }
  }

  async deleteTrip(id: string): Promise<boolean> {
    const before = this.history.length;
    this.history = this.history.filter((t) => t.id !== id);
    if (this.history.length === before) return false;
    await this.persist();
    this.publish(true);
    return true;
  }

  async clear(): Promise<void> {
    this.history = [];
    await this.persist();
    this.publish(true);
  }

  /** Replace the history from a backup: every trip is checked like one read from disk, and bad ones are dropped. */
  async restore(raw: unknown): Promise<number> {
    const list = (raw as { trips?: unknown[] } | null)?.trips;
    this.history = (Array.isArray(list) ? list : []).map(sanitizeTrip).filter((t): t is TripRecord => t !== null).sort((a, b) => b.startedAt - a.startedAt).slice(0, this.cfg.keep);
    await this.persist();
    this.publish(true);
    return this.history.length;
  }

  /** The history as it is saved (for backups). */
  export(): unknown {
    return { version: 1, trips: this.history };
  }

  /** Every kept trip, newest first (for the CSV export). */
  all(): readonly TripRecord[] {
    return this.history;
  }

  // ---- internals ----------------------------------------------------------

  private newRun(s: TripSample): Run {
    return {
      phase: 'candidate',
      startedAt: s.at,
      km: 0,
      movingS: 0,
      maxKmh: s.speedKmh,
      idleS: 0,
      lastMovingAt: s.at,
      start: s.pos ?? null,
      end: s.pos ?? null,
      startFuel: typeof s.fuelPct === 'number' ? s.fuelPct : null,
      lastFuel: typeof s.fuelPct === 'number' ? s.fuelPct : null,
      source: s.source,
    };
  }

  private finish(endedAt: number): void {
    const run = this.run;
    this.run = null;
    if (!run || run.phase !== 'driving') return;
    const durationS = Math.max(0, (endedAt - run.startedAt) / 1000);
    if (run.km < this.cfg.minKm || run.movingS < this.cfg.minMovingS) return void this.clearDraft();
    const trip: TripRecord = {
      id: this.newId(),
      startedAt: run.startedAt,
      endedAt,
      distanceKm: round(run.km, 2),
      durationS: Math.round(durationS),
      movingS: Math.round(run.movingS),
      avgSpeedKmh: run.movingS > 0 ? round((run.km / run.movingS) * 3600, 1) : 0,
      maxSpeedKmh: Math.round(run.maxKmh),
      source: run.source,
    };
    if (run.start) trip.start = run.start;
    if (run.end) trip.end = run.end;
    if (run.startFuel !== null && run.lastFuel !== null && run.startFuel - run.lastFuel > 0) trip.fuelUsedPct = round(run.startFuel - run.lastFuel, 1);
    this.history = [trip, ...this.history].slice(0, this.cfg.keep);
    void this.persist();
    void this.clearDraft();
    try {
      this.opts.onTripEnded?.(trip);
    } catch (err) {
      console.error('[trips] onTripEnded failed:', err);
    }
    this.publish(true);
  }

  private persist(): Promise<void> {
    return this.store.write(FILE, { version: 1, trips: this.history });
  }

  private saveDraft(): Promise<void> {
    this.lastDraft = this.now();
    return this.store.write(DRAFT_FILE, { run: this.run });
  }

  private clearDraft(): Promise<void> {
    return this.store.write(DRAFT_FILE, {});
  }

  private publish(force = false): void {
    const now = this.now();
    // While driving, readings arrive every second; the screens do not need to redraw that often.
    if (!force && this.run?.phase === 'driving' && now - this.lastPublish < 2000) return;
    if (!force && !this.run && this.state.get().active === null) return;
    this.lastPublish = now;
    this.state.set(this.snapshot(now));
  }

  private snapshot(now: number): TripsState {
    const run = this.run?.phase === 'driving' ? this.run : null;
    const active: ActiveTrip | null = run
      ? {
          startedAt: run.startedAt,
          distanceKm: round(run.km, 2),
          durationS: Math.round(Math.max(0, ((this.last?.at ?? now) - run.startedAt) / 1000)),
          movingS: Math.round(run.movingS),
          maxSpeedKmh: Math.round(run.maxKmh),
          paused: run.idleS > 5,
        }
      : null;

    const today = startOfDay(now);
    const d = new Date(now);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const totals = (since: number): TripTotals => {
      const t = emptyTotals();
      for (const trip of this.history) {
        if (trip.startedAt < since) continue;
        t.trips += 1;
        t.distanceKm += trip.distanceKm;
        t.durationS += trip.durationS;
      }
      return { trips: t.trips, distanceKm: round(t.distanceKm, 1), durationS: t.durationS };
    };

    const perDay = new Map<string, number>();
    for (const trip of this.history) perDay.set(dayKey(trip.startedAt), (perDay.get(dayKey(trip.startedAt)) ?? 0) + trip.distanceKm);
    const daily: Array<{ day: string; km: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const key = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime());
      daily.push({ day: key, km: round(perDay.get(key) ?? 0, 1) });
    }

    return { active, recent: this.history.slice(0, 60), today: totals(today), week: totals(monday), month: totals(month), all: totals(0), daily };
  }
}
