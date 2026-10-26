import { spawn, type ChildProcess } from 'node:child_process';
import type { ProjectionState } from '@headunit/shared';
import type { Config } from '../config';
import { Observable } from '../observable';
import type { RadioProvider } from '../radio/radio';
import { splitCommand } from '../shellwords';
import type { MediaProvider } from './media';

export interface ProjectionProvider {
  readonly state: Observable<ProjectionState>;
  /** Show Android Auto: start the app (ondemand) or raise its window (resident). */
  launch(): Promise<void>;
  /** Leave Android Auto: kill the app (ondemand) or send its window back (resident). */
  stop(): Promise<void>;
  /** Called once at boot; resident mode starts the app here. */
  start(): void;
  dispose(): void;
}

/**
 * Android Auto brings its own audio, so the moment it comes to the front (status turns 'active') the head
 * unit's own sources go quiet: the radio stream stops and the active music service pauses, otherwise two
 * things play at once. It never resumes anything when you come back: that is a decision for the driver.
 *
 * Only the server's sources are handled here. Players that live in the browser page (the TIDAL and YouTube
 * embeds) are invisible to the server; the UI reacts to `projection.status === 'active'` for those.
 * Edge-triggered, so later updates while Android Auto stays up (a restart, `running` flipping) do not
 * pause music the driver started on purpose. Returns the unsubscribe function.
 */
export function yieldAudioToProjection(
  state: Observable<ProjectionState>,
  sources: { media: Pick<MediaProvider, 'state' | 'command'>; radio: Pick<RadioProvider, 'state' | 'command'> },
): () => void {
  let wasActive = state.get().status === 'active';
  return state.subscribe((s) => {
    const active = s.status === 'active';
    const justShown = active && !wasActive;
    wasActive = active;
    if (!justShown) return;
    const quiet = (what: string) => (e: unknown) => console.error(`[projection] could not silence ${what}:`, e);
    // Only touch what is actually playing, so a sleeping Spotify device is not woken just to be told to pause.
    if (sources.radio.state.get().playing) void sources.radio.command({ cmd: 'stop' }).catch(quiet('the radio'));
    if (sources.media.state.get().playing) void sources.media.command({ cmd: 'pause' }).catch(quiet('the music player'));
  });
}

export interface ExternalOptions {
  /** Backoff between restarts of a crashed resident app. */
  restartDelaysMs?: number[];
  /** SIGTERM → SIGKILL escalation delay. */
  killGraceMs?: number;
  /** How long a focus/back hook may run. */
  hookTimeoutMs?: number;
  /**
   * A resident app whose launcher exits cleanly (code 0) within this long of starting is taken to have
   * handed over to a detached process instead of having quit (see the comment in createExternalProjection).
   */
  handoffMs?: number;
}

const isWin = process.platform === 'win32';

/**
 * Terminate a child and everything it spawned (it runs as its own process group on POSIX).
 * The SIGKILL follow-up is NOT cancelled when the leader exits: a descendant that ignores SIGTERM
 * would otherwise outlive it. (The timer is unref'd, so it never keeps the server alive.)
 */
function killTree(c: ChildProcess, graceMs: number) {
  const pid = c.pid;
  if (!pid) return;
  const send = (sig: NodeJS.Signals) => {
    try {
      if (isWin) c.kill(sig);
      else process.kill(-pid, sig);
    } catch {
      /* already gone */
    }
  };
  send('SIGTERM');
  setTimeout(() => send('SIGKILL'), graceMs).unref();
}

interface HookResult {
  ok: boolean;
  detail?: string;
  /** Exit code when the hook ran and exited with one. */
  code?: number;
}

function runHook(cmdline: string, timeoutMs: number, signal?: AbortSignal): Promise<HookResult> {
  const argv = splitCommand(cmdline);
  if (argv.length === 0) return Promise.resolve({ ok: false, detail: 'not configured' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: HookResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const c = spawn(argv[0]!, argv.slice(1), { stdio: 'ignore', signal });
    const timer = setTimeout(() => {
      c.kill('SIGKILL');
      finish({ ok: false, detail: 'timed out' });
    }, timeoutMs);
    c.once('error', (e) => finish({ ok: false, detail: e.message }));
    c.once('exit', (code) => finish(code === 0 ? { ok: true } : { ok: false, detail: `exit code ${code}`, ...(code === null ? {} : { code }) }));
  });
}

/**
 * Runs an external native Android Auto receiver as a child process.
 *
 * ondemand: Launch spawns the app, Stop kills it. Fine for wired USB.
 * resident: the app is started at boot and supervised (restarted with backoff), because wireless
 *   Android Auto needs it running to answer the phone's Bluetooth/Wi-Fi handshake. Launch/Stop then
 *   run the configured focus/back commands to swap which window is on top.
 *
 * Some native receivers are launcher processes that hand their display work to a detached compositor.
 * In that case a clean exit shortly after start is treated as a successful hand-off instead of a crash;
 * if a later Launch cannot find the receiver window, the provider starts it again once.
 *
 * Launch/Stop run one at a time. A request that arrives while another is still running is not lost: the
 * newest one runs when the current one finishes (a steering-wheel Home press during a slow focus hook must
 * win), and its caller returns immediately; the outcome arrives through `state`.
 */
