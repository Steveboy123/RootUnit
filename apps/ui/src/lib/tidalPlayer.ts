import { apiRequest } from './api';

export type TidalCredentialSource = 'user' | 'client';

interface TidalCredential {
  clientId: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  source: TidalCredentialSource;
}

interface TidalCredentialBundle {
  primary: TidalCredential;
  fallback?: TidalCredential;
}

interface TidalSdk {
  auth: any;
  events: any;
  player: any;
}

export interface TidalLoadResult {
  credentialSource: TidalCredentialSource;
  mediaElement: HTMLMediaElement | null;
}

const SDK = {
  auth: '@tidal-music/auth@1.6.2',
  events: '@tidal-music/event-producer@2.6.0',
  player: '@tidal-music/player@0.20.1',
} as const;

const CLIENT_KEY = 'rpi-headunit-tidal-player';
let sdkPromise: Promise<TidalSdk> | null = null;
let booted = false;
let qualityConfigured = false;
let lastCredential: TidalCredential | null = null;
let loadGeneration = 0;
let loadQueue: Promise<void> = Promise.resolve();

/**
 * The app deliberately does not add the TIDAL SDK to package-lock: old installed head units update with `npm ci` before
 * they replace themselves, so changing dependencies would make the first in-place update fragile. These are pinned ESM
 * builds of TIDAL's official packages. A jsDelivr URL is tried only if esm.sh is unavailable.
 */
