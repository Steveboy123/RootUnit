import { describe, expect, it } from 'vitest';
import { countdownText, elapsedMs, lapStopwatch, lapTimes, newStopwatch, resetStopwatch, startStopwatch, stopStopwatch, stopwatchText } from './stopwatch';

describe('stopwatch', () => {
  it('counts only while running and keeps the total across stops', () => {
    let s = startStopwatch(newStopwatch(), 1000);
    expect(elapsedMs(s, 4000)).toBe(3000);
    s = stopStopwatch(s, 4000);
    expect(elapsedMs(s, 99_000)).toBe(3000); // stopped: time passes, the count does not
    s = startStopwatch(s, 10_000);
    expect(elapsedMs(s, 12_500)).toBe(5500);
  });
  it('starting twice or stopping twice changes nothing', () => {
    const run = startStopwatch(newStopwatch(), 1000);
    expect(startStopwatch(run, 5000)).toBe(run);
    const stopped = stopStopwatch(run, 2000);
    expect(stopStopwatch(stopped, 9000)).toBe(stopped);
  });
  it('records laps as running totals, and shows each lap on its own', () => {
    let s = startStopwatch(newStopwatch(), 0);
    s = lapStopwatch(s, 10_000);
    s = lapStopwatch(s, 25_000);
    s = lapStopwatch(s, 26_000);
    expect(s.laps).toEqual([10_000, 25_000, 26_000]);
    expect(lapTimes(s)).toEqual([10_000, 15_000, 1000]);
  });
  it('ignores a lap press while stopped, and keeps only the last 50', () => {
    expect(lapStopwatch(newStopwatch(), 1000).laps).toEqual([]);
    let s = startStopwatch(newStopwatch(), 0);
    for (let i = 1; i <= 60; i++) s = lapStopwatch(s, i * 1000);
    expect(s.laps).toHaveLength(50);
    expect(s.laps.at(-1)).toBe(60_000);
  });
  it('never goes negative if the clock is set back', () => {
    const s = startStopwatch(newStopwatch(), 10_000);
    expect(elapsedMs(s, 5000)).toBe(0);
  });
  it('reset clears everything', () => {
    expect(resetStopwatch()).toEqual({ baseMs: 0, startedAt: null, laps: [] });
  });
});

describe('text', () => {
  it('stopwatch: minutes, seconds, hundredths', () => {
    expect(stopwatchText(0)).toBe('0:00.00');
    expect(stopwatchText(83_456)).toBe('1:23.45');
    expect(stopwatchText(599_999)).toBe('9:59.99');
    expect(stopwatchText(3_600_000)).toBe('60:00.00');
    expect(stopwatchText(-5)).toBe('0:00.00');
  });
  it('countdown: rounds up so 0:00 means finished, shows hours when needed', () => {
    expect(countdownText(0)).toBe('0:00');
    expect(countdownText(0.2)).toBe('0:01');
    expect(countdownText(59)).toBe('0:59');
    expect(countdownText(3725)).toBe('1:02:05');
    expect(countdownText(-3)).toBe('0:00');
  });
});
