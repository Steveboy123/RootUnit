import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  CatalogItem,
  CatalogTrack,
  ConnectDevice,
  MediaCommand,
  MediaState,
  SearchResults,
  TestConnectionResult,
  TrackListing,
} from '@headunit/shared';
import type { ConnectionProblem } from '@headunit/shared';
import { parsePastedLogin } from '../connections/paste';
import type { MusicServiceProvider, ServiceAuthInfo, ServiceSettings, TidalPlayerCredential, TidalPlayerCredentialBundle } from '../connections/service';
import { LibraryError, type LibraryProvider } from '../library/library';
import { Observable } from '../observable';
import { oauthNetworkFailure, retryableSpotifyConnection } from './spotifyNetwork';
import type { JsonStore } from '../store';

const AUTH_URL = 'https://login.tidal.com/authorize';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';
const API_URL = 'https://openapi.tidal.com/v2';
const TOKEN_FILE = 'tidal.json';
const DEFAULT_COUNTRY = 'US';
export const TIDAL_DEFAULT_SCOPES = 'user.read playback';
/** One stalled request must never hold everything else up (the official client uses 10 s per attempt). */
const REQUEST_TIMEOUT_MS = 12_000;
/** Best-effort lookups (the account's country) may not slow a search by more than this. */
const LOOKUP_TIMEOUT_MS = 3_000;
const MAX_RATE_RETRIES = 2;
const MAX_SERVER_RETRIES = 1;
const MAX_RETRY_WAIT_MS = 5_000;
const SERVER_RETRY_MS = 500;
/** Personal collections and album/playlist items: follow `links.meta.nextCursor` up to this many pages / items. */
const PAGE_CAP = 5;
const ITEM_CAP = 100;
/** Ids per `filter[id]` request. The spec does not state a limit; 20 is what this provider has always used. */
const ID_CHUNK = 20;
/** Artwork: the smallest image at least this wide, else the largest one there is. */
const ARTWORK_MIN_WIDTH = 640;
/** After a failed /users/me, ask again no sooner than this. */
const COUNTRY_RETRY_MS = 10 * 60_000;
const MSG_OFFLINE = 'Could not reach TIDAL. Check the internet connection and try again';
const MSG_EXPIRED = 'Your TIDAL sign-in is no longer valid. Sign in again.';
const MSG_REJECTED = 'TIDAL rejected this account sign-in. Check the Client ID and Redirect URI in your TIDAL developer app.';
const MSG_APP_REJECTED = 'TIDAL rejected the developer credentials. Check the Client ID and Client Secret in your TIDAL developer app.';
const MSG_SCOPE = 'TIDAL did not grant a permission this feature needs. Sign in again and approve the requested permissions.';
const MSG_RATE = 'TIDAL is rate limiting requests. Try again in a few seconds.';
const MSG_NOT_SAVED = 'TIDAL accepted the sign-in, but it could not be saved on this head unit (check that the data folder can be written to). Try again.';
const MSG_NOT_REMOVED = 'Signed out for now, but this head unit could not remove the saved TIDAL sign-in (check that the data folder can be written to); it may come back after a restart.';

interface TidalDeps {
  config: ServiceSettings;
  store: JsonStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Pause between retries (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout in milliseconds. Default 12 s. */
  timeoutMs?: number;
  /**
   * Catalog market (ISO 3166-1 alpha-2). Default: `TIDAL_COUNTRY` from the environment. Without either, the
   * country of the signed-in account is used (GET /users/me), else US.
   */
  country?: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  obtainedAt?: number;
  scope?: string;
  clientId?: string;
  /** The account's country (GET /users/me), learned once per sign-in. */
  country?: string;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

class TokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** A catalog answer that was not a success, with the HTTP status kept for the caller that wants to react to it. */
class HttpError extends LibraryError {
  constructor(
    message: string,
    code: LibraryError['code'],
    readonly status: number,
  ) {
    super(message, code);
  }
}

/** The refresh token is dead (TIDAL's own auth SDK signs the user out on these), as opposed to TIDAL being unwell. */
const isDeadRefresh = (e: TokenError) => e.code === 'invalid_grant' || e.status === 400 || e.status === 401;

/* eslint-disable @typescript-eslint/no-explicit-any */
type JsonApiResource = { id?: unknown; type?: unknown; attributes?: any; relationships?: any };

const b64url = (v: Buffer) => v.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const pkceChallenge = (v: string) => b64url(createHash('sha256').update(v).digest());
const list = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
const idOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const splitScopes = (v: string): string[] => v.split(/[\s,]+/).filter(Boolean);
const normalizeCountry = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toUpperCase() : undefined);

/** "Song" + version "Remastered 2011" -> "Song (Remastered 2011)", unless the title already says so. */
function withVersion(title: string, version: unknown): string {
  const v = typeof version === 'string' ? version.trim() : '';
  return !v || title.toLowerCase().includes(v.toLowerCase()) ? title : `${title} (${v})`;
}

function durationMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v * 1000));
  if (typeof v !== 'string') return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(v);
  if (!m) return 0;
  const seconds = Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return Math.max(0, Math.round(seconds * 1000));
}

function resources(doc: any): JsonApiResource[] {
  return [...list<JsonApiResource>(doc?.data), ...list<JsonApiResource>(doc?.included)].filter((x) => x && typeof x === 'object');
}

