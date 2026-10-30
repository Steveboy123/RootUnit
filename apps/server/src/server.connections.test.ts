import { request } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type ConnectionsResponse, type MusicSource, type ServiceConnection } from '@headunit/shared';

type TestSource = MusicSource | 'demo';
import { config } from './config';
import { CREDENTIALS_FILE } from './connections/credentials';
import { LEAK, createFakeWorld, type FakeWorld } from './connections/fakes';
import { createMusic, type ConnectionsApi } from './connections/music';
import { Observable } from './observable';
import { createCamera } from './providers/camera';
import { createSimDevices } from './demo/devicesSim';
import { createMockMedia } from './demo/mediaMock';
import { createMockProjection } from './demo/projection';
import { createVehicleSim } from './demo/vehicleSim';
import { createRadio } from './radio/radio';
import { createApp } from './server';
import { JsonStore } from './store';
import { createSimSystem } from './demo/system';

const ID_A = '0123456789abcdef0123456789abcdef';
const ID_B = 'fedcba9876543210fedcba9876543210';
const TIDAL_ID = 'tidalClient123';
const TIDAL_ID_2 = 'tidalClient456';
/** Pasted from the TIDAL dashboard next to the Client ID. No response, file other than credentials.json, or log may carry it. */
const TIDAL_SECRET = 'tidal-secret-123456789';
const TIDAL_SECRET_2 = 'tidal-secret-abcdefghij';
const EVIL = { Origin: 'https://evil.example.com' };
const UI_URL = '/?welcome="1"&x=<b>';

let dir: string;
let closers: Array<() => void> = [];
/** Every response body of the test, to prove no secret ever appears in any of them. */
let seen: string[] = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'srv-conn-'))));
afterEach(async () => {
  const bodies = seen.join('\n');
  seen = [];
  for (const c of closers) c();
  closers = [];
  await rm(dir, { recursive: true, force: true });
  expect(bodies).not.toContain(LEAK);
  expect(bodies).not.toContain(TIDAL_SECRET); // every response of every test: the TIDAL Client Secret is never sent back
  expect(bodies).not.toContain(TIDAL_SECRET_2);
});

interface BootOpts {
  env?: { clientId?: string; redirectUri?: string };
  /** The environment's TIDAL Client ID / Client Secret. */
  tidalEnv?: { clientId?: string; clientSecret?: string };
  /** TIDAL has a (fake) implementation by default, as it has a real one in production. 'unavailable' = no implementation at all. */
  tidal?: 'fake' | 'unavailable';
  signedIn?: { spotify?: string; tidal?: string };
  source?: TestSource;
  saved?: unknown;
  /** Replace the connections API handed to the server (to simulate a bug inside it). */
  wrap?: (c: ConnectionsApi) => ConnectionsApi;
}

async function boot(opts: BootOpts = {}) {
  const store = new JsonStore(dir);
  if (opts.saved) await store.write(CREDENTIALS_FILE, opts.saved);
  const world: FakeWorld = createFakeWorld({ leak: true, signedIn: opts.signedIn });
  const settings = new Observable({ ...DEFAULT_SETTINGS, musicSource: (opts.source ?? 'auto') as MusicSource });
  const music = createMusic({
    store,
    settings,
    config: {
      port: 8787,
      spotify: { clientId: opts.env?.clientId ?? '', redirectUri: opts.env?.redirectUri ?? '', deviceName: 'Head Unit', pollMs: 3000 },
      tidal: { clientId: opts.tidalEnv?.clientId ?? '', clientSecret: opts.tidalEnv?.clientSecret ?? '', redirectUri: '', scopes: '' },
    },
    // `undefined` replaces the built-in TIDAL implementation: the service then has none ("not available in this build").
    factories: { spotify: world.factory('spotify'), tidal: opts.tidal === 'unavailable' ? undefined : world.factory('tidal') },
    mock: createMockMedia(),
    allowDemo: true,
  });
  await music.ready;
  const app = createApp({
    config: { ...config, dataDir: dir, uiUrl: UI_URL },
    store,
    vehicle: createVehicleSim(),
    media: music.media,
    connections: opts.wrap ? opts.wrap(music.connections) : music.connections,
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
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    seen.push(text);
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: () => JSON.parse(text) as Record<string, unknown> & ServiceConnection,
    };
  }

  /** fetch() forbids overriding Host, so DNS-rebinding checks need a raw request. */
  const raw = (method: string, path: string, host: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const r = request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          seen.push(text);
          resolve({ status: res.statusCode ?? 0, text });
        });
      });
      r.on('error', reject);
      r.end();
    });

  const credentials = async () => {
    try {
      return JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')) as unknown;
    } catch {
      return null;
    }
  };

  return { call, raw, world, music, settings, credentials, port };
}

