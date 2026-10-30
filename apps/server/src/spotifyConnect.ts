import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Observable } from './observable';

export type SpotifyConnectState = 'disabled' | 'starting' | 'running' | 'error' | 'stopped';
export interface SpotifyConnectStatus {
  enabled: boolean;
  name: string;
  state: SpotifyConnectState;
  message?: string;
  /** Native Spotify stream bitrate requested from librespot. */
  bitrateKbps?: number;
  backend?: string;
  device?: string;
  discoverable?: boolean;
  /** Native path deliberately avoids loudness normalisation by default. */
  normalization?: boolean;
}

export interface SpotifyConnectConfig {
  enabled: boolean;
  name: string;
  binary: string;
  backend: string;
  device: string;
  bitrate: number;
  format?: string;
  normalize: boolean;
  dataDir: string;
  /** Where this runs: off Linux the receiver does not exist, and the status says what to use instead. */
  platform?: NodeJS.Platform;
}

/** Why the native receiver is off, in words the Play on… sheet can show. */
export function disabledReason(platform: NodeJS.Platform): string {
  return platform === 'linux'
    ? 'Turned off (SPOTIFY_CONNECT_DISABLED=1). Use Browser fallback, or play on another device.'
    : 'Built into the Raspberry Pi version only. On this computer, use Browser fallback (Spotify Premium), or play on another device such as the Spotify app.';
}

export interface SpotifyConnectReceiver {
  readonly state: Observable<SpotifyConnectStatus>;
  start(): void;
  restart(): void;
  stop(): void;
}

/** Runs the Pi's native librespot receiver as a child of the head-unit service. */
export function createSpotifyConnectReceiver(config: SpotifyConnectConfig): SpotifyConnectReceiver {
  const base = {
    enabled: config.enabled,
    name: config.name,
    bitrateKbps: config.bitrate,
    backend: config.backend,
    device: config.device,
    normalization: config.normalize,
  };
  const offMessage = disabledReason(config.platform ?? process.platform);
  const state = new Observable<SpotifyConnectStatus>({
    ...base,
    state: config.enabled ? 'stopped' : 'disabled',
    ...(config.enabled ? {} : { message: offMessage }),
  });
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let retry: NodeJS.Timeout | null = null;
  let stopping = false;
  let runToken = 0;

  const cache = resolve(config.dataDir, 'spotify-connect', 'cache');
  const systemCache = resolve(config.dataDir, 'spotify-connect', 'system');

  function clearRetry() {
    if (retry) clearTimeout(retry);
    retry = null;
  }

  function publish(next: Partial<SpotifyConnectStatus> & Pick<SpotifyConnectStatus, 'state'>) {
    state.set({ ...base, ...next });
  }

  function launch() {
    clearRetry();
    if (!config.enabled || stopping || child) return;
    const token = ++runToken;
    if (!existsSync(config.binary)) {
      publish({
        state: 'error',
        message: 'Native Spotify receiver is missing. Install/update again while the Pi is online.',
      });
      return;
    }
    try {
      mkdirSync(cache, { recursive: true, mode: 0o700 });
      mkdirSync(systemCache, { recursive: true, mode: 0o700 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[spotify-connect] cache directory is not writable: ${message}`);
      publish({ state: 'error', message: 'Spotify cache is not writable. Re-run the installer to repair data-folder permissions.' });
      if (!stopping) {
        retry = setTimeout(launch, 10000);
        retry.unref();
      }
      return;
    }

    const args = [
      '--name', config.name,
      '--device-type', 'avr',
      '--bitrate', String(config.bitrate),
      '--backend', config.backend,
      '--device', config.device,
      '--cache', cache,
      '--cache-size-limit', '256M',
      '--system-cache', systemCache,
      '--initial-volume', '100',
    ];
    if (config.format) args.push('--format', config.format);
    if (config.normalize) args.push('--enable-volume-normalisation');

    publish({ state: 'starting', discoverable: false, message: `Starting native Spotify Connect at ${config.bitrate} kbps…` });
    console.log(`[spotify-connect] starting ${config.name} (${config.backend}:${config.device}, ${config.bitrate} kbps)`);
    child = spawn(config.binary, args, {
      cwd: config.dataDir,
      env: { ...process.env, TMPDIR: '/tmp' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const inspect = (raw: unknown, warn = false) => {
      const line = String(raw).trimEnd();
      if (!line) return;
      (warn ? console.warn : console.log)(`[spotify-connect] ${line}`);
      if (token !== runToken || stopping) return;
      if (/zeroconf|mdns|discovery.*listen|listening on/i.test(line)) {
        publish({ state: 'running', discoverable: true, message: `Native Connect ready · ${config.bitrate} kbps` });
      } else if (/authenticated|session.*connected|spirc/i.test(line) && state.get().state !== 'running') {
        publish({ state: 'running', discoverable: true, message: `Native Connect ready · ${config.bitrate} kbps` });
      }
    };
    child.stdout.on('data', (b) => inspect(b));
    child.stderr.on('data', (b) => inspect(b, true));
    child.once('spawn', () => {
      setTimeout(() => {
        if (token === runToken && child && !stopping && state.get().state === 'starting') {
          // Some builds are quiet unless verbose logging is enabled. Process survival is still useful,
          // but keep discoverable=false until the Spotify API actually sees the device.
          publish({ state: 'running', discoverable: false, message: `Native receiver running · ${config.bitrate} kbps · waiting for Spotify discovery` });
        }
      }, 1800).unref();
    });
    child.once('error', (err) => {
      if (token !== runToken) return;
      console.error('[spotify-connect] failed to start:', err.message);
      child = null;
      publish({ state: 'error', message: err.message });
      if (!stopping) retry = setTimeout(launch, 5000);
    });
    child.once('exit', (code, signal) => {
      if (token !== runToken) return;
      child = null;
      if (stopping) {
        publish({ state: 'stopped' });
        return;
      }
      const why = signal ? `signal ${signal}` : `exit ${code ?? 'unknown'}`;
      console.warn(`[spotify-connect] receiver stopped (${why}); retrying`);
      publish({ state: 'error', message: `Native receiver stopped (${why}); retrying…` });
      retry = setTimeout(launch, 5000);
      retry.unref();
    });
  }

  return {
    state,
    start() {
      stopping = false;
      launch();
    },
    restart() {
      stopping = false;
      clearRetry();
      runToken++;
      if (child) {
        const old = child;
        child = null;
        old.kill('SIGTERM');
      }
      publish({ state: 'starting', discoverable: false, message: 'Restarting native Spotify Connect…' });
      setTimeout(launch, 500).unref();
    },
    stop() {
      stopping = true;
      clearRetry();
      runToken++;
      const old = child;
      child = null;
      if (old) old.kill('SIGTERM');
      publish(config.enabled ? { state: 'stopped' } : { state: 'disabled', message: offMessage });
    },
  };
}
