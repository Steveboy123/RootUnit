import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../store';
import { createSpotifyMedia, pkceChallenge } from './mediaSpotify';

const cfg = { clientId: 'cid', redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback', deviceName: 'Head Unit', pollMs: 3000 };

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'hu-'))));
afterEach(async () => rm(dir, { recursive: true, force: true }));

type Call = { url: string; method: string; body?: string; auth?: string };
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ? String(init.body) : undefined,
      auth: (init.headers as Record<string, string> | undefined)?.Authorization,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const j = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });

async function seedTokens(store: JsonStore, expiresAt = Date.now() + 3600_000) {
  await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt });
}

describe('PKCE', () => {
  it('matches the RFC 7636 test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('spotify provider', () => {
  it('reports needs-auth without tokens', async () => {
    const store = new JsonStore(dir);
    const { fn, calls } = fakeFetch(() => j({}));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    expect(sp.state.get().status).toBe('needs-auth');
    expect(calls).toHaveLength(0);
  });

  it('builds a PKCE authorize URL and completes login', async () => {
    const store = new JsonStore(dir);
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.includes('/api/token')) return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      return new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    const u = new URL(sp.beginLogin());
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    const state = u.searchParams.get('state')!;

    await expect(sp.finishLogin('code', 'wrong-state')).rejects.toThrow(/expired or invalid/);
    await sp.finishLogin('code', state);
    const tokenCall = calls.find((c) => c.url.includes('/api/token'))!;
    const body = new URLSearchParams(tokenCall.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(pkceChallenge(body.get('code_verifier')!)).toBe(u.searchParams.get('code_challenge'));
    expect(body.get('client_secret')).toBeNull();
    // Replaying the same state must fail.
    await expect(sp.finishLogin('code', state)).rejects.toThrow();
    expect(sp.state.get().status).toBe('no-device'); // 204 from /me/player
  });

  it('parses now-playing state', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() =>
      j({
        is_playing: true,
        progress_ms: 42_000,
        shuffle_state: true,
        repeat_state: 'context',
        device: { name: 'Head Unit', volume_percent: 33 },
        item: {
          id: 't1',
          type: 'track',
          name: 'Song',
          duration_ms: 200_000,
          artists: [{ name: 'A' }, { name: 'B' }],
          album: { name: 'Alb', images: [{ url: 'http://img/1.jpg' }] },
        },
      }),
    );
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    const s = sp.state.get();
    expect(s).toMatchObject({ status: 'ready', playing: true, progressMs: 42_000, volume: 33, shuffle: true, repeat: 'context', deviceName: 'Head Unit' });
    expect(s.track).toMatchObject({ title: 'Song', artist: 'A, B', album: 'Alb', artUrl: 'http://img/1.jpg', durationMs: 200_000 });
  });

  it('refreshes an expiring token and keeps the old refresh token if none is returned', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store, Date.now() + 5_000);
    const { fn, calls } = fakeFetch((c) =>
      c.url.includes('/api/token') ? j({ access_token: 'AT2', expires_in: 3600 }) : new Response(null, { status: 204 }),
    );
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    const refresh = calls.find((c) => c.url.includes('/api/token'))!;
    expect(new URLSearchParams(refresh.body).get('refresh_token')).toBe('RT');
    expect(calls.find((c) => c.url.includes('/me/player'))!.auth).toBe('Bearer AT2');
    await store.write('noop', 1); // flush queue
    expect(await store.read('spotify.json')).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT' });
  });

  it('retries once on 401 with a fresh token', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let n = 0;
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.includes('/api/token')) return j({ access_token: 'AT-new', expires_in: 3600 });
      return n++ === 0 ? new Response(null, { status: 401 }) : new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    expect(calls.filter((c) => c.url.includes('/me/player'))).toHaveLength(2);
    expect(sp.state.get().status).toBe('no-device');
  });

  it('honours Retry-After on 429 (no hammering)', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let t = 1_000_000_000_000;
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 429, headers: { 'retry-after': '30' } }));
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: t + 3600_000 });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t });
    await sp.poll();
    await sp.poll();
    expect(calls).toHaveLength(1);
    t += 31_000;
    await sp.poll();
    expect(calls).toHaveLength(2);
  });

  it('wakes our own Connect device when there is no active device', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let played = 0;
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/me/player/play')) return played++ === 0 ? j({ error: {} }, 404) : new Response(null, { status: 204 });
      if (c.url.endsWith('/me/player/devices')) return j({ devices: [{ id: 'dev1', name: 'head unit' }] });
      return new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'play' });
    const transfer = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/me/player'))!;
    expect(JSON.parse(transfer.body!)).toEqual({ device_ids: ['dev1'], play: false });
    expect(calls.filter((c) => c.url.endsWith('/me/player/play'))).toHaveLength(2);
    sp.stop();
  });

  it('surfaces a clear message when Premium is missing (judged from Spotify\'s own message)', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    // Used to be a bare 403 that always meant "Premium"; Spotify's 403 is generic, so the wording now follows its message.
    const { fn } = fakeFetch(() => j({ error: { status: 403, message: 'Player command failed: Premium required' } }, 403));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'next' });
    expect(sp.state.get()).toMatchObject({ status: 'error', error: expect.stringContaining('Premium') });
    sp.stop();
  });

  it('does not blame Premium for other 403s: it passes Spotify\'s message on', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() => j({ error: { status: 403, message: 'User not registered in the Developer Dashboard' } }, 403));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'next' });
    const err = sp.state.get().error!;
    expect(err).toBe('Spotify refused the request (403): User not registered in the Developer Dashboard');
    expect(err).not.toContain('Premium');
    sp.stop();
  });

  it('says to sign in again when a 403 is about the permission scope, and records a permissions problem', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() => j({ error: { status: 403, message: 'Insufficient client scope' } }, 403));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'next' });
    expect(sp.state.get().error).toMatch(/permission.*sign in again/i);
    expect(sp.connection()).toMatchObject({ connected: true, problem: 'permissions', message: expect.stringMatching(/permission/) });
    sp.stop();
  });

  it('lists playlists tolerating the tracks → items rename (February 2026)', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() =>
      j({ items: [{ id: '1', uri: 'u1', name: 'A', tracks: { total: 3 }, images: [{ url: 'i', width: 300 }] }, null, { id: '2', uri: 'u2', name: 'B', items: { total: 9 }, images: [] }] }),
    );
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    expect(await sp.library.playlists()).toEqual([
      { id: '1', uri: 'u1', type: 'playlist', name: 'A', subtitle: undefined, artUrl: 'i', trackCount: 3 },
      { id: '2', uri: 'u2', type: 'playlist', name: 'B', subtitle: undefined, artUrl: undefined, trackCount: 9 },
    ]);
  });
});