describe('GET /api/connections', () => {
  it('lists Spotify then TIDAL, with the exact Redirect URI to register and no secrets', async () => {
    const s = await boot();
    const r = await s.call('GET', '/api/connections');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = JSON.parse(r.text) as ConnectionsResponse;
    expect(body.services.map((c) => c.service)).toEqual(['spotify', 'tidal']);
    expect(body.services[0]).toMatchObject({
      label: 'Spotify',
      available: true,
      configured: false,
      clientIdSource: 'none',
      redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback',
      redirectUriSource: 'default',
      dashboardUrl: 'https://developer.spotify.com/dashboard',
      connected: false,
    });
    expect(body.services[0]).not.toHaveProperty('clientSecretConfigured'); // Spotify has no Client Secret
    expect(body.services[1]).toMatchObject({
      service: 'tidal',
      label: 'TIDAL',
      available: true,
      configured: false, // TIDAL needs a Client ID and a Client Secret
      clientIdSource: 'none',
      clientSecretConfigured: false,
      clientSecretSource: 'none',
      redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback',
      redirectUriSource: 'default',
      dashboardUrl: 'https://developer.tidal.com/dashboard',
      connected: false,
    });
  });

  it('says a service with no implementation in this build is not available', async () => {
    const s = await boot({ tidal: 'unavailable' });
    const body = JSON.parse((await s.call('GET', '/api/connections')).text) as ConnectionsResponse;
    expect(body.services.map((c) => [c.service, c.available])).toEqual([['spotify', true], ['tidal', false]]);
  });

  it('shows where a Client ID came from (saved > environment)', async () => {
    const s = await boot({ env: { clientId: ID_B } });
    expect((await s.call('GET', '/api/connections/spotify')).json()).toMatchObject({ clientId: ID_B, clientIdSource: 'env', configured: true });
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    expect((await s.call('GET', '/api/connections/spotify')).json()).toMatchObject({ clientId: ID_A, clientIdSource: 'saved' });
    const forgot = await s.call('DELETE', '/api/connections/spotify?forget=1');
    expect(forgot.json()).toMatchObject({ clientId: ID_B, clientIdSource: 'env' });
  });

  it('shows where the TIDAL Client ID and Client Secret came from (saved > environment), never the secret', async () => {
    const s = await boot({ tidalEnv: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } });
    expect((await s.call('GET', '/api/connections/tidal')).json()).toMatchObject({ configured: true, clientId: TIDAL_ID, clientIdSource: 'env', clientSecretConfigured: true, clientSecretSource: 'env' });
    const saved = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID_2, clientSecret: TIDAL_SECRET_2 });
    expect(saved.json()).toMatchObject({ configured: true, clientId: TIDAL_ID_2, clientIdSource: 'saved', clientSecretSource: 'saved' });
    expect(s.world.built.at(-1)?.settings).toMatchObject({ clientId: TIDAL_ID_2, clientSecret: TIDAL_SECRET_2 });
    const forgot = await s.call('DELETE', '/api/connections/tidal?forget=1');
    expect(forgot.json()).toMatchObject({ configured: true, clientId: TIDAL_ID, clientIdSource: 'env', clientSecretConfigured: true, clientSecretSource: 'env' });
    expect(s.world.built.at(-1)?.settings).toMatchObject({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
  });

  it('answers 404 to other methods on the collection', async () => {
    const s = await boot();
    for (const m of ['POST', 'PUT', 'DELETE']) expect((await s.call(m, '/api/connections', {})).status).toBe(404);
  });
});

