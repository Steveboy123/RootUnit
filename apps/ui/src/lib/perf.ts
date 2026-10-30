/**
 * Acceleration timing (0-100 km/h, 0-60 mph, 100-200 km/h) and the quarter mile, from a stream of timed speed readings.
 *
 * A reading arrives once or twice a second, so the moment a speed is reached almost always falls BETWEEN two readings. It is found
 * by interpolation: speed is taken as a straight line between readings (exact for constant acceleration), and for the quarter
 * mile the distance is integrated the same way and solved exactly inside the last interval. The result is as good as the GPS speed,
 * which is good to a few tenths of a second: it is a fun number, not a certified one.
 */

export type PerfMode = 'zero-100' | 'zero-60mph' | 'hundred-200' | 'quarter';

export interface PerfModeDef {
  id: PerfMode;
  label: string;
  /** Speed (km/h) the run starts from; 0 means a standing start. */
  from: number;
  /** Speed (km/h) that ends the run, or null for a distance run. */
  to: number | null;
  /** Distance (m) that ends the run, or null. */
  distanceM: number | null;
}

const MPH = 1.609344;
export const PERF_MODES: PerfModeDef[] = [
  { id: 'zero-100', label: '0–100 km/h', from: 0, to: 100, distanceM: null },
  { id: 'zero-60mph', label: '0–60 mph', from: 0, to: 60 * MPH, distanceM: null },
  { id: 'hundred-200', label: '100–200 km/h', from: 100, to: 200, distanceM: null },
  { id: 'quarter', label: '¼ mile', from: 0, to: null, distanceM: 402.336 },
];

export const perfMode = (id: PerfMode): PerfModeDef => PERF_MODES.find((m) => m.id === id)!;

export interface PerfSample {
  /** Milliseconds, any steady clock (the GPS fix time is the best one). */
  t: number;
  kmh: number;
}

export type PerfState = 'idle' | 'armed' | 'running' | 'done' | 'aborted';

export interface PerfRun {
  mode: PerfMode;
  state: PerfState;
  startT: number | null;
  /** While running: time since the start; once done: the result. */
  elapsedMs: number | null;
  /** Distance covered so far (m), for the quarter mile. */
  distanceM: number;
  /** Speed at the end of a distance run (km/h). */
  trapKmh: number | null;
  /** Why a run was abandoned. */
  reason?: string;
}

export const newRun = (mode: PerfMode): PerfRun => ({ mode, state: 'idle', startT: null, elapsedMs: null, distanceM: 0, trapKmh: null });

/** A standing start counts as launched once the speed passes this (km/h): above GPS noise, below anything a driver would call moving. */
const LAUNCH_KMH = 2;
/** The car must be at rest (below this) before a standing run can be armed. */
const STANDSTILL_KMH = 1;
const MAX_RUN_MS = 60_000;

const ms = (kmh: number) => kmh / 3.6;

/** The time within [prev, cur] at which a straight-line speed crosses `level`; null when it does not cross upward. */
function crossingUp(prev: PerfSample, cur: PerfSample, level: number): number | null {
  if (!(prev.kmh < level && cur.kmh >= level)) return null;
  return prev.t + ((level - prev.kmh) / (cur.kmh - prev.kmh)) * (cur.t - prev.t);
}

/** Feed the next reading (and the one before it). Returns the updated run; it is a pure function of its inputs. */
export function stepPerf(run: PerfRun, cur: PerfSample, prev: PerfSample | null): PerfRun {
  const def = perfMode(run.mode);
  if (run.state === 'done' || run.state === 'aborted') return run;
  const standing = def.from === 0;

  if (run.state === 'idle' || run.state === 'armed') {
    // Standing start: arm when stopped. Rolling start (100-200): arm whenever below the starting speed.
    const ready = standing ? cur.kmh < STANDSTILL_KMH : cur.kmh < def.from;
    if (!ready && run.state === 'idle') return run;
    if (ready && run.state === 'idle') return { ...run, state: 'armed' };
    // Armed: wait for the launch.
    const level = standing ? LAUNCH_KMH : def.from;
    if (!prev) return run;
    const t0 = crossingUp(prev, cur, level);
    if (t0 === null) return ready ? run : standing ? run : { ...run, state: 'armed' };
    return progress({ ...run, state: 'running', startT: t0, elapsedMs: 0, distanceM: 0, trapKmh: null }, cur, { t: t0, kmh: level }, def);
  }

  return progress(run, cur, prev, def);
}