describe('spotify provider: library features', () => {
  const playbackBody = (calls: Call[]) => JSON.parse(calls.find((c) => c.url.includes('/me/player/play'))!.body!);

  it('asks for the library permissions when logging in', () => {
    const store = new JsonStore(dir);
    const sp = createSpotifyMedia({ config: cfg, store });
    const scope = new URL(sp.beginLogin()).searchParams.get('scope')!.split(' ');
    for (const s of ['user-library-read', 'user-library-modify', 'user-top-read', 'user-read-recently-played', 'user-follow-read', 'user-modify-playback-state']) {
      expect(scope).toContain(s);
    }
  });

  it('plays a context from a track position', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'playContext', uri: 'spotify:playlist:p1', offset: 4 });
    expect(playbackBody(calls)).toEqual({ context_uri: 'spotify:playlist:p1', offset: { position: 4 } });
    calls.length = 0;
    await sp.command({ cmd: 'playContext', uri: 'spotify:album:a1' });
    expect(playbackBody(calls)).toEqual({ context_uri: 'spotify:album:a1' }); // no offset key when none given
    sp.stop();
  });

  it('plays a list of tracks (max 100) from an offset', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:t${i}`);
    await sp.command({ cmd: 'playTracks', uris, offset: 2 });
    const body = playbackBody(calls);
    expect(body.uris).toHaveLength(100);
    expect(body.offset).toEqual({ position: 2 });
    sp.stop();
  });

  it('adds to the queue with the uri in the query string', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'queueAdd', uri: 'spotify:track:abc' });
    const c = calls.find((x) => x.url.includes('/me/player/queue'))!;
    expect(c.method).toBe('POST');
    expect(c.url).toContain('uri=spotify%3Atrack%3Aabc');
    sp.stop();
  });

  it('looks up the liked state once per track and keeps it in sync when liking', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let containsCalls = 0;
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.includes('/me/library/contains')) {
        containsCalls++;
        return j([true]);
      }
      if (c.url.includes('/me/library')) return new Response(null, { status: 200 });
      return j({ is_playing: true, progress_ms: 1, device: { name: 'HU' }, item: { type: 'track', id: 'abc', name: 'S', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'Al', images: [] } } });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(sp.state.get().liked).toBe(true);
    await sp.poll();
    await sp.poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(containsCalls).toBe(1); // same track → no repeated lookups
    expect(await sp.library.setLiked('spotify:track:abc', false)).toBe(false);
    expect(sp.state.get().liked).toBe(false); // heart updates immediately
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/me/library?uris='))).toBe(true);
    await sp.library.setLiked('spotify:track:other', true);
    expect(sp.state.get().liked).toBe(false); // a different track doesn't change the current heart
    sp.stop();
  });

  it('leaves liked unknown (not false) when the permission is missing', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch((c) =>
      c.url.includes('/me/library') || c.url.includes('/me/tracks/contains')
        ? new Response('Insufficient client scope', { status: 403 })
        : j({ is_playing: true, progress_ms: 1, item: { type: 'track', id: 'abc', name: 'S', duration_ms: 1000, artists: [], album: { name: 'Al', images: [] } } }),
    );
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(sp.state.get().liked).toBeUndefined();
    sp.stop();
  });
});


// ---------------------------------------------------------------------------
// Sign-in lifecycle, failure classification, test(), 429 handling (connection setup work)
// ---------------------------------------------------------------------------

const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/api/token'));
const pathOf = (c: Call) => new URL(c.url).pathname;
/** A refresh is due: the access token has under a minute left. */
const seedExpiring = (store: JsonStore) => store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 5_000 });

describe('spotify provider: connection()', () => {
  const grant = { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: 'user-read-playback-state user-library-read' };

  it('is not connected before signing in', async () => {
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fakeFetch(() => j({})).fn });
    expect(sp.connection()).toEqual({ connected: false, loginPending: false });
  });

  it('reports a pending sign-in until it completes or the link expires', async () => {
    let t = T0;
    const { fn } = fakeFetch((c) => (c.url.includes('/api/token') ? j(grant) : new Response(null, { status: 204 })));
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn, now: () => t });
    const st = new URL(sp.beginLogin()).searchParams.get('state')!;
    expect(sp.connection().loginPending).toBe(true);
    await sp.finishLogin('code', st);
    expect(sp.connection().loginPending).toBe(false);

    const sp2 = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn, now: () => t });
    sp2.beginLogin();
    t += 11 * 60_000; // login links last 10 minutes
    expect(sp2.connection().loginPending).toBe(false);
  });

  it('knows when you signed in, about when it lapses, and what you allowed; a refresh does not move those', async () => {
    const t = { now: T0 };
    const store = new JsonStore(dir);
    const { fn, calls } = fakeFetch((c) => {
      if (!c.url.includes('/api/token')) return new Response(null, { status: 204 });
      return new URLSearchParams(c.body).get('grant_type') === 'refresh_token' ? j({ access_token: 'AT2', expires_in: 3600 }) : j(grant);
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t.now });
    await sp.finishLogin('code', new URL(sp.beginLogin()).searchParams.get('state')!);
    expect(sp.connection()).toEqual({
      connected: true,
      loginPending: false,
      connectedAt: T0,
      loginExpiresAt: T0 + 180 * DAY, // "about six months" (third-party figure, see LOGIN_LIFETIME_MS)
      scopes: ['user-read-playback-state', 'user-library-read'],
    });

    t.now = T0 + 2 * 3600_000; // the access token has lapsed: the next poll renews it
    await sp.poll();
    expect(tokenCalls(calls).map((c) => new URLSearchParams(c.body).get('grant_type'))).toEqual(['authorization_code', 'refresh_token']);
    expect(sp.connection()).toMatchObject({ connected: true, connectedAt: T0, loginExpiresAt: T0 + 180 * DAY, scopes: ['user-read-playback-state', 'user-library-read'] });

    await store.flush();
    const saved = (await store.read('spotify.json')) as Record<string, unknown>;
    expect(saved).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT1', obtainedAt: T0, clientId: 'cid' });
    expect(Object.keys(saved).join()).not.toMatch(/secret/i);
  });

  it('reads the same facts back from the saved file after a restart', async () => {
    const store = new JsonStore(dir);
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 3600_000, obtainedAt: T0 - 10 * DAY, scope: 'a b', clientId: 'cid' });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fakeFetch(() => j({})).fn, now: () => T0 });
    await sp.poll(); // makes sure the file has been read
    expect(sp.connection()).toMatchObject({ connected: true, connectedAt: T0 - 10 * DAY, loginExpiresAt: T0 + 170 * DAY, scopes: ['a', 'b'] });
  });

  it('ignores a sign-in that belongs to a different Client ID', async () => {
    const store = new JsonStore(dir);
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 3600_000, clientId: 'some-other-app' });
    const { fn, calls } = fakeFetch(() => j({}));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await sp.poll();
    expect(sp.connection().connected).toBe(false);
    expect(sp.state.get().status).toBe('needs-auth');
    expect(calls).toHaveLength(0);
  });

  it('forgets everything on logout, including a problem and a pending sign-in', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() => j({ error: { status: 403, message: 'Insufficient client scope' } }, 403));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.library.liked().catch(() => undefined); // 403 about scope → permissions problem
    expect(sp.connection().problem).toBe('permissions');
    sp.beginLogin();
    await sp.logout();
    expect(sp.connection()).toEqual({ connected: false, loginPending: false });
    expect(sp.state.get()).toMatchObject({ status: 'needs-auth', track: null });
    expect(await store.read('spotify.json')).toBeNull();
  });

  it('clears a permissions problem when a new sign-in succeeds', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let denied = true;
    const { fn } = fakeFetch((c) => {
      if (c.url.includes('/api/token')) return j(grant);
      return denied ? j({ error: { status: 403, message: 'Insufficient client scope' } }, 403) : new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.library.liked().catch(() => undefined);
    expect(sp.connection().problem).toBe('permissions');
    denied = false;
    await sp.finishLogin('code', new URL(sp.beginLogin()).searchParams.get('state')!);
    expect(sp.connection().problem).toBeUndefined();
    expect(sp.connection().message).toBeUndefined();
  });
});

describe('spotify provider: failure classification', () => {
  it('invalid_grant on refresh: the sign-in has expired — tokens cleared, plain message, no hammering', async () => {
    const store = new JsonStore(dir);
    await seedExpiring(store);
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/api/token') ? j({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400) : new Response(null, { status: 204 })));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await sp.poll();
    const expired = 'Spotify says your sign-in has expired (they last about six months). Sign in again.';
    expect(sp.state.get()).toMatchObject({ status: 'needs-auth', playing: false, error: expired });
    expect(sp.connection()).toMatchObject({ connected: false, problem: 'login-expired', message: expired });
    await store.flush();
    expect(await store.read('spotify.json')).toBeNull();
    await sp.poll();
    await sp.poll();
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/me/player'))).toHaveLength(0);
    expect(sp.state.get().error).toBe(expired); // later polls keep saying why
    expect(await sp.test()).toEqual({ ok: false, message: expired });
  });

  it('invalid_client on refresh: Spotify does not know this app — flagged as rejected, not retried every poll', async () => {
    const store = new JsonStore(dir);
    await seedExpiring(store);
    const { fn, calls } = fakeFetch(() => j({ error: 'invalid_client', error_description: 'Invalid client' }, 400));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await sp.poll();
    const rejected = "Spotify doesn't recognise this Client ID — check it matches your app";
    expect(sp.state.get()).toMatchObject({ status: 'needs-auth', error: rejected });
    expect(sp.connection()).toMatchObject({ connected: false, problem: 'rejected', message: rejected });
    await sp.poll();
    expect(tokenCalls(calls)).toHaveLength(1);
    await sp.logout(); // signing out clears the problem
    expect(sp.connection()).toEqual({ connected: false, loginPending: false });
  });

  it('a network failure or Spotify 5xx while refreshing keeps the sign-in', async () => {
    const store = new JsonStore(dir);
    await seedExpiring(store);
    let mode: 'down' | '503' | 'ok' = 'down';
    const { fn } = fakeFetch((c) => {
      if (!c.url.includes('/api/token')) return new Response(null, { status: 204 });
      if (mode === 'down') throw new TypeError('fetch failed');
      return mode === '503' ? new Response('upstream', { status: 503 }) : j({ access_token: 'AT2', expires_in: 3600 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await sp.poll();
    expect(sp.state.get()).toMatchObject({ status: 'error', error: expect.stringContaining("Can't reach Spotify") });
    expect(sp.connection()).toMatchObject({ connected: true });
    expect(sp.connection().problem).toBeUndefined();
    mode = '503';
    await sp.poll();
    expect(sp.state.get().status).toBe('error');
    expect(sp.connection().connected).toBe(true);
    await store.flush();
    expect(await store.read('spotify.json')).toMatchObject({ refreshToken: 'RT' });
    mode = 'ok';
    await sp.poll();
    expect(sp.state.get().status).toBe('no-device'); // recovered on its own
  });

  it('renews the token only once when several requests find it expired at the same time', async () => {
    const store = new JsonStore(dir);
    await seedExpiring(store);
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/api/token') ? j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }) : new Response(null, { status: 204 })));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await Promise.all([sp.poll(), sp.command({ cmd: 'next' }), sp.test()]);
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.auth !== undefined).every((c) => c.auth === 'Bearer AT2')).toBe(true);
  });

  it('sign-in: a rejected code gets a plain explanation and stores nothing', async () => {
    const store = new JsonStore(dir);
    const { fn } = fakeFetch(() => j({ error: 'invalid_grant', error_description: 'Invalid authorization code' }, 400));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    const err = await sp.finishLogin('stale', new URL(sp.beginLogin()).searchParams.get('state')!).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/didn.t accept the sign-in code/);
    expect((err as Error).message).not.toMatch(/stale|Invalid authorization code/);
    expect(sp.connection().connected).toBe(false);
    expect(sp.connection().problem).toBeUndefined(); // a bad code is not a bad app
  });

  it('sign-in: a wrong Client ID is reported as rejected', async () => {
    const store = new JsonStore(dir);
    const { fn } = fakeFetch(() => j({ error: 'invalid_client', error_description: 'Invalid client' }, 400));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => T0 });
    await expect(sp.finishLogin('code', new URL(sp.beginLogin()).searchParams.get('state')!)).rejects.toThrow(/doesn't recognise this Client ID/);
    expect(sp.connection()).toMatchObject({ connected: false, problem: 'rejected' });
  });

  it('sign-in: no connection gives a plain message, not a stack trace', async () => {
    const store = new JsonStore(dir);
    const { fn } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await expect(sp.finishLogin('code', new URL(sp.beginLogin()).searchParams.get('state')!)).rejects.toThrow(/Couldn't reach Spotify/);
  });

  it('recovers when the first DNS connection to Spotify fails and the next one succeeds', async () => {
    const store = new JsonStore(dir);
    let tries = 0;
    const { fn } = fakeFetch((call) => {
      if (call.url.includes('/api/token')) {
        tries += 1;
        if (tries === 1) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('temporary DNS'), { code: 'EAI_AGAIN' }) });
        return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      }
      return new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    const st = new URL(sp.beginLogin()).searchParams.get('state')!;
    await sp.finishLogin('one-use-code', st);
    expect(tries).toBe(2);
    expect(sp.connection().connected).toBe(true);
    expect(sp.state.get().status).toBe('no-device');
    sp.stop();
  });

  it('keeps PKCE state after a temporary token-server outage, then consumes it on recovery', async () => {
    const store = new JsonStore(dir);
    let requests = 0;
    const { fn } = fakeFetch((call) => {
      if (call.url.includes('/api/token')) {
        requests++;
        if (requests < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } });
        return j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
      }
      return new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    const st = new URL(sp.beginLogin()).searchParams.get('state')!;
    await expect(sp.finishLogin('code', st)).rejects.toThrow(/DNS/);
    expect(sp.connection().loginPending).toBe(true);
    await sp.finishLogin('code', st);
    expect(sp.connection().connected).toBe(true);
    expect(sp.connection().loginPending).toBe(false);
    await expect(sp.finishLogin('code', st)).rejects.toThrow(/expired or invalid/);
    sp.stop();
  });

  it('never puts a token or the sign-in code in a message', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() => j({ error: { status: 500, message: 'oops' } }, 500));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'next' });
    await sp.poll();
    const seen = JSON.stringify([sp.state.get(), sp.connection(), await sp.test()]);
    expect(seen).not.toMatch(/\bAT\b|\bRT\b|Bearer/);
  });
});

describe('spotify provider: finishLoginFromPaste', () => {
  const okFetch = () => fakeFetch((c) => (c.url.includes('/api/token') ? j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) : new Response(null, { status: 204 })));

  it('finishes the sign-in from the pasted redirect address', async () => {
    const { fn, calls } = okFetch();
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn, now: () => T0 });
    const st = new URL(sp.beginLogin()).searchParams.get('state')!;
    await sp.finishLoginFromPaste(`  http://127.0.0.1:8787/auth/spotify/callback?code=THE-CODE&state=${st}  `);
    const body = new URLSearchParams(tokenCalls(calls)[0]!.body);
    expect(body.get('code')).toBe('THE-CODE');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(sp.connection()).toMatchObject({ connected: true, connectedAt: T0 });
  });

  it('accepts just the query string', async () => {
    const { fn } = okFetch();
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn });
    const st = new URL(sp.beginLogin()).searchParams.get('state')!;
    await sp.finishLoginFromPaste(`code=abc&state=${st}`);
    expect(sp.connection().connected).toBe(true);
  });

  it('explains what is wrong with a paste that is not the redirect address', async () => {
    const { fn, calls } = okFetch();
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn });
    sp.beginLogin();
    await expect(sp.finishLoginFromPaste('hello')).rejects.toThrow(/code=/);
    await expect(sp.finishLoginFromPaste('')).rejects.toThrow(/Paste/);
    await expect(sp.finishLoginFromPaste('http://x/cb?error=access_denied')).rejects.toThrow(/Spotify said: access_denied/);
    expect(calls).toHaveLength(0);
    expect(sp.connection().loginPending).toBe(true); // still waiting for the real one
  });

  it('refuses an address from a different sign-in attempt', async () => {
    const { fn, calls } = okFetch();
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn });
    sp.beginLogin();
    await expect(sp.finishLoginFromPaste('http://x/cb?code=abc&state=somebody-elses')).rejects.toThrow(/expired or invalid/);
    expect(calls).toHaveLength(0);
  });
});