describe('PUT /api/connections/:service', () => {
  it('saves a Client ID, answers with the connection and writes credentials.json (0600)', async () => {
    const s = await boot();
    const r = await s.call('PUT', '/api/connections/spotify', { clientId: ` "${ID_A.toUpperCase()}" ` });
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ service: 'spotify', configured: true, clientId: ID_A, clientIdSource: 'saved', connected: false });
    expect(await s.credentials()).toEqual({ spotify: { clientId: ID_A } });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
    // and the app's player now offers Spotify instead of the demo
    expect(s.music.media.state.get().provider).toBe('spotify');
  });

  it('accepts a Redirect URI and permissions override, and null puts the default back', async () => {
    const s = await boot();
    const saved = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'https://car.example.com/t', scopes: 'a.read b.read' });
    expect(saved.status).toBe(200);
    expect(saved.json()).toMatchObject({ available: true, configured: true, redirectUri: 'https://car.example.com/t', redirectUriSource: 'saved', requestedScopes: 'a.read b.read' });
    // Leaving them out changes nothing (the secret stays too).
    const same = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID });
    expect(same.json()).toMatchObject({ configured: true, redirectUri: 'https://car.example.com/t', requestedScopes: 'a.read b.read', clientSecretConfigured: true });
    const reset = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, redirectUri: null, scopes: null });
    expect(reset.json()).toMatchObject({ redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback', redirectUriSource: 'default', requestedScopes: 'user.read playback', configured: true });
  });

  it('a service with no implementation in this build still saves its Client ID (and says it is not available)', async () => {
    const s = await boot({ tidal: 'unavailable' });
    const r = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID });
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ service: 'tidal', available: false, configured: false, clientId: TIDAL_ID, clientIdSource: 'saved', connected: false });
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID } });
    expect(s.world.built).toHaveLength(0);
    expect(s.music.media.state.get().provider).toBe('mock'); // nothing to connect to
  });

  it('forwards and saves the TIDAL Client Secret without returning it', async () => {
    const s = await boot();
    const saved = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    expect(saved.status).toBe(200);
    expect(saved.json()).toMatchObject({ service: 'tidal', configured: true, clientSecretConfigured: true, clientSecretSource: 'saved' });
    expect(saved.text).not.toContain(TIDAL_SECRET);
    expect(Object.keys(saved.json())).not.toContain('clientSecret');
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
    expect(s.world.built.at(-1)?.settings).toMatchObject({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET }); // the provider got it
    // Neither GET shows it, nor the list.
    expect((await s.call('GET', '/api/connections/tidal')).json()).toMatchObject({ configured: true, clientSecretConfigured: true });
    expect((await s.call('GET', '/api/connections')).text).not.toContain(TIDAL_SECRET);
    // The app now offers TIDAL instead of the demo.
    expect(s.music.media.state.get().provider).toBe('tidal');
  });

  it('TIDAL is "configured" only with BOTH the Client ID and the Client Secret', async () => {
    const s = await boot();
    const idOnly = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID });
    expect(idOnly.status).toBe(200);
    expect(idOnly.json()).toMatchObject({ available: true, configured: false, clientId: TIDAL_ID, clientSecretConfigured: false, clientSecretSource: 'none' });
    expect(s.world.built).toHaveLength(0);
    expect(s.music.media.state.get().provider).toBe('mock');
    const both = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    expect(both.json()).toMatchObject({ configured: true, clientSecretConfigured: true });
    expect(s.world.built).toHaveLength(1);
  });

  it('a bad Client Secret is a plain-language 400 that never repeats what was typed, and saves nothing', async () => {
    const s = await boot();
    for (const bad of ['tiny', 'has a space in it', 'x'.repeat(600), 'tidal-secret-\u00e9\u00e9\u00e9\u00e9', 42, {}]) {
      const r = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: bad });
      expect(r.status).toBe(400);
      expect(Object.keys(r.json())).toEqual(['error']);
      if (typeof bad === 'string') expect(r.text).not.toContain(bad);
    }
    expect(await s.credentials()).toBeNull();
    expect(s.world.built).toHaveLength(0);
  });

  it('replacing the TIDAL Client Secret rebuilds the provider with it; a changed Client ID without one drops the old secret', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    expect(s.world.built).toHaveLength(1);
    const replaced = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 });
    expect(replaced.json()).toMatchObject({ configured: true, clientSecretSource: 'saved' });
    expect(s.world.built.at(-1)?.settings.clientSecret).toBe(TIDAL_SECRET_2);
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 } });

    const changed = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID_2 });
    expect(changed.json()).toMatchObject({ clientId: TIDAL_ID_2, configured: false, clientSecretConfigured: false, clientSecretSource: 'none' });
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID_2 } });
    expect(s.music.media.state.get().provider).toBe('mock'); // TIDAL is no longer usable
  });

  it('a null Client Secret removes the saved one', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const r = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: null });
    expect(r.json()).toMatchObject({ configured: false, clientSecretConfigured: false });
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('only TIDAL takes a Client Secret: Spotify ignores one and saves just its Client ID', async () => {
    const s = await boot();
    const r = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, clientSecret: TIDAL_SECRET });
    expect(r.status).toBe(200);
    expect(r.json()).not.toHaveProperty('clientSecretConfigured');
    expect(await s.credentials()).toEqual({ spotify: { clientId: ID_A } });
    expect(s.world.built.at(-1)?.settings).not.toHaveProperty('clientSecret');
  });

  it('turns a bad Client ID into a plain-language 400 that never repeats what was typed', async () => {
    const s = await boot();
    const typed = 'abcdef0123456789-this-is-a-client-secret';
    const r = await s.call('PUT', '/api/connections/spotify', { clientId: typed });
    expect(r.status).toBe(400);
    expect(Object.keys(r.json())).toEqual(['error']);
    expect(r.json().error).toMatch(/32 letters and numbers/);
    expect(r.text).not.toContain(typed);
    for (const body of [{}, { clientId: '' }, { clientId: 7 }, { clientId: null }, 'not json', '[]']) {
      const bad = await s.call('PUT', '/api/connections/spotify', body);
      expect(bad.status).toBe(400);
      expect(bad.json().error).toBe('Enter your Client ID.');
    }
    expect(await s.credentials()).toBeNull();
  });

  it('turns a bad Redirect URI or permissions list into a 400 and saves nothing', async () => {
    const s = await boot();
    const uri = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, redirectUri: 'http://localhost:8787/cb' });
    expect(uri.status).toBe(400);
    expect(uri.json().error).toMatch(/127\.0\.0\.1/);
    expect((await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, redirectUri: 'ftp://x.example/cb' })).status).toBe(400);
    expect((await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, redirectUri: 5 })).status).toBe(400);
    const scopes = await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, scopes: 'ok;rm -rf' });
    expect(scopes.status).toBe(400);
    expect(scopes.json().error).toMatch(/letters, numbers/);
    expect(await s.credentials()).toBeNull();
    expect(s.world.built).toHaveLength(0);
  });

  it('ignores everything in the body except the connection fields', async () => {
    const s = await boot();
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, accessToken: LEAK, __proto__: { polluted: true }, extra: 'x' });
    expect(await s.credentials()).toEqual({ spotify: { clientId: ID_A } });
    await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, accessToken: LEAK, refreshToken: LEAK, extra: 'x' });
    expect(await s.credentials()).toEqual({ spotify: { clientId: ID_A }, tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } });
  });

  it('changing the Client ID signs the old account out', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } }, signedIn: { spotify: ID_A } });
    expect((await s.call('GET', '/api/connections/spotify')).json().connected).toBe(true);
    const r = await s.call('PUT', '/api/connections/spotify', { clientId: ID_B });
    expect(r.json()).toMatchObject({ clientId: ID_B, connected: false });
    expect(s.world.calls).toContain('spotify:logout');
    // …but saving the same one again keeps whoever is signed in
    await s.call('POST', '/api/connections/spotify/paste', { text: 'http://127.0.0.1:8787/auth/spotify/callback?code=c&state=s' });
    const again = await s.call('PUT', '/api/connections/spotify', { clientId: ID_B });
    expect(again.json().connected).toBe(true);
  });
});

