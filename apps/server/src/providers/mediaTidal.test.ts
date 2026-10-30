import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryError } from '../library/library';
import type { JsonStore } from '../store';
import { createTidalMedia, TIDAL_DEFAULT_SCOPES } from './mediaTidal';

// ---------------------------------------------------------------------------------------------------------------
// Test rig: a fake fetch, a fake clock and an in-memory stand-in for JsonStore. Nothing here touches the network.
// Fixtures are shaped like the v2 OpenAPI types (tidal-music/api 0.50.0): attributes.files[] = {href, meta:{width,height}},
// ISO-8601 durations, links.meta.nextCursor, resources linked through relationships.<name>.data.
// ---------------------------------------------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const CID = 'tidalClient123';
const SECRET = 'sup3r-secret-value';
const REDIRECT = 'http://127.0.0.1:8787/auth/tidal/callback';
const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';

class MemStore {
  files = new Map<string, unknown>();
  failWrites = false;
  async read(name: string): Promise<unknown> {
    return this.files.has(name) ? structuredClone(this.files.get(name)) : null;
  }
  async writeOrThrow(name: string, value: unknown): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.files.set(name, structuredClone(value));
  }
  async write(name: string, value: unknown): Promise<void> {
    await this.writeOrThrow(name, value).catch(() => undefined);
  }
  async flush(): Promise<void> {}
}

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  form?: URLSearchParams;
  body?: string;
  signal?: AbortSignal;
}