describe('spotify provider: test()', () => {
  it('says how many playback devices Spotify reported', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let devices = [{ id: 'a' }, { id: 'b' }];
    const { fn, calls } = fakeFetch(() => j({ devices }));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    expect(await sp.test()).toEqual({ ok: true, message: 'Spotify answered — 2 playback devices found' });
    expect(calls.map((c) => [c.method, pathOf(c)])).toEqual([['GET', '/v1/me/player/devices']]);
    devices = [{ id: 'a' }];
    expect((await sp.test()).message).toBe('Spotify answered — 1 playback device found');
    devices = [];
    expect(await sp.test()).toMatchObject({ ok: true, message: expect.stringContaining('no playback devices') });
  });

  it('says so when not signed in, without calling Spotify', async () => {
    const { fn, calls } = fakeFetch(() => j({}));
    const sp = createSpotifyMedia({ config: cfg, store: new JsonStore(dir), fetch: fn });
    expect(await sp.test()).toEqual({ ok: false, message: 'Not signed in yet' });
    expect(calls).toHaveLength(0);
  });

  it('explains rate limiting, refusals and a missing connection — and never throws', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let respond: () => Response = () => j({});
    const { fn } = fakeFetch(() => respond());
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });

    respond = () => j({ error: { status: 429, message: 'API rate limit exceeded' } }, 429);
    expect(await sp.test()).toEqual({ ok: false, message: 'Spotify is rate limiting this app — try again in a moment' });

    respond = () => j({ error: { status: 403, message: 'Player command failed: Premium required' } }, 403);
    expect(await sp.test()).toEqual({ ok: false, message: 'Spotify refused the request (403): Player command failed: Premium required' });

    respond = () => new Response(null, { status: 500 });
    expect((await sp.test()).message).toContain('500');

    respond = () => {
      throw new TypeError('fetch failed');
    };
    expect(await sp.test()).toEqual({ ok: false, message: "Couldn't reach Spotify — check the Pi's internet connection" });
  });

  it('reports a saved sign-in Spotify no longer accepts', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch((c) => (c.url.includes('/api/token') ? j({ access_token: 'AT2', expires_in: 3600 }) : new Response(null, { status: 401 })));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    expect(await sp.test()).toEqual({ ok: false, message: expect.stringContaining('sign in again') });
  });
});