export function createExternalProjection(cfg: Config['projection'], opts: ExternalOptions = {}): ProjectionProvider {
  const resident = cfg.mode === 'resident';
  const delays = opts.restartDelaysMs ?? [1000, 2000, 5000, 10_000, 30_000];
  const graceMs = opts.killGraceMs ?? 3000;
  // The Pi focus helper may wait up to ~20 s for a cold Qt window after boot, so allow longer than that.
  const hookMs = opts.hookTimeoutMs ?? 25_000;
  const handoffMs = opts.handoffMs ?? 15_000;

  const state = new Observable<ProjectionState>({ provider: 'external', mode: cfg.mode, running: false, status: 'idle' });
  const set = (patch: Partial<ProjectionState>) => state.update({ detail: undefined, ...patch });

  let child: ChildProcess | null = null;
  let disposed = false;
  let stopRequested = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let startedAt = 0;
  /** The launcher exited cleanly right after start: a detached process is (probably) running the app. */
  let handedOff = false;
  /** Counts exits that were not hand-offs, so a Launch can tell the app died while it was waiting on a hook. */
  let crashes = 0;
  const hooks = new AbortController();

  function scheduleRestart() {
    if (!resident || disposed || restartTimer) return;
    const delay = delays[Math.min(attempt, delays.length - 1)]!;
    attempt++;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnApp();
    }, delay);
    restartTimer.unref();
  }

  function spawnApp() {
    if (child || disposed) return;
    stopRequested = false;
    handedOff = false;
    set({ status: resident ? 'idle' : 'starting', running: false });
    const c = spawn(cfg.command, cfg.args, { stdio: 'ignore', detached: !isWin });
    child = c;
    startedAt = Date.now();

    c.once('spawn', () => set({ running: true, status: resident ? 'idle' : 'active' }));
    c.once('error', (err) => {
      if (child === c) child = null;
      crashes++;
      set({ running: false, status: 'error', detail: err.message });
      scheduleRestart();
    });
    c.once('exit', (code, signal) => {
      if (child === c) child = null;
      const lived = Date.now() - startedAt;
      if (lived > 60_000) attempt = 0; // it was healthy for a while
      if (disposed) return void state.update({ running: false });
      if (resident && !stopRequested && code === 0 && lived < handoffMs) {
        handedOff = true;
        attempt = 0;
        const s = state.get().status;
        set({ running: true, status: s === 'active' || s === 'starting' ? s : 'idle' });
        return;
      }
      crashes++;
      const clean = stopRequested || code === 0 || signal === 'SIGTERM';
      if (resident) {
        set({ running: false, status: 'error', detail: `Projection app exited (${signal ?? `code ${code}`}) — restarting` });
        scheduleRestart();
      } else {
        set({ running: false, status: clean ? 'idle' : 'error', detail: clean ? undefined : `Exited with code ${code}` });
      }
    });
  }

  async function doLaunch() {
    if (!resident) {
      spawnApp();
      return;
    }
    if (!child && !handedOff) return set({ status: 'error', running: false, detail: 'The projection app is not running' });
    if (!cfg.focusCommand) {
      return set({ status: 'error', detail: 'Set PROJECTION_FOCUS_COMMAND so Android Auto can be brought to the front' });
    }
    const crashesBefore = crashes;
    set({ status: 'starting' });
    let r = await runHook(cfg.focusCommand, hookMs, hooks.signal);
    if (disposed) return;
    // Exit code 1 is the helper's "no such window". If the app only ever handed off, it may have died since: start it again once.
    if (!r.ok && r.code === 1 && handedOff && !child) {
      spawnApp();
      set({ status: 'starting' });
      r = await runHook(cfg.focusCommand, hookMs, hooks.signal);
      if (disposed) return;
    }
    // The app crashed while we waited: the exit handler already reported it and a restart is under way, so don't claim success.
    if (crashes !== crashesBefore) return;
    set(r.ok ? { status: 'active' } : { status: 'error', detail: `Couldn't show Android Auto (${r.detail})` });
  }

  async function doStop() {
    if (!resident) {
      if (child) {
        stopRequested = true;
        killTree(child, graceMs);
      } else {
        set({ status: 'idle' });
      }
      return;
    }
    if (!cfg.backCommand) {
      return set({ status: 'error', detail: 'Set PROJECTION_BACK_COMMAND so the dashboard can be brought back' });
    }
    const r = await runHook(cfg.backCommand, hookMs, hooks.signal);
    if (disposed) return;
    set(r.ok ? { status: 'idle' } : { status: 'error', detail: `Couldn't return to the dashboard (${r.detail})` });
  }

  type Request = 'launch' | 'stop';
  const impl: Record<Request, () => Promise<void>> = { launch: doLaunch, stop: doStop };
  let inFlight: Request | null = null;
  let queued: Request | null = null;

  async function serialized(req: Request) {
    if (inFlight) {
      // Newest request wins: asking for what is already running cancels a pending opposite request.
      queued = req === inFlight ? null : req;
      return;
    }
    let next: Request | null = req;
    while (next && !disposed) {
      inFlight = next;
      try {
        await impl[next]();
      } catch (e) {
        queued = null;
        throw e;
      } finally {
        inFlight = null;
      }
      next = queued;
      queued = null;
    }
  }

  return {
    state,

    start() {
      if (resident) spawnApp();
    },

    launch: () => serialized('launch'),
    stop: () => serialized('stop'),

    dispose() {
      disposed = true;
      queued = null;
      hooks.abort();
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (child) killTree(child, graceMs);
    },
  };
}

/** A production Pi should never silently fall back to a fake Android Auto session. */
export function createUnavailableProjection(detail = 'Android Auto receiver is not configured'): ProjectionProvider {
  const state = new Observable<ProjectionState>({
    provider: 'external',
    mode: 'resident',
    running: false,
    status: 'unavailable',
    detail,
  });
  return {
    state,
    start() {},
    async launch() {
      state.update({ status: 'unavailable', running: false, detail });
    },
    async stop() {
      state.update({ status: 'unavailable', running: false, detail });
    },
    dispose() {},
  };
}

export const createProjection = (cfg: Config['projection']): ProjectionProvider =>
  cfg.command ? createExternalProjection(cfg) : createUnavailableProjection();
