import { useSyncExternalStore } from 'react';
import { apiRequest, apiSend } from './api';

interface SpotifyCredential {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

type SpotifySdkPlayer = {
  addListener(event: string, cb: (arg: any) => void): boolean;
  removeListener(event?: string, cb?: (arg: any) => void): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement?(): Promise<void>;
};

type SpotifyCtor = new (opts: {
  name: string;
  getOAuthToken(cb: (token: string) => void): void;
  volume?: number;
}) => SpotifySdkPlayer;

declare global {
  interface Window {
    Spotify?: { Player: SpotifyCtor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export interface SpotifyPlaybackStatus {
  state: 'idle' | 'connecting' | 'ready' | 'needs-login' | 'error';
  name: string;
  deviceId?: string;
  message: string;
}

let status: SpotifyPlaybackStatus = {
  state: 'idle',
  name: 'RPI Headunit Web Fallback',
  message: 'Preparing Spotify playback…',
};
let player: SpotifySdkPlayer | null = null;
let starting: Promise<void> | null = null;
let sdkPromise: Promise<void> | null = null;
let activationInstalled = false;
const listeners = new Set<() => void>();

function setStatus(next: SpotifyPlaybackStatus) {
  status = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSpotifyPlaybackStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

async function credentials(): Promise<SpotifyCredential> {
  return apiRequest<SpotifyCredential>('/api/spotify/player-credentials');
}

function loadSdk(): Promise<void> {
  if (window.Spotify?.Player) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-headunit-spotify-sdk]');
    const timeout = window.setTimeout(() => reject(new Error('Spotify player took too long to load')), 15000);
    window.onSpotifyWebPlaybackSDKReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.dataset.headunitSpotifySdk = '1';
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Could not load Spotify player — check the Pi internet connection'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function friendlySdkError(kind: string, message: string) {
  if (kind === 'account_error') return 'Spotify Premium is required to play through the browser fallback.';
  if (kind === 'authentication_error') return 'Spotify playback permission expired. Sign out and sign in again in Settings.';
  if (kind === 'initialization_error') return `Spotify player could not start: ${message}`;
  return message || 'Spotify player reported an error.';
}

function installActivation() {
  if (activationInstalled) return;
  activationInstalled = true;
  const activate = () => {
    void player?.activateElement?.().catch(() => undefined);
  };
  window.addEventListener('pointerdown', activate, { passive: true });
  window.addEventListener('keydown', activate, { passive: true });
}

export function ensureSpotifyPlayback(): Promise<void> {
  if (status.state === 'ready' && player) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    setStatus({ state: 'connecting', name: 'RPI Headunit Web Fallback', message: 'Starting Spotify player…' });
    let first: SpotifyCredential;
    try {
      first = await credentials();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needs = /sign in|permission/i.test(message);
      setStatus({ state: needs ? 'needs-login' : 'error', name: 'RPI Headunit Web Fallback', message });
      return;
    }
    if (!first.scopes.includes('streaming')) {
      setStatus({
        state: 'needs-login',
        name: 'RPI Headunit Web Fallback',
        message: 'Sign out and sign back into Spotify once to enable playback on this head unit.',
      });
      return;
    }
    try {
      await loadSdk();
      if (!window.Spotify?.Player) throw new Error('Spotify player SDK did not initialise');
      player?.disconnect();
      player = new window.Spotify.Player({
        name: 'RPI Headunit Web Fallback',
        volume: 0.8,
        getOAuthToken: (cb) => {
          void credentials()
            .then((c) => cb(c.accessToken))
            .catch((e) => setStatus({ state: 'error', name: 'RPI Headunit Web Fallback', message: e instanceof Error ? e.message : String(e) }));
        },
      });
      const errorListener = (kind: string) => ({ message }: { message?: string }) => {
        setStatus({ state: kind === 'authentication_error' ? 'needs-login' : 'error', name: 'RPI Headunit Web Fallback', message: friendlySdkError(kind, message ?? '') });
      };
      player.addListener('initialization_error', errorListener('initialization_error'));
      player.addListener('authentication_error', errorListener('authentication_error'));
      player.addListener('account_error', errorListener('account_error'));
      player.addListener('playback_error', errorListener('playback_error'));
      player.addListener('not_ready', ({ device_id }: { device_id: string }) => {
        if (status.deviceId === device_id) setStatus({ state: 'connecting', name: 'RPI Headunit Web Fallback', message: 'Spotify player temporarily disconnected; reconnecting…' });
      });
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        setStatus({ state: 'ready', name: 'RPI Headunit Web Fallback', deviceId: device_id, message: 'Browser fallback ready' });
        installActivation();
      });
      const ok = await player.connect();
      if (!ok) throw new Error('Spotify did not accept the local player connection');
    } catch (err) {
      setStatus({ state: 'error', name: 'RPI Headunit Web Fallback', message: err instanceof Error ? err.message : String(err) });
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export async function transferSpotifyToHeadunit(): Promise<void> {
  await ensureSpotifyPlayback();
  if (status.state !== 'ready' || !status.deviceId) throw new Error(status.message || 'RPI Headunit browser fallback is not ready yet.');
  const r = await apiSend('/api/connect/transfer', { id: status.deviceId });
  if (r.error) throw new Error(r.error.message);
}

export function restartSpotifyPlayback() {
  player?.disconnect();
  player = null;
  setStatus({ state: 'idle', name: 'RPI Headunit Web Fallback', message: 'Restarting Spotify player…' });
  return ensureSpotifyPlayback();
}