describe('DELETE /api/connections/:service', () => {
  it('signs out but keeps the Client ID; ?forget=1 removes it as well', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A, redirectUri: 'https://car.example.com/cb' } }, signedIn: { spotify: ID_A } });
    const out = await s.call('DELETE', '/api/connections/spotify');
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({ connected: false, configured: true, clientId: ID_A });
    expect(await s.credentials()).toEqual({ spotify: { clientId: ID_A, redirectUri: 'https://car.example.com/cb' } });

    const forgot = await s.call('DELETE', '/api/connections/spotify?forget=1');
    expect(forgot.json()).toMatchObject({ configured: false, clientId: '', clientIdSource: 'none', redirectUriSource: 'default' });
    expect(await s.credentials()).toEqual({});
    expect(s.music.media.state.get().provider).toBe('mock'); // nothing configured: the demo is back
  });

  it('only forget=1 forgets', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    await s.call('DELETE', '/api/connections/spotify?forget=yes');
    expect((await s.call('GET', '/api/connections/spotify')).json().configured).toBe(true);
  });

  it('TIDAL: signing out keeps the Client ID and Client Secret; ?forget=1 removes both', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, scopes: 'a.read' } }, signedIn: { tidal: TIDAL_ID } });
    expect((await s.call('GET', '/api/connections/tidal')).json()).toMatchObject({ connected: true, configured: true });
    const out = await s.call('DELETE', '/api/connections/tidal');
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({ connected: false, configured: true, clientId: TIDAL_ID, clientSecretConfigured: true, clientSecretSource: 'saved' });
    expect(await s.credentials()).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, scopes: 'a.read' } });

    const forgot = await s.call('DELETE', '/api/connections/tidal?forget=1');
    expect(forgot.status).toBe(200);
    expect(forgot.json()).toMatchObject({ configured: false, clientId: '', clientIdSource: 'none', clientSecretConfigured: false, clientSecretSource: 'none', redirectUriSource: 'default' });
    expect(await s.credentials()).toEqual({}); // the secret is gone from the disk
    expect(s.music.media.state.get().provider).toBe('mock');
    expect((await s.call('POST', '/api/connections/tidal/test')).json()).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' });
  });
});