function resourceMap(doc: any): Map<string, JsonApiResource> {
  const out = new Map<string, JsonApiResource>();
  for (const r of resources(doc)) {
    const id = idOf(r.id);
    const type = idOf(r.type);
    if (id && type) out.set(`${type}:${id}`, r);
  }
  return out;
}

function relationRefs(r: JsonApiResource | undefined, name: string): Array<{ type: string; id: string }> {
  const data = r?.relationships?.[name]?.data;
  return list<any>(data)
    .map((x) => ({ type: idOf(x?.type), id: idOf(x?.id) }))
    .filter((x) => x.type && x.id);
}

function artworkUrl(r: JsonApiResource | undefined, map: Map<string, JsonApiResource>): string | undefined {
  const refs = [...relationRefs(r, 'coverArt'), ...relationRefs(r, 'profileArt'), ...relationRefs(r, 'thumbnailArt')];
  const files = refs.flatMap((ref) => list<any>(map.get(`${ref.type}:${ref.id}`)?.attributes?.files));
  // The spec's Artwork_File is { href, meta: { width, height } }.
  const candidates = files
    .map((x) => ({ href: typeof x?.href === 'string' ? x.href : '', width: Number(x?.meta?.width ?? x?.width ?? 0) || 0 }))
    .filter((x) => x.href);
  const sized = candidates.filter((x) => x.width > 0);
  if (!sized.length) return candidates[0]?.href; // no sizes given: keep TIDAL's own order
  const big = sized.filter((x) => x.width >= ARTWORK_MIN_WIDTH);
  const pool = big.length ? big : sized;
  return pool.reduce((best, x) => ((big.length ? x.width < best.width : x.width > best.width) ? x : best)).href;
}

/** Does a relationship carry its linkage (`data`), with every linked resource present together with its attributes? */
function linked(r: JsonApiResource | undefined, name: string, map: Map<string, JsonApiResource>): boolean {
  if (r?.relationships?.[name]?.data === undefined) return false;
  return relationRefs(r, name).every((ref) => map.get(`${ref.type}:${ref.id}`)?.attributes);
}

/**
 * Does this resource, as returned inside a search document, hold everything the Music page shows (titles, artist
 * names, album, artwork)? If not it is fetched by id as before, so a thinner answer only costs the old requests.
 */
function carries(r: JsonApiResource, map: Map<string, JsonApiResource>): boolean {
  const a = r.attributes;
  if (!a) return false;
  switch (r.type) {
    case 'tracks':
      return (
        typeof a.title === 'string' &&
        linked(r, 'artists', map) &&
        linked(r, 'albums', map) &&
        relationRefs(r, 'albums').every((ref) => linked(map.get(`${ref.type}:${ref.id}`), 'coverArt', map))
      );
    case 'albums':
      return typeof a.title === 'string' && linked(r, 'artists', map) && linked(r, 'coverArt', map);
    case 'artists':
      return typeof a.name === 'string' && linked(r, 'profileArt', map);
    case 'playlists':
      return typeof a.name === 'string' && linked(r, 'coverArt', map);
    default:
      return false;
  }
}

function namesFor(r: JsonApiResource | undefined, rel: string, map: Map<string, JsonApiResource>): string {
  return relationRefs(r, rel)
    .map((ref) => map.get(`${ref.type}:${ref.id}`)?.attributes?.name)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(', ');
}

function trackOf(r: JsonApiResource, map: Map<string, JsonApiResource>): CatalogTrack | null {
  if (r.type !== 'tracks') return null;
  const id = idOf(r.id);
  if (!id) return null;
  const a = r.attributes ?? {};
  const albumRef = relationRefs(r, 'albums')[0];
  const album = albumRef ? map.get(`${albumRef.type}:${albumRef.id}`) : undefined;
  // `availability` is deprecated in the spec but still sent: when it lists usages and STREAM is not one of them,
  // the track cannot be played here. Absent or empty = unknown, which stays "playable" as before.
  const usage = Array.isArray(a.availability) ? a.availability : [];
  return {
    id,
    uri: `tidal:track:${id}`,
    title: typeof a.title === 'string' ? withVersion(a.title, a.version) : 'Unknown track',
    artist: namesFor(r, 'artists', map) || 'TIDAL',
    album: typeof album?.attributes?.title === 'string' ? withVersion(album.attributes.title, album.attributes.version) : '',
    artUrl: artworkUrl(album ?? r, map),
    durationMs: durationMs(a.duration),
    explicit: typeof a.explicit === 'boolean' ? a.explicit : undefined,
    playable: !(usage.length > 0 && !usage.includes('STREAM')),
  };
}

function itemOf(r: JsonApiResource, map: Map<string, JsonApiResource>): CatalogItem | null {
  const id = idOf(r.id);
  const type = idOf(r.type);
  if (!id || !['albums', 'artists', 'playlists'].includes(type)) return null;
  const a = r.attributes ?? {};
  const kind: CatalogItem['type'] = type === 'albums' ? 'album' : type === 'artists' ? 'artist' : 'playlist';
  const name =
    typeof a.name === 'string'
      ? a.name
      : typeof a.title === 'string'
        ? kind === 'album'
          ? withVersion(a.title, a.version)
          : a.title
        : kind === 'artist'
          ? 'Unknown artist'
          : 'Untitled';
  const subtitle = kind === 'album' ? namesFor(r, 'artists', map) : undefined;
  const count = Number(a.numberOfItems ?? a.numberOfTracks ?? 0);
  return {
    id,
    uri: `tidal:${kind}:${id}`,
    type: kind,
    name,
    ...(subtitle ? { subtitle } : {}),
    ...(Number.isFinite(count) && count > 0 ? { trackCount: count } : {}),
    ...(artworkUrl(r, map) ? { artUrl: artworkUrl(r, map) } : {}),
  };
}