async function externalModule(spec: string): Promise<any> {
  const urls = [
    `https://esm.sh/${spec}?bundle`,
    `https://cdn.jsdelivr.net/npm/${spec}/+esm`,
  ];
  let last: unknown;
  for (const url of urls) {
    try {
      return await import(/* @vite-ignore */ url);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Could not load the TIDAL player SDK. Check the internet connection.${last instanceof Error ? ` ${last.message}` : ''}`);
}

async function sdk(): Promise<TidalSdk> {
  return (sdkPromise ??= Promise.all([externalModule(SDK.auth), externalModule(SDK.events), externalModule(SDK.player)]).then(
    ([auth, events, player]) => ({ auth, events, player }),
  ));
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'object' && e && 'message' in e) return new Error(String((e as any).message));
  return new Error(String(e || 'TIDAL playback failed'));
}

function credentialsFor(c: TidalCredential) {
  const scopes = [...new Set(c.scopes.filter(Boolean))];
  return {
    accessToken: {
      clientId: c.clientId,
      clientUniqueKey: CLIENT_KEY,
      expires: new Date(c.expiresAt),
      grantedScopes: scopes,
      requestedScopes: scopes,
      token: c.accessToken,
    },
  };
}

async function applyCredential(s: TidalSdk, c: TidalCredential) {
  const scopes = [...new Set(c.scopes.filter(Boolean))];
  // init() is safe to repeat. It lets a newer server-side TIDAL sign-in replace the short-lived token already in this kiosk.
  await s.auth.init({ clientId: c.clientId, clientUniqueKey: CLIENT_KEY, scopes });
  await s.auth.setCredentials(credentialsFor(c));

  if (!booted) {
    await s.events.init({
      appInfo: { appName: 'RPI Headunit', appVersion: '0.3.5' },
      blockedConsentCategories: { NECESSARY: false, PERFORMANCE: true, TARGETING: true },
      credentialsProvider: s.auth.credentialsProvider,
      platform: {
        browserName: 'Chromium',
        browserVersion: navigator.userAgent,
        deviceVendor: 'Raspberry Pi',
        model: 'RPI Headunit',
        osName: 'Raspberry Pi OS',
      },
      tlConsumerUri: 'https://ec.tidal.com',
      tlPublicConsumerUri: 'https://ec.tidal.com',
    });
    s.player.setCredentialsProvider(s.auth.credentialsProvider);
    s.player.setEventSender(s.events);
    booted = true;
  }
  if (!qualityConfigured) {
    qualityConfigured = true;
    // Ask TIDAL for the highest Wi-Fi quality this account/app/track is entitled to. The SDK/service may
    // transparently constrain this (for example preview/developer tiers), so failure falls back safely.
    for (const quality of ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH']) {
      try {
        await s.player.setStreamingWifiAudioQuality?.(quality);
        break;
      } catch {
        // Try the next supported tier.
      }
    }
    try { await s.player.setAudioAdaptiveBitrateStreaming?.(false); } catch { /* optional SDK capability */ }
  }
  lastCredential = c;
}

class StaleTidalLoad extends Error {}

function ensureCurrent(generation: number) {
  if (generation !== loadGeneration) throw new StaleTidalLoad('TIDAL track changed');
}

async function loadWith(s: TidalSdk, c: TidalCredential, id: string, generation: number) {
  ensureCurrent(generation);
  await applyCredential(s, c);
  ensureCurrent(generation);
  await s.player.load(
    {
      productId: id,
      productType: 'track',
      sourceId: 'rpi-headunit',
      sourceType: 'head-unit',
    },
    0,
  );
  ensureCurrent(generation);
  await s.player.play();
  ensureCurrent(generation);
}

/** Load a TIDAL track into the native browser player. User credentials are tried first, then app-preview credentials. */
export function loadTidalTrack(id: string): Promise<TidalLoadResult> {
  const generation = ++loadGeneration;
  let resolveResult!: (value: TidalLoadResult) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<TidalLoadResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const run = async () => {
    try {
      ensureCurrent(generation);
      const [s, bundle] = await Promise.all([sdk(), apiRequest<TidalCredentialBundle>('/api/tidal/player-credentials')]);
      ensureCurrent(generation);
      try {
        await loadWith(s, bundle.primary, id, generation);
        resolveResult({ credentialSource: bundle.primary.source, mediaElement: s.player.getMediaElement?.() ?? null });
        return;
      } catch (first) {
        if (first instanceof StaleTidalLoad) throw first;
        if (!bundle.fallback || bundle.fallback.accessToken === bundle.primary.accessToken) throw asError(first);
        try {
          s.player.reset?.();
          await loadWith(s, bundle.fallback, id, generation);
          resolveResult({ credentialSource: bundle.fallback.source, mediaElement: s.player.getMediaElement?.() ?? null });
          return;
        } catch (fallback) {
          if (fallback instanceof StaleTidalLoad) throw fallback;
          const a = asError(first).message;
          const b = asError(fallback).message;
          throw new Error(a === b ? b : `${a} · Preview fallback: ${b}`);
        }
      }
    } catch (e) {
      // A newer tap supersedes this load. The React caller has already advanced its sequence, so reject quietly there.
      rejectResult(e);
    }
  };

  loadQueue = loadQueue.then(run, run).then(() => undefined, () => undefined);
  return result;
}

export async function tidalPlay() {
  const s = await sdk();
  await s.player.play();
}

export async function tidalPause() {
  const s = await sdk();
  await s.player.pause();
}

export async function tidalSeek(seconds: number) {
  const s = await sdk();
  await s.player.seek(Math.max(0, seconds));
}

export async function tidalSetVolume(volume: number) {
  const s = await sdk();
  s.player.setVolumeLevel(Math.max(0, Math.min(100, volume)));
}

export async function tidalPositionSeconds(): Promise<number> {
  const s = await sdk();
  const n = Number(s.player.getAssetPosition?.() ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function tidalMediaElement(): Promise<HTMLMediaElement | null> {
  const s = await sdk();
  return s.player.getMediaElement?.() ?? null;
}

export async function resetTidalPlayer() {
  loadGeneration++;
  if (!sdkPromise) {
    lastCredential = null;
    return;
  }
  // Wait for a currently running load to notice the generation change before resetting the singleton player.
  await loadQueue.catch(() => undefined);
  const s = await sdkPromise;
  s.player.reset?.();
  lastCredential = null;
}

export function tidyTidalPlaybackError(e: unknown): string {
  const raw = asError(e).message;
  if (/FULL_REQUIRES_HIGHER_ACCESS_TIER|higher access tier/i.test(raw)) {
    return 'TIDAL only granted preview playback to this developer app. The head-unit player is working, but TIDAL has not enabled full-track access for this app.';
  }
  if (/scope|playback/i.test(raw) && /missing|required|grant|permission/i.test(raw)) {
    return 'TIDAL did not grant the playback permission needed for this track. The app can still use developer previews when TIDAL allows them.';
  }
  if (/cors|403|forbidden/i.test(raw)) {
    return 'TIDAL refused the audio stream in this browser session. Try the track again; if it continues, TIDAL may be restricting this developer app to its supported preview surface.';
  }
  return raw || 'TIDAL playback failed.';
}

export function currentTidalCredentialSource(): TidalCredentialSource | null {
  return lastCredential?.source ?? null;
}
