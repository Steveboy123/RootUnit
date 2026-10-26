import { spawn as spawnProcess } from 'node:child_process';
import { connect as connectSocket } from 'node:net';
import { FM_BAND, FM_MAX_PRESETS, FM_NOTICE_VERSION, NO_FM, normalizeFmFrequency, type FmState } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';
import type { FmBackend, FmObserved, FmWanted } from './backend';
import { CapturePump, type ConnectFn, type SpawnFn } from './capture';
import { FmNodeClient } from './client';
import { scrubSecret, type FmConfig } from './config';
import { DemoBackend } from './demo';
import { RemoteBackend } from './remote';
import { DEFAULT_FM_FILE, FM_FILE, sanitizeFmFile, type FmFile } from './store';

/** A request the person can fix: shown as it is, with the HTTP status that goes with it. */
export class FmError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FmServiceOptions {
  store: JsonStore;
  config: FmConfig;
  /** `--demo`: nothing is opened or started, whatever the configuration says. */
  demo?: boolean;
  now?: () => number;
  /** Network, processes and sockets for tests. */
  fetch?: typeof fetch;
  spawn?: SpawnFn;
  connect?: ConnectFn;
  /** The recorder program (parec). A stand-in for tests. */
  parecCommand?: string;
  /** Replaces the whole engine (tests of the service itself). */
  backend?: FmBackend;
}

/** parec does not need the helper's password, so it does not get it. */
const captureEnv = (): NodeJS.ProcessEnv => {
  const { FM_NODE_TOKEN: _token, ...rest } = process.env;
  return rest;
};
const defaultSpawn: SpawnFn = (command, args) => spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: captureEnv() });
const defaultConnect: ConnectFn = (port, host) => connectSocket({ port, host });

/**
 * The FM transmitter as the screens see it (`svc.fm`). It keeps what the person asked for (on or off, the frequency, saved
 * frequencies, whether the notice was accepted), saves it in data/fm.json, and lets an engine make it true:
 *
 *  - the real engine talks to the FM helper (RemoteBackend),
 *  - in --demo a pretend one (DemoBackend),
 *  - when nothing is configured, none: the state says so.
 *
 * "On" is a wish that the engine keeps working towards, also after a restart. Nothing transmits until the notice has been accepted on
 * this head unit: the wish is not even passed to the engine before that. Nothing here throws into the caller except `FmError`, which the
 * routes turn into a sentence.
 */
export class FmService {
  readonly state = new Observable<FmState>({ ...NO_FM });
  private file: FmFile = { ...DEFAULT_FM_FILE, presets: [] };
  private observed: FmObserved;
  private backend: FmBackend | null = null;
  private started = false;
  private last = '';
  private tunedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;

  constructor(private readonly opts: FmServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.observed = { mode: 'none', status: 'unconfigured', detail: opts.config.problem ?? NO_FM.detail, board: null, limits: { min: FM_BAND.min, max: FM_BAND.max }, level: 0 };
  }

  /** Loads what was saved and starts the engine. Does not wait for the helper: an unreachable one must not hold up the head unit's start. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      this.file = sanitizeFmFile(await this.opts.store.read(FM_FILE));
    } catch (err) {
      console.error('[fm] saved settings could not be read; starting with the defaults:', err);
    }
    // A notice that changed since it was accepted has not been accepted: it stays off until it is read again.
    if (!this.acknowledged) this.file.on = false;
    this.backend = this.makeBackend();
    // With an engine the first thing to show is "looking", not "not set up": the engine says more as soon as it knows.
    if (this.backend) this.observed = { ...this.observed, mode: this.opts.config.mode, status: 'idle', detail: 'Looking for the FM helper\u2026' };
    this.backend?.start(
      () => this.wanted(),
      (observed) => {
        this.observed = observed;
        this.publish();
      },
    );
    this.publish();
  }

  /** Carrier off and everything closed. The wish ("on") is kept, so the next start picks it up again. */
  async stop(): Promise<void> {
    try {
      await this.backend?.stop();
    } catch (err) {
      console.error('[fm] could not stop cleanly:', scrubSecret(err instanceof Error ? err.message : String(err), this.opts.config.token));
    }
  }

  get acknowledged(): boolean {
    return this.file.ack?.version === FM_NOTICE_VERSION;
  }

