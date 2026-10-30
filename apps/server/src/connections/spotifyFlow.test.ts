/**
 * The whole sign-in, over HTTP, through the REAL Spotify provider, hub, credential store and token file — only
 * Spotify itself is mocked (the injected fetch). This is what the Settings card and the Music page's "Sign in" drive.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type ServiceConnection } from '@headunit/shared';
import { config } from '../config';
import { Observable } from '../observable';
import { createCamera } from '../providers/camera';
import { createSimDevices } from '../demo/devicesSim';
import { createMockMedia } from '../demo/mediaMock';
import { pkceChallenge } from '../providers/mediaSpotify';
import { createMockProjection } from '../demo/projection';
import { createVehicleSim } from '../demo/vehicleSim';
import { createRadio } from '../radio/radio';
import { createApp } from '../server';
import { JsonStore } from '../store';
import { createSimSystem } from '../demo/system';
import { CREDENTIALS_FILE } from './credentials';
import { createMusic } from './music';

const ID_A = '0123456789abcdef0123456789abcdef';
const ID_B = 'fedcba9876543210fedcba9876543210';
const AT = 'ACCESS-TOKEN-SENTINEL-1';
const RT = 'REFRESH-TOKEN-SENTINEL-1';
const CODE = 'one-time-code-SENTINEL';
const PORT_IN_CONFIG = 8787;
const UI_URL = '/ui-home';

let dir: string;
let closers: Array<() => void> = [];
let seen: string[] = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'spotify-flow-'))));
afterEach(async () => {
  const bodies = seen.join('\n');
  seen = [];
  for (const c of closers) c();
  closers = [];
  await rm(dir, { recursive: true, force: true });
  // No response of the whole test may carry a token, a refresh token or the one-time code.
  for (const secret of [AT, RT, CODE]) expect(bodies).not.toContain(secret);
});

interface SpotifyCall {
  url: string;
  method: string;
  body?: string;
}

async function boot() {
  const calls: SpotifyCall[] = [];
  const spotify = (async (url: string, init: RequestInit = {}) => {
    const call: SpotifyCall = { url: String(url), method: init.method ?? 'GET', body: init.body ? String(init.body) : undefined };
    calls.push(call);
    if (call.url === 'https://accounts.spotify.com/api/token') {
      const grant = new URLSearchParams(call.body).get('grant_type');
      if (grant === 'authorization_code') {
        const code = new URLSearchParams(call.body).get('code');
        if (code !== CODE) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
        return new Response(JSON.stringify({ access_token: AT, refresh_token: RT, expires_in: 3600, scope: 'user-read-playback-state' }), { status: 200 });
      }
    }
    if (call.url.startsWith('https://api.spotify.com/v1/me/player/devices')) {
      return new Response(JSON.stringify({ devices: [{ id: 'd1', name: 'Head Unit', is_active: true, type: 'Speaker', volume_percent: 40 }] }), { status: 200 });
    }
    if (call.url.startsWith('https://api.spotify.com/v1/me/player')) return new Response(null, { status: 204 });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  const store = new JsonStore(dir);
  const settings = new Observable({ ...DEFAULT_SETTINGS });
  const music = createMusic({
    store,
    settings,
    config: {
      port: PORT_IN_CONFIG,
      spotify: { clientId: '', redirectUri: '', deviceName: 'Head Unit', pollMs: 3000 },
      tidal: { clientId: '', redirectUri: '', scopes: '' },
    },
    fetch: spotify,
    mock: createMockMedia(),
    allowDemo: true,
  });
  await music.ready;
  const app = createApp({
    config: { ...config, dataDir: dir, uiUrl: UI_URL },
    store,
    vehicle: createVehicleSim(),
    media: music.media,
    connections: music.connections,
    system: createSimSystem(),
    projection: createMockProjection(),
    devices: createSimDevices(),
    radio: createRadio({ store }),
    camera: createCamera(),
    settings,
    layout: new Observable(DEFAULT_LAYOUT),
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  closers.push(() => app.close(), () => music.dispose());
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    seen.push(text);
    return { status: res.status, headers: res.headers, text, json: <T = Record<string, unknown>>() => JSON.parse(text) as T };
  }
  const connection = async () => (await call('GET', '/api/connections/spotify')).json<ServiceConnection>();
  const login = async () => new URL((await call('POST', '/api/connections/spotify/login')).json<{ url: string }>().url);
  const tokenFile = async () => JSON.parse(await readFile(join(dir, 'spotify.json'), 'utf8')) as Record<string, unknown> | null;
  return { call, calls, music, connection, login, tokenFile };
}

const redirect = (state: string, code = CODE) => `http://127.0.0.1:${PORT_IN_CONFIG}/auth/spotify/callback?code=${code}&state=${state}`;

describe('Spotify sign-in from Settings, through the real provider', () => {
  it('save Client ID -> login address -> paste the redirect address -> signed in, tokens on disk only', async () => {
    const s = await boot();
    expect(s.music.media.state.get().provider).toBe('mock'); // nothing configured: the demo

    const saved = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A.toUpperCase() });
    expect(saved.status).toBe(200);
    expect(saved.json<ServiceConnection>()).toMatchObject({ configured: true, clientId: ID_A, clientIdSource: 'saved', connected: false, loginPending: false });
    expect(s.music.media.state.get()).toMatchObject({ provider: 'spotify', status: 'needs-auth' }); // the Connect prompt

    const u = await s.login();
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('client_id')).toBe(ID_A);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${PORT_IN_CONFIG}/auth/spotify/callback`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(
      expect.arrayContaining(['user-read-playback-state', 'user-modify-playback-state', 'user-library-read', 'user-library-modify', 'playlist-read-private']),
    );
    const state = u.searchParams.get('state')!;
    expect(state.length).toBeGreaterThan(10);

    // The pending sign-in lives in the provider: it must survive other requests and a no-change save (same instance).
    expect((await s.connection()).loginPending).toBe(true);
    expect((await s.call('PUT', '/api/connections/spotify', { clientId: ID_A })).json<ServiceConnection>().loginPending).toBe(true);
    expect((await s.call('POST', '/api/connections/spotify/test')).json()).toMatchObject({ ok: false, message: 'Not signed in yet' });
    expect(s.calls).toEqual([]); // nothing has gone to Spotify yet

    const pasted = await s.call('POST', '/api/connections/spotify/paste', { text: `  ${redirect(state)}\n` });
    expect(pasted.status).toBe(200);
    const conn = pasted.json<ServiceConnection>();
    expect(conn).toMatchObject({ connected: true, loginPending: false, configured: true });
    expect(conn.connectedAt).toBeGreaterThan(0);
    expect(conn.loginExpiresAt).toBeGreaterThan(conn.connectedAt!);
    expect(conn.problem).toBeUndefined();

    // Spotify was asked for tokens with the verifier that matches the challenge in the login address.
    const exchange = s.calls.find((c) => c.url === 'https://accounts.spotify.com/api/token')!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe(ID_A);
    expect(form.get('code')).toBe(CODE);
    expect(form.get('redirect_uri')).toBe(`http://127.0.0.1:${PORT_IN_CONFIG}/auth/spotify/callback`);
    expect(pkceChallenge(form.get('code_verifier')!)).toBe(u.searchParams.get('code_challenge'));
    expect(form.get('client_secret')).toBeNull(); // PKCE: the Client secret is never used

    // Tokens are on disk (private) and nowhere in any answer.
    expect(await s.tokenFile()).toMatchObject({ accessToken: AT, refreshToken: RT, clientId: ID_A });
    if (process.platform !== 'win32') expect((await stat(join(dir, 'spotify.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(await s.connection())).not.toMatch(/token|secret/i);

    // The same address can't be used twice.
    const again = await s.call('POST', '/api/connections/spotify/paste', { text: redirect(state) });
    expect(again.status).toBe(400);
    expect(again.json<{ error: string }>().error).toMatch(/expired or invalid|again/i);

    // Test works with the saved sign-in, and the Music page's player is now Spotify's, signed in.
    expect((await s.call('POST', '/api/connections/spotify/test')).json()).toMatchObject({ ok: true, message: expect.stringMatching(/1 playback device/) });
    expect(s.music.media.state.get()).toMatchObject({ provider: 'spotify', status: 'no-device' });
  });

  it('the head unit browser path (/auth/spotify/login -> /auth/spotify/callback) uses the same pending sign-in', async () => {
    const s = await boot();
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    const go = await s.call('GET', '/auth/spotify/login');
    expect(go.status).toBe(302);
    const u = new URL(go.headers.get('location')!);
    expect(u.searchParams.get('client_id')).toBe(ID_A);

    const back = await s.call('GET', `/auth/spotify/callback?code=${CODE}&state=${u.searchParams.get('state')}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(UI_URL);
    expect((await s.connection()).connected).toBe(true);

    const stale = await s.call('GET', `/auth/spotify/callback?code=${CODE}&state=nope`);
    expect(stale.status).toBe(400);
    expect(stale.headers.get('content-type')).toMatch(/text\/html/);
    expect(stale.text).not.toContain(CODE);
  });

  it('a garbage paste is a plain 400 and keeps the pending sign-in; a wrong code is refused without leaking', async () => {
    const s = await boot();
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    const state = (await s.login()).searchParams.get('state')!;

    const junk = await s.call('POST', '/api/connections/spotify/paste', { text: 'hello there' });
    expect(junk.status).toBe(400);
    expect(Object.keys(junk.json())).toEqual(['error']);
    expect(junk.json<{ error: string }>().error).toMatch(/code=/);
    expect((await s.connection()).loginPending).toBe(true);

    const wrongCode = await s.call('POST', '/api/connections/spotify/paste', { text: redirect(state, 'a-wrong-code') });
    expect(wrongCode.status).toBe(400);
    expect(wrongCode.text).not.toContain('a-wrong-code');
    expect((await s.connection()).connected).toBe(false);
  });

  it('a different Client ID discards the old sign-in; sign out keeps the ID; forget removes it and the demo returns', async () => {
    const s = await boot();
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    const state = (await s.login()).searchParams.get('state')!;
    await s.call('POST', '/api/connections/spotify/paste', { text: redirect(state) });
    expect((await s.connection()).connected).toBe(true);

    // Changing only the Redirect URI keeps tokens (they belong to the Client ID).
    const sameId = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, redirectUri: 'https://car.example.com/spotify/callback' });
    expect(sameId.json<ServiceConnection>()).toMatchObject({ connected: true, redirectUri: 'https://car.example.com/spotify/callback', redirectUriSource: 'saved' });

    const other = await s.call('PUT', '/api/connections/spotify', { clientId: ID_B });
    expect(other.json<ServiceConnection>()).toMatchObject({ clientId: ID_B, connected: false });
    expect(await s.tokenFile()).toBeNull();

    // Sign in again with the new ID, then sign out / forget.
    const st2 = (await s.login()).searchParams.get('state')!;
    await s.call('POST', '/api/connections/spotify/paste', { text: redirect(st2) });
    expect((await s.connection()).connected).toBe(true);

    const out = await s.call('DELETE', '/api/connections/spotify');
    expect(out.json<ServiceConnection>()).toMatchObject({ connected: false, configured: true, clientId: ID_B });
    expect(await s.tokenFile()).toBeNull();

    const forgot = await s.call('DELETE', '/api/connections/spotify?forget=1');
    expect(forgot.json<ServiceConnection>()).toMatchObject({ configured: false, clientId: '', clientIdSource: 'none' });
    expect(s.music.media.state.get().provider).toBe('mock');
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({});
  });
});
