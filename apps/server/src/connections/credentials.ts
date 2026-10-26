import {
  defaultRedirectUri,
  validateClientId,
  validateClientSecret,
  validateRedirectUri,
  validateScopes,
  type MusicService,
  MUSIC_SERVICES,
} from '@headunit/shared';
import type { JsonStore } from '../store';

export const CREDENTIALS_FILE = 'credentials.json';

/** What the user saved through Settings or `npm run setup`. Client IDs are not secrets, but the file is 0600 anyway. */
export interface SavedService {
  clientId?: string;
  /** TIDAL only. Sensitive: persisted in credentials.json (0600) and never sent back to the browser. */
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
}
export type SavedCredentials = Partial<Record<MusicService, SavedService>>;

/** Environment-provided values (`SPOTIFY_CLIENT_ID`, …). */
export interface EnvService {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
}

export interface ResolvedService {
  clientId: string;
  clientIdSource: 'saved' | 'env' | 'none';
  clientSecret: string;
  clientSecretSource: 'saved' | 'env' | 'none';
  redirectUri: string;
  redirectUriSource: 'default' | 'saved' | 'env';
  scopes: string;
}

/** Drop anything invalid or unknown; never throws. */
export function sanitizeCredentials(raw: unknown): SavedCredentials {
  const out: SavedCredentials = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const service of MUSIC_SERVICES) {
    const r = (raw as Record<string, unknown>)[service];
    if (typeof r !== 'object' || r === null) continue;
    const entry: SavedService = {};
    const id = validateClientId(service, (r as SavedService).clientId);
    if (id.ok) entry.clientId = id.value;
    if (service === 'tidal') {
      const secret = validateClientSecret(service, (r as SavedService).clientSecret);
      if (secret.ok) entry.clientSecret = secret.value;
    }
    const uri = validateRedirectUri(service, (r as SavedService).redirectUri);
    if (uri.ok) entry.redirectUri = uri.value;
    const sc = validateScopes((r as SavedService).scopes);
    if (sc.ok && sc.value) entry.scopes = sc.value;
    if (Object.keys(entry).length) out[service] = entry;
  }
  return out;
}

export async function loadCredentials(store: JsonStore): Promise<SavedCredentials> {
  return sanitizeCredentials(await store.read(CREDENTIALS_FILE));
}

/**
 * Merge `patch` into one service's saved values and write the file. A key set to `null` (or '') is removed, so
 * the environment/default value applies again; a key left `undefined` is untouched. Validates; throws a
 * plain-language Error on bad input (nothing is written then).
 */
export async function saveServiceCredentials(
  store: JsonStore,
  service: MusicService,
  patch: { clientId?: string | null; clientSecret?: string | null; redirectUri?: string | null; scopes?: string | null },
): Promise<SavedCredentials> {
  const all = await loadCredentials(store);
  const entry: SavedService = { ...all[service] };
  if (patch.clientId !== undefined) {
    if (patch.clientId === null || patch.clientId === '') delete entry.clientId;
    else {
      const v = validateClientId(service, patch.clientId);
      if (!v.ok) throw new Error(v.error);
      entry.clientId = v.value;
    }
  }
  if (patch.clientSecret !== undefined) {
    if (service !== 'tidal') throw new Error('This service does not use a Client Secret here.');
    if (patch.clientSecret === null || patch.clientSecret === '') delete entry.clientSecret;
    else {
      const v = validateClientSecret(service, patch.clientSecret);
      if (!v.ok) throw new Error(v.error);
      entry.clientSecret = v.value;
    }
  }
  if (patch.redirectUri !== undefined) {
    if (patch.redirectUri === null || patch.redirectUri === '') delete entry.redirectUri;
    else {
      const v = validateRedirectUri(service, patch.redirectUri);
      if (!v.ok) throw new Error(v.error);
      entry.redirectUri = v.value;
    }
  }
  if (patch.scopes !== undefined) {
    if (patch.scopes === null || patch.scopes.trim() === '') delete entry.scopes;
    else {
      const v = validateScopes(patch.scopes);
      if (!v.ok) throw new Error(v.error);
      if (v.value) entry.scopes = v.value;
      else delete entry.scopes;
    }
  }
  const next: SavedCredentials = { ...all };
  if (Object.keys(entry).length) next[service] = entry;
  else delete next[service];
  await store.write(CREDENTIALS_FILE, next);
  return next;
}

/** Saved values win over the environment, which wins over the built-in defaults. */
export function resolveService(
  service: MusicService,
  saved: SavedCredentials,
  env: EnvService,
  port: number,
  defaultScopes = '',
): ResolvedService {
  const s = saved[service] ?? {};
  const envId = env.clientId ? validateClientId(service, env.clientId) : null;
  const envSecret = service === 'tidal' && env.clientSecret ? validateClientSecret(service, env.clientSecret) : null;
  const envUri = env.redirectUri ? validateRedirectUri(service, env.redirectUri) : null;
  const clientId = s.clientId ?? (envId?.ok ? envId.value : '');
  const clientSecret = service === 'tidal' ? (s.clientSecret ?? (envSecret?.ok ? envSecret.value : '')) : '';
  return {
    clientId,
    clientIdSource: s.clientId ? 'saved' : envId?.ok ? 'env' : 'none',
    clientSecret,
    clientSecretSource: service === 'tidal' ? (s.clientSecret ? 'saved' : envSecret?.ok ? 'env' : 'none') : 'none',
    redirectUri: s.redirectUri ?? (envUri?.ok ? envUri.value : defaultRedirectUri(service, port)),
    redirectUriSource: s.redirectUri ? 'saved' : envUri?.ok ? 'env' : 'default',
    scopes: s.scopes ?? (env.scopes ? (validateScopes(env.scopes).ok ? env.scopes.split(/[\s,]+/).filter(Boolean).join(' ') : defaultScopes) : defaultScopes),
  };
}