describe('spotify provider: 429', () => {
  it('a quota 429 backs off for at least a minute and says the app used up its quota', async () => {
    const store = new JsonStore(dir);
    let t = T0;
    const { fn, calls } = fakeFetch(() => j({ error: { status: 429, message: 'Rate limit: app quota exceeded' } }, 429, { 'retry-after': '3' }));
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 3600_000 });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t });
    await sp.poll();
    expect(sp.state.get()).toMatchObject({ status: 'error', error: expect.stringMatching(/quota/i) });
    t += 59_000; // a plain Retry-After of 3 s would be over by now
    await sp.poll();
    expect(calls).toHaveLength(1);
    t += 70_000; // 129 s after the 429
    await sp.poll();
    expect(calls).toHaveLength(2);
  });

  it('a long Retry-After on a quota 429 is honoured, a silly one is capped at an hour', async () => {
    const store = new JsonStore(dir);
    let t = T0;
    const { fn, calls } = fakeFetch(() => j({ error: { status: 429, message: 'quota exceeded' } }, 429, { 'retry-after': '999999' }));
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 7200_000 });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t });
    await sp.poll();
    t += 3599_000;
    await sp.poll();
    expect(calls).toHaveLength(1);
    t += 2_000;
    await sp.poll();
    expect(calls).toHaveLength(2);
  });

  it('a plain rate limit keeps the normal Retry-After behaviour and shows no error', async () => {
    const store = new JsonStore(dir);
    let t = T0;
    const { fn, calls } = fakeFetch(() => j({ error: { status: 429, message: 'API rate limit exceeded' } }, 429, { 'retry-after': '10' }));
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 3600_000 });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t });
    await sp.poll();
    expect(sp.state.get().error).toBeUndefined();
    t += 11_000;
    await sp.poll();
    expect(calls).toHaveLength(2);
  });

  it('a 429 without a JSON body still just waits', async () => {
    const store = new JsonStore(dir);
    let t = T0;
    const { fn, calls } = fakeFetch(() => new Response('Too many requests', { status: 429 }));
    await store.write('spotify.json', { accessToken: 'AT', refreshToken: 'RT', expiresAt: T0 + 3600_000 });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn, now: () => t });
    await sp.poll();
    await sp.poll();
    expect(calls).toHaveLength(1);
    t += 6_000; // the 5 s default
    await sp.poll();
    expect(calls).toHaveLength(2);
  });

  it('test() says the quota is used up rather than "rate limiting"', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn } = fakeFetch(() => j({ error: { status: 429, message: 'quota exceeded' } }, 429));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    expect((await sp.test()).message).toMatch(/quota/i);
  });
});