  /** The frequency the person chose, kept inside the band the helper accepts. */
  async tune(frequency: unknown): Promise<FmState> {
    const { min, max } = this.observed.limits;
    const f = normalizeFmFrequency(frequency, this.observed.limits);
    if (f === null) throw new FmError(400, `Choose a frequency between ${min.toFixed(1)} and ${max.toFixed(1)} MHz.`);
    this.file.frequency = f;
    this.tunedAt = this.now();
    await this.commit();
    return this.state.get();
  }

  async setOn(on: unknown): Promise<FmState> {
    if (typeof on !== 'boolean') throw new FmError(400, 'Send on as true or false.');
    if (on) {
      if (!this.acknowledged) throw new FmError(403, 'Read and accept the FM notice before the transmitter is switched on.');
      const { status, detail } = this.observed;
      if (status === 'unconfigured' || status === 'unsupported') throw new FmError(409, detail);
    }
    this.file.on = on;
    await this.commit();
    return this.state.get();
  }

  async acknowledge(version: unknown): Promise<FmState> {
    if (version !== FM_NOTICE_VERSION) throw new FmError(400, 'That is not the current FM notice. Reload the page and read it again.');
    this.file.ack = { version: FM_NOTICE_VERSION, at: this.now() };
    await this.commit();
    return this.state.get();
  }

  async togglePreset(frequency: unknown, saved: unknown): Promise<FmState> {
    if (typeof saved !== 'boolean') throw new FmError(400, 'Send saved as true or false.');
    // A saved frequency can always be removed; a new one has to be usable with the helper as it is set now.
    const f = normalizeFmFrequency(frequency, saved ? this.observed.limits : FM_BAND);
    if (f === null) throw new FmError(400, 'That is not a frequency in the FM band.');
    if (saved) {
      if (!this.file.presets.includes(f)) {
        if (this.file.presets.length >= FM_MAX_PRESETS) throw new FmError(400, `You can save up to ${FM_MAX_PRESETS} frequencies. Remove one first.`);
        this.file.presets = [...this.file.presets, f];
      }
    } else {
      this.file.presets = this.file.presets.filter((p) => p !== f);
    }
    await this.commit();
    return this.state.get();
  }

  // ---- internals -------------------------------------------------------------------------------------------------------------------------

  /** What the engine works towards. "On" counts only once the notice has been accepted. */
  private wanted(): FmWanted {
    return { on: this.file.on && this.acknowledged, frequency: this.file.frequency, tunedAt: this.tunedAt };
  }

  private makeBackend(): FmBackend | null {
    const { opts } = this;
    if (opts.backend) return opts.backend;
    if (opts.demo) return new DemoBackend(this.now);
    const { config } = opts;
    const token = config.token;
    if (config.mode === 'none' || !token) return null;
    const client = new FmNodeClient({ baseUrl: config.controlUrl, token, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    const spawn = opts.spawn ?? defaultSpawn;
    const connect = opts.connect ?? defaultConnect;
    return new RemoteBackend({
      config,
      client,
      now: this.now,
      makePump: (events) =>
        new CapturePump({ source: config.audioSource, host: config.host, port: config.audioPort, token, spawn, connect, ...(opts.parecCommand ? { command: opts.parecCommand } : {}), ...events }),
    });
  }

  /** Tell the screens and the engine at once, then save. */
  private async commit(): Promise<void> {
    this.publish();
    this.backend?.poke();
    await this.opts.store.write(FM_FILE, { ...this.file, presets: [...this.file.presets] });
  }

  private publish(): void {
    const o = this.observed;
    const token = this.opts.config.token;
    const next: FmState = {
      mode: o.mode,
      status: o.status,
      on: this.file.on,
      acknowledged: this.acknowledged,
      frequency: this.file.frequency,
      presets: [...this.file.presets],
      level: Math.round(Math.min(1, Math.max(0, o.level)) * 100) / 100,
      board: o.board === null ? null : scrubSecret(o.board, token),
      limits: { min: o.limits.min, max: o.limits.max },
      detail: scrubSecret(o.detail, token),
      demo: Boolean(this.opts.demo),
    };
    const key = JSON.stringify(next);
    if (key === this.last) return;
    this.last = key;
    try {
      this.state.set(next);
    } catch (err) {
      // A listener that fails (a screen that went away mid-send) is not the transmitter's problem.
      console.error('[fm] a listener of the state failed:', scrubSecret(err instanceof Error ? err.message : String(err), token));
    }
  }
}
