import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonStore } from '../store';
import { TimersError, TimersService } from './timers';

let dir: string;
let store: JsonStore;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2024, 5, 20, 22, 0, 0));
  dir = await mkdtemp(join(tmpdir(), 'timers-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  vi.useRealTimers();
  await store.flush();
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
const make = (onSleep?: () => void | Promise<void>) => new TimersService(store, { onSleep, newId: () => `id${++n}` });

describe('TimersService', () => {
  it('adds countdown timers soonest first, with a sensible default label', async () => {
    const t = make();
    await t.start();
    const a = await t.add({ seconds: 600, kind: 'timer', label: 'Pasta' });
    const b = await t.add({ seconds: 60, kind: 'timer' });
    const c = await t.add({ seconds: 3600, kind: 'parking' });
    expect(t.state.get().items.map((i) => i.id)).toEqual([b.id, a.id, c.id]);
    expect(b.label).toBe('Timer');
    expect(c.label).toBe('Parking meter');
    expect(a.endsAt - a.createdAt).toBe(600_000);
    t.stop();
  });

  it('refuses nonsense and says what is allowed', async () => {
    const t = make();
    await t.start();
    for (const bad of [null, {}, { seconds: 1 }, { seconds: 999_999 }, { seconds: 'ten' }, { seconds: Number.NaN }]) await expect(t.add(bad)).rejects.toBeInstanceOf(TimersError);
    await expect(t.add({ seconds: 0 })).rejects.toThrow('5 seconds and 24 hours');
    expect(t.state.get().items).toEqual([]);
    t.stop();
  });

  it('removes a timer; removing one that is already gone is not an error', async () => {
    const t = make();
    await t.start();
    const a = await t.add({ seconds: 60 });
    expect(await t.remove(a.id)).toBe(true);
    expect(await t.remove(a.id)).toBe(false);
    expect(t.state.get().items).toEqual([]);
    t.stop();
  });

  it('caps how many can run', async () => {
    const t = make();
    await t.start();
    for (let i = 0; i < 12; i++) await t.add({ seconds: 60 + i });
    await expect(t.add({ seconds: 60 })).rejects.toThrow('Too many');
    t.stop();
  });

  it('survives a restart: the same timers, the same end times', async () => {
    const t = make();
    await t.start();
    const a = await t.add({ seconds: 1800, kind: 'parking', label: 'Meter' });
    t.stop();
    await vi.advanceTimersByTimeAsync(0);
    await store.flush();
    const again = make();
    await again.start();
    expect(again.state.get().items).toEqual([a]);
    again.stop();
  });

  it('keeps a countdown that ran out while the unit was off, so the screen can say "time is up"', async () => {
    const t = make();
    await t.start();
    await t.add({ seconds: 60, kind: 'parking' });
    t.stop();
    await store.flush();
    vi.setSystemTime(new Date(2024, 5, 20, 23, 0, 0));
    const again = make();
    await again.start();
    expect(again.state.get().items).toHaveLength(1);
    again.stop();
  });
});

describe('sleep timer', () => {
  it('pauses the music by itself when it runs out, then disappears', async () => {
    const onSleep = vi.fn();
    const t = make(onSleep);
    await t.start();
    await t.add({ seconds: 1800, kind: 'sleep' });
    await vi.advanceTimersByTimeAsync(1799_000);
    expect(onSleep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onSleep).toHaveBeenCalledTimes(1);
    expect(t.state.get().items).toEqual([]);
    t.stop();
  });

  it('there is only one: a new sleep timer replaces the old', async () => {
    const onSleep = vi.fn();
    const t = make(onSleep);
    await t.start();
    await t.add({ seconds: 600, kind: 'sleep' });
    await t.add({ seconds: 1800, kind: 'sleep' });
    expect(t.state.get().items.filter((i) => i.kind === 'sleep')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(700_000);
    expect(onSleep).not.toHaveBeenCalled(); // the 10 minute one is gone
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(onSleep).toHaveBeenCalledTimes(1);
    t.stop();
  });

  it('cancelling it means the music keeps playing', async () => {
    const onSleep = vi.fn();
    const t = make(onSleep);
    await t.start();
    const s = await t.add({ seconds: 600, kind: 'sleep' });
    await t.remove(s.id);
    await vi.advanceTimersByTimeAsync(700_000);
    expect(onSleep).not.toHaveBeenCalled();
    t.stop();
  });

  it('does not touch the music for a sleep timer that expired while the unit was off', async () => {
    const onSleep = vi.fn();
    const t = make(onSleep);
    await t.start();
    await t.add({ seconds: 600, kind: 'sleep' });
    t.stop();
    await store.flush();
    vi.setSystemTime(new Date(2024, 5, 21, 8, 0, 0));
    const again = make(onSleep);
    await again.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onSleep).not.toHaveBeenCalled();
    expect(again.state.get().items).toEqual([]);
    again.stop();
  });

  it('re-arms a pending sleep timer after a restart', async () => {
    const onSleep = vi.fn();
    const t = make(onSleep);
    await t.start();
    await t.add({ seconds: 600, kind: 'sleep' });
    t.stop();
    await store.flush();
    const again = make(onSleep);
    await again.start();
    await vi.advanceTimersByTimeAsync(601_000);
    expect(onSleep).toHaveBeenCalledTimes(1);
    again.stop();
  });

  it('a failing player does not break the timer service', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = make(() => {
      throw new Error('device asleep');
    });
    await t.start();
    await t.add({ seconds: 30, kind: 'sleep' });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.state.get().items).toEqual([]);
    expect(quiet).toHaveBeenCalled();
    const next = await t.add({ seconds: 60 });
    expect(next.id).toBeTruthy();
    quiet.mockRestore();
    t.stop();
  });
});