describe('spotify provider: now playing details', () => {
  const playing = (extra: Record<string, unknown>) =>
    j({ is_playing: true, progress_ms: 1000, device: { name: 'HU' }, item: { type: 'track', id: 'old', uri: 'spotify:track:old', name: 'Old Song', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'Al', images: [] } }, ...extra });

  it('shows a placeholder instead of the previous title while an advert plays', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let body = playing({});
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/me/library') ? j([false]) : body.clone()));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    expect(sp.state.get().track?.title).toBe('Old Song');
    body = j({ is_playing: true, progress_ms: 0, currently_playing_type: 'ad', item: null, device: { name: 'HU' } });
    await sp.poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(sp.state.get()).toMatchObject({ status: 'ready', playing: true, track: { title: 'Advertisement' } });
    // An advert is not a song you can like: no lookup for it.
    expect(calls.filter((c) => c.url.includes('/me/library/contains')).map((c) => decodeURIComponent(c.url))).toEqual([expect.stringContaining('spotify:track:old')]);
  });

  it('names a podcast episode after its show when the (deprecated) publisher is missing', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let show: Record<string, string> = { name: 'The Show' };
    const { fn } = fakeFetch(() => j({ is_playing: true, device: {}, item: { type: 'episode', id: 'e1', uri: 'spotify:episode:e1', name: 'Ep 1', duration_ms: 5000, show, images: [{ url: 'img' }] } }));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.poll();
    expect(sp.state.get().track).toMatchObject({ title: 'Ep 1', artist: 'The Show', album: 'The Show', artUrl: 'img' });
    show = { name: 'The Show', publisher: 'The Network' };
    await sp.poll();
    expect(sp.state.get().track?.artist).toBe('The Network');
  });
});

