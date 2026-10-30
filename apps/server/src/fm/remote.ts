import { FM_BAND, FM_BANDWIDTH_KHZ, FM_PROTOCOL, formatFmFrequency, type FmNodeStatus } from '@headunit/shared';
import type { FmBackend, FmObserved, FmWanted } from './backend';
import type { CapturePump, PumpFailure } from './capture';
import type { FmNodeClient, FmNodeReply } from './client';
import { scrubSecret, type FmConfig } from './config';

/** While it is on, this often: it is also the helper's dead-man keepalive (the helper switches off when it hears nothing for 30 s). */
export const POLL_ON_MS = 2000;
/** While it is off, so that the page can say "ready" or "not supported" without anyone asking. */
export const POLL_OFF_MS = 10_000;
/** Pauses after a failed request, then the last one repeats. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 10_000];
/** After the transmitter program failed or was refused, not sooner than this before it is asked again. */
export const RETRY_AFTER_ERROR_MS = 10_000;
/** A sound connection that held this long counts as having worked: its next failure starts the pauses again from the first. */
const PUMP_STABLE_MS = 10_000;
/** At shutdown nobody can wait: one second to switch the carrier off. */
const STOP_TIMEOUT_MS = 1000;
/** The helper rounds to 0.05 MHz; what is asked for is a multiple of 0.1. */
const SAME_FREQUENCY_MHZ = 0.03;
/**
 * A retune waits until the frequency has stood still this long: five taps on "+" are one retune, not five restarts of the transmitter
 * program (each one is a gap in the carrier that the car radio hears). Switching on is not delayed.
 */
export const RETUNE_SETTLE_MS = 400;

export interface RemoteOptions {
  config: FmConfig;
  client: FmNodeClient;
  now: () => number;
  /** A new, not yet started sound connection (see CapturePump). */
  makePump(events: { onStreaming(): void; onDown(failure: PumpFailure): void }): CapturePump;
}

type Link = { kind: 'unknown' } | { kind: 'ok' } | { kind: 'unreachable'; why: string } | { kind: 'notahelper' } | { kind: 'unauthorized' };

interface Refusal {
  code: number;
  message: string;
  frequency: number;
  until: number;
}

const backoff = (n: number): number => BACKOFF_MS[Math.min(Math.max(n, 1), BACKOFF_MS.length) - 1]!;
const sameFrequency = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < SAME_FREQUENCY_MHZ;
const inBand = (f: number, limits: { min: number; max: number }): boolean => f >= limits.min - 1e-9 && f <= limits.max + 1e-9;
const mhz = (f: number): string => formatFmFrequency(f);

/**
 * Makes the wanted state true by talking to the FM helper. A reconcile loop with one step in flight at a time:
 *
 *  - ask the helper how it is (this is also what keeps its dead-man switch from firing),
 *  - when the person wants it off and it is on the air, switch it off,
 *  - when they want it on and the board is supported, start or retune it, and keep the capture pump connected,
 *  - show all of that as one `FmObserved`.
 *
 * Nothing is started unless the helper says it is a supported board and speaks this protocol; the sound connection is never opened
 * before the carrier is reported on the air. The password is only ever inside `client` and `makePump`.
 */
export class RemoteBackend implements FmBackend {
  private wanted: () => FmWanted = () => ({ on: false, frequency: FM_BAND.min, tunedAt: 0 });
  private report: (o: FmObserved) => void = () => undefined;
  private started = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private tickRun: Promise<void> | null = null;
  private again = false;
  private stopping: Promise<void> | null = null;
  private readonly abort = new AbortController();

  private link: Link = { kind: 'unknown' };
  private node: FmNodeStatus | null = null;
  private failures = 0;
  /** The helper may have the carrier on, as far as we know: it is switched off at shutdown when so. */
  private maybeOn = false;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private refusal: Refusal | null = null;
  /** A retune is being held back until this time (see RETUNE_SETTLE_MS); 0 when none is. */
  private settleUntil = 0;

  private pump: CapturePump | null = null;
  private pumpFailure: PumpFailure | null = null;
  private pumpFails = 0;
  private pumpRetryAt = 0;
  private streamingSince: number | null = null;
  private loggedKey = '';

  constructor(private readonly opts: RemoteOptions) {}

