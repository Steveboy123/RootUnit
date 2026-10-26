import { randomUUID } from 'node:crypto';
import { TIMER_LIMITS, sanitizeTimerInput, type TimerItem, type TimersState } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';

const FILE = 'timers.json';

export interface TimersOptions {
  now?: () => number;
  /** The sleep timer ran out: quiet the car (pause the music, stop the radio). The server does this itself, so it works with the screen asleep. */
  onSleep?: () => void | Promise<void>;
  newId?: () => string;
}

export class TimersError extends Error {}

/**
 * Countdown timers, the parking-meter reminder and the sleep timer. They live on the server so they survive a reload of the screen and
 * a restart of the browser. The screen shows them and rings when `endsAt` passes; only the sleep timer acts by itself.
 */
export class TimersService {
  readonly state = new Observable<TimersState>({ items: [] });
  private items: TimerItem[] = [];
  private sleepTimer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private store: JsonStore,
    private opts: TimersOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));
  }

  async start(): Promise<void> {
    const raw = (await this.store.read(FILE)) as { items?: unknown[] } | null;
    const items: TimerItem[] = [];
    for (const r of Array.isArray(raw?.items) ? raw.items : []) {
      if (typeof r !== 'object' || r === null) continue;
      const t = r as Partial<TimerItem>;
      const ok = typeof t.id === 'string' && typeof t.label === 'string' && typeof t.endsAt === 'number' && typeof t.createdAt === 'number' && typeof t.durationS === 'number' && (t.kind === 'timer' || t.kind === 'parking' || t.kind === 'sleep');
      if (!ok) continue;
      // The head unit was off when a sleep timer ran out: nothing is playing after a boot, so there is nothing left to do.
      if (t.kind === 'sleep' && t.endsAt! <= this.now()) continue;
      items.push({ id: t.id!, label: t.label!.slice(0, 30), kind: t.kind!, endsAt: t.endsAt!, createdAt: t.createdAt!, durationS: t.durationS! });
    }
    this.items = items.slice(0, TIMER_LIMITS.maxItems);
    this.armSleep();
    this.publish();
  }

  stop(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
  }

  async add(input: unknown): Promise<TimerItem> {
    const t = sanitizeTimerInput(input);
    if (!t) throw new TimersError('Choose a time between 5 seconds and 24 hours.');
    // Only one sleep timer makes sense: setting a new one replaces the old.
    if (t.kind === 'sleep') this.items = this.items.filter((i) => i.kind !== 'sleep');
    if (this.items.length >= TIMER_LIMITS.maxItems) throw new TimersError('Too many timers. Remove one first.');
    const now = this.now();
    const item: TimerItem = { id: this.newId(), label: t.label, kind: t.kind, durationS: t.durationS, createdAt: now, endsAt: now + t.durationS * 1000 };
    this.items = [...this.items, item].sort((a, b) => a.endsAt - b.endsAt);
    this.armSleep();
    await this.commit();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) return false;
    this.armSleep();
    await this.commit();
    return true;
  }

  export(): unknown {
    return { items: this.items };
  }

  private armSleep(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    const sleep = this.items.find((i) => i.kind === 'sleep');
    if (!sleep) return;
    // setTimeout cannot wait longer than about 24.8 days; the longest timer is a day, so one timeout is enough.
    this.sleepTimer = setTimeout(() => void this.fireSleep(sleep.id), Math.max(0, sleep.endsAt - this.now()));
    this.sleepTimer.unref();
  }

  private async fireSleep(id: string): Promise<void> {
    this.sleepTimer = null;
    if (!this.items.some((i) => i.id === id)) return;
    this.items = this.items.filter((i) => i.id !== id);
    try {
      await this.opts.onSleep?.();
    } catch (err) {
      console.error('[timers] the sleep timer could not stop the music:', err);
    }
    await this.commit();
  }

  private async commit(): Promise<void> {
    this.publish();
    await this.store.write(FILE, { items: this.items });
  }

  private publish(): void {
    this.state.set({ items: this.items });
  }
}