/** One step of a run in progress: distance, the end test, and giving up. */
function progress(run: PerfRun, cur: PerfSample, prev: PerfSample | null, def: PerfModeDef): PerfRun {
  if (run.startT === null || !prev) return run;
  const dt = (cur.t - prev.t) / 1000;
  if (dt <= 0) return run;

  // Speed target.
  if (def.to !== null) {
    const t1 = crossingUp(prev, cur, def.to);
    if (t1 !== null) return { ...run, state: 'done', elapsedMs: t1 - run.startT, trapKmh: def.to };
  }

  // Distance target: integrate the straight-line speed, and solve exactly inside the interval where the line is crossed.
  let distance = run.distanceM;
  const a = (ms(cur.kmh) - ms(prev.kmh)) / dt;
  if (def.distanceM !== null) {
    const v0 = ms(prev.kmh);
    const after = distance + v0 * dt + 0.5 * a * dt * dt;
    if (after >= def.distanceM) {
      const rem = def.distanceM - distance;
      const tau = Math.abs(a) < 1e-9 ? rem / v0 : (-v0 + Math.sqrt(Math.max(0, v0 * v0 + 2 * a * rem))) / a;
      const t1 = prev.t + tau * 1000;
      const vEnd = v0 + a * tau;
      return { ...run, state: 'done', elapsedMs: t1 - run.startT, distanceM: def.distanceM, trapKmh: vEnd * 3.6 };
    }
    distance = after;
  }

  const elapsed = cur.t - run.startT;
  // Giving up: the driver lifted and stopped, dropped well below the start speed, or took far too long.
  const floor = def.from === 0 ? LAUNCH_KMH / 2 : def.from - 10;
  if (cur.kmh < floor && elapsed > 1500) return { ...run, state: 'aborted', elapsedMs: null, distanceM: distance, reason: 'The car slowed down before the run finished.' };
  if (elapsed > MAX_RUN_MS) return { ...run, state: 'aborted', elapsedMs: null, distanceM: distance, reason: 'The run took more than a minute.' };
  return { ...run, elapsedMs: elapsed, distanceM: distance };
}

/** "8.31 s" for a result. */
export const perfSeconds = (elapsedMs: number): string => `${(elapsedMs / 1000).toFixed(2)} s`;

export type PerfBests = Partial<Record<PerfMode, { ms: number; at: number; trapKmh?: number }>>;

/** Keep the better (lower) of the stored best and a new result. Returns the same object when nothing improved. */
export function recordBest(bests: PerfBests, run: PerfRun, at: number): { bests: PerfBests; improved: boolean } {
  if (run.state !== 'done' || run.elapsedMs === null) return { bests, improved: false };
  const old = bests[run.mode];
  if (old && old.ms <= run.elapsedMs) return { bests, improved: false };
  return { bests: { ...bests, [run.mode]: { ms: Math.round(run.elapsedMs), at, ...(run.trapKmh !== null ? { trapKmh: Math.round(run.trapKmh) } : {}) } }, improved: true };
}

/** Read the stored document defensively: only plausible numbers survive. */
export function parseBests(doc: unknown): PerfBests {
  const out: PerfBests = {};
  const d = (typeof doc === 'object' && doc !== null ? doc : {}) as Record<string, unknown>;
  for (const m of PERF_MODES) {
    const v = d[m.id] as { ms?: unknown; at?: unknown; trapKmh?: unknown } | undefined;
    if (v && typeof v.ms === 'number' && Number.isFinite(v.ms) && v.ms > 500 && v.ms < 120_000 && typeof v.at === 'number') {
      out[m.id] = { ms: v.ms, at: v.at, ...(typeof v.trapKmh === 'number' && Number.isFinite(v.trapKmh) ? { trapKmh: v.trapKmh } : {}) };
    }
  }
  return out;
}