  start(wanted: () => FmWanted, report: (o: FmObserved) => void): void {
    if (this.started) return;
    this.started = true;
    this.wanted = wanted;
    this.report = report;
    this.render();
    this.schedule(0);
  }

  poke(): void {
    if (!this.started || this.stopped) return;
    if (this.tickRun) this.again = true;
    else this.schedule(0);
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Cancels a request in flight; the answer to it is dropped.
    this.abort.abort();
    this.dropPump();
    const off = this.maybeOn ? this.opts.client.stop(STOP_TIMEOUT_MS).then(() => undefined) : Promise.resolve();
    this.stopping = Promise.all([off, this.tickRun]).then(() => undefined);
    return this.stopping;
  }

  // ---- the loop ----------------------------------------------------------------------------------------------------------------------

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
    this.timer.unref();
  }

  private run(): Promise<void> {
    if (this.stopped || this.tickRun) return this.tickRun ?? Promise.resolve();
    this.again = false;
    const done = (async () => {
      try {
        await this.tick();
      } catch (err) {
        // A bug must not stop the loop, and must not take the password to the log.
        console.error('[fm] unexpected problem:', scrubSecret(err instanceof Error ? err.message : String(err), this.opts.config.token));
        this.failures++;
      } finally {
        this.tickRun = null;
        if (!this.stopped) this.schedule(this.again ? 0 : this.nextDelay());
      }
    })();
    this.tickRun = done;
    return done;
  }

  private nextDelay(): number {
    const want = this.wanted();
    let ms = this.failures > 0 ? backoff(this.failures) : want.on ? POLL_ON_MS : POLL_OFF_MS;
    // A sound connection that is waiting to be tried again is tried when its pause is over, not up to a poll later.
    if (want.on && !this.pump && this.pumpFailure && this.pumpRetryAt > this.opts.now()) ms = Math.min(ms, Math.max(100, this.pumpRetryAt - this.opts.now()));
    // A retune that is being held back is made the moment the frequency has stood still long enough.
    if (want.on && this.settleUntil > this.opts.now()) ms = Math.min(ms, Math.max(1, this.settleUntil - this.opts.now()));
    return ms;
  }

  private async tick(): Promise<void> {
    const reply = await this.opts.client.status(this.abort.signal);
    if (this.stopped) return;
    if (reply.kind !== 'ok') return this.controlFailed(reply);
    this.failures = 0;
    this.link = { kind: 'ok' };
    const node = (this.node = reply.status);
    this.maybeOn = node.state === 'transmitting';
    await this.act(node);
  }

  private async act(node: FmNodeStatus): Promise<void> {
    let want = this.wanted();
    if (node.protocol !== FM_PROTOCOL) {
      // Not understood well enough to start anything. Switching off is one call that every version has.
      this.dropPump();
      if (!want.on && node.state === 'transmitting') await this.sendStop();
      return this.render();
    }
    if (!node.supported) {
      this.dropPump();
      return this.render();
    }
    if (!want.on) {
      this.dropPump();
      this.refusal = null;
      if (node.state === 'transmitting') await this.sendStop();
      return this.render();
    }
    if (!inBand(want.frequency, node.limits)) {
      // Tuned inside the usual band, but the helper is set to a narrower one: nothing is sent, and the page says so.
      this.dropPump();
      if (node.state === 'transmitting') await this.sendStop();
      return this.render();
    }

    const bandwidth = Math.min(FM_BANDWIDTH_KHZ, node.limits.maxBandwidth);
    const onAir = node.state === 'transmitting' && sameFrequency(node.frequency, want.frequency);
    if (onAir) this.refusal = null; // it is on the air after all (started by someone else, or an old refusal): nothing to complain about
    this.settleUntil = 0;
    if (!onAir && this.mayStart(node, want)) {
      const standingStill = this.opts.now() - want.tunedAt;
      if (node.state === 'transmitting' && standingStill >= 0 && standingStill < RETUNE_SETTLE_MS) {
        this.settleUntil = want.tunedAt + RETUNE_SETTLE_MS;
      } else {
        await this.sendStart(want.frequency, bandwidth);
        if (this.stopped) return;
      }
    }
    // The person may have changed their mind while the request was out: look again before opening anything.
    want = this.wanted();
    if (this.link.kind === 'ok' && want.on && this.node?.state === 'transmitting' && this.node.supported) this.ensurePump();
    this.render();
  }

  /** The transmitter program fails often at first (wrong board settings, busy DMA): it is asked again only every so often. */
  private mayStart(node: FmNodeStatus, want: FmWanted): boolean {
    const now = this.opts.now();
    if (node.state === 'error' && now - this.lastStartAt < RETRY_AFTER_ERROR_MS) return false;
    if (this.refusal && this.refusal.frequency === want.frequency && now < this.refusal.until) return false;
    return true;
  }

  private async sendStart(frequency: number, bandwidth: number): Promise<void> {
    this.lastStartAt = this.opts.now();
    this.maybeOn = true; // a request that is cancelled may still have been carried out
    const reply = await this.opts.client.start(frequency, bandwidth, this.abort.signal);
    if (this.stopped) return;
    if (reply.kind === 'ok') {
      this.failures = 0;
      this.link = { kind: 'ok' };
      this.node = reply.status;
      this.maybeOn = reply.status.state === 'transmitting';
      this.refusal = null;
    } else if (reply.kind === 'refused') {
      this.link = { kind: 'ok' };
      this.refusal = { code: reply.code, message: reply.message, frequency, until: this.opts.now() + RETRY_AFTER_ERROR_MS };
    } else {
      this.controlFailed(reply);
    }
  }

  private async sendStop(): Promise<void> {
    const reply = await this.opts.client.stop(undefined, this.abort.signal);
    if (this.stopped) return;
    if (reply.kind === 'ok') {
      this.node = reply.status;
      this.maybeOn = reply.status.state === 'transmitting';
    } else {
      this.controlFailed(reply);
    }
  }

  private controlFailed(reply: Exclude<FmNodeReply, { kind: 'ok' }>): void {
    this.failures++;
    if (reply.kind === 'unauthorized') this.link = { kind: 'unauthorized' };
    else if (reply.kind === 'notahelper') this.link = { kind: 'notahelper' };
    else if (reply.kind === 'refused') this.link = { kind: 'ok' };
    else this.link = { kind: 'unreachable', why: reply.why };
    // A wrong password or a stranger: the sound has no business going there. A helper that is merely slow keeps its connection a little
    // longer (it may be fine, and the connection tells if not).
    if (reply.kind === 'unauthorized' || reply.kind === 'notahelper' || this.failures >= 3) this.dropPump();
    this.render();
  }

  // ---- the sound connection ----------------------------------------------------------------------------------------------------------

  private ensurePump(): void {
    if (this.pump || this.opts.now() < this.pumpRetryAt) return;
    const pump = this.opts.makePump({
      onStreaming: () => {
        if (this.pump !== pump || this.stopped) return;
        this.streamingSince = this.opts.now();
        this.pumpFailure = null;
        this.render();
        this.poke(); // the helper's own view ("sound connected") is what completes "transmitting"
      },
      onDown: (failure) => {
        if (this.pump !== pump || this.stopped) return;
        this.pump = null;
        const held = this.streamingSince !== null && this.opts.now() - this.streamingSince >= PUMP_STABLE_MS;
        this.pumpFails = held ? 1 : this.pumpFails + 1;
        this.streamingSince = null;
        this.pumpFailure = failure;
        this.pumpRetryAt = this.opts.now() + backoff(this.pumpFails);
        this.render();
        this.poke();
      },
    });
    this.pump = pump;
    pump.start();
  }

  /** On purpose: the person switched off, or the helper cannot be trusted. Not a failure, so nothing is remembered. */
  private dropPump(): void {
    const pump = this.pump;
    this.pump = null;
    this.pumpFails = 0;
    this.pumpRetryAt = 0;
    this.pumpFailure = null;
    this.streamingSince = null;
    pump?.stop();
  }

  // ---- what to show ------------------------------------------------------------------------------------------------------------------

  private render(): void {
    if (this.stopped) return;
    const observed = this.describe(this.wanted());
    try {
      this.report(observed);
    } catch (err) {
      // A listener of the state that fails must not stop the loop, or end up as an uncaught error in a socket handler.
      console.error('[fm] could not publish the state:', scrubSecret(err instanceof Error ? err.message : String(err), this.opts.config.token));
    }
    const key = `${observed.status}|${observed.detail}`;
    if (key !== this.loggedKey) {
      this.loggedKey = key;
      console.log(`[fm] ${observed.status}: ${scrubSecret(observed.detail, this.opts.config.token)}`);
    }
  }

  private describe(want: FmWanted): FmObserved {
    const { mode } = this.opts.config;
    const node = this.node;
    const limits = node ? { min: node.limits.min, max: node.limits.max } : { min: FM_BAND.min, max: FM_BAND.max };
    const out = (status: FmObserved['status'], detail: string, level = 0): FmObserved => ({ mode, status, detail, board: node?.board ?? null, limits, level });
    const where = mode === 'local' ? 'on this Pi' : 'on the second Pi';

    switch (this.link.kind) {
      case 'unknown':
        return out('idle', 'Looking for the FM helper…');
      case 'unreachable':
        return out('unreachable', `The FM helper ${where} does not answer (${this.link.why}). Check that it is running, that FM_NODE_URL is its address and that FM_NODE_TOKEN is set. See docs/fm.md.`);
      case 'notahelper':
        return out('unreachable', 'Something answers at FM_NODE_URL, but it is not the FM helper. Check the address and the port. See docs/fm.md.');
      case 'unauthorized':
        return out('error', 'The FM helper refused the password: FM_NODE_TOKEN does not match the password the FM helper was set up with.');
    }
    if (!node) return out('idle', 'Looking for the FM helper…');
    if (node.protocol !== FM_PROTOCOL) return out('error', 'The FM helper is a different version than this head unit. Update the FM helper: run sudo ./deploy/setup-fm.sh node again on the Pi that has it.');
    if (!node.supported) {
      const reason = (node.reason ?? 'This board cannot run the FM transmitter.').replace(/\s+$/, '');
      const hint = mode === 'local' ? ' Use a second Pi as the transmitter: see docs/fm.md.' : '';
      return out('unsupported', `${/[.!?]$/.test(reason) ? reason : `${reason}.`}${hint}`);
    }
    if (!want.on) return out('idle', node.state === 'transmitting' ? 'Switching off…' : 'Ready. Switch it on to send the sound to the car radio.');
    if (!inBand(want.frequency, node.limits)) return out('error', `The FM helper is set to send only between ${mhz(node.limits.min)} and ${mhz(node.limits.max)} MHz. Choose a frequency in that range.`);
    if (this.refusal && this.refusal.frequency === want.frequency) return out(this.refusal.code === 403 ? 'unsupported' : 'error', this.refusal.message);
    if (node.state === 'error') return out('error', node.error ? `The transmitter program stopped: ${node.error}` : 'The transmitter program stopped. It is tried again in a few seconds.');
    if (node.state !== 'transmitting') return out('starting', 'Starting the transmitter…');
    if (!sameFrequency(node.frequency, want.frequency)) return out('starting', `Tuning to ${mhz(want.frequency)} MHz…`);

    // The carrier is on the air at the right frequency. What is left is the sound.
    const streaming = this.pump?.phase === 'streaming';
    if (streaming && node.audio.connected) return out('transmitting', `Sending on ${mhz(want.frequency)} MHz. The car radio hears it a second or two late.`, node.audio.level);
    const failure = this.pumpFailure;
    if (failure) return out(failure.kind === 'missing-parec' || this.pumpFails >= 2 ? 'error' : 'starting', pumpText(failure));
    return out('starting', 'Connecting the sound…');
  }
}

function pumpText(f: PumpFailure): string {
  switch (f.kind) {
    case 'missing-parec':
      return 'Sound capture (parec) is missing: sudo apt install pulseaudio-utils';
    case 'capture':
      return `${f.message} Is the sound system (PipeWire or PulseAudio) running? See docs/fm.md.`;
    case 'connect':
      return `The sound could not be sent to the FM helper (${f.message}). It is tried again shortly.`;
    case 'refused':
      return `The FM helper refused the sound connection: ${f.message}.`;
    case 'timeout':
      return 'The FM helper did not accept the sound connection in time. It is tried again shortly.';
    case 'closed':
      return `The sound connection to the FM helper ended (${f.message.replace(/[.\s]+$/, '')}). It is tried again shortly.`;
  }
}