function fakeFetch(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const body = init.body;
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string> | undefined) },
      ...(body instanceof URLSearchParams ? { form: body } : {}),
      ...(typeof body === 'string' ? { body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const j = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/vnd.api+json', ...headers } });
const isToken = (c: Call) => c.url.href.split('?')[0] === TOKEN_URL;
const isApi = (c: Call) => c.url.origin === 'https://openapi.tidal.com';
const apiPath = (c: Call) => c.url.pathname.replace(/^\/v2/, '');
const apiCalls = (calls: Call[]) => calls.filter(isApi);
const b64url = (b: Buffer) => b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const tick = () => new Promise<void>((r) => setImmediate(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RigOptions {
  scopes?: string;
  clientSecret?: string | null;
  timeoutMs?: number;
  country?: string;
  tokens?: Partial<Record<string, unknown>> | false;
}

function rig(handler: (c: Call, n: number) => Response | Promise<Response>, opts: RigOptions = {}) {
  const store = new MemStore();
  if (opts.tokens !== false) {
    store.files.set('tidal.json', {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: T0 + 3_600_000,
      obtainedAt: T0 - 1_000,
      scope: 'user.read playback',
      clientId: CID,
      ...opts.tokens,
    });
  }
  const clock = { t: T0 };
  const sleeps: number[] = [];
  const { fn, calls } = fakeFetch(handler);
  const provider = createTidalMedia({
    config: {
      clientId: CID,
      ...(opts.clientSecret === null ? {} : { clientSecret: opts.clientSecret ?? SECRET }),
      redirectUri: REDIRECT,
      scopes: opts.scopes ?? TIDAL_DEFAULT_SCOPES,
    },
    store: store as unknown as JsonStore,
    fetch: fn,
    now: () => clock.t,
    sleep: async (ms: number) => void sleeps.push(ms),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.country ? { country: opts.country } : {}),
  });
  return { provider, store, clock, sleeps, calls };
}

// ---- JSON:API fixtures ---------------------------------------------------------------------------------------

type Res = { id: string; type: string; attributes?: Record<string, unknown>; relationships?: Record<string, unknown> };
const ref = (type: string, ...ids: string[]) => ({ data: ids.map((id) => ({ type, id })) });
const artwork = (id: string, widths: number[]): Res => ({
  id,
  type: 'artworks',
  attributes: { mediaType: 'IMAGE', files: widths.map((w) => ({ href: `https://img.tidal.test/${id}/${w}.jpg`, meta: { width: w, height: w } })) },
});
const artist = (id: string, name: string, art?: string): Res => ({
  id,
  type: 'artists',
  attributes: { name, popularity: 0.5 },
  relationships: { profileArt: ref('artworks', ...(art ? [art] : [])) },
});
const album = (id: string, title: string, artists: string[], art?: string, extra: Record<string, unknown> = {}): Res => ({
  id,
  type: 'albums',
  attributes: { title, numberOfItems: 10, ...extra },
  relationships: { artists: ref('artists', ...artists), coverArt: ref('artworks', ...(art ? [art] : [])) },
});
const track = (id: string, title: string, o: { artists: string[]; album: string; duration?: unknown } & Record<string, unknown>): Res => {
  const { artists, album: albumId, duration, ...extra } = o;
  return {
    id,
    type: 'tracks',
    attributes: { title, duration: 'duration' in o ? duration : 'PT3M5S', explicit: false, ...extra },
    relationships: { artists: ref('artists', ...artists), albums: ref('albums', albumId) },
  };
};
const playlist = (id: string, name: string, art?: string): Res => ({
  id,
  type: 'playlists',
  attributes: { name, numberOfItems: 12 },
  relationships: { coverArt: ref('artworks', ...(art ? [art] : [])) },
});

interface Catalog {
  tracks?: Res[];
  albums?: Res[];
  artists?: Res[];
  playlists?: Res[];
  artworks?: Res[];
}

/** A tiny fake of the TIDAL catalog: /tracks|albums|artists|playlists?filter[id]=… answers from `cat`. */
function catalogByIds(cat: Catalog, c: Call): Response | undefined {
  const type = apiPath(c).slice(1) as keyof Catalog;
  if (!['tracks', 'albums', 'artists', 'playlists'].includes(type) || !c.url.searchParams.has('filter[id]')) return undefined;
  const wanted = c.url.searchParams.get('filter[id]')!.split(',');
  const data = (cat[type] ?? []).filter((r) => wanted.includes(r.id));
  const included = [...(cat.artists ?? []), ...(cat.albums ?? []), ...(cat.artworks ?? [])];
  return j({ data, included, links: { self: apiPath(c) } });
}

const appToken = (n = 1) => j({ access_token: `APP${n}`, token_type: 'Bearer', expires_in: 3600 });

beforeEach(() => {
  vi.stubEnv('TIDAL_COUNTRY', ''); // hermetic: a TIDAL_COUNTRY on the developer's machine must not change the expected market
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------------------------------------------
// Account sign-in: Authorization Code + PKCE
// ---------------------------------------------------------------------------------------------------------------

describe('account sign-in (authorization code + PKCE)', () => {
  const tokenOk = () => j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 7200, scope: 'user.read playback', token_type: 'Bearer' });

  it('builds an S256 authorize URL with state, scope and the redirect, then exchanges the code with the matching verifier', async () => {
    const { provider, calls, store } = rig(tokenOk, { tokens: false });
    const u = new URL(provider.beginLogin());
    expect(u.origin + u.pathname).toBe('https://login.tidal.com/authorize');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe(CID);
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('scope')).toBe('user.read playback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const state = u.searchParams.get('state')!;
    expect(state.length).toBeGreaterThanOrEqual(16);
    expect(provider.connection().loginPending).toBe(true);

    await provider.finishLogin('the-code', state);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url.href).toBe(TOKEN_URL);
    expect(c.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(c.headers.Authorization).toBeUndefined();
    expect(c.form!.get('grant_type')).toBe('authorization_code');
    expect(c.form!.get('code')).toBe('the-code');
    expect(c.form!.get('redirect_uri')).toBe(REDIRECT);
    expect(c.form!.get('client_id')).toBe(CID);
    expect(c.form!.has('client_secret')).toBe(false);
    const verifier = c.form!.get('code_verifier')!;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(b64url(createHash('sha256').update(verifier).digest())).toBe(u.searchParams.get('code_challenge'));

    expect(await store.read('tidal.json')).toEqual({
      accessToken: 'AT1',
      refreshToken: 'RT1',
      expiresAt: T0 + 7_200_000,
      obtainedAt: T0,
      scope: 'user.read playback',
      clientId: CID,
    });
    expect(provider.connection()).toEqual({ connected: true, loginPending: false, connectedAt: T0, scopes: ['user.read', 'playback'] });
  });

  it('a state can be used once and an unknown state is refused before any request is made', async () => {
    const { provider, calls } = rig(tokenOk, { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await expect(provider.finishLogin('c', 'not-the-state')).rejects.toThrow(/expired or invalid/);
    expect(calls).toHaveLength(0);
    await provider.finishLogin('c', state);
    await expect(provider.finishLogin('c', state)).rejects.toThrow(/expired or invalid/);
    expect(calls).toHaveLength(1);
  });

  it('a state expires after ten minutes', async () => {
    const { provider, calls, clock } = rig(tokenOk, { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    clock.t += 10 * 60_000 - 1;
    expect(provider.connection().loginPending).toBe(true);
    clock.t += 2;
    expect(provider.connection().loginPending).toBe(false);
    await expect(provider.finishLogin('c', state)).rejects.toThrow(/expired or invalid/);
    expect(calls).toHaveLength(0);
  });

  it('finishes a sign-in from a pasted redirect address', async () => {
    const { provider } = rig(tokenOk, { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLoginFromPaste(`${REDIRECT}?code=abc&state=${state}`);
    expect(provider.connection().connected).toBe(true);
  });

  it('explains why a sign-in was refused', async () => {
    const answers: Array<[() => Response | Promise<Response>, RegExp]> = [
      [() => j({ error: 'invalid_client' }, 401), /rejected this account sign-in/],
      [() => j({ error: 'server_error' }, 503), /had a problem answering/],
      [() => j({ error: 'invalid_grant' }, 400), /did not accept the sign-in \(invalid_grant\)/],
      [() => Promise.reject(new TypeError('fetch failed')), /Could not reach TIDAL/],
      [() => j({ access_token: 'AT1', expires_in: 3600 }), /did not return a refresh token/],
    ];
    for (const [answer, expected] of answers) {
      const { provider, store } = rig(answer, { tokens: false });
      const state = new URL(provider.beginLogin()).searchParams.get('state')!;
      await expect(provider.finishLogin('c', state)).rejects.toThrow(expected);
      expect(await store.read('tidal.json')).toBeNull();
      expect(provider.connection().connected).toBe(false);
    }
  });

  it('can reload a token callback after a temporary DNS outage without losing its PKCE state', async () => {
    let requests = 0;
    const { provider } = rig((c) => {
      if (isToken(c)) {
        requests++;
        if (requests < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
        return j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 });
      }
      return j({ data: [] });
    }, { tokens: false });
    const st = new URL(provider.beginLogin()).searchParams.get('state')!;
    await expect(provider.finishLogin('once', st)).rejects.toThrow(/DNS/);
    expect(provider.connection().loginPending).toBe(true);
    await provider.finishLogin('once', st);
    expect(provider.connection().connected).toBe(true);
    await expect(provider.finishLogin('once', st)).rejects.toThrow(/expired or invalid/);
  });

  it('invalid_client marks the sign-in as rejected on the card', async () => {
    const { provider } = rig(() => j({ error: 'invalid_client' }, 401), { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await expect(provider.finishLogin('c', state)).rejects.toThrow();
    expect(provider.connection()).toMatchObject({ connected: false, problem: 'rejected', message: expect.stringContaining('Client ID') });
  });

  it('sign out forgets the tokens, the saved file and any login still waiting', async () => {
    const { provider, store } = rig(tokenOk, { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLogin('c', state);
    expect(provider.connection().connected).toBe(true);
    const second = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.logout();
    expect(provider.connection()).toEqual({ connected: false, loginPending: false });
    expect(await store.read('tidal.json')).toBeNull();
    await expect(provider.finishLogin('c', second)).rejects.toThrow(/expired or invalid/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------------------------------------------

describe('token refresh', () => {
  const emptyCollection = () => j({ data: [], links: { self: '/userCollectionPlaylists/me/relationships/items' } });

  it('is single-flight: concurrent calls with an expiring token cause one refresh request', async () => {
    const gate = deferred<Response>();
    const { provider, calls } = rig((c) => (isToken(c) ? gate.promise : emptyCollection()), { tokens: { expiresAt: T0 + 30_000 } });
    const all = Promise.all([provider.library.playlists(), provider.library.playlists(), provider.library.playlists()]);
    await tick();
    await tick();
    expect(calls.filter(isToken)).toHaveLength(1);
    gate.resolve(j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, scope: 'user.read playback' }));
    await all;
    expect(calls.filter(isToken)).toHaveLength(1);
    expect(calls.filter(isToken)[0]!.form!.get('grant_type')).toBe('refresh_token');
    expect(calls.filter(isToken)[0]!.form!.get('refresh_token')).toBe('RT');
    expect(apiCalls(calls).map((c) => c.headers.Authorization)).toEqual(['Bearer AT2', 'Bearer AT2', 'Bearer AT2']);
  });

  it('does not refresh a token that still has more than a minute left', async () => {
    const { provider, calls } = rig(emptyCollection, { tokens: { expiresAt: T0 + 61_000 } });
    await provider.library.playlists();
    expect(calls.filter(isToken)).toHaveLength(0);
    expect(apiCalls(calls)[0]!.headers.Authorization).toBe('Bearer AT');
  });

  it('stores a rotated refresh token, or keeps the old one (and scope) when TIDAL sends none', async () => {
    const rotated = rig((c) => (isToken(c) ? j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, scope: 'user.read collection.read' }) : emptyCollection()), { tokens: { expiresAt: T0 + 1_000 } });
    await rotated.provider.library.playlists();
    expect(await rotated.store.read('tidal.json')).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2', scope: 'user.read collection.read', obtainedAt: T0 - 1_000, expiresAt: T0 + 3_600_000 });

    const kept = rig((c) => (isToken(c) ? j({ access_token: 'AT3', expires_in: 1800 }) : emptyCollection()), { tokens: { expiresAt: T0 + 1_000 } });
    await kept.provider.library.playlists();
    expect(await kept.store.read('tidal.json')).toMatchObject({ accessToken: 'AT3', refreshToken: 'RT', scope: 'user.read playback', expiresAt: T0 + 1_800_000 });
  });

  it('a dead refresh token (invalid_grant) clears the tokens and reports login-expired', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? j({ error: 'invalid_grant' }, 400) : emptyCollection()), { tokens: { expiresAt: T0 + 1_000 } });
    expect(await provider.library.playlists()).toEqual([]);
    expect(await store.read('tidal.json')).toBeNull();
    expect(provider.connection()).toMatchObject({ connected: false, problem: 'login-expired', message: expect.stringContaining('no longer valid') });
  });

  it('signing in again after a login-expired state connects again and clears the problem', async () => {
    const { provider } = rig(
      (c) => (isToken(c) ? (c.form!.get('grant_type') === 'refresh_token' ? j({ error: 'invalid_grant' }, 400) : j({ access_token: 'AT9', refresh_token: 'RT9', expires_in: 3600, scope: 'user.read playback' })) : emptyCollection()),
      { tokens: { expiresAt: T0 + 1_000 } },
    );
    await provider.library.playlists();
    expect(provider.connection().problem).toBe('login-expired');
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLogin('c', state);
    expect(provider.connection()).toMatchObject({ connected: true });
    expect(provider.connection().problem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Catalog access: Client Credentials
// ---------------------------------------------------------------------------------------------------------------

describe('catalog token (client credentials)', () => {
  const searchDoc = () => j({ data: [{ id: 'S1', type: 'searchResults', relationships: { tracks: { data: [] } } }], links: { self: '/searchResults/x' } });

  it('sends HTTP Basic with the Client ID and Secret, caches the token and renews it before it expires', async () => {
    let n = 0;
    const { provider, calls, clock } = rig((c) => (isToken(c) ? appToken(++n) : searchDoc()), { tokens: false });
    await provider.library.search('one');
    await provider.library.search('two');
    const tokenCalls = calls.filter(isToken);
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    expect(tokenCalls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from(`${CID}:${SECRET}`).toString('base64')}`);
    expect(tokenCalls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect([...tokenCalls[0]!.form!.keys()]).toEqual(['grant_type']);
    expect(tokenCalls[0]!.form!.get('grant_type')).toBe('client_credentials');
    expect(apiCalls(calls).every((c) => c.headers.Authorization === 'Bearer APP1')).toBe(true);

    clock.t += 3_000_000;
    await provider.library.search('three');
    expect(calls.filter(isToken)).toHaveLength(1);
    clock.t += 600_000; // within the last minute of the 3600 s lifetime
    await provider.library.search('four');
    expect(calls.filter(isToken)).toHaveLength(2);
    expect(apiCalls(calls).at(-1)!.headers.Authorization).toBe('Bearer APP2');
  });

  it('a 401 from the API is retried once with a brand-new token', async () => {
    let n = 0;
    let api = 0;
    const { provider, calls } = rig((c) => (isToken(c) ? appToken(++n) : api++ === 0 ? j({ errors: [{ status: '401' }] }, 401) : searchDoc()), { tokens: false });
    await provider.library.search('x');
    expect(calls.filter(isToken)).toHaveLength(2);
    expect(apiCalls(calls).map((c) => c.headers.Authorization)).toEqual(['Bearer APP1', 'Bearer APP2']);
  });

  it('a second 401 gives a plain "rejected the developer credentials" error and drops the cached token', async () => {
    let n = 0;
    let rejecting = true;
    const { provider, calls } = rig((c) => (isToken(c) ? appToken(++n) : rejecting ? j({}, 401) : searchDoc()), { tokens: false });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'auth', message: expect.stringContaining('rejected the developer credentials') });
    rejecting = false;
    await provider.library.search('y');
    expect(calls.filter(isToken)).toHaveLength(3);
  });

  it('asks for the Client Secret when there is none, without any request', async () => {
    const { provider, calls } = rig(searchDoc, { tokens: false, clientSecret: null });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'auth', message: expect.stringContaining('Client Secret') });
    expect(calls).toHaveLength(0);
  });

  it('maps token-endpoint answers to plain errors', async () => {
    const rejected = rig(() => j({ error: 'invalid_client', error_description: 'bad secret' }, 401), { tokens: false });
    await expect(rejected.provider.library.search('x')).rejects.toMatchObject({ code: 'auth', message: expect.stringMatching(/rejected the developer credentials.*bad secret/) });
    const down = rig(() => j({}, 500), { tokens: false });
    await expect(down.provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable' });
    const offline = rig(() => Promise.reject(new TypeError('fetch failed')), { tokens: false });
    await expect(offline.provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Search + parsing
// ---------------------------------------------------------------------------------------------------------------

describe('search', () => {
  const cat: Catalog = {
    artists: [artist('10', 'Nina Simone', 'a10'), artist('11', 'Second Artist')],
    albums: [album('20', 'Pastel Blues', ['10'], 'c20', { numberOfItems: 9 })],
    tracks: [
      track('1', 'Sinnerman', { artists: ['10', '11'], album: '20', explicit: true }),
      track('2', 'Plain Track', { artists: ['10'], album: '20', duration: 'PT45S' }),
    ],
    playlists: [playlist('p1', 'Soul Classics', 'c20')],
    artworks: [artwork('c20', [80, 320, 1280]), artwork('a10', [160, 750])],
  };

  /** The search document names the results only through relationship linkage (nothing included). */
  const linkageOnly = () =>
    j({
      data: [
        {
          id: 'S1',
          type: 'searchResults',
          attributes: { query: 'nina' },
          relationships: { tracks: ref('tracks', '1', '2'), albums: ref('albums', '20'), artists: ref('artists', '10'), playlists: ref('playlists', 'p1') },
        },
      ],
      links: { self: '/searchResults/nina' },
    });

  it('asks TIDAL for the query in the car-friendly shape and maps tracks, albums, artists and playlists', async () => {
    const { provider, calls } = rig((c) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? linkageOnly() : (catalogByIds(cat, c) ?? j({}, 404))), { tokens: false });
    const r = await provider.library.search('  nina  ');

    const first = apiCalls(calls)[0]!;
    expect(apiPath(first)).toBe('/searchResults');
    expect(first.headers.Accept).toBe('application/vnd.api+json');
    expect(first.url.searchParams.get('filter[query]')).toBe('nina');
    expect(first.url.searchParams.get('countryCode')).toBe('US');
    expect(first.url.searchParams.get('deviceType')).toBe('CAR');
    expect(first.url.searchParams.get('systemType')).toBe('WEB');

    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0]).toMatchObject({
      id: '1',
      uri: 'tidal:track:1',
      title: 'Sinnerman',
      artist: 'Nina Simone, Second Artist',
      album: 'Pastel Blues',
      durationMs: 185_000,
      explicit: true,
    });
    expect(r.tracks[1]).toMatchObject({ id: '2', durationMs: 45_000, explicit: false });
    expect(r.albums).toEqual([expect.objectContaining({ id: '20', uri: 'tidal:album:20', type: 'album', name: 'Pastel Blues', subtitle: 'Nina Simone', trackCount: 9 })]);
    expect(r.artists).toEqual([expect.objectContaining({ id: '10', uri: 'tidal:artist:10', type: 'artist', name: 'Nina Simone' })]);
    expect(r.playlists).toEqual([expect.objectContaining({ id: 'p1', uri: 'tidal:playlist:p1', type: 'playlist', name: 'Soul Classics', trackCount: 12 })]);
  });

  it('an empty query never reaches TIDAL', async () => {
    const { provider, calls } = rig(() => j({}), { tokens: false });
    expect(await provider.library.search('   ')).toEqual({ tracks: [], albums: [], artists: [], playlists: [] });
    expect(calls).toHaveLength(0);
  });

  it('parses ISO-8601 durations (and tolerates junk)', async () => {
    const durations = ['PT3M5S', 'PT1H2M3S', 'PT45S', 'P0DT0H3M0S', 'PT1.5S', 'nonsense', 200, undefined];
    const tracks = durations.map((d, i) => track(`t${i}`, `T${i}`, { artists: ['10'], album: '20', duration: d }));
    const doc = j({
      data: [{ id: 'S', type: 'searchResults', relationships: { tracks: ref('tracks', ...tracks.map((t) => t.id)) } }],
      links: { self: '/s' },
    });
    const { provider } = rig((c) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? doc : (catalogByIds({ ...cat, tracks }, c) ?? j({}, 404))), { tokens: false });
    // idsFromSearch keeps 12 ids at most; we use 8
    const r = await provider.library.search('durations');
    expect(r.tracks.map((t) => t.durationMs)).toEqual([185_000, 3_723_000, 45_000, 180_000, 1_500, 0, 200_000, 0]);
  });

  it('maps TIDAL being offline to a plain "unavailable" error', async () => {
    const { provider } = rig((c) => (isToken(c) ? appToken() : Promise.reject(new TypeError('fetch failed'))), { tokens: false });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
    await expect(provider.library.search('x')).rejects.toBeInstanceOf(LibraryError);
  });

  it('a 403 on the personal collection endpoints degrades to empty lists and does not break search', async () => {
    const { provider, calls } = rig(
      (c) => {
        if (isToken(c)) return appToken();
        if (apiPath(c).startsWith('/userCollection')) return j({ errors: [{ status: '403', code: 'FORBIDDEN', detail: 'Missing scope collection.read' }] }, 403);
        if (apiPath(c).startsWith('/searchResults')) return linkageOnly();
        return catalogByIds(cat, c) ?? j({}, 404);
      },
    );
    expect(await provider.library.playlists()).toEqual([]);
    expect(await provider.library.liked()).toEqual([]);
    expect(await provider.library.albums()).toEqual([]);
    expect(await provider.library.artists()).toEqual([]);
    expect(apiCalls(calls).filter((c) => apiPath(c).startsWith('/userCollection'))).toHaveLength(4);
    const r = await provider.library.search('nina');
    expect(r.tracks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// test(), connection(), HTTP error mapping
// ---------------------------------------------------------------------------------------------------------------

describe('test()', () => {
  const found = (n: number) =>
    j({
      data: [{ id: 'S', type: 'searchResults', relationships: { tracks: ref('tracks', ...Array.from({ length: n }, (_, i) => `t${i}`)) } }],
      links: { self: '/s' },
    });

  it('reports a working catalog connection, with or without results', async () => {
    const some = rig((c) => (isToken(c) ? appToken() : found(3)), { tokens: false });
    expect(await some.provider.test()).toEqual({ ok: true, message: 'TIDAL catalog connected — Client Credentials accepted; search returned 3 results' });
    const one = rig((c) => (isToken(c) ? appToken() : found(1)), { tokens: false });
    expect((await one.provider.test()).message).toMatch(/search returned 1 result$/);
    const none = rig((c) => (isToken(c) ? appToken() : found(0)), { tokens: false });
    expect(await none.provider.test()).toEqual({ ok: true, message: 'TIDAL catalog connected — Client Credentials accepted' });
  });

  it('says plainly what is wrong', async () => {
    const noSecret = rig(() => found(1), { tokens: false, clientSecret: null });
    expect(await noSecret.provider.test()).toEqual({ ok: false, message: 'Add your TIDAL Client Secret in Music settings first.' });
    const rejected = rig(() => j({ error: 'invalid_client' }, 401), { tokens: false });
    expect(await rejected.provider.test()).toMatchObject({ ok: false, message: expect.stringContaining('rejected the developer credentials') });
    const offline = rig(() => Promise.reject(new TypeError('fetch failed')), { tokens: false });
    expect(await offline.provider.test()).toEqual({ ok: false, message: 'Could not reach TIDAL. Check the internet connection and try again' });
    const denied = rig((c) => (isToken(c) ? appToken() : j({ errors: [{ detail: 'App not allowed' }] }, 403)), { tokens: false });
    expect(await denied.provider.test()).toEqual({ ok: false, message: 'TIDAL denied catalog access: App not allowed' });
  });
});

describe('connection()', () => {
  it('is empty before a sign-in', async () => {
    const { provider } = rig(() => j({}), { tokens: false });
    await tick();
    expect(provider.connection()).toEqual({ connected: false, loginPending: false });
  });

  it('reports the saved sign-in without ever containing a token or the Client Secret', async () => {
    const { provider } = rig(() => j({}), { tokens: { accessToken: 'ACCESS-SECRET-1', refreshToken: 'REFRESH-SECRET-1', scope: 'user.read playback collection.read' } });
    await tick();
    const info = provider.connection();
    expect(info).toEqual({ connected: true, loginPending: false, connectedAt: T0 - 1_000, scopes: ['user.read', 'playback', 'collection.read'] });
    const text = JSON.stringify(info);
    for (const secret of ['ACCESS-SECRET-1', 'REFRESH-SECRET-1', SECRET]) expect(text).not.toContain(secret);
    expect(Object.keys(info).every((k) => ['connected', 'loginPending', 'problem', 'message', 'connectedAt', 'scopes'].includes(k))).toBe(true);
  });

  it('ignores a saved sign-in that belongs to another Client ID', async () => {
    const { provider } = rig(() => j({}), { tokens: { clientId: 'someone-else' } });
    await tick();
    expect(provider.connection().connected).toBe(false);
  });
});

// ===============================================================================================================
// Hardening (v5.2): timeouts + bounded retries, refresh error mapping, sign-out races, sticky problems, scope
// upgrades, artwork picking, pagination, fewer round trips, market/availability.
// ===============================================================================================================

/** A request that never answers until its AbortSignal fires (what a stalled mobile connection looks like). */
const stall = (c: Call) =>
  new Promise<Response>((_, reject) => {
    c.signal?.addEventListener('abort', () => reject(c.signal!.reason), { once: true });
  });

const emptySearch = () => j({ data: [{ id: 'S', type: 'searchResults', relationships: { tracks: { data: [] } } }], links: { self: '/s' } });
const emptyItems = () => j({ data: [], links: { self: '/x' } });

describe('timeouts and bounded retries', () => {
  it('every token and API request carries an abort signal', async () => {
    const { provider, calls } = rig((c) => (isToken(c) ? (c.form?.get('grant_type') === 'client_credentials' ? appToken() : j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 })) : emptySearch()), { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLogin('c', state);
    await provider.library.search('x');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
  });

  it('a stalled catalog-token request is abandoned, and the next call is not stuck behind it', async () => {
    let stalled = true;
    const { provider } = rig((c) => (isToken(c) ? (stalled ? stall(c) : appToken()) : emptySearch()), { tokens: false, timeoutMs: 40 });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
    stalled = false;
    await expect(provider.library.search('x')).resolves.toBeDefined();
  }, 3000);

  it('a stalled API request is abandoned with a plain message', async () => {
    const { provider } = rig((c) => (isToken(c) ? appToken() : stall(c)), { tokens: false, timeoutMs: 40 });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
  }, 3000);

  it('a stalled refresh request is abandoned and reported as "unavailable"', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? stall(c) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 }, timeoutMs: 40 });
    await expect(provider.library.playlists()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
  }, 3000);

  it('retries a GET after 429 honouring Retry-After, at most twice', async () => {
    let n = 0;
    const { provider, calls, sleeps } = rig((c) => {
      if (isToken(c)) return appToken();
      n++;
      if (n === 1) return j({ errors: [{ status: '429' }] }, 429, { 'Retry-After': '2' });
      if (n === 2) return j({ errors: [{ status: '429' }] }, 429, { 'retry-after': '1' });
      return emptySearch();
    }, { tokens: false });
    await expect(provider.library.search('x')).resolves.toBeDefined();
    expect(apiCalls(calls)).toHaveLength(3);
    expect(sleeps).toEqual([2000, 1000]);
  });

  it('gives up with a "rate" error after two retries', async () => {
    const { provider, calls, sleeps } = rig((c) => (isToken(c) ? appToken() : j({ errors: [{ status: '429', detail: 'Rate limit exceeded' }] }, 429)), { tokens: false });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'rate', message: expect.stringContaining('rate limiting') });
    expect(apiCalls(calls)).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(sleeps.every((ms) => ms <= 5000)).toBe(true);
  });

  it('does not wait longer than five seconds: a bigger Retry-After is reported at once instead of hammering', async () => {
    const { provider, calls, sleeps } = rig((c) => (isToken(c) ? appToken() : j({}, 429, { 'retry-after': '30' })), { tokens: false });
    await expect(provider.library.search('x')).rejects.toMatchObject({ code: 'rate' });
    expect(apiCalls(calls)).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('understands a Retry-After given as a date', async () => {
    let n = 0;
    const { provider, sleeps, clock } = rig((c) => {
      if (isToken(c)) return appToken();
      return n++ === 0 ? j({}, 429, { 'retry-after': new Date(clock.t + 3_000).toUTCString() }) : emptySearch();
    }, { tokens: false });
    await provider.library.search('x');
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]!).toBeGreaterThanOrEqual(2000);
    expect(sleeps[0]!).toBeLessThanOrEqual(3000);
  });

  it('retries a GET once after a 5xx, then reports "unavailable"', async () => {
    let n = 0;
    const flaky = rig((c) => (isToken(c) ? appToken() : n++ === 0 ? j({}, 503) : j({ data: [], links: { self: '/x' } })), { tokens: false });
    await expect(flaky.provider.library.album('A1')).resolves.toBeDefined();
    expect(flaky.sleeps).toEqual([500]);

    const down = rig((c) => (isToken(c) ? appToken() : j({ errors: [{ detail: 'boom' }] }, 502)), { tokens: false });
    await expect(down.provider.library.album('A1')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('502') });
    expect(apiCalls(down.calls)).toHaveLength(2);
    expect(down.sleeps).toEqual([500]);
  });

  it('a search during a TIDAL outage costs a bounded number of requests (nested include and plain include, one retry each)', async () => {
    const down = rig((c) => (isToken(c) ? appToken() : j({ errors: [{ detail: 'boom' }] }, 503)), { tokens: false });
    await expect(down.provider.library.search('x')).rejects.toMatchObject({ code: 'unavailable' });
    expect(apiCalls(down.calls)).toHaveLength(4);
    expect(down.sleeps).toEqual([500, 500]);
  });

  it('never retries a token POST (a refresh must not be sent twice)', async () => {
    const { provider, calls, sleeps } = rig((c) => (isToken(c) ? j({ error: 'server_error' }, 503) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    await expect(provider.library.playlists()).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls.filter(isToken)).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('does not retry client errors', async () => {
    const { provider, calls, sleeps } = rig((c) => (isToken(c) ? appToken() : j({ errors: [{ detail: 'bad request' }] }, 400)), { tokens: false });
    await expect(provider.library.album('A1')).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('bad request') });
    expect(apiCalls(calls)).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('refresh failures', () => {
  it('an offline refresh is a LibraryError "unavailable", not an uncaught error, and keeps the sign-in', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? Promise.reject(new TypeError('fetch failed')) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    const err = await provider.library.playlists().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryError);
    expect(err).toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
    expect(provider.connection()).toMatchObject({ connected: true });
    expect(provider.connection().problem).toBeUndefined();
  });

  it('a 5xx during refresh is "unavailable" too, and nothing is signed out', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? j({ error: 'server_error' }, 503) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    const err = await provider.library.liked().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryError);
    expect(err).toMatchObject({ code: 'unavailable', message: expect.stringContaining('Could not reach TIDAL') });
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
    expect(provider.connection().connected).toBe(true);
  });

  it('a 429 during refresh is a "rate" error and keeps the sign-in', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? j({ error: 'too_many_requests' }, 429) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    await expect(provider.library.albums()).rejects.toMatchObject({ code: 'rate' });
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
  });

  it.each([
    [400, 'invalid_request'],
    [400, 'unauthorized_client'],
    [401, 'invalid_client'],
    [401, 'access_denied'],
    [400, 'invalid_grant'],
  ])('a %i %s answer means the refresh token is dead: tokens cleared, login-expired', async (status, error) => {
    const { provider, store } = rig((c) => (isToken(c) ? j({ error }, status) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    expect(await provider.library.playlists()).toEqual([]);
    expect(await store.read('tidal.json')).toBeNull();
    expect(provider.connection()).toMatchObject({ connected: false, problem: 'login-expired' });
  });

  it('an unreadable success answer from the token endpoint is "unavailable" and keeps the sign-in', async () => {
    const { provider, store } = rig((c) => (isToken(c) ? new Response('<html>oops</html>', { status: 200 }) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    await expect(provider.library.playlists()).rejects.toMatchObject({ code: 'unavailable' });
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
  });
});

describe('sign-out races and sticky problems', () => {
  const pageOfPlaylists = () => emptyItems();

  it('a refresh that finishes after sign-out does not bring the tokens back', async () => {
    const gate = deferred<Response>();
    const { provider, store } = rig((c) => (isToken(c) ? gate.promise : pageOfPlaylists()), { tokens: { expiresAt: T0 + 1_000 } });
    const pending = provider.library.playlists();
    await tick();
    await tick();
    await provider.logout();
    gate.resolve(j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }));
    expect(await pending).toEqual([]);
    await tick();
    expect(await store.read('tidal.json')).toBeNull();
    expect(provider.connection()).toEqual({ connected: false, loginPending: false });
  });

  it('a refresh that fails after sign-out does not raise a problem on the signed-out card', async () => {
    const gate = deferred<Response>();
    const { provider } = rig((c) => (isToken(c) ? gate.promise : pageOfPlaylists()), { tokens: { expiresAt: T0 + 1_000 } });
    const pending = provider.library.playlists();
    await tick();
    await tick();
    await provider.logout();
    gate.resolve(j({ error: 'invalid_grant' }, 400));
    await pending;
    expect(provider.connection()).toEqual({ connected: false, loginPending: false });
  });

  it('a refresh that finishes after a NEW sign-in does not overwrite the new tokens', async () => {
    const gate = deferred<Response>();
    const { provider, store } = rig(
      (c) => {
        if (!isToken(c)) return pageOfPlaylists();
        if (c.form?.get('grant_type') === 'refresh_token') return gate.promise;
        return j({ access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 3600, scope: 'user.read playback' });
      },
      { tokens: { expiresAt: T0 + 1_000 } },
    );
    const pending = provider.library.playlists();
    await tick();
    await tick();
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLogin('c', state);
    gate.resolve(j({ access_token: 'AT-old', refresh_token: 'RT-old', expires_in: 3600 }));
    await pending;
    expect(await store.read('tidal.json')).toMatchObject({ accessToken: 'AT-new', refreshToken: 'RT-new' });
  });

  it('a sign-in that finishes after sign-out was pressed is dropped', async () => {
    const gate = deferred<Response>();
    const { provider, store } = rig(() => gate.promise, { tokens: false });
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    const finishing = provider.finishLogin('c', state).catch((e: Error) => e);
    await tick();
    await provider.logout();
    gate.resolve(j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }));
    expect(await finishing).toBeInstanceOf(Error);
    expect(await store.read('tidal.json')).toBeNull();
    expect(provider.connection().connected).toBe(false);
  });

  it('login-expired after an API 401 heals by itself once a later call works', async () => {
    let api = 0;
    const { provider, store } = rig((c) => {
      if (isToken(c)) return j({ access_token: `AT${api}`, expires_in: 3600 });
      return api++ < 2 ? j({ errors: [{ status: '401' }] }, 401) : emptyItems();
    });
    expect(await provider.library.playlists()).toEqual([]);
    expect(provider.connection()).toMatchObject({ connected: false, problem: 'login-expired' });
    expect(await store.read('tidal.json')).not.toBeNull();
    expect(await provider.library.playlists()).toEqual([]);
    expect(provider.connection().connected).toBe(true);
    expect(provider.connection().problem).toBeUndefined();
  });

  it('a 403 on the optional collection endpoints does not flag "Needs permissions"', async () => {
    const { provider } = rig((c) => (c.url.pathname.includes('userCollection') ? j({ errors: [{ status: '403', detail: 'Missing scope' }] }, 403) : emptyItems()));
    for (const call of [provider.library.playlists, provider.library.liked, provider.library.albums, provider.library.artists]) expect(await call()).toEqual([]);
    expect(provider.connection()).toMatchObject({ connected: true });
    expect(provider.connection().problem).toBeUndefined();
    expect(provider.connection().message).toBeUndefined();
  });
});

describe('persisting the sign-in', () => {
  it('a sign-in that cannot be saved is reported, not pretended', async () => {
    const { provider, store } = rig(() => j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }), { tokens: false });
    store.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await expect(provider.finishLogin('c', state)).rejects.toThrow(/could not be saved/);
    expect(provider.connection().connected).toBe(false);
  });

  it('sign-out says so when the saved sign-in could not be removed, but still signs out for now', async () => {
    const { provider, store } = rig(() => j({}));
    await tick();
    expect(provider.connection().connected).toBe(true);
    store.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(provider.logout()).rejects.toThrow(/could not remove/i);
    expect(provider.connection().connected).toBe(false);
  });

  it('a refreshed token that cannot be saved is still used for this session', async () => {
    const { provider, store, calls } = rig((c) => (isToken(c) ? j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }) : emptyItems()), { tokens: { expiresAt: T0 + 1_000 } });
    store.failWrites = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await provider.library.playlists()).toEqual([]);
    expect(apiCalls(calls)[0]!.headers.Authorization).toBe('Bearer AT2');
    expect(provider.connection().connected).toBe(true);
  });
});

describe('permissions the saved sign-in lacks', () => {
  const wide = 'user.read collection.read playlists.read';

  it('never changes the default scope request', () => {
    expect(TIDAL_DEFAULT_SCOPES).toBe('user.read playback');
    const { provider } = rig(() => j({}), { tokens: false });
    expect(new URL(provider.beginLogin()).searchParams.get('scope')).toBe('user.read playback');
  });

  it('asks to sign in again when the configured scopes are wider than the ones granted, without disconnecting', async () => {
    const { provider } = rig(() => j({}), { scopes: wide, tokens: { scope: 'user.read' } });
    await tick();
    const info = provider.connection();
    expect(info).toMatchObject({ connected: true, problem: 'permissions' });
    expect(info.message).toContain('Sign in again to grant: collection.read, playlists.read');
    expect(info.scopes).toEqual(['user.read']);
  });

  it('is not sticky: it is computed from what is stored, so a wider grant clears it', async () => {
    const { provider } = rig((c) => (isToken(c) ? j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, scope: wide }) : emptyItems()), { scopes: wide, tokens: { scope: 'user.read', expiresAt: T0 + 1_000 } });
    await tick();
    expect(provider.connection().problem).toBe('permissions');
    await provider.library.playlists(); // refresh returns the wider grant
    expect(provider.connection().problem).toBeUndefined();
  });

  it('a new sign-in with the wider grant clears it', async () => {
    const { provider } = rig(() => j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, scope: wide }), { scopes: wide, tokens: { scope: 'user.read' } });
    await tick();
    expect(provider.connection().problem).toBe('permissions');
    const state = new URL(provider.beginLogin()).searchParams.get('state')!;
    await provider.finishLogin('c', state);
    expect(provider.connection()).toMatchObject({ connected: true, scopes: ['user.read', 'collection.read', 'playlists.read'] });
    expect(provider.connection().problem).toBeUndefined();
  });

  it('says nothing when the grant is unknown, but asks old default sign-ins to add the new playback scope', async () => {
    const unknown = rig(() => j({}), { scopes: wide, tokens: { scope: undefined } });
    await tick();
    expect(unknown.provider.connection().problem).toBeUndefined();
    const builtIn = rig(() => j({}), { tokens: { scope: 'user.read' } });
    await tick();
    expect(builtIn.provider.connection()).toMatchObject({ problem: 'permissions' });
    expect(builtIn.provider.connection().message).toContain('playback');
  });

  it('a hard problem (login expired) wins over the scope hint', async () => {
    const { provider } = rig((c) => (isToken(c) ? j({ error: 'invalid_grant' }, 400) : emptyItems()), { scopes: wide, tokens: { scope: 'user.read', expiresAt: T0 + 1_000 } });
    await provider.library.playlists();
    expect(provider.connection()).toMatchObject({ connected: false, problem: 'login-expired' });
  });
});

describe('artwork and titles', () => {
  /** One album with the given widths, found through search by id. */
  async function pickFor(widths: number[], files?: unknown) {
    const art = artwork('c1', widths);
    if (files !== undefined) (art.attributes as { files: unknown }).files = files;
    const cat: Catalog = { albums: [album('20', 'Album', ['10'], 'c1')], artists: [artist('10', 'Artist')], artworks: [art] };
    const doc = j({ data: [{ id: 'S', type: 'searchResults', relationships: { albums: ref('albums', '20') } }], links: { self: '/s' } });
    const { provider } = rig((c) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? doc : (catalogByIds(cat, c) ?? j({}, 404))), { tokens: false });
    return (await provider.library.search('x')).albums[0]!.artUrl;
  }

  it('reads the size from files[].meta (as the spec has it) and takes the smallest image of at least 640 px', async () => {
    expect(await pickFor([1280, 750, 320, 80])).toBe('https://img.tidal.test/c1/750.jpg');
    expect(await pickFor([80, 160, 320, 640, 1280])).toBe('https://img.tidal.test/c1/640.jpg');
    expect(await pickFor([640, 1280])).toBe('https://img.tidal.test/c1/640.jpg');
    expect(await pickFor([1280, 4000])).toBe('https://img.tidal.test/c1/1280.jpg');
  });

  it('falls back to the largest image when nothing reaches 640 px', async () => {
    expect(await pickFor([80, 320, 160])).toBe('https://img.tidal.test/c1/320.jpg');
    expect(await pickFor([320, 80])).toBe('https://img.tidal.test/c1/320.jpg');
  });

  it('keeps the first file when TIDAL gives no sizes, and copes with a missing file list', async () => {
    const noMeta = [{ href: 'https://img.tidal.test/a.jpg' }, { href: 'https://img.tidal.test/b.jpg' }];
    expect(await pickFor([], noMeta)).toBe('https://img.tidal.test/a.jpg');
    expect(await pickFor([], [])).toBeUndefined();
    expect(await pickFor([], null)).toBeUndefined();
  });

  it('appends the track and album version to the title when it is not already part of it', async () => {
    const cat: Catalog = {
      artists: [artist('10', 'Artist')],
      albums: [album('20', 'Hello', ['10'], undefined, { version: 'Deluxe' }), album('21', 'Hi (Deluxe)', ['10'], undefined, { version: 'Deluxe' })],
      tracks: [
        track('1', 'Song', { artists: ['10'], album: '20', version: 'Remastered 2011' }),
        track('2', 'Other (Remastered 2011)', { artists: ['10'], album: '20', version: 'Remastered 2011' }),
        track('3', 'Plain', { artists: ['10'], album: '20', version: '' }),
      ],
    };
    const doc = j({
      data: [{ id: 'S', type: 'searchResults', relationships: { tracks: ref('tracks', '1', '2', '3'), albums: ref('albums', '20', '21') } }],
      links: { self: '/s' },
    });
    const { provider } = rig((c) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? doc : (catalogByIds(cat, c) ?? j({}, 404))), { tokens: false });
    const r = await provider.library.search('x');
    expect(r.tracks.map((t) => t.title)).toEqual(['Song (Remastered 2011)', 'Other (Remastered 2011)', 'Plain']);
    expect(r.albums.map((a) => a.name)).toEqual(['Hello (Deluxe)', 'Hi (Deluxe)']);
    expect(r.tracks[0]!.album).toBe('Hello (Deluxe)');
  });
});

describe('pagination', () => {
  const REL = '/userCollectionTracks/me/relationships/items';
  /** The market is pinned so that the account-country lookup (GET /users/me) does not add a request to the counts. */
  const paged = (handler: (c: Call, n: number) => Response | Promise<Response>, opts: RigOptions = {}) => rig(handler, { country: 'US', ...opts });

  /** `total` track ids t0.., `size` per page, cursor "p<n>" (spec: links.meta.nextCursor + links.next with page[cursor]). */
  function server(opts: { total: number; size?: number; metaCursor?: boolean; type?: string; path?: string; endless?: boolean }) {
    const size = opts.size ?? 20;
    const path = opts.path ?? REL;
    return (c: Call): Response => {
      if (isToken(c)) return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      if (apiPath(c) === path) {
        const cursor = c.url.searchParams.get('page[cursor]');
        const page = cursor ? Number(cursor.slice(1)) : 0;
        const start = page * size;
        const ids = Array.from({ length: Math.max(0, Math.min(size, opts.total - start)) }, (_, i) => `t${start + i}`);
        const hasNext = opts.endless || start + size < opts.total;
        return j({
          data: ids.map((id) => ({ type: opts.type ?? 'tracks', id })),
          links: {
            self: path,
            ...(hasNext ? { next: `${path}?page[cursor]=p${page + 1}`, ...(opts.metaCursor === false ? {} : { meta: { nextCursor: `p${page + 1}` } }) } : {}),
          },
        });
      }
      // by-id lookups: every requested id exists
      const type = apiPath(c).slice(1);
      const wanted = c.url.searchParams.get('filter[id]')?.split(',') ?? [];
      const make = (id: string): Res => (type === 'tracks' ? track(id, `Title ${id}`, { artists: ['10'], album: '20' }) : type === 'albums' ? album(id, `Album ${id}`, ['10']) : type === 'artists' ? artist(id, `Artist ${id}`) : playlist(id, `Playlist ${id}`));
      return j({ data: wanted.map(make), included: [artist('10', 'Artist'), album('20', 'Alb', ['10'])], links: { self: apiPath(c) } });
    };
  }

  it('follows links.meta.nextCursor through the pages and fetches track details in chunks of 20', async () => {
    const { provider, calls } = paged(server({ total: 45 }));
    const liked = await provider.library.liked();
    expect(liked.map((t) => t.id)).toEqual(Array.from({ length: 45 }, (_, i) => `t${i}`));
    const rel = apiCalls(calls).filter((c) => apiPath(c) === REL);
    expect(rel.map((c) => c.url.searchParams.get('page[cursor]'))).toEqual([null, 'p1', 'p2']);
    const chunks = apiCalls(calls).filter((c) => apiPath(c) === '/tracks');
    expect(chunks.map((c) => c.url.searchParams.get('filter[id]')!.split(',').length)).toEqual([20, 20, 5]);
    expect(chunks.every((c) => c.url.searchParams.get('countryCode') === 'US')).toBe(true);
  });

  it('asks the personal collections newest first and sends only the parameters the spec lists for them', async () => {
    const { provider, calls } = paged(server({ total: 3 }));
    await provider.library.liked();
    const rel = apiCalls(calls).find((c) => apiPath(c) === REL)!;
    expect(rel.url.searchParams.get('sort')).toBe('-addedAt');
    expect(rel.url.searchParams.has('countryCode')).toBe(false);
    expect(rel.headers.Authorization).toBe('Bearer AT');
  });

  it('stops at 5 pages / 100 items however many pages TIDAL offers', async () => {
    const { provider, calls } = paged(server({ total: 10_000, endless: true }));
    const liked = await provider.library.liked();
    expect(liked).toHaveLength(100);
    expect(apiCalls(calls).filter((c) => apiPath(c) === REL)).toHaveLength(5);
    expect(apiCalls(calls).filter((c) => apiPath(c) === '/tracks')).toHaveLength(5);
  });

  it('falls back to the page[cursor] inside links.next when there is no meta cursor', async () => {
    const { provider, calls } = paged(server({ total: 30, metaCursor: false }));
    expect(await provider.library.liked()).toHaveLength(30);
    expect(apiCalls(calls).filter((c) => apiPath(c) === REL).map((c) => c.url.searchParams.get('page[cursor]'))).toEqual([null, 'p1']);
  });

  it('a repeated cursor ends the loop', async () => {
    let n = 0;
    const { provider, calls } = paged((c) => {
      if (isToken(c)) return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      if (apiPath(c) === REL) return j({ data: [{ type: 'tracks', id: `t${n++}` }], links: { self: REL, meta: { nextCursor: 'same' } } });
      return j({ data: [], links: { self: '/tracks' } });
    });
    await provider.library.liked();
    expect(apiCalls(calls).filter((c) => apiPath(c) === REL)).toHaveLength(2);
  });

  it('a single short page costs the same requests as before', async () => {
    const { provider, calls } = paged(server({ total: 3 }));
    expect(await provider.library.liked()).toHaveLength(3);
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it('opens a long public playlist beyond its first 20 tracks', async () => {
    const path = '/playlists/PL1/relationships/items';
    const base = server({ total: 60, path });
    const { provider, calls } = paged((c) => (isToken(c) ? appToken() : base(c)), { tokens: false });
    const listing = await provider.library.playlist('PL1');
    expect(listing.item).toMatchObject({ id: 'PL1', name: 'Playlist PL1' });
    expect(listing.tracks).toHaveLength(60);
    const rel = apiCalls(calls).filter((c) => apiPath(c) === path);
    expect(rel).toHaveLength(3);
    expect(rel[0]!.url.searchParams.get('countryCode')).toBe('US');
  });

  it('opens a long album and keeps the tracks in album order without duplicates', async () => {
    const path = '/albums/A1/relationships/items';
    const base = server({ total: 25, path });
    const { provider } = paged((c) => (isToken(c) ? appToken() : base(c)), { tokens: false });
    const listing = await provider.library.album('A1');
    expect(listing.tracks.map((t) => t.id)).toEqual(Array.from({ length: 25 }, (_, i) => `t${i}`));
  });

  it('collections of albums, artists and playlists page too', async () => {
    for (const [fn, path, type] of [
      ['albums', '/userCollectionAlbums/me/relationships/items', 'albums'],
      ['artists', '/userCollectionArtists/me/relationships/items', 'artists'],
      ['playlists', '/userCollectionPlaylists/me/relationships/items', 'playlists'],
    ] as const) {
      const { provider, calls } = paged(server({ total: 30, path, type }));
      const rows = await provider.library[fn]();
      expect(rows).toHaveLength(30);
      expect(apiCalls(calls).filter((c) => apiPath(c) === path)).toHaveLength(2);
    }
  });
});

describe('search round trips', () => {
  const art = [artwork('c20', [80, 320, 1280]), artwork('a10', [160, 750]), artwork('c21', [320, 640])];
  const cat: Catalog = {
    artists: [artist('10', 'Nina Simone', 'a10')],
    albums: [album('20', 'Pastel Blues', ['10'], 'c20'), album('21', 'Second Album', ['10'], 'c21')],
    tracks: [track('1', 'Sinnerman', { artists: ['10'], album: '20' }), track('2', 'Plain Track', { artists: ['10'], album: '21', duration: 'PT45S' })],
    playlists: [playlist('p1', 'Soul Classics', 'c20')],
    artworks: art,
  };
  const root = {
    id: 'S1',
    type: 'searchResults',
    attributes: { query: 'nina' },
    relationships: { tracks: ref('tracks', '1', '2'), albums: ref('albums', '20', '21'), artists: ref('artists', '10'), playlists: ref('playlists', 'p1') },
  };
  const fullDoc = (c: Catalog = cat) => j({ data: [root], included: [...(c.tracks ?? []), ...(c.albums ?? []), ...(c.artists ?? []), ...(c.playlists ?? []), ...(c.artworks ?? [])], links: { self: '/searchResults/nina' } });
  const server = (searchAnswer: (c: Call) => Response) => (c: Call) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? searchAnswer(c) : (catalogByIds(cat, c) ?? j({}, 404)));

  it('uses the resources the search already returned: one request for a whole search', async () => {
    const { provider, calls } = rig(server(() => fullDoc()), { tokens: false });
    const r = await provider.library.search('nina');
    expect(apiCalls(calls)).toHaveLength(1);
    const include = apiCalls(calls)[0]!.url.searchParams.get('include')!.split(',');
    for (const path of ['tracks', 'tracks.artists', 'tracks.albums', 'tracks.albums.coverArt', 'albums', 'albums.artists', 'albums.coverArt', 'artists', 'artists.profileArt', 'playlists', 'playlists.coverArt']) {
      expect(include).toContain(path);
    }
    expect(r.tracks.map((t) => [t.title, t.artist, t.album, t.artUrl])).toEqual([
      ['Sinnerman', 'Nina Simone', 'Pastel Blues', 'https://img.tidal.test/c20/1280.jpg'],
      ['Plain Track', 'Nina Simone', 'Second Album', 'https://img.tidal.test/c21/640.jpg'],
    ]);
    expect(r.albums.map((a) => [a.name, a.subtitle, a.artUrl])).toEqual([
      ['Pastel Blues', 'Nina Simone', 'https://img.tidal.test/c20/1280.jpg'],
      ['Second Album', 'Nina Simone', 'https://img.tidal.test/c21/640.jpg'],
    ]);
    expect(r.artists[0]).toMatchObject({ name: 'Nina Simone', artUrl: 'https://img.tidal.test/a10/750.jpg' });
    expect(r.playlists[0]).toMatchObject({ name: 'Soul Classics', trackCount: 12 });
  });

  it('fetches by id only what the search did not carry, keeping the search order', async () => {
    const thin = track('2', 'Plain Track', { artists: ['10'], album: '21', duration: 'PT45S' });
    thin.relationships = { artists: { links: { self: '/tracks/2/relationships/artists' } }, albums: { links: { self: '/tracks/2/relationships/albums' } } };
    const { provider, calls } = rig(server(() => fullDoc({ ...cat, tracks: [cat.tracks![0]!, thin] })), { tokens: false });
    const r = await provider.library.search('nina');
    const rest = apiCalls(calls).slice(1);
    expect(rest.map(apiPath)).toEqual(['/tracks']);
    expect(rest[0]!.url.searchParams.get('filter[id]')).toBe('2');
    expect(r.tracks.map((t) => t.id)).toEqual(['1', '2']);
    expect(r.tracks[1]).toMatchObject({ artist: 'Nina Simone', album: 'Second Album' });
    expect(r.albums).toHaveLength(2);
  });

  it('falls back to the old by-id requests when the search carries nothing usable', async () => {
    const linkage = () => j({ data: [root], links: { self: '/searchResults/nina' } });
    const { provider, calls } = rig(server(linkage), { tokens: false });
    const r = await provider.library.search('nina');
    expect(apiCalls(calls).map(apiPath)).toEqual(['/searchResults', '/tracks', '/albums', '/artists', '/playlists']);
    expect(r.tracks).toHaveLength(2);
    expect(r.albums).toHaveLength(2);
    expect(r.artists).toHaveLength(1);
    expect(r.playlists).toHaveLength(1);
  });

  it('retries with the plain include list when TIDAL rejects the nested one, and remembers it', async () => {
    const answer = (c: Call) => (c.url.searchParams.get('include')!.includes('.') ? j({ errors: [{ status: '400', detail: 'Invalid include' }] }, 400) : fullDoc());
    const { provider, calls } = rig(server(answer), { tokens: false });
    const first = await provider.library.search('nina');
    expect(first.tracks).toHaveLength(2);
    const searches = () => apiCalls(calls).filter((c) => apiPath(c) === '/searchResults');
    expect(searches().map((c) => c.url.searchParams.get('include'))).toEqual([expect.stringContaining('tracks.artists'), 'tracks,albums,artists,playlists']);
    await provider.library.search('nina again');
    expect(searches().map((c) => c.url.searchParams.get('include')).slice(2)).toEqual(['tracks,albums,artists,playlists']);
  });

  it('does not give up on nested includes just because one search failed for another reason', async () => {
    let failing = true;
    const answer = () => (failing ? j({ errors: [{ status: '400', detail: 'Bad query' }] }, 400) : fullDoc());
    const { provider, calls } = rig(server(answer), { tokens: false });
    await expect(provider.library.search('bad')).rejects.toMatchObject({ code: 'unavailable' });
    failing = false;
    await provider.library.search('good');
    const last = apiCalls(calls).filter((c) => apiPath(c) === '/searchResults').at(-1)!;
    expect(last.url.searchParams.get('include')).toContain('tracks.artists');
  });
});

describe('market and availability', () => {
  const usersMe = (country: string) => j({ data: { id: 'u1', type: 'users', attributes: { country, developerAccessTier: 'THIRD_PARTY', username: 'x' } }, links: { self: '/users/me' } });
  const handler = (country: () => Response) => (c: Call) => {
    if (isToken(c)) return appToken();
    if (apiPath(c) === '/users/me') return country();
    return emptySearch();
  };
  const countries = (calls: Call[]) => apiCalls(calls).filter((c) => apiPath(c) === '/searchResults').map((c) => c.url.searchParams.get('countryCode'));

  it('defaults to US', async () => {
    const { provider, calls } = rig(handler(() => usersMe('NO')), { tokens: false });
    await provider.library.search('x');
    expect(countries(calls)).toEqual(['US']);
    expect(apiCalls(calls).some((c) => apiPath(c) === '/users/me')).toBe(false);
  });

  it('takes the market from the country setting and from TIDAL_COUNTRY, ignoring junk', async () => {
    const injected = rig(handler(() => usersMe('NO')), { tokens: false, country: 'de' });
    await injected.provider.library.search('x');
    expect(countries(injected.calls)).toEqual(['DE']);

    vi.stubEnv('TIDAL_COUNTRY', ' gb ');
    const fromEnv = rig(handler(() => usersMe('NO')), { tokens: false });
    await fromEnv.provider.library.search('x');
    expect(countries(fromEnv.calls)).toEqual(['GB']);

    vi.stubEnv('TIDAL_COUNTRY', 'Germany');
    const junk = rig(handler(() => usersMe('NO')), { tokens: false });
    await junk.provider.library.search('x');
    expect(countries(junk.calls)).toEqual(['US']);
  });

  it('an explicit country wins and then /users/me is not even asked', async () => {
    const { provider, calls } = rig(handler(() => usersMe('NO')), { country: 'DE' });
    await provider.library.search('x');
    expect(countries(calls)).toEqual(['DE']);
    expect(apiCalls(calls).some((c) => apiPath(c) === '/users/me')).toBe(false);
  });

  it('with an account sign-in it learns the account country once from GET /users/me and keeps it with the sign-in', async () => {
    const { provider, calls, store } = rig(handler(() => usersMe('no')));
    await provider.library.search('x');
    await provider.library.search('y');
    const me = apiCalls(calls).filter((c) => apiPath(c) === '/users/me');
    expect(me).toHaveLength(1);
    expect(me[0]!.headers.Authorization).toBe('Bearer AT');
    expect(me[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(countries(calls)).toEqual(['NO', 'NO']);
    expect(await store.read('tidal.json')).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', country: 'NO' });
  });

  it('a restart already knows the saved country and does not ask again', async () => {
    const { provider, calls } = rig(handler(() => usersMe('SE')), { tokens: { country: 'se' } });
    await provider.library.search('x');
    expect(countries(calls)).toEqual(['SE']);
    expect(apiCalls(calls).some((c) => apiPath(c) === '/users/me')).toBe(false);
  });

  it('never refreshes an expired access token just to learn the country, and never marks the sign-in expired', async () => {
    const { provider, calls, store } = rig(handler(() => usersMe('NO')), { tokens: { expiresAt: T0 + 10_000 } });
    await provider.library.search('x');
    expect(countries(calls)).toEqual(['US']);
    expect(calls.filter(isToken).every((c) => c.form?.get('grant_type') !== 'refresh_token')).toBe(true);
    expect(apiCalls(calls).some((c) => apiPath(c) === '/users/me')).toBe(false);
    expect(await store.read('tidal.json')).toMatchObject({ refreshToken: 'RT' });
  });

  it('a 401 from /users/me is ignored: no forced refresh, no "login expired"', async () => {
    const { provider, calls } = rig(handler(() => j({ errors: [{ status: '401' }] }, 401)));
    await provider.library.search('x');
    expect(countries(calls)).toEqual(['US']);
    expect(calls.filter(isToken).every((c) => c.form?.get('grant_type') !== 'refresh_token')).toBe(true);
    expect(provider.connection()).toMatchObject({ connected: true });
    expect(provider.connection().problem).toBeUndefined();
  });

  it('a country learned while a refresh is in flight does not make the refresh result get dropped', async () => {
    const meGate = deferred<Response>();
    const tokenGate = deferred<Response>();
    const { provider, store, clock } = rig(
      (c) => {
        if (isToken(c)) return c.form?.get('grant_type') === 'refresh_token' ? tokenGate.promise : appToken();
        if (apiPath(c) === '/users/me') return meGate.promise;
        return emptySearch();
      },
      { tokens: { expiresAt: T0 + 61_000 } },
    );
    await tick();
    const searching = provider.library.search('x'); // token is good: asks /users/me and waits for the answer
    await tick();
    await tick();
    clock.t += 2_000; // the access token now needs a refresh
    const refreshing = provider.library.playlists();
    await tick();
    await tick();
    meGate.resolve(usersMe('NO'));
    await searching;
    tokenGate.resolve(j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, scope: 'user.read playback' }));
    await refreshing;
    expect(await store.read('tidal.json')).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT2', country: 'NO' });
  });

  it('forgets the account country when the user signs out', async () => {
    const { provider, calls } = rig(handler(() => usersMe('NO')));
    await provider.library.search('x');
    await provider.logout();
    await provider.library.search('y');
    expect(countries(calls)).toEqual(['NO', 'US']);
  });

  it('ignores a failing /users/me (no problem flagged, not asked again for a while)', async () => {
    const forbidden = rig(handler(() => j({ errors: [{ status: '403', detail: 'Missing scope' }] }, 403)));
    await forbidden.provider.library.search('x');
    await forbidden.provider.library.search('y');
    expect(countries(forbidden.calls)).toEqual(['US', 'US']);
    expect(apiCalls(forbidden.calls).filter((c) => apiPath(c) === '/users/me')).toHaveLength(1);
    expect(forbidden.provider.connection()).toMatchObject({ connected: true });
    expect(forbidden.provider.connection().problem).toBeUndefined();

    let up = false;
    const flaky = rig(handler(() => (up ? usersMe('SE') : j({}, 500))));
    await flaky.provider.library.search('x');
    up = true;
    await flaky.provider.library.search('y');
    expect(countries(flaky.calls)).toEqual(['US', 'US']);
    flaky.clock.t += 11 * 60_000;
    await flaky.provider.library.search('z');
    expect(countries(flaky.calls)).toEqual(['US', 'US', 'SE']);
  });

  it('uses the account country for the other catalog calls too', async () => {
    const { provider, calls } = rig((c) => {
      if (isToken(c)) return appToken();
      if (apiPath(c) === '/users/me') return usersMe('NO');
      if (apiPath(c) === '/albums/A1/relationships/items') return j({ data: [{ type: 'tracks', id: 't1' }], links: { self: '/x' } });
      return j({ data: [], links: { self: '/x' } });
    });
    await provider.library.album('A1');
    const withCountry = apiCalls(calls).filter((c) => apiPath(c) !== '/users/me');
    expect(withCountry.length).toBeGreaterThanOrEqual(3);
    expect(withCountry.every((c) => c.url.searchParams.get('countryCode') === 'NO')).toBe(true);
  });

  it('marks a track as not playable only when TIDAL lists its usage and STREAM is not part of it', async () => {
    const mk = (id: string, availability?: string[]) => track(id, `T${id}`, { artists: ['10'], album: '20', ...(availability ? { availability } : {}) });
    const cat: Catalog = { artists: [artist('10', 'A')], albums: [album('20', 'Alb', ['10'])], tracks: [mk('1', ['STREAM', 'DJ']), mk('2', ['DJ']), mk('3'), mk('4', ['STREAM']), mk('5', [])] };
    const doc = j({ data: [{ id: 'S', type: 'searchResults', relationships: { tracks: ref('tracks', '1', '2', '3', '4', '5') } }], links: { self: '/s' } });
    const { provider } = rig((c) => (isToken(c) ? appToken() : apiPath(c).startsWith('/searchResults') ? doc : (catalogByIds(cat, c) ?? j({}, 404))), { tokens: false });
    const r = await provider.library.search('x');
    expect(r.tracks.map((t) => t.playable)).toEqual([true, false, true, true, true]);
  });
});
