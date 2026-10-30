import { execFile } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { HealthState, ThrottleFlags } from '@headunit/shared';
import { Observable } from '../observable';

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Parsers: plain text in, numbers out. Each returns null for anything it does not understand.
// ---------------------------------------------------------------------------

/**
 * `vcgencmd get_throttled` prints `throttled=0x50005`. Bits 0-3 are live, bits 16-19 stay set since boot:
 * 0 under-voltage · 1 ARM frequency capped · 2 throttled · 3 soft temperature limit.
 */
export function parseThrottled(text: string): ThrottleFlags | null {
  // The whole value must match: "0xZZ" is garbage, not "0" (which would read as all clear and hide an under-voltage).
  const m = /^throttled\s*=\s*(0x[0-9a-f]+|\d+)$/i.exec(text.trim());
  if (!m) return null;
  const raw = Number(m[1]);
  if (!Number.isInteger(raw) || raw < 0) return null;
  const bit = (n: number) => (raw & (1 << n)) !== 0;
  return {
    raw,
    underVoltageNow: bit(0),
    freqCappedNow: bit(1),
    throttledNow: bit(2),
    softTempLimitNow: bit(3),
    underVoltageSince: bit(16),
    freqCappedSince: bit(17),
    throttledSince: bit(18),
    softTempLimitSince: bit(19),
  };
}

/** `/proc/meminfo`: used = total - available, so cache the kernel can give back does not count as used. */
export function parseMeminfo(text: string): { totalMb: number; usedPct: number } | null {
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  const total = kb('MemTotal');
  const avail = kb('MemAvailable') ?? kb('MemFree');
  if (total === null || avail === null || total <= 0) return null;
  return { totalMb: Math.round(total / 1024), usedPct: Math.round(((total - avail) / total) * 1000) / 10 };
}

export interface CpuTimes {
  idle: number;
  total: number;
}

/** The aggregate `cpu ` line of `/proc/stat`. */
export function parseCpuStat(text: string): CpuTimes | null {
  const line = text.split('\n').find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 5 || f.some((n) => !Number.isFinite(n))) return null;
  const idle = (f[3] ?? 0) + (f[4] ?? 0); // idle + iowait
  return { idle, total: f.reduce((a, b) => a + b, 0) };
}

/** Busy share between two samples of `parseCpuStat`. */
export function cpuLoadPct(prev: CpuTimes | null, cur: CpuTimes | null): number | null {
  if (!prev || !cur) return null;
  const total = cur.total - prev.total;
  if (total <= 0) return null;
  return Math.round(Math.min(100, Math.max(0, (1 - (cur.idle - prev.idle) / total) * 100)) * 10) / 10;
}

/** `/sys/class/thermal/thermal_zone0/temp` is in millidegrees. */
export function parseTemp(text: string): number | null {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = n > 1000 ? n / 1000 : n;
  return c > 0 && c < 150 ? Math.round(c * 10) / 10 : null;
}

export const parseUptime = (text: string): number | null => {
  const n = Number(text.trim().split(/\s+/)[0]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** `/proc/device-tree/model` ends with a NUL byte. */
export const parseModel = (text: string): string | null => {
  const m = text.replace(/\0/g, '').trim();
  return m ? m.slice(0, 60) : null;
};

// ---------------------------------------------------------------------------
// The reader and the monitor
// ---------------------------------------------------------------------------

export type HealthReading = Omit<HealthState, 'updatedAt'>;
export type HealthReader = () => Promise<HealthReading>;

export const NO_HEALTH: HealthReading = { available: false, model: null, cpuTempC: null, cpuLoadPct: null, memUsedPct: null, memTotalMb: null, diskFreeGb: null, diskTotalGb: null, uptimeS: null, throttle: null };

const text = (path: string) => readFile(path, 'utf8').catch(() => '');

/** Reads the real Pi. Every source is optional: a missing file or tool leaves its field null and never throws. */
export function createLinuxHealthReader(dataDir: string): HealthReader {
  let prevCpu: CpuTimes | null = null;
  let model: string | null | undefined;
  return async () => {
    const [stat, mem, temp, uptime] = await Promise.all([text('/proc/stat'), text('/proc/meminfo'), text('/sys/class/thermal/thermal_zone0/temp'), text('/proc/uptime')]);
    if (model === undefined) model = parseModel(await text('/proc/device-tree/model'));
    const cpu = parseCpuStat(stat);
    const load = cpuLoadPct(prevCpu, cpu);
    prevCpu = cpu;
    const memory = parseMeminfo(mem);

    let throttle: ThrottleFlags | null = null;
    try {
      throttle = parseThrottled((await run('vcgencmd', ['get_throttled'], { timeout: 2000 })).stdout);
    } catch {
      /* not a Pi, or the service user may not open /dev/vcio */
    }

    let diskFreeGb: number | null = null;
    let diskTotalGb: number | null = null;
    try {
      const fs = await statfs(dataDir);
      diskFreeGb = Math.round(((fs.bavail * fs.bsize) / 1024 ** 3) * 10) / 10;
      diskTotalGb = Math.round(((fs.blocks * fs.bsize) / 1024 ** 3) * 10) / 10;
    } catch {
      /* the data directory does not exist yet */
    }

    const cpuTempC = parseTemp(temp);
    const available = cpuTempC !== null || memory !== null || throttle !== null;
    return { available, model, cpuTempC, cpuLoadPct: load, memUsedPct: memory?.usedPct ?? null, memTotalMb: memory?.totalMb ?? null, diskFreeGb, diskTotalGb, uptimeS: parseUptime(uptime), throttle };
  };
}

/** Polls a reader and publishes what it finds; only publishes when something visible changed. */
export class HealthMonitor {
  readonly state = new Observable<HealthState>({ ...NO_HEALTH, updatedAt: 0 });
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private read: HealthReader,
    private intervalMs = 5000,
    private now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {
    await this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sample(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const reading = await this.read();
      const prev = this.state.get();
      const { updatedAt: _ignored, ...before } = prev;
      // `updatedAt` alone is not news: the screens only redraw when a number or flag moved.
      if (JSON.stringify(before) !== JSON.stringify(reading)) this.state.set({ ...reading, updatedAt: this.now() });
    } catch (err) {
      console.error('[health] could not read the system state:', err);
    } finally {
      this.busy = false;
    }
  }
}

/** A calm, believable Pi for demo mode. Its numbers drift a little so the screens visibly update. */
export function createDemoHealthReader(now: () => number = Date.now): HealthReader {
  return async () => {
    const t = now() / 1000;
    return {
      available: true,
      model: 'Raspberry Pi 5 Model B Rev 1.0 (demo)',
      cpuTempC: Math.round((54 + Math.sin(t / 40) * 4) * 10) / 10,
      cpuLoadPct: Math.round((14 + Math.sin(t / 7) * 6) * 10) / 10,
      memUsedPct: Math.round((38 + Math.sin(t / 90) * 2) * 10) / 10,
      memTotalMb: 8062,
      diskFreeGb: 41.3,
      diskTotalGb: 58.1,
      uptimeS: Math.round(t % 864000),
      throttle: { raw: 0, underVoltageNow: false, freqCappedNow: false, throttledNow: false, softTempLimitNow: false, underVoltageSince: false, freqCappedSince: false, throttledSince: false, softTempLimitSince: false },
    };
  };
}