describe('spotify provider: command ordering', () => {
  it('waits for a shuffle request to finish before it starts playing (Spotify does not order player calls)', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fn, calls } = fakeFetch(async (c) => {
      if (c.url.includes('/me/player/shuffle')) await gate;
      return new Response(null, { status: 204 });
    });
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    // What the Shuffle button sends: shuffle, then play, back to back.
    const shuffle = sp.command({ cmd: 'shuffle', enabled: true });
    const play = sp.command({ cmd: 'playContext', uri: 'spotify:playlist:p1' });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.map(pathOf)).toEqual(['/v1/me/player/shuffle']); // play is still waiting
    release();
    await Promise.all([shuffle, play]);
    expect(calls.map(pathOf)).toEqual(['/v1/me/player/shuffle', '/v1/me/player/play']);
    expect(JSON.parse(calls[1]!.body!)).toEqual({ context_uri: 'spotify:playlist:p1' });
  });

  it('a failed shuffle does not block the play that follows', async () => {
    const store = new JsonStore(dir);
    await seedTokens(store);
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/shuffle') ? j({ error: { status: 403, message: 'Player command failed: Premium required' } }, 403) : new Response(null, { status: 204 })));
    const sp = createSpotifyMedia({ config: cfg, store, fetch: fn });
    await sp.command({ cmd: 'shuffle', enabled: true });
    await sp.command({ cmd: 'playContext', uri: 'spotify:album:a' });
    expect(calls.map(pathOf)).toEqual(['/v1/me/player/shuffle', '/v1/me/player/play']);
  });
});