describe('sign-in routes', () => {
  it('POST login needs a Client ID first, then returns the address to open', async () => {
    const s = await boot();
    const early = await s.call('POST', '/api/connections/spotify/login');
    expect(early.status).toBe(400);
    expect(early.json().error).toBe('Save your Client ID first');
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    const r = await s.call('POST', '/api/connections/spotify/login');
    expect(r.status).toBe(200);
    const { url } = r.json() as unknown as { url: string };
    expect(new URL(url).searchParams.get('client_id')).toBe(ID_A);
    expect(Object.keys(r.json())).toEqual(['url']);
  });

  it('TIDAL login needs the Client ID and the Client Secret first, then returns the address to open (without the secret)', async () => {
    const s = await boot();
    const needsBoth = { error: 'Save your TIDAL Client ID and Client Secret first' };
    const early = await s.call('POST', '/api/connections/tidal/login');
    expect(early.status).toBe(400);
    expect(early.json()).toEqual(needsBoth);
    await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID });
    expect((await s.call('POST', '/api/connections/tidal/login')).json()).toEqual(needsBoth); // the ID alone is not enough
    expect((await s.call('POST', '/api/connections/tidal/paste', { text: 'code=1&state=2' })).json()).toEqual(needsBoth);
    await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const r = await s.call('POST', '/api/connections/tidal/login');
    expect(r.status).toBe(200);
    const { url } = r.json() as unknown as { url: string };
    expect(new URL(url).searchParams.get('client_id')).toBe(TIDAL_ID);
    expect(url).not.toContain(TIDAL_SECRET);
    expect(Object.keys(r.json())).toEqual(['url']);
  });

  it('a service that is not available in this build answers 409 in plain words', async () => {
    const s = await boot({ tidal: 'unavailable', saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const r = await s.call('POST', '/api/connections/tidal/login');
    expect(r.status).toBe(409);
    expect(r.json()).toEqual({ error: 'TIDAL sign-in is not available in this version yet.' });
    const paste = await s.call('POST', '/api/connections/tidal/paste', { text: 'code=1&state=2' });
    expect(paste.status).toBe(409);
    expect(paste.json().error).toMatch(/not available in this version/);
    expect(s.world.built).toHaveLength(0);
    // The other service is not affected.
    expect((await s.call('POST', '/api/connections/spotify/login')).status).toBe(400);
  });

  it('POST paste finishes a sign-in from a pasted address', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const r = await s.call('POST', '/api/connections/spotify/paste', { text: 'http://127.0.0.1:8787/auth/spotify/callback?code=abc&state=xyz' });
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ service: 'spotify', connected: true });
    expect(s.world.calls).toContain('spotify:paste');
  });

  it('POST paste with something that is not the address is a 400 with the reason', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const r = await s.call('POST', '/api/connections/spotify/paste', { text: 'hello' });
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('That does not look like the address you were sent to.');
    expect((await s.call('POST', '/api/connections/spotify/paste', {})).status).toBe(400);
    expect((await s.call('POST', '/api/connections/spotify/paste', { text: 5 })).status).toBe(400);
  });

  it('POST test answers ok or why not', async () => {
    const s = await boot();
    expect((await s.call('POST', '/api/connections/spotify/test')).json()).toEqual({ ok: false, message: 'Save your Client ID first' });
    expect((await s.call('POST', '/api/connections/tidal/test')).json()).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' });
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    expect((await s.call('POST', '/api/connections/spotify/test')).json()).toEqual({ ok: false, message: 'Spotify rejected the saved sign-in' });
    await s.call('POST', '/api/connections/spotify/paste', { text: '?code=c&state=s' });
    const ok = await s.call('POST', '/api/connections/spotify/test');
    expect(ok.status).toBe(200);
    expect(ok.json()).toEqual({ ok: true, message: 'Spotify answered' });
  });

  it('POST test for a service with no implementation in this build says there is nothing to test', async () => {
    const s = await boot({ tidal: 'unavailable', saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const r = await s.call('POST', '/api/connections/tidal/test');
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: false, message: 'TIDAL is not available in this version yet.' });
  });

  it('POST test for TIDAL asks the provider and passes on only ok + message', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const provider = s.world.built.find((b) => b.settings.clientSecret === TIDAL_SECRET)!;
    provider.test = async () => ({ ok: true, message: 'TIDAL catalog connected', token: LEAK, clientSecret: TIDAL_SECRET }) as never;
    const ok = await s.call('POST', '/api/connections/tidal/test');
    expect(ok.status).toBe(200);
    expect(ok.json()).toEqual({ ok: true, message: 'TIDAL catalog connected' });
    provider.test = async () => ({ ok: false, message: 'TIDAL refused the Client ID or Client Secret' });
    expect((await s.call('POST', '/api/connections/tidal/test')).json()).toEqual({ ok: false, message: 'TIDAL refused the Client ID or Client Secret' });
    provider.test = async () => {
      throw new Error(`boom ${TIDAL_SECRET}`);
    };
    const failed = await s.call('POST', '/api/connections/tidal/test');
    expect(failed.status).toBe(200);
    expect(failed.json().ok).toBe(false);
  });
});

