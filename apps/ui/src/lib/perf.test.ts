import { describe, expect, it } from 'vitest';
import { newRun, parseBests, perfMode, perfSeconds, recordBest, stepPerf, type PerfMode, type PerfRun, type PerfSample } from './perf';

/** A car accelerating at a constant `a` m/s² from `v0` m/s, sampled every `dtMs`, from time 0. */
function drive(mode: PerfMode, opts: { a: number; v0?: number; dtMs: number; seconds: number; standBefore?: number; startAt?: number }) {
  let run: PerfRun = newRun(mode);
  let prev: PerfSample | null = null;
  const t0 = opts.startAt ?? 0;
  const v0 = opts.v0 ?? 0;
  const trace: PerfRun[] = [];
  // Stand still (or roll below the starting speed) for a while first, so the run arms.
  for (let t = -(opts.standBefore ?? 2000); t < 0; t += opts.dtMs) {
    const s: PerfSample = { t: t0 + t, kmh: v0 === 0 ? 0 : Math.max(0, v0 * 3.6 - 15) };
    run = stepPerf(run, s, prev);
    prev = s;
  }
  for (let t = 0; t <= opts.seconds * 1000; t += opts.dtMs) {
    const s: PerfSample = { t: t0 + t, kmh: (v0 + opts.a * (t / 1000)) * 3.6 };
    run = stepPerf(run, s, prev);
    prev = s;
    trace.push(run);
    if (run.state === 'done' || run.state === 'aborted') break;
  }
  return { run, trace };
}

describe('0-100 km/h from a standing start', () => {
  it('is exact for constant acceleration at any sample rate (the speed between readings really is a straight line)', () => {
    // 3.5 m/s²: 100 km/h = 27.778 m/s takes 7.937 s, the launch threshold of 2 km/h costs 0.159 s of that
    for (const dtMs of [1000, 500, 100, 1300]) {
      const { run } = drive('zero-100', { a: 3.5, dtMs, seconds: 15 });
      expect(run.state, `dt=${dtMs}`).toBe('done');
      expect(run.elapsedMs!, `dt=${dtMs}`).toBeCloseTo(((100 - 2) / 3.6 / 3.5) * 1000, 0);
    }
  });

  it('does not depend on where the run starts on the clock', () => {
    const a = drive('zero-100', { a: 4, dtMs: 1000, seconds: 15, startAt: 0 }).run.elapsedMs!;
    const b = drive('zero-100', { a: 4, dtMs: 1000, seconds: 15, startAt: 987_654_321 }).run.elapsedMs!;
    expect(b).toBeCloseTo(a, 3);
  });

  it('shows the time so far while running', () => {
    const { trace } = drive('zero-100', { a: 3, dtMs: 500, seconds: 3 });
    const running = trace.filter((r) => r.state === 'running');
    expect(running.length).toBeGreaterThan(2);
    expect(running.at(-1)!.elapsedMs!).toBeGreaterThan(2000);
  });

  it('waits at standstill: armed, but nothing runs until the car launches', () => {
    let run = newRun('zero-100');
    let prev: PerfSample | null = null;
    for (let t = 0; t < 5000; t += 500) {
      const s = { t, kmh: 0 };
      run = stepPerf(run, s, prev);
      prev = s;
    }
    expect(run.state).toBe('armed');
    expect(run.startT).toBeNull();
  });

  it('does not arm while already moving', () => {
    let run = newRun('zero-100');
    let prev: PerfSample | null = null;
    for (let t = 0; t < 3000; t += 500) {
      const s = { t, kmh: 40 };
      run = stepPerf(run, s, prev);
      prev = s;
    }
    expect(run.state).toBe('idle');
  });

  it('is abandoned when the car stops again, and says why', () => {
    let run = newRun('zero-100');
    let prev: PerfSample | null = null;
    const speeds = [0, 0, 10, 30, 45, 20, 5, 0, 0, 0];
    speeds.forEach((kmh, i) => {
      const s = { t: i * 1000, kmh };
      run = stepPerf(run, s, prev);
      prev = s;
    });
    expect(run.state).toBe('aborted');
    expect(run.reason).toContain('slowed down');
    expect(run.elapsedMs).toBeNull();
  });

  it('a finished run stays finished', () => {
    const { run } = drive('zero-100', { a: 5, dtMs: 500, seconds: 15 });
    expect(stepPerf(run, { t: 1e9, kmh: 0 }, { t: 1e9 - 500, kmh: 150 })).toBe(run);
  });
});

