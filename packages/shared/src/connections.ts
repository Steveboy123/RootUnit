import type { MusicService } from './types';

/** Static facts about each music service, used by the server, the setup screen and `npm run setup`. */
export const SERVICE_INFO: Record<
  MusicService,
  {
    label: string;
    /** Where the developer app is created. */
    dashboardUrl: string;
    /** Path appended to http://127.0.0.1:<port> for the default Redirect URI. */
    callbackPath: string;
    /** Shown under the Client ID box. */
    clientIdHint: string;
  }
> = {
  spotify: {
    label: 'Spotify',
    dashboardUrl: 'https://developer.spotify.com/dashboard',
    callbackPath: '/auth/spotify/callback',
    clientIdHint: '32 letters and numbers, from your app’s Settings page',
  },
  tidal: {
    label: 'TIDAL',
    dashboardUrl: 'https://developer.tidal.com/dashboard',
    callbackPath: '/auth/tidal/callback',
    clientIdHint: 'from your app on the TIDAL developer dashboard',
  },
};

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Spotify Client IDs are 32 hex characters; TIDAL's format isn't documented, so only sanity-check it. */
const CLIENT_ID: Record<MusicService, RegExp> = {
  spotify: /^[0-9a-f]{32}$/,
  tidal: /^[A-Za-z0-9_-]{6,128}$/,
};

/**
 * Validate what the user typed or pasted as a Client ID. Trims whitespace/quotes. Never echoes the input back
 * in the error (it could be a secret pasted into the wrong box).
 */
export function validateClientId(service: MusicService, raw: unknown): Checked<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter your Client ID.' };
  const v = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (v === '') return { ok: false, error: 'Enter your Client ID.' };
  if (v.length > 200) return { ok: false, error: 'That is too long to be a Client ID.' };
  const candidate = service === 'spotify' ? v.toLowerCase() : v;
  if (!CLIENT_ID[service].test(candidate)) {
    return {
      ok: false,
      error:
        service === 'spotify'
          ? 'A Spotify Client ID is 32 letters and numbers (0–9, a–f). Copy it from your app’s Settings page — not the Client secret.'
          : 'A TIDAL Client ID is letters, numbers, “-” and “_” only. Copy it from your app on the TIDAL developer dashboard.',
    };
  }
  return { ok: true, value: candidate };
}


/** TIDAL Client Secrets are opaque. Accept printable non-whitespace characters but never echo them in errors. */
export function validateClientSecret(service: MusicService, raw: unknown): Checked<string> {
  if (service !== 'tidal') return { ok: false, error: 'This service does not use a Client Secret here.' };
  if (typeof raw !== 'string') return { ok: false, error: 'Enter your TIDAL Client Secret.' };
  const v = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (v.length < 8) return { ok: false, error: 'That is too short to be a TIDAL Client Secret.' };
  if (v.length > 512) return { ok: false, error: 'That is too long to be a TIDAL Client Secret.' };
  if (/\s/.test(v) || /[^\x21-\x7E]/.test(v)) return { ok: false, error: 'The TIDAL Client Secret contains unsupported characters. Copy it again from the developer dashboard.' };
  return { ok: true, value: v };
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);

/**
 * Validate a Redirect URI override. It must match what is registered in the service's dashboard exactly,
 * so this only checks it is a sane URL and — for Spotify — one the service will accept (https, or an
 * IP-literal loopback address; Spotify rejects "localhost").
 */
export function validateRedirectUri(service: MusicService, raw: unknown): Checked<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a web address.' };
  const v = raw.trim();
  if (v.length === 0 || v.length > 300) return { ok: false, error: 'Enter a web address (up to 300 characters).' };
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, error: 'That is not a valid web address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'It must start with https:// or http://.' };
  if (url.username || url.password) return { ok: false, error: 'It must not contain a user name or password.' };
  if (url.hash) return { ok: false, error: 'It must not contain a # fragment.' };
  if (service === 'spotify' && url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    return {
      ok: false,
      error: 'Spotify only accepts https:// addresses, or http://127.0.0.1 (not “localhost”).',
    };
  }
  return { ok: true, value: v };
}

/** Permissions to request, as typed by the user: space- or comma-separated tokens. Empty → use the default. */
export function validateScopes(raw: unknown): Checked<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter permissions separated by spaces.' };
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 40) return { ok: false, error: 'That is too many permissions.' };
  for (const p of parts) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(p)) return { ok: false, error: 'Permissions may contain only letters, numbers and . _ : -' };
  }
  return { ok: true, value: parts.join(' ') };
}

/** `http://127.0.0.1:8787` + the service's callback path. */
export function defaultRedirectUri(service: MusicService, port: number): string {
  return `http://127.0.0.1:${port}${SERVICE_INFO[service].callbackPath}`;
}
