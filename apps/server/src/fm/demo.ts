import { FM_BAND, formatFmFrequency } from '@headunit/shared';
import type { FmBackend, FmObserved, FmWanted } from './backend';

export const DEMO_BOARD = 'Demo (no radio)';
const LEVEL_EVERY_MS = 500;

/** A loudness that moves like music does, from the clock alone: the same time always gives the same value (0 to 1, two decimals). */
export function demoLevel(atMs: number): number {
  const v = 0.45 + 0.25 * Math.sin(atMs / 650) + 0.2 * Math.sin(atMs / 170 + 1);
  return Math.round(Math.min(0.98, Math.max(0.02, v)) * 100) / 100;
}

/**
 * The FM transmitter in `--demo`: nothing is opened, started or sent. It follows the same rules as the real one (the service has
 * already held back "on" until the notice was accepted) and shows a transmitter that works, so the page can be designed and shown
 * without a radio. Production never uses this.
 */
export class DemoBackend implements FmBackend {
  private wanted: () => FmWanted = () => ({ on: false, frequency: FM_BAND.min, tunedAt: 0 });
  private report: (o: FmObserved) => void = () => undefined;
  private ticker: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly now: () => number = Date.now) {}

  start(wanted: () => FmWanted, report: (o: FmObserved) => void): void {
    this.wanted = wanted;
    this.report = report;
    this.render();
  }

  poke(): void {
    this.render();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private render(): void {
    if (this.stopped) return;
    const want = this.wanted();
    // The meter moves only while "sending"; the timer exists only then.
    if (want.on && !this.ticker) {
      this.ticker = setInterval(() => this.render(), LEVEL_EVERY_MS);
      this.ticker.unref();
    } else if (!want.on && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    this.report({
      mode: 'local',
      status: want.on ? 'transmitting' : 'idle',
      detail: want.on ? `Demo: pretending to send on ${formatFmFrequency(want.frequency)} MHz. Nothing is on the air.` : 'Demo: ready. Nothing is ever sent from the demo.',
      board: DEMO_BOARD,
      limits: { min: FM_BAND.min, max: FM_BAND.max },
      level: want.on ? demoLevel(this.now()) : 0,
    });
  }
}