describe('0-60 mph and 100-200 km/h', () => {
  it('0-60 mph ends at 96.56 km/h', () => {
    const { run } = drive('zero-60mph', { a: 4, dtMs: 1000, seconds: 15 });
    expect(run.state).toBe('done');
    expect(run.elapsedMs!).toBeCloseTo(((60 * 1.609344 - 2) / 3.6 / 4) * 1000, 0);
  });

  it('100-200 starts as the car passes 100 km/h and times only the roll', () => {
    // from 80 km/h at 2 m/s²: reaches 100 at (100-80)/3.6/2 s, 200 km/h at (200-80)/3.6/2: the run is the difference
    const { run } = drive('hundred-200', { a: 2, v0: 80 / 3.6, dtMs: 1000, seconds: 60 });
    expect(run.state).toBe('done');
    expect(run.elapsedMs!).toBeCloseTo((100 / 3.6 / 2) * 1000, 0);
  });
});

describe('quarter mile', () => {
  it('measures the elapsed time and the speed at the line, exactly, for constant acceleration', () => {
    // d = a t² / 2: 402.336 m at 5 m/s² takes sqrt(2 * 402.336 / 5) = 12.686 s, plus the launch threshold's share
    for (const dtMs of [1000, 500, 100]) {
      const { run } = drive('quarter', { a: 5, dtMs, seconds: 30 });
      expect(run.state, `dt=${dtMs}`).toBe('done');
      // the clock starts when 2 km/h is passed (0.111 s after the true start); the distance counted from there
      const v2 = 2 / 3.6;
      const t0 = v2 / 5;
      const dAtStart = 0.5 * 5 * t0 * t0;
      const expected = (Math.sqrt(2 * (402.336 + dAtStart) / 5) - t0) * 1000;
      expect(run.elapsedMs!, `dt=${dtMs}`).toBeCloseTo(expected, -1); // within 5 ms
      expect(run.distanceM).toBeCloseTo(402.336, 6);
      // v² = 2 a d for constant acceleration, with d counted from the true start of the motion
      expect(run.trapKmh!, `dt=${dtMs}`).toBeCloseTo(Math.sqrt(2 * 5 * (402.336 + dAtStart)) * 3.6, 1);
    }
  });

  it('copes with a constant speed (no acceleration within the interval)', () => {
    let run = newRun('quarter');
    let prev: PerfSample | null = null;
    const samples: PerfSample[] = [{ t: 0, kmh: 0 }, { t: 100, kmh: 0 }, { t: 200, kmh: 36 }];
    for (let t = 300; t < 60_000; t += 1000) samples.push({ t, kmh: 36 }); // 10 m/s
    for (const s of samples) {
      run = stepPerf(run, s, prev);
      prev = s;
      if (run.state === 'done') break;
    }
    expect(run.state).toBe('done');
    expect(run.distanceM).toBeCloseTo(402.336, 6);
    expect(run.trapKmh!).toBeCloseTo(36, 3);
  });
});

describe('perfSeconds / bests', () => {
  it('formats two decimals', () => expect(perfSeconds(8314)).toBe('8.31 s'));

  it('keeps only improvements', () => {
    const done = (mode: PerfMode, ms: number, trap: number | null = null): PerfRun => ({ ...newRun(mode), state: 'done', elapsedMs: ms, trapKmh: trap });
    let r = recordBest({}, done('zero-100', 8300), 1);
    expect(r.improved).toBe(true);
    expect(r.bests['zero-100']).toEqual({ ms: 8300, at: 1 });
    const same = recordBest(r.bests, done('zero-100', 8300), 2);
    expect(same.improved).toBe(false);
    expect(same.bests).toBe(r.bests);
    expect(recordBest(r.bests, done('zero-100', 9000), 3).improved).toBe(false);
    r = recordBest(r.bests, done('zero-100', 8100), 4);
    expect(r.bests['zero-100']!.ms).toBe(8100);
    expect(recordBest(r.bests, done('quarter', 14000, 160.4), 5).bests.quarter).toEqual({ ms: 14000, at: 5, trapKmh: 160 });
  });

  it('ignores a run that did not finish', () => {
    expect(recordBest({}, { ...newRun('zero-100'), state: 'aborted' }, 1).improved).toBe(false);
    expect(recordBest({}, newRun('zero-100'), 1).improved).toBe(false);
  });

  it('reads a stored document defensively', () => {
    expect(parseBests(null)).toEqual({});
    expect(parseBests({ 'zero-100': { ms: 8300, at: 5 }, quarter: { ms: 5, at: 1 }, 'zero-60mph': 'fast', 'hundred-200': { ms: Number.NaN, at: 1 } })).toEqual({ 'zero-100': { ms: 8300, at: 5 } });
    expect(perfMode('quarter').distanceM).toBe(402.336);
  });
});
