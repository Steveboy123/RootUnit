import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FM_BAND, FM_NOTICE_VERSION } from '@headunit/shared';
import { FM_NO_CONFIG, readFmConfig } from './config';
import { DEMO_BOARD, DemoBackend, demoLevel } from './demo';
import { FmService } from './service';
import { MemStore, TOKEN, captureConsole, sleepFor } from './testing/fakes';

let quiet: ReturnType<typeof captureConsole>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 20, 12, 0, 0));
  quiet = captureConsole();
});
afterEach(() => {
  quiet.restore();
  vi.useRealTimers();
});

const boom = (what: string) => () => {
  throw new Error(`the demo must not touch ${what}`);
};

function demoService(file?: unknown, config = FM_NO_CONFIG) {
  const store = new MemStore();
  if (file !== undefined) store.files.set('fm.json', file);
  const service = new FmService({
    store: store.asStore(),
    config,
    demo: true,
    fetch: boom('the network') as unknown as typeof fetch,
    spawn: boom('a process'),
    connect: boom('a socket'),
  });
  return { service, store };
}

describe('demoLevel', () => {
  it('is the same for the same time, always between 0 and 1, and moves', () => {
    const values = Array.from({ length: 400 }, (_, i) => demoLevel(i * 100));
    expect(values).toEqual(Array.from({ length: 400 }, (_, i) => demoLevel(i * 100)));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.02);
      expect(v).toBeLessThanOrEqual(0.98);
      expect(Math.round(v * 100) / 100).toBe(v);
    }
    expect(new Set(values).size).toBeGreaterThan(30);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5);
  });
});

describe('the demo transmitter', () => {
  it('shows a pretend radio: demo, this Pi, the demo board, the whole band', async () => {
    const { service } = demoService();
    await service.start();
    expect(service.state.get()).toMatchObject({ demo: true, mode: 'local', status: 'idle', board: DEMO_BOARD, limits: { min: FM_BAND.min, max: FM_BAND.max }, on: false, acknowledged: false, level: 0 });
    expect(service.state.get().detail).toMatch(/^Demo/);
    await service.stop();
  });

  it('follows the same rules as the real one: the notice first, then on, tune, saved frequencies', async () => {
    const { service, store } = demoService();
    await service.start();
    await expect(service.setOn(true)).rejects.toMatchObject({ status: 403 });
    expect(service.state.get().status).toBe('idle');
    await service.acknowledge(FM_NOTICE_VERSION);
    expect(service.state.get().status).toBe('idle'); // accepting is not switching on
    await service.setOn(true);
    expect(service.state.get()).toMatchObject({ status: 'transmitting', on: true });
    expect(service.state.get().detail).toMatch(/Nothing is on the air/);
    await service.tune(101.3);
    expect(service.state.get().detail).toContain('101.3 MHz');
    await expect(service.tune(50)).rejects.toMatchObject({ status: 400 });
    await service.togglePreset(101.3, true);
    expect(service.state.get().presets).toEqual([101.3]);
    await service.setOn(false);
    expect(service.state.get()).toMatchObject({ status: 'idle', on: false, level: 0 });
    expect(store.files.get('fm.json')).toMatchObject({ frequency: 101.3, presets: [101.3], on: false });
    await service.stop();
  });

  it('a saved "on" without the notice stays off in the demo too', async () => {
    const { service } = demoService({ version: 1, frequency: 90, on: true, presets: [], ack: null });
    await service.start();
    expect(service.state.get()).toMatchObject({ on: false, status: 'idle' });
    await service.stop();
  });

  it('the level moves while it is on, and the meter timer exists only then', async () => {
    const { service } = demoService({ version: 1, frequency: 90, on: false, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } });
    await service.start();
    expect(vi.getTimerCount()).toBe(0);
    await service.setOn(true);
    expect(vi.getTimerCount()).toBe(1);
    const levels = new Set<number>();
    service.state.subscribe((s) => levels.add(s.level));
    await sleepFor(10_000);
    expect(levels.size).toBeGreaterThan(5);
    expect(service.state.get().level).toBe(demoLevel(Date.now()));
    await service.setOn(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(service.state.get().level).toBe(0);
    await service.stop();
  });

  it('opens nothing: no network, no process, no socket, even with a helper configured and the notice accepted', async () => {
    const config = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:8788' });
    const { service } = demoService({ version: 1, frequency: 90, on: true, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } }, config);
    await service.start(); // would throw through a throwing fetch/spawn/connect if it tried
    await sleepFor(60_000);
    expect(service.state.get()).toMatchObject({ status: 'transmitting', mode: 'local', demo: true });
    expect(JSON.stringify(service.state.get())).not.toContain(TOKEN);
    await service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop leaves no timer and later nudges do not start one', async () => {
    const { service } = demoService({ version: 1, frequency: 90, on: true, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } });
    await service.start();
    expect(vi.getTimerCount()).toBe(1);
    await service.stop();
    expect(vi.getTimerCount()).toBe(0);
    await service.tune(95).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the backend alone: a direct look at what it reports', () => {
    const b = new DemoBackend(() => 5000);
    const seen: Array<{ status: string; level: number }> = [];
    b.start(
      () => ({ on: true, frequency: 99.5, tunedAt: 0 }),
      (o) => seen.push({ status: o.status, level: o.level }),
    );
    expect(seen).toEqual([{ status: 'transmitting', level: demoLevel(5000) }]);
    void b.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('production never simulates', () => {
  it('without --demo, nothing configured means "not set up", never a working radio, whatever was saved', async () => {
    const store = new MemStore();
    store.files.set('fm.json', { version: 1, frequency: 90, on: true, presets: [], ack: { version: FM_NOTICE_VERSION, at: 1 } });
    const service = new FmService({ store: store.asStore(), config: FM_NO_CONFIG });
    await service.start();
    await sleepFor(60_000);
    expect(service.state.get()).toMatchObject({ demo: false, mode: 'none', status: 'unconfigured', level: 0, board: null });
    expect(vi.getTimerCount()).toBe(0);
    await service.stop();
  });

  it('the demo flag is not read from the environment or the config', () => {
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, DEMO: '1', HEADUNIT_DEMO: '1', FM_DEMO: '1' })).not.toHaveProperty('demo');
  });
});