describe('local TIDAL native-player credentials', () => {
  it('serves only short-lived player credentials to the local head-unit origin and never the Client Secret', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const r = await s.call('GET', '/api/tidal/player-credentials');
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ primary: { clientId: TIDAL_ID, accessToken: 'fake-tidal-player-token', source: 'client' } });
    expect(r.text).not.toContain(TIDAL_SECRET);
  });

  it('rejects a cross-site browser Origin even when the TCP connection itself is loopback', async () => {
    const s = await boot({ saved: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    const r = await s.call('GET', '/api/tidal/player-credentials', undefined, EVIL);
    expect(r.status).toBe(403);
    expect(r.json().error).toMatch(/local head-unit screen/i);
  });
});

describe('unexpected failures', () => {
  it('JSON routes answer a generic 500 and never repeat the internal message', async () => {
    const s = await boot({
      wrap: (c) => ({
        ...c,
        save: async () => {
          throw new TypeError(`cannot read ${LEAK} at /home/user/secret/path`);
        },
        list: () => {
          throw new TypeError(`cannot read ${LEAK}`);
        },
      }),
    });
    const put = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    expect(put.status).toBe(500);
    expect(put.json()).toEqual({ error: 'internal error' });
    expect((await s.call('GET', '/api/connections')).status).toBe(500);
    expect((await s.call('GET', '/api/health')).status).toBe(200);
  });
});

describe('unknown services', () => {
  it('are a JSON 404 on every route', async () => {
    const s = await boot();
    const routes: Array<[string, string]> = [
      ['GET', '/api/connections/apple'],
      ['PUT', '/api/connections/apple'],
      ['DELETE', '/api/connections/apple'],
      ['POST', '/api/connections/apple/login'],
      ['POST', '/api/connections/apple/paste'],
      ['POST', '/api/connections/apple/test'],
      ['GET', '/api/connections/spotify%2F..'],
      ['GET', '/api/connections/__proto__'],
      ['GET', '/auth/apple/login'],
      ['GET', '/auth/apple/callback?code=c&state=s'],
      ['POST', '/auth/apple/logout'],
      ['GET', '/auth/__proto__/login'],
    ];
    for (const [method, path] of routes) {
      const r = await s.call(method, path, method === 'GET' ? undefined : {});
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(r.headers.get('content-type'), `${method} ${path}`).toMatch(/application\/json/);
      expect(typeof r.json().error).toBe('string');
    }
  });

  it('unknown paths and methods under a known service are 404 too', async () => {
    const s = await boot();
    for (const [method, path] of [
      ['GET', '/api/connections/spotify/login'],
      ['POST', '/api/connections/spotify/nope'],
      ['PATCH', '/api/connections/spotify'],
      ['GET', '/auth/spotify/nope'],
      ['POST', '/auth/spotify/login'],
      ['GET', '/auth/spotify/logout'],
      ['GET', '/auth/spotify'],
      ['GET', '/auth/'],
    ] as const) {
      expect((await s.call(method, path, method === 'GET' ? undefined : {})).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('who may call it', () => {
  const stateChanging: Array<[string, string, unknown]> = [
    ['PUT', '/api/connections/spotify', { clientId: ID_A }],
    ['DELETE', '/api/connections/spotify', undefined],
    ['DELETE', '/api/connections/spotify?forget=1', undefined],
    ['POST', '/api/connections/spotify/login', {}],
    ['POST', '/api/connections/spotify/paste', { text: '?code=c&state=s' }],
    ['POST', '/api/connections/spotify/test', {}],
    ['PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 }],
    ['DELETE', '/api/connections/tidal?forget=1', undefined],
    ['POST', '/api/connections/tidal/test', {}],
    ['POST', '/auth/spotify/logout', {}],
  ];

  it('a page on another site cannot change anything', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } }, signedIn: { spotify: ID_A } });
    const before = await s.credentials();
    for (const [method, path, body] of stateChanging) {
      const r = await s.call(method, path, body, EVIL);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json().error).toBe('bad origin');
    }
    expect(await s.credentials()).toEqual(before);
    expect(s.world.calls).toEqual([]); // nothing reached a provider
    expect((await s.call('GET', '/api/connections/spotify')).json().connected).toBe(true);
  });

  it('a request from another host name (DNS rebinding) is refused, reads included', async () => {
    const s = await boot();
    for (const [method, path] of [
      ['GET', '/api/connections'],
      ['GET', '/api/connections/spotify'],
      ['PUT', '/api/connections/spotify'],
      ['DELETE', '/api/connections/spotify'],
      ['POST', '/api/connections/spotify/login'],
      ['GET', '/auth/spotify/login'],
      ['GET', '/auth/spotify/callback?code=c&state=s'],
      ['POST', '/auth/spotify/logout'],
    ] as const) {
      const r = await s.raw(method, path, 'evil.example.com');
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    expect((await s.raw('GET', '/api/connections', 'localhost:8787')).status).toBe(200);
    expect((await s.raw('GET', '/api/connections', '[::1]:8787')).status).toBe(200);
    expect(await s.credentials()).toBeNull();
  });

  it('the head unit’s own pages, on loopback or the Vite dev server, may', async () => {
    const s = await boot();
    for (const origin of ['http://127.0.0.1:8787', 'http://localhost:5173', 'http://[::1]:5173']) {
      expect((await s.call('PUT', '/api/connections/spotify', { clientId: ID_A }, { Origin: origin })).status, origin).toBe(200);
    }
    expect((await s.call('PUT', '/api/connections/spotify', { clientId: ID_A }, { Origin: 'null' })).status).toBe(403);
  });

  it('a body over 8 KB is refused and nothing is saved', async () => {
    const s = await boot();
    const big = { clientId: ID_A, scopes: 'a'.repeat(20_000) };
    const r = await s.call('PUT', '/api/connections/spotify', big).catch(() => null);
    expect(r === null || r.status === 413).toBe(true); // the connection may be cut before the answer is read
    const paste = await s.call('POST', '/api/connections/spotify/paste', { text: 'p'.repeat(20_000) }).catch(() => null);
    expect(paste === null || paste.status === 413).toBe(true);
    expect(await s.credentials()).toBeNull();
    expect((await s.call('GET', '/api/health')).status).toBe(200); // still serving
    // a body just under the limit is fine (and rejected for being wrong, not for being big)
    const ok = await s.call('PUT', '/api/connections/spotify', { clientId: ID_A, pad: 'p'.repeat(7000) });
    expect(ok.status).toBe(200);
  });
});

describe('GET /auth/:service/login', () => {
  it('sends the browser to the provider', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const r = await s.call('GET', '/auth/spotify/login');
    expect(r.status).toBe(302);
    const location = new URL(r.headers.get('location')!);
    expect(location.origin).toBe('https://spotify.example');
    expect(location.searchParams.get('client_id')).toBe(ID_A);
  });

  it('works for a plain navigation (no Origin header), as a provider redirect or a typed address would', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    expect((await s.raw('GET', '/auth/spotify/login', '127.0.0.1:8787')).status).toBe(302);
  });

  it('without a Client ID shows a small page instead of JSON, with a way back', async () => {
    const s = await boot();
    const r = await s.call('GET', '/auth/spotify/login');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.text).toContain('Save your Client ID first');
    expect(r.text).toContain('Back to the head unit');
    expect(r.text).not.toContain('Try again'); // retrying can't help until a Client ID is saved
  });
});

