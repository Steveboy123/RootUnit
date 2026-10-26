/** A stopwatch as plain data: it only knows when it started and what had already been counted, so it survives any number of redraws. */
export interface Stopwatch {
  /** Time counted before the current run, ms. */
  baseMs: number;
  /** Epoch ms when the current run began, or null while stopped. */
  startedAt: number | null;
  /** Elapsed time at each lap press, ms. */
  laps: number[];
}

export const newStopwatch = (): Stopwatch => ({ baseMs: 0, startedAt: null, laps: [] });
export const elapsedMs = (s: Stopwatch, now: number): number => s.baseMs + (s.startedAt === null ? 0 : Math.max(0, now - s.startedAt));
export const isRunning = (s: Stopwatch): boolean => s.startedAt !== null;

export const startStopwatch = (s: Stopwatch, now: number): Stopwatch => (isRunning(s) ? s : { ...s, startedAt: now });
export const stopStopwatch = (s: Stopwatch, now: number): Stopwatch => (isRunning(s) ? { ...s, baseMs: elapsedMs(s, now), startedAt: null } : s);
export const lapStopwatch = (s: Stopwatch, now: number): Stopwatch => (isRunning(s) ? { ...s, laps: [...s.laps, elapsedMs(s, now)].slice(-50) } : s);
export const resetStopwatch = (): Stopwatch => newStopwatch();

/** The time of each lap on its own (not the running total), newest last. */
export function lapTimes(s: Stopwatch): number[] {
  return s.laps.map((t, i) => t - (s.laps[i - 1] ?? 0));
}

/** 83456 -> "1:23.45". Hundredths, because that is what a stopwatch is for. */
export function stopwatchText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 10));
  const cs = total % 100;
  const sec = Math.floor(total / 100) % 60;
  const min = Math.floor(total / 6000);
  return `${min}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** 3725 -> "1:02:05", 59 -> "0:59": a countdown shows no hundredths. */
export function countdownText(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