function idsFromSearch(doc: any, relationship: string, type: string): string[] {
  const root = list<JsonApiResource>(doc?.data)[0];
  const linked = relationRefs(root, relationship).filter((x) => x.type === type).map((x) => x.id);
  if (linked.length) return linked;
  return resources(doc)
    .filter((r) => r.type === type)
    .map((r) => idOf(r.id))
    .filter(Boolean);
}

async function readApiError(res: Response): Promise<string> {
  try {
    const j = (await res.clone().json()) as any;
    const first = Array.isArray(j?.errors) ? j.errors[0] : undefined;
    const text = first?.detail ?? first?.title ?? j?.error_description ?? j?.error;
    return typeof text === 'string' ? text.slice(0, 240) : '';
  } catch {
    return '';
  }
}

export function createTidalMedia(deps: TidalDeps): MusicServiceProvider {
  const { config, store } = deps;
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const scopes = config.scopes.trim() || TIDAL_DEFAULT_SCOPES;
  const requestedScopes = splitScopes(scopes);
  /** user.read was the original built-in scope. `playback` is new for the native player, so an older sign-in that lacks it must be prompted to sign in again. */
  const baselineScopes = new Set(['user.read']);
  const explicitCountry = normalizeCountry(deps.country) ?? normalizeCountry(process.env.TIDAL_COUNTRY);

  let tokens: Tokens | null = null;
  let loading: Promise<void> | null = null;
  let refreshing: Promise<void> | null = null;
  let appToken: { accessToken: string; expiresAt: number } | null = null;
  let appTokenLoading: Promise<string> | null = null;
  let problem: { kind: ConnectionProblem; message: string } | null = null;
  const pending = new Map<string, { verifier: string; expires: number }>();
  /** Counts sign-outs, so a sign-in that was still being finished when Sign out was pressed can be dropped. */
  let signOuts = 0;
  const finishing = new Set<string>();
  /** Changes whenever the signed-in account changes (sign-out, new sign-in, dead sign-in). */
  let account = 0;
  let countryRetryAt = 0;
  let countryLookup: Promise<void> | null = null;
  /** Nested `include` paths on /searchResults are inferred from other endpoints; flipped off if TIDAL refuses them. */
  let nestedSearchInclude = true;

  const state = new Observable<MediaState>({
    provider: 'tidal',
    status: 'ready',
    playing: false,
    track: null,
    progressMs: 0,
    progressTs: now(),
    volume: 70,
    shuffle: false,
    repeat: 'off',
  });

  function loadTokens(): Promise<void> {
    return (loading ??= (async () => {
      const raw = (await store.read(TOKEN_FILE)) as Partial<Tokens> | null;
      if (raw?.accessToken && raw.refreshToken && typeof raw.expiresAt === 'number' && (!raw.clientId || raw.clientId === config.clientId)) {
        tokens = {
          accessToken: raw.accessToken,
          refreshToken: raw.refreshToken,
          expiresAt: raw.expiresAt,
          obtainedAt: typeof raw.obtainedAt === 'number' ? raw.obtainedAt : undefined,
          scope: typeof raw.scope === 'string' ? raw.scope : undefined,
          clientId: raw.clientId,
          country: normalizeCountry(raw.country),
        };
      }
    })());
  }
  void loadTokens();

  /**
   * Remember `t` (or forget with null). The session always switches to it; `strict` makes a failed write an error the
   * user is told about (a sign-in or sign-out that silently does not survive a restart), otherwise it is only logged.
   */
  async function saveTokens(t: Tokens | null, strict = false) {
    tokens = t && { ...t, clientId: config.clientId };
    await persistTokens(strict);
  }

  /** Write the current `tokens` (without replacing the object: a refresh in flight recognises its own sign-in by it). */
  async function persistTokens(strict = false) {
    const saving = tokens;
    try {
      await (typeof store.writeOrThrow === 'function' ? store.writeOrThrow(TOKEN_FILE, saving) : store.write(TOKEN_FILE, saving));
    } catch (err) {
      console.error('[tidal] could not save the sign-in', err);
      if (strict) throw new Error(saving ? MSG_NOT_SAVED : MSG_NOT_REMOVED);
    }
  }

  function forgetAccount() {
    account++;
    countryRetryAt = 0;
  }

  async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await f(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: config.clientId, ...params }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        break;
      } catch (err) {
        // Retry a DNS or connection-establishment error only. An authorization
        // code is one-use, so never blindly retry a request after it was sent.
        if (attempt === 0 && retryableSpotifyConnection(err)) {
          await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(650);
          continue;
        }
        throw new LibraryError(oauthNetworkFailure('TIDAL', err), 'unavailable');
      }
    }
    if (!res.ok) {
      let code: string | undefined;
      try {
        const j = (await res.json()) as any;
        if (typeof j?.error === 'string') code = j.error;
      } catch {
        // status is enough
      }
      throw new TokenError(`TIDAL sign-in was refused (${res.status}${code ? ` ${code}` : ''})`, res.status, code);
    }
    let j: any;
    try {
      j = await res.json();
    } catch {
      throw new TokenError('TIDAL returned an unreadable sign-in response', 502);
    }
    if (typeof j?.access_token !== 'string' || !j.access_token) throw new TokenError('TIDAL returned an incomplete sign-in response', 502);
    return {
      accessToken: j.access_token,
      refreshToken: typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : undefined,
      expiresIn: typeof j.expires_in === 'number' ? j.expires_in : 3600,
      scope: typeof j.scope === 'string' ? j.scope : undefined,
    };
  }

  /** What a failed refresh means for the caller. Never a raw TypeError or TokenError: the routes only understand LibraryError. */
  function refreshFailure(e: unknown): LibraryError {
    if (e instanceof LibraryError) return e;
    if (e instanceof TokenError) {
      if (e.status === 429) return new LibraryError(MSG_RATE, 'rate');
      return new LibraryError(`Could not reach TIDAL right now (${e.status}). Try again in a moment.`, 'unavailable');
    }
    return new LibraryError(MSG_OFFLINE, 'unavailable');
  }

  function refresh(): Promise<void> {
    if (refreshing) return refreshing;
    const run = (async () => {
      const cur = tokens;
      if (!cur) return;
      let r: TokenResponse;
      try {
        r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cur.refreshToken });
      } catch (e) {
        // Signed out (or in again) while TIDAL was thinking: whatever it says is about a sign-in nobody has any more.
        if (tokens !== cur) return;
        if (e instanceof TokenError && isDeadRefresh(e)) {
          problem = { kind: 'login-expired', message: MSG_EXPIRED };
          forgetAccount();
          await saveTokens(null);
          state.update({ status: 'ready', playing: false, error: undefined });
          return;
        }
        throw refreshFailure(e);
      }
      if (tokens !== cur) return; // same: do not bring a signed-out (or replaced) sign-in back
      await saveTokens({
        accessToken: r.accessToken,
        refreshToken: r.refreshToken ?? cur.refreshToken,
        expiresAt: now() + r.expiresIn * 1000,
        obtainedAt: cur.obtainedAt,
        scope: r.scope ?? cur.scope,
        country: cur.country,
      });
    })();
    refreshing = run;
    const done = () => {
      if (refreshing === run) refreshing = null;
    };
    run.then(done, done);
    return run;
  }

  async function userAccessToken(force = false): Promise<string | null> {
    await loadTokens();
    if (!tokens || problem?.kind === 'rejected') return null;
    if (force || tokens.expiresAt - now() < 60_000) await refresh();
    return tokens?.accessToken ?? null;
  }

  async function appAccessToken(force = false): Promise<string> {
    const secret = config.clientSecret?.trim() ?? '';
    if (!secret) throw new LibraryError('Add your TIDAL Client Secret in Music settings first.', 'auth');
    if (!force && appToken && appToken.expiresAt - now() >= 60_000) return appToken.accessToken;
    if (!force && appTokenLoading) return appTokenLoading;

    const run = (async () => {
      let res: Response;
      try {
        res = await f(TOKEN_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${secret}`, 'utf8').toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ grant_type: 'client_credentials' }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new LibraryError(MSG_OFFLINE, 'unavailable');
      }
      if (!res.ok) {
        const detail = await readApiError(res);
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new LibraryError(detail ? `${MSG_APP_REJECTED} TIDAL says: ${detail}` : MSG_APP_REJECTED, 'auth');
        }
        throw new LibraryError(detail ? `TIDAL token error ${res.status}: ${detail}` : `TIDAL token service answered with an error (${res.status})`, 'unavailable');
      }
      let j: any;
      try {
        j = await res.json();
      } catch {
        throw new LibraryError('TIDAL returned an incomplete catalog token.', 'unavailable');
      }
      if (typeof j?.access_token !== 'string' || !j.access_token) throw new LibraryError('TIDAL returned an incomplete catalog token.', 'unavailable');
      appToken = {
        accessToken: j.access_token,
        expiresAt: now() + (typeof j.expires_in === 'number' ? j.expires_in : 3600) * 1000,
      };
      return appToken.accessToken;
    })();
    appTokenLoading = run;
    try {
      return await run;
    } finally {
      if (appTokenLoading === run) appTokenLoading = null;
    }
  }

  type AuthMode = 'app' | 'user';
  interface ApiOptions {
    /** Per-request timeout; default is the provider's. */
    timeoutMs?: number;
    /** Set false for best-effort calls: no retries on 429/5xx. */
    retry?: boolean;
    /** Best-effort account call: never refreshes the sign-in and never marks it expired, whatever the answer. */
    passive?: boolean;
  }

  /** Seconds, or an HTTP date, from a Retry-After header, as milliseconds from now. */
  function retryAfterMs(header: string | null): number | null {
    const h = header?.trim();
    if (!h) return null;
    if (/^\d+(\.\d+)?$/.test(h)) return Math.round(Number(h) * 1000);
    const at = Date.parse(h);
    return Number.isNaN(at) ? null : Math.max(0, at - now());
  }

  /**
   * One request, with a timeout. A GET that met 429 is repeated up to twice (after Retry-After, or 1 s then 2 s;
   * never more than 5 s, a longer ask is reported instead of hammering) and one that met a 5xx once. Anything that
   * is not a GET is sent exactly once.
   */
  async function send(method: string, path: string, body: unknown, token: string, opts: ApiOptions): Promise<Response> {
    const repeatable = method === 'GET' && opts.retry !== false;
    let rate = 0;
    let server = 0;
    for (;;) {
      let res: Response;
      try {
        res = await f(`${API_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.api+json',
            ...(body !== undefined ? { 'Content-Type': 'application/vnd.api+json', 'Idempotency-Key': randomUUID() } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutMs),
        });
      } catch {
        throw new LibraryError(MSG_OFFLINE, 'unavailable');
      }
      if (repeatable && res.status === 429 && rate < MAX_RATE_RETRIES) {
        const wait = retryAfterMs(res.headers.get('retry-after')) ?? 1000 * 2 ** rate;
        if (wait <= MAX_RETRY_WAIT_MS) {
          rate++;
          void res.body?.cancel().catch(() => undefined);
          await sleep(wait);
          continue;
        }
      } else if (repeatable && res.status >= 500 && server < MAX_SERVER_RETRIES) {
        server++;
        void res.body?.cancel().catch(() => undefined);
        await sleep(SERVER_RETRY_MS);
        continue;
      }
      return res;
    }
  }

  async function api(method: string, path: string, body?: unknown, authMode: AuthMode = 'app', opts: ApiOptions = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = authMode === 'app' ? await appAccessToken(attempt === 1) : await userAccessToken(attempt === 1);
      if (!token) throw new LibraryError(problem?.message ?? 'Sign in to TIDAL for this account feature first', 'auth');
      const res = await send(method, path, body, token, opts);
      if (res.status === 401 && opts.passive) throw new LibraryError(MSG_EXPIRED, 'auth');
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 401) {
        if (authMode === 'user') {
          problem = { kind: 'login-expired', message: MSG_EXPIRED };
          throw new LibraryError(MSG_EXPIRED, 'auth');
        }
        appToken = null;
        throw new LibraryError(MSG_APP_REJECTED, 'auth');
      }
      if (res.status === 403) {
        const detail = await readApiError(res);
        // The only account-mode calls are the optional collection endpoints and /users/me; a 403 there is not a broken
        // sign-in, so it must not mark the connection card. Missing permissions are reported from the grant instead.
        if (authMode === 'user') throw new LibraryError(detail ? `${MSG_SCOPE} TIDAL says: ${detail}` : MSG_SCOPE, 'scope');
        throw new LibraryError(detail ? `TIDAL denied catalog access: ${detail}` : 'TIDAL denied catalog access for this developer app.', 'scope');
      }
      if (res.status === 429) throw new LibraryError(MSG_RATE, 'rate');
      if (!res.ok) {
        const detail = await readApiError(res);
        throw new HttpError(detail ? `TIDAL error ${res.status}: ${detail}` : `TIDAL answered with an error (${res.status})`, 'unavailable', res.status);
      }
      // The account works: an earlier "login expired" that was only an API 401 is over.
      if (authMode === 'user' && problem?.kind === 'login-expired') problem = null;
      return res;
    }
    throw new LibraryError(authMode === 'app' ? MSG_APP_REJECTED : MSG_EXPIRED, 'auth');
  }

  async function json(method: string, path: string, body?: unknown, authMode: AuthMode = 'app', opts: ApiOptions = {}): Promise<any> {
    const res = await api(method, path, body, authMode, opts);
    try {
      return await res.json();
    } catch {
      throw new LibraryError('TIDAL sent an unreadable response', 'unavailable');
    }
  }

  const query = (pairs: Array<[string, string]>) => {
    const q = new URLSearchParams();
    for (const [k, v] of pairs) q.append(k, v);
    return q.toString();
  };
  const withQuery = (path: string, pairs: Array<[string, string]>) => (pairs.length ? `${path}?${query(pairs)}` : path);

  // ---- Market -------------------------------------------------------------------------------------------------------

  /**
   * Best effort: the signed-in account's country, kept with the sign-in. Never refreshes a token for this and
   * never marks the sign-in expired; any failure is ignored (and not retried for a while).
   */
  async function lookupAccountCountry(): Promise<void> {
    const mine = account;
    try {
      const doc = await json('GET', '/users/me', undefined, 'user', { timeoutMs: Math.min(timeoutMs, LOOKUP_TIMEOUT_MS), retry: false, passive: true });
      if (account !== mine || !tokens) return;
      const country = normalizeCountry(doc?.data?.attributes?.country);
      if (!country) {
        countryRetryAt = now() + COUNTRY_RETRY_MS;
        return;
      }
      tokens.country = country;
      await persistTokens();
    } catch (e) {
      if (account !== mine) return;
      // Without the permission it will not start working until the next sign-in; anything else may be a bad moment.
      countryRetryAt = e instanceof LibraryError && e.code === 'scope' ? Infinity : now() + COUNTRY_RETRY_MS;
    }
  }

  /**
   * The catalog market: the explicit setting (TIDAL_COUNTRY), else the signed-in account's country, else US. The
   * account lookup only happens while the saved access token is still good, so a search never triggers a refresh.
   */
  async function market(): Promise<string> {
    if (explicitCountry) return explicitCountry;
    await loadTokens();
    if (tokens && !tokens.country && now() >= countryRetryAt && tokens.expiresAt - now() >= 60_000) {
      countryLookup ??= lookupAccountCountry().finally(() => {
        countryLookup = null;
      });
      await countryLookup;
    }
    return tokens?.country ?? DEFAULT_COUNTRY;
  }

  // ---- Catalog ------------------------------------------------------------------------------------------------------

  type CatalogType = 'tracks' | 'albums' | 'artists' | 'playlists';

  async function fetchTyped(type: CatalogType, ids: string[]): Promise<{ rows: JsonApiResource[]; map: Map<string, JsonApiResource> }> {
    const unique = [...new Set(ids)].filter(Boolean);
    const map = new Map<string, JsonApiResource>();
    const byId = new Map<string, JsonApiResource>();
    const include =
      type === 'tracks'
        ? 'artists,albums,albums.coverArt'
        : type === 'albums'
          ? 'artists,coverArt'
          : type === 'artists'
            ? 'profileArt'
            : 'coverArt';
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const pairs: Array<[string, string]> = [
        ['countryCode', await market()],
        ['include', include],
        ['filter[id]', unique.slice(i, i + ID_CHUNK).join(',')],
      ];
      const doc = await json('GET', `/${type}?${query(pairs)}`);
      for (const [key, r] of resourceMap(doc)) map.set(key, r);
      for (const r of list<JsonApiResource>(doc?.data)) if (r?.type === type) byId.set(idOf(r.id), r);
    }
    return { rows: unique.map((id) => byId.get(id)).filter((r): r is JsonApiResource => !!r), map };
  }

  async function tracksByIds(ids: string[]): Promise<CatalogTrack[]> {
    const d = await fetchTyped('tracks', ids);
    return d.rows.map((r) => trackOf(r, d.map)).filter((x): x is CatalogTrack => !!x);
  }

  async function itemsByIds(type: 'albums' | 'artists' | 'playlists', ids: string[]): Promise<CatalogItem[]> {
    const d = await fetchTyped(type, ids);
    return d.rows.map((r) => itemOf(r, d.map)).filter((x): x is CatalogItem => !!x);
  }

  /** The `page[cursor]` of the next page: `links.meta.nextCursor`, else the one inside `links.next`. */
  function nextCursor(doc: any): string | undefined {
    const meta = doc?.links?.meta?.nextCursor;
    if (typeof meta === 'string' && meta) return meta;
    const next = doc?.links?.next;
    if (typeof next !== 'string' || !next) return undefined;
    try {
      return new URL(next, 'https://openapi.tidal.com').searchParams.get('page[cursor]') || undefined;
    } catch {
      return undefined;
    }
  }

  /** Ids of one relationship, following the cursor up to PAGE_CAP pages / ITEM_CAP ids. */
  async function relationshipIds(path: string, wantedType: string, authMode: AuthMode, extra: { country: boolean; sort?: string }): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_CAP && ids.length < ITEM_CAP; page++) {
      const pairs: Array<[string, string]> = [];
      if (extra.country) pairs.push(['countryCode', await market()]);
      if (extra.sort) pairs.push(['sort', extra.sort]);
      if (cursor) pairs.push(['page[cursor]', cursor]);
      const doc = await json('GET', withQuery(path, pairs), undefined, authMode);
      for (const x of list<any>(doc?.data)) if (x?.type === wantedType && typeof x?.id === 'string') ids.push(x.id as string);
      cursor = nextCursor(doc);
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return ids.slice(0, ITEM_CAP);
  }

  // The spec lists `sort=addedAt` and `locale` (not `countryCode`) for the personal collections.
  const collectionIds = (path: string, wantedType: string) => relationshipIds(path, wantedType, 'user', { country: false, sort: '-addedAt' });

  async function publicListing(kind: 'playlist' | 'album', id: string): Promise<TrackListing> {
    const type = kind === 'playlist' ? 'playlists' : 'albums';
    const itemRows = await itemsByIds(type, [id]);
    const item = itemRows[0] ?? { id, uri: `tidal:${kind}:${id}`, type: kind, name: kind === 'album' ? 'Album' : 'Playlist' };
    const ids = await relationshipIds(`/${type}/${encodeURIComponent(id)}/relationships/items`, 'tracks', 'app', { country: true });
    const tracks = await tracksByIds(ids);
    return { item, tracks };
  }

  const SEARCH_INCLUDE = 'tracks,albums,artists,playlists';
  const SEARCH_INCLUDE_NESTED = [
    'tracks,tracks.artists,tracks.albums,tracks.albums.coverArt',
    'albums,albums.artists,albums.coverArt',
    'artists,artists.profileArt',
    'playlists,playlists.coverArt',
  ].join(',');

  async function searchDocument(q: string, country: string): Promise<any> {
    const at = (include: string) =>
      `/searchResults?${query([
        ['filter[query]', q],
        ['countryCode', country],
        ['deviceType', 'CAR'],
        ['systemType', 'WEB'],
        ['include', include],
      ])}`;
    if (nestedSearchInclude) {
      try {
        return await json('GET', at(SEARCH_INCLUDE_NESTED));
      } catch (e) {
        // Only an answer from TIDAL that says "no" (400, 404, 422, 5xx ...) can be about the include list; refused
        // credentials, rate limits and being offline would be the same for the plain request.
        if (!(e instanceof HttpError)) throw e;
      }
      // TIDAL did not like the nested include (or the query). The plain list is what worked before; only give up on
      // the nested one if the plain one gets through.
      const plain = await json('GET', at(SEARCH_INCLUDE));
      nestedSearchInclude = false;
      return plain;
    }
    return json('GET', at(SEARCH_INCLUDE));
  }

  /** Build the rows for `ids` from what the search document already carries; fetch only the rest by id. */
  async function resolveFrom<T>(type: CatalogType, ids: string[], map: Map<string, JsonApiResource>, make: (r: JsonApiResource, m: Map<string, JsonApiResource>) => T | null): Promise<T[]> {
    const wanted = [...new Set(ids)].filter(Boolean);
    const built = new Map<string, T>();
    const missing: string[] = [];
    for (const id of wanted) {
      const r = map.get(`${type}:${id}`);
      const row = r && carries(r, map) ? make(r, map) : null;
      if (row) built.set(id, row);
      else missing.push(id);
    }
    if (missing.length) {
      const d = await fetchTyped(type, missing);
      for (const r of d.rows) {
        const row = make(r, d.map);
        if (row) built.set(idOf(r.id), row);
      }
    }
    return wanted.map((id) => built.get(id)).filter((x): x is T => x !== undefined);
  }

  const library: LibraryProvider = {
    async home() {
      return { recent: [], topTracks: [], topArtists: [], playlists: [] };
    },
    async playlists() {
      // The personal collections need permissions (collection.read ...) that the developer app may not have; keep the
      // integration usable instead of turning the whole Music page into a 403.
      try {
        const ids = await collectionIds('/userCollectionPlaylists/me/relationships/items', 'playlists');
        return await itemsByIds('playlists', ids);
      } catch (e) {
        if (e instanceof LibraryError && (e.code === 'scope' || e.code === 'auth')) return [];
        throw e;
      }
    },
    async liked() {
      try {
        const ids = await collectionIds('/userCollectionTracks/me/relationships/items', 'tracks');
        return await tracksByIds(ids);
      } catch (e) {
        if (e instanceof LibraryError && (e.code === 'scope' || e.code === 'auth')) return [];
        throw e;
      }
    },
    async albums() {
      try {
        const ids = await collectionIds('/userCollectionAlbums/me/relationships/items', 'albums');
        return await itemsByIds('albums', ids);
      } catch (e) {
        if (e instanceof LibraryError && (e.code === 'scope' || e.code === 'auth')) return [];
        throw e;
      }
    },
    async artists() {
      try {
        const ids = await collectionIds('/userCollectionArtists/me/relationships/items', 'artists');
        return await itemsByIds('artists', ids);
      } catch (e) {
        if (e instanceof LibraryError && (e.code === 'scope' || e.code === 'auth')) return [];
        throw e;
      }
    },
    async search(text): Promise<SearchResults> {
      const q = text.trim();
      if (!q) return { tracks: [], albums: [], artists: [], playlists: [] };
      const doc = await searchDocument(q, await market());
      const map = resourceMap(doc);
      const trackIds = idsFromSearch(doc, 'tracks', 'tracks').slice(0, 12);
      const albumIds = idsFromSearch(doc, 'albums', 'albums').slice(0, 8);
      const artistIds = idsFromSearch(doc, 'artists', 'artists').slice(0, 8);
      const playlistIds = idsFromSearch(doc, 'playlists', 'playlists').slice(0, 8);
      // Anything the search did not carry is fetched by id. Sequential on purpose: TIDAL applies fairly tight development rate limits.
      const tracks = await resolveFrom('tracks', trackIds, map, trackOf);
      const albums = await resolveFrom('albums', albumIds, map, itemOf);
      const artists = await resolveFrom('artists', artistIds, map, itemOf);
      const playlists = await resolveFrom('playlists', playlistIds, map, itemOf);
      return { tracks, albums, artists, playlists };
    },
    playlist: (id) => publicListing('playlist', id),
    album: (id) => publicListing('album', id),
    async queue() {
      return { current: null, next: [] };
    },
    async devices(): Promise<ConnectDevice[]> {
      return [{ id: 'tidal-web-sdk', name: 'RPI Headunit', type: 'browser', active: true }];
    },
    async transfer() {
      // TIDAL Connect is a separate partner/device programme; playback for this build stays in the native head-unit Web SDK player.
    },
    async setLiked() {
      throw new LibraryError('Saving tracks is not available to ordinary TIDAL third-party apps yet.', 'scope');
    },
  };

  async function finishLogin(code: string, st: string) {
    const p = pending.get(st);
    if (!p || p.expires < now()) throw new Error('Login expired or invalid state — try again');
    if (finishing.has(st)) throw new Error('Sign-in is already being processed — please wait.');
    finishing.add(st);
    try {
      const outsBefore = signOuts;
      let r: TokenResponse;
      try {
        r = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: p.verifier });
      } catch (e) {
        if (e instanceof TokenError) {
          pending.delete(st); // A definitive response consumed or rejected the one-use code.
          if (e.code === 'invalid_client') {
            problem = { kind: 'rejected', message: MSG_REJECTED };
            throw new Error(MSG_REJECTED);
          }
          if (e.status >= 500) throw new Error('TIDAL had a problem answering. Start a new sign-in in a moment.');
          throw new Error(`TIDAL did not accept the sign-in (${e.code ?? e.status}). Check the Redirect URI and start again.`);
        }
        // Preserve the pending PKCE state after transport failures. The same
        // callback can be retried while the authorization code is still valid.
        if (e instanceof LibraryError) throw new Error(e.message);
        throw new Error(MSG_OFFLINE);
      }
      pending.delete(st); // Exchanged successfully, no replay permitted.
      if (signOuts !== outsBefore) throw new Error('Sign-in was cancelled by a sign-out. Start the sign-in again if you still want it.');
      if (!r.refreshToken) throw new Error('TIDAL did not return a refresh token. Start the sign-in again.');
      const previous = tokens;
      try {
        await saveTokens(
          {
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
            expiresAt: now() + r.expiresIn * 1000,
            obtainedAt: now(),
            scope: r.scope,
          },
          true,
        );
      } catch (e) {
        tokens = previous;
        throw e;
      }
      forgetAccount();
      problem = null;
      state.update({ status: 'ready', error: undefined });
    } finally {
      finishing.delete(st);
    }
  }

  async function command(c: MediaCommand) {
    // Playback is handled by TIDAL's official Web Player SDK in the local Chromium UI. We still keep
    // volume in the shared state so dashboard widgets do not jump when switching services.
    if (c.cmd === 'volume') state.update({ volume: Math.max(0, Math.min(100, c.volume)) });
  }

  /**
   * TIDAL's Web Player must authenticate from the browser that owns the audio element. Only the local kiosk can call
   * the HTTP route that exposes this bundle. No Client Secret or refresh token ever leaves the Node process.
   *
   * A signed-in user's short-lived access token is preferred because it is the only public route that can possibly
   * carry a higher playback entitlement. Client Credentials are also returned as a preview fallback.
   */
  async function playerCredentials(): Promise<TidalPlayerCredentialBundle> {
    const app = async (): Promise<TidalPlayerCredential> => {
      const accessToken = await appAccessToken();
      return {
        clientId: config.clientId,
        accessToken,
        expiresAt: appToken?.expiresAt ?? now() + 55 * 60_000,
        scopes: [],
        source: 'client',
      };
    };

    try {
      const accessToken = await userAccessToken();
      if (accessToken && tokens) {
        return {
          primary: {
            clientId: config.clientId,
            accessToken,
            expiresAt: tokens.expiresAt,
            scopes: splitScopes(tokens.scope ?? scopes),
            source: 'user',
          },
          fallback: await app(),
        };
      }
    } catch (err) {
      // Account refresh trouble must not take developer-preview playback down with it.
      console.warn('[tidal] account token was unavailable for player; using app preview credentials', err);
    }
    return { primary: await app() };
  }

  /** Permissions the user asked for (beyond the built-in default) that the saved sign-in was not granted. */
  function missingScopes(t: Tokens): string[] {
    if (!t.scope) return []; // the grant is unknown: nothing to compare
    const granted = new Set(splitScopes(t.scope));
    return requestedScopes.filter((s) => !baselineScopes.has(s) && !granted.has(s));
  }

  return {
    state,
    library,
    command,
    playerCredentials,
    start() {
      void loadTokens().then(() => state.update({ status: 'ready', error: undefined }));
    },
    stop() {},

    beginLogin() {
      const verifier = b64url(randomBytes(64));
      const st = b64url(randomBytes(16));
      for (const [key, p] of pending) if (p.expires < now()) pending.delete(key);
      pending.set(st, { verifier, expires: now() + 10 * 60_000 });
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: scopes,
        state: st,
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge(verifier),
      });
      return `${AUTH_URL}?${q}`;
    },

    finishLogin,

    async finishLoginFromPaste(text) {
      const { code, state: st } = parsePastedLogin(text, 'TIDAL');
      await finishLogin(code, st);
    },

    async logout() {
      pending.clear();
      problem = null;
      signOuts++;
      forgetAccount();
      try {
        await saveTokens(null, true);
      } finally {
        state.update({ status: 'ready', playing: false, track: null, error: undefined });
      }
    },

    connection(): ServiceAuthInfo {
      const connected = tokens !== null && problem?.kind !== 'login-expired' && problem?.kind !== 'rejected';
      const t = connected ? tokens : null;
      const gap = t ? missingScopes(t) : [];
      const shown =
        problem ??
        (gap.length
          ? {
              kind: 'permissions' as const,
              message: `Sign in again to grant: ${gap.join(', ')}. If this keeps showing, switch these permissions on for your app in the TIDAL developer dashboard.`,
            }
          : null);
      return {
        connected,
        loginPending: [...pending.values()].some((p) => p.expires >= now()),
        ...(shown ? { problem: shown.kind, message: shown.message } : {}),
        ...(t?.obtainedAt !== undefined ? { connectedAt: t.obtainedAt } : {}),
        ...(t?.scope ? { scopes: t.scope.split(/\s+/).filter(Boolean) } : {}),
      };
    },

    async test(): Promise<TestConnectionResult> {
      try {
        const doc = await json(
          'GET',
          `/searchResults?${query([
            ['filter[query]', 'TIDAL'],
            ['countryCode', explicitCountry ?? tokens?.country ?? DEFAULT_COUNTRY],
            ['deviceType', 'CAR'],
            ['systemType', 'WEB'],
            ['include', 'tracks'],
          ])}`,
        );
        const n = idsFromSearch(doc, 'tracks', 'tracks').length;
        return { ok: true, message: `TIDAL catalog connected — Client Credentials accepted${n ? `; search returned ${n} result${n === 1 ? '' : 's'}` : ''}` };
      } catch (e) {
        if (e instanceof LibraryError) return { ok: false, message: e.message };
        return { ok: false, message: `${MSG_OFFLINE}.` };
      }
    },
  };
}