describe('GET /auth/:service/callback', () => {
  it('finishes the sign-in and sends the browser back to the UI', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const r = await s.call('GET', '/auth/spotify/callback?code=the-code&state=the-state');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(UI_URL);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(s.world.calls).toContain('spotify:finishLogin:the-code:the-state');
    expect((await s.call('GET', '/api/connections/spotify')).json().connected).toBe(true);
  });

  it('shows a page, with the message HTML-escaped, when the sign-in is refused', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    s.world.built[0]!.finishLogin = async () => {
      throw new Error('<img src=x onerror=alert(1)> & "quoted" \'single\'');
    };
    const r = await s.call('GET', '/auth/spotify/callback?code=c&state=s');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.text).not.toContain('<img');
    expect(r.text).toContain('&#60;img src=x onerror=alert(1)&#62; &#38; &#34;quoted&#34; &#39;single&#39;');
    expect(r.text).toMatch(/<a href="\/auth\/spotify\/login">Try again<\/a>/);
    // the address back to the UI is escaped too (it sits inside an attribute)
    expect(r.text).toContain('<a href="/?welcome=&#34;1&#34;&#38;x=&#60;b&#62;">Back to the head unit</a>');
  });

  it('escapes what the provider put in the address, and says plainly when the user said no', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const evil = await s.call('GET', `/auth/spotify/callback?error=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(evil.status).toBe(400);
    expect(evil.text).not.toContain('<script>');
    expect(evil.text).toContain('&#60;script&#62;');
    const denied = await s.call('GET', '/auth/spotify/callback?error=access_denied&state=s');
    expect(denied.text).toContain('You chose not to allow access');
    expect(denied.text).toContain('Try again');
    expect(denied.text).toContain('Back to the head unit');
    expect(s.world.calls).toEqual([]);
  });

  it('names the setting to fix when the provider refuses the request, and escapes its description', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    const scope = await s.call('GET', `/auth/tidal/callback?error=invalid_scope&error_description=${encodeURIComponent('Scope <b>playback</b> not allowed')}`);
    expect(scope.status).toBe(400);
    expect(scope.text).toContain('TIDAL refused the permissions');
    expect(scope.text).toContain('enable user.read and playback');
    expect(scope.text).toContain('TIDAL says: “Scope &#60;b&#62;playback&#60;/b&#62; not allowed”');
    expect(scope.text).not.toContain('<b>');
    const client = await s.call('GET', '/auth/spotify/callback?error=unauthorized_client');
    expect(client.text).toContain('Spotify does not accept this Client ID (unauthorized_client)');
    const request = await s.call('GET', '/auth/spotify/callback?error=invalid_request');
    expect(request.text).toContain('Redirect URI shown in Settings');
    expect(s.world.calls).toEqual([]);
  });

  it('a callback with no code or state is a page, not a crash', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    for (const q of ['', '?code=c', '?state=s']) {
      const r = await s.call('GET', `/auth/spotify/callback${q}`);
      expect(r.status).toBe(400);
      expect(r.text).toContain('Try again');
    }
  });

  it('before a Client ID is saved says so', async () => {
    const s = await boot();
    const r = await s.call('GET', '/auth/spotify/callback?code=c&state=s');
    expect(r.status).toBe(400);
    expect(r.text).toContain('Save your Client ID first');
  });

  it('an unexpected failure shows a generic page and leaks nothing', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } } });
    // A provider rejecting with something that is not an Error carries no message worth showing.
    s.world.built[0]!.finishLogin = () => Promise.reject({ secret: LEAK });
    const r = await s.call('GET', '/auth/spotify/callback?code=c&state=s');
    expect(r.status).toBe(400);
    expect(r.text).toContain('Something went wrong');
    expect(r.text).not.toContain(LEAK);
  });

  it('a bug inside the connections layer shows a generic page (500) and leaks nothing', async () => {
    const s = await boot({
      wrap: (c) => ({
        ...c,
        complete: async () => {
          throw new TypeError(`cannot read ${LEAK}`);
        },
      }),
    });
    const r = await s.call('GET', '/auth/spotify/callback?code=c&state=s');
    expect(r.status).toBe(500);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    expect(r.text).toContain('Something went wrong');
    expect(r.text).not.toContain(LEAK);
  });

  it('a successful sign-in from the callback switches "auto" over to that service', async () => {
    const s = await boot({ source: 'auto', saved: { tidal: { clientId: TIDAL_ID } } });
    expect(s.music.media.state.get().provider).toBe('mock'); // TIDAL has a Client ID but no Client Secret yet, so the demo stays
    await s.call('PUT', '/api/connections/spotify', { clientId: ID_A });
    expect(s.music.media.state.get().provider).toBe('spotify');
    await s.call('GET', '/auth/spotify/callback?code=c&state=s');
    expect(s.music.media.state.get().provider).toBe('spotify');
  });
});

describe('POST /auth/:service/logout (kept for compatibility)', () => {
  it('signs out', async () => {
    const s = await boot({ saved: { spotify: { clientId: ID_A } }, signedIn: { spotify: ID_A } });
    const r = await s.call('POST', '/auth/spotify/logout', {});
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect((await s.call('GET', '/api/connections/spotify')).json()).toMatchObject({ connected: false, configured: true });
  });
});

describe('the music hub behind the library routes', () => {
  it('a chosen-but-unconfigured service answers the library with the Connect prompt', async () => {
    const s = await boot({ source: 'spotify' });
    const r = await s.call('GET', '/api/library/liked');
    expect(r.status).toBe(401);
    expect(r.json()).toEqual({ error: "Spotify isn't set up yet", code: 'auth' });
    const tidal = await boot({ source: 'tidal' });
    expect((await tidal.call('GET', '/api/library/home')).json()).toMatchObject({ code: 'auth', error: "TIDAL isn't set up yet" });
    const idOnly = await boot({ source: 'tidal', saved: { tidal: { clientId: TIDAL_ID } } });
    expect((await idOnly.call('GET', '/api/library/home')).json()).toMatchObject({ code: 'auth', error: "TIDAL isn't set up yet" });
  });

  it('a service with no implementation in this build answers the library with a plain "not available" message', async () => {
    const s = await boot({ source: 'tidal', tidal: 'unavailable' });
    const r = await s.call('GET', '/api/library/home');
    expect(r.status).toBe(401);
    expect(r.json()).toEqual({ error: "TIDAL isn't available in this version yet", code: 'auth' });
  });

  it('saving the TIDAL Client ID + Client Secret in Settings turns the chosen-but-unconfigured prompt into the real library', async () => {
    const s = await boot({ source: 'tidal' });
    expect((await s.call('GET', '/api/library/playlists')).status).toBe(401);
    await s.call('PUT', '/api/connections/tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const r = await s.call('GET', '/api/library/playlists');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]); // the fake TIDAL's
  });

  it('follows Settings: demo first, the service once chosen', async () => {
    const s = await boot({ source: 'demo', saved: { spotify: { clientId: ID_A } } });
    expect(((await s.call('GET', '/api/library/playlists')).json() as unknown as unknown[]).length).toBe(8); // the demo catalog
    s.settings.update({ musicSource: 'spotify' });
    expect(await (await s.call('GET', '/api/library/playlists')).json()).toEqual([]); // the fake Spotify's
  });
});
