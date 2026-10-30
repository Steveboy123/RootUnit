import { describe, expect, it, vi } from 'vitest';
import { HealthMonitor, NO_HEALTH, cpuLoadPct, createDemoHealthReader, parseCpuStat, parseMeminfo, parseModel, parseTemp, parseThrottled, parseUptime } from './health';

describe('parseThrottled (vcgencmd get_throttled)', () => {
  it('all clear', () => {
    expect(parseThrottled('throttled=0x0\n')).toEqual({
      raw: 0,
      underVoltageNow: false,
      freqCappedNow: false,
      throttledNow: false,
      softTempLimitNow: false,
      underVoltageSince: false,
      freqCappedSince: false,
      throttledSince: false,
      softTempLimitSince: false,
    });
  });

  it('0x50005: under-voltage and throttling now, and both have happened since boot', () => {
    expect(parseThrottled('throttled=0x50005')).toMatchObject({
      raw: 0x50005,
      underVoltageNow: true,
      freqCappedNow: false,
      throttledNow: true,
      softTempLimitNow: false,
      underVoltageSince: true,
      freqCappedSince: false,
      throttledSince: true,
      softTempLimitSince: false,
    });
  });

  it('0x50000: it happened earlier but is fine now (the flag people miss)', () => {
    expect(parseThrottled('throttled=0x50000')).toMatchObject({ underVoltageNow: false, throttledNow: false, underVoltageSince: true, throttledSince: true });
  });

  it('0x8 is the soft temperature limit, 0xA0000 is a cap and the soft limit since boot', () => {
    expect(parseThrottled('throttled=0x8')).toMatchObject({ softTempLimitNow: true, underVoltageNow: false });
    expect(parseThrottled('throttled=0xA0000')).toMatchObject({ freqCappedSince: true, softTempLimitSince: true, underVoltageSince: false });
  });

  it('accepts decimal output and refuses anything else', () => {
    expect(parseThrottled('throttled=5')).toMatchObject({ underVoltageNow: true, throttledNow: true });
    for (const bad of ['', 'error=1', 'throttled=', 'throttled=0xZZ', 'VCHI initialization failed']) expect(parseThrottled(bad)).toBeNull();
  });
});

const MEMINFO = `MemTotal:        8257024 kB
MemFree:          812344 kB
MemAvailable:    5132800 kB
Buffers:          201024 kB
Cached:          3891200 kB
`;

describe('parseMeminfo', () => {
  it('counts what the kernel can give back as free', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ totalMb: 8064, usedPct: 37.8 });
  });
  it('falls back to MemFree on an old kernel and refuses garbage', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 250 kB\n')).toEqual({ totalMb: 1, usedPct: 75 });
    expect(parseMeminfo('')).toBeNull();
    expect(parseMeminfo('MemTotal: 0 kB\nMemAvailable: 0 kB')).toBeNull();
  });
});

describe('CPU load from /proc/stat', () => {
  const stat = (user: number, idle: number) => `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 1 1 1 1 0 0 0 0 0 0\n`;
  it('is the busy share between two samples', () => {
    const a = parseCpuStat(stat(1000, 9000));
    const b = parseCpuStat(stat(1250, 9750)); // +250 busy, +750 idle: 25 %
    expect(cpuLoadPct(a, b)).toBe(25);
  });
  it('has no answer without two samples, or when the counters did not move', () => {
    const a = parseCpuStat(stat(1000, 9000));
    expect(cpuLoadPct(null, a)).toBeNull();
    expect(cpuLoadPct(a, a)).toBeNull();
    expect(cpuLoadPct(a, null)).toBeNull();
  });
  it('treats iowait as idle', () => {
    const a = parseCpuStat('cpu  100 0 0 100 0 0 0 0 0 0');
    const b = parseCpuStat('cpu  100 0 0 100 100 0 0 0 0 0');
    expect(cpuLoadPct(a, b)).toBe(0);
  });
  it('refuses anything that is not the aggregate line', () => {
    expect(parseCpuStat('')).toBeNull();
    expect(parseCpuStat('cpu0 1 2 3 4 5')).toBeNull();
    expect(parseCpuStat('cpu  1 2 x 4 5')).toBeNull();
  });
});

describe('small parsers', () => {
  it('temperature in millidegrees or degrees; nothing for rubbish', () => {
    expect(parseTemp('54321\n')).toBe(54.3);
    expect(parseTemp('54.3')).toBe(54.3);
    for (const bad of ['', '0', '-5', 'hot', '999999999']) expect(parseTemp(bad)).toBeNull();
  });
  it('uptime and model', () => {
    expect(parseUptime('12345.67 54321.00\n')).toBe(12346);
    expect(parseUptime('x')).toBeNull();
    expect(parseModel('Raspberry Pi 5 Model B Rev 1.0\0')).toBe('Raspberry Pi 5 Model B Rev 1.0');
    expect(parseModel('')).toBeNull();
  });
});

describe('HealthMonitor', () => {
  const reading = (over = {}) => ({ ...NO_HEALTH, available: true, cpuTempC: 50, ...over });

  it('publishes a reading, and stays quiet while nothing visible changes', async () => {
    let t = 1000;
    const read = vi.fn(async () => reading());
    const m = new HealthMonitor(read, 5000, () => t);
    const seen: number[] = [];
    m.state.subscribe((s) => seen.push(s.updatedAt));
    await m.sample();
    t = 2000;
    await m.sample();
    t = 3000;
    await m.sample();
    expect(read).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([1000]);
    t = 4000;
    read.mockResolvedValueOnce(reading({ cpuTempC: 61 }));
    await m.sample();
    expect(seen).toEqual([1000, 4000]);
    expect(m.state.get().cpuTempC).toBe(61);
  });

  it('survives a reader that throws and keeps the last good reading', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = false;
    const m = new HealthMonitor(async () => {
      if (fail) throw new Error('boom');
      return reading();
    });
    await m.sample();
    fail = true;
    await expect(m.sample()).resolves.toBeUndefined();
    expect(m.state.get().cpuTempC).toBe(50);
    quiet.mockRestore();
  });

  it('never runs two samples at once', async () => {
    let running = 0;
    let peak = 0;
    const m = new HealthMonitor(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return reading();
    });
    await Promise.all([m.sample(), m.sample(), m.sample()]);
    expect(peak).toBe(1);
  });

  it('the demo reader gives believable, healthy numbers', async () => {
    const r = await createDemoHealthReader(() => 1_700_000_000_000)();
    expect(r.available).toBe(true);
    expect(r.cpuTempC).toBeGreaterThan(45);
    expect(r.cpuTempC).toBeLessThan(70);
    expect(r.throttle?.raw).toBe(0);
  });
});
