import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type MediaState, type MusicService, type MusicSource, type Settings } from '@headunit/shared';

/** `demo` is a saved source only in explicit demo mode; the public MusicSource type does not offer it. */
type TestSource = MusicSource | 'demo';
import { LibraryError } from '../library/library';
import { createMockMedia } from '../demo/mediaMock';
import { Observable } from '../observable';
import { TIDAL_DEFAULT_SCOPES } from '../providers/mediaTidal';
import { JsonStore } from '../store';
import { CREDENTIALS_FILE, type SavedCredentials } from './credentials';
import { CountingObservable, LEAK, createFakeWorld, fakeMedia, type Fake, type FakeMedia } from './fakes';
import { ConnectionError, createMusic } from './music';

const ID_A = '0123456789abcdef0123456789abcdef';
const ID_B = 'fedcba9876543210fedcba9876543210';
const TIDAL_ID = 'tidalClient123';
const TIDAL_ID_2 = 'tidalClient456';
/** What the user pastes from the TIDAL dashboard next to the Client ID. It must never leave the server. */
const TIDAL_SECRET = 'tidal-secret-0123456789';
const TIDAL_SECRET_2 = 'tidal-secret-abcdefghij';
/** TIDAL needs the Client ID AND the Client Secret to count as configured. */
const TIDAL_CREDS = { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET };

let dir: string;
let disposers: Array<() => void> = [];
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'music-'))));
afterEach(async () => {
  for (const d of disposers) d();
  disposers = [];
  await rm(dir, { recursive: true, force: true });
});

interface Harness {
  music: ReturnType<typeof createMusic>;
  settings: Observable<Settings>;
  calls: string[];
  demo: FakeMedia;
  built: Fake[];
  /** Which Client ID each service's saved tokens were issued to (the fakes' stand-in for spotify.json). */
  vault: Partial<Record<MusicService, string>>;
  /** The newest provider built for a service. */
  latest(service: MusicService): Fake;
  setSource(source: TestSource): void;
  active(): MediaState['provider'];
}

interface SetupOpts {
  source?: TestSource;
  saved?: SavedCredentials;
  env?: {
    spotify?: { clientId?: string; redirectUri?: string };
    tidal?: { clientId?: string; clientSecret?: string; redirectUri?: string; scopes?: string };
  };
  /** Services with no implementation at all ("not available in this build"). Both have a (fake) one by default, as in production. */
  unavailable?: MusicService[];
  /** Tokens already on disk: service -> the Client ID they were issued to. */
  signedIn?: Partial<Record<MusicService, string>>;
  /** Make every provider's connection() carry a secret it must not be allowed to pass on. */
  leak?: boolean;
  /** Production Pi mode disables the built-in fake catalog/player. */
  allowDemo?: boolean;
}

async function setup(opts: SetupOpts = {}): Promise<Harness> {
  const store = new JsonStore(dir);
  if (opts.saved) await store.write(CREDENTIALS_FILE, opts.saved);
  const world = createFakeWorld({ signedIn: opts.signedIn, leak: opts.leak });
  const { calls, built, vault } = world;
  const demo = fakeMedia('mock', calls);
  const settings = new Observable<Settings>({ ...DEFAULT_SETTINGS, musicSource: (opts.source ?? 'auto') as MusicSource });

  const music = createMusic({
    store,
    settings,
    config: {
      port: 8787,
      spotify: { clientId: opts.env?.spotify?.clientId ?? '', redirectUri: opts.env?.spotify?.redirectUri ?? '', deviceName: 'Head Unit', pollMs: 3000 },
      tidal: {
        clientId: opts.env?.tidal?.clientId ?? '',
        clientSecret: opts.env?.tidal?.clientSecret ?? '', // '' = none; never falls back to the developer's own environment
        redirectUri: opts.env?.tidal?.redirectUri ?? '',
        scopes: opts.env?.tidal?.scopes ?? '',
      },
    },
    factories: {
      // `undefined` replaces the built-in implementation: the service then has no factory at all.
      spotify: opts.unavailable?.includes('spotify') ? undefined : world.factory('spotify'),
      tidal: opts.unavailable?.includes('tidal') ? undefined : world.factory('tidal'),
    },
    mock: demo,
    allowDemo: opts.allowDemo ?? true,
  });
  disposers.push(() => music.dispose());
  await music.ready;
  calls.length = 0; // startup noise (the demo being let go of) is not what the tests are about
  return {
    music,
    settings,
    calls,
    demo,
    built,
    vault,
    latest(service) {
      const f = [...built].reverse().find((b) => b.state.get().provider === service);
      if (!f) throw new Error(`no ${service} provider was built`);
      return f;
    },
    setSource: (source) => settings.update({ musicSource: source as MusicSource }),
    active: () => music.media.state.get().provider,
  };
}

const saved = (o: SavedCredentials): SavedCredentials => o;

describe('which service is active', () => {
  it('the demo when nothing is configured (auto)', async () => {
    const h = await setup();
    expect(h.active()).toBe('mock');
    expect(h.music.describe()).toBe('demo');
  });

  it('production mode never falls back to fake music when nothing is configured', async () => {
    const h = await setup({ allowDemo: false });
    expect(h.active()).toBe('spotify');
    expect(h.music.describe()).toBe('Spotify (needs a Client ID)');
  });

  it('production mode ignores a previously saved demo source', async () => {
    const h = await setup({ source: 'demo', allowDemo: false });
    expect(h.active()).toBe('spotify');
  });

  it('"demo" wins even when a service is connected', async () => {
    const h = await setup({ source: 'demo', saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    expect(h.active()).toBe('mock');
  });

  it.each([
    // [source, saved, signedIn, TIDAL has an implementation, expected provider]
    ['auto', { spotify: { clientId: ID_A } }, { spotify: ID_A }, true, 'spotify'],
    ['auto', { spotify: { clientId: ID_A } }, {}, true, 'spotify'], // configured: its Connect prompt shows
    ['auto', { tidal: TIDAL_CREDS }, {}, false, 'mock'], // no implementation in this build, so no prompt for it
    ['auto', { tidal: TIDAL_CREDS }, {}, true, 'tidal'], // Client ID + Secret: configured, so TIDAL shows
    ['auto', { tidal: { clientId: TIDAL_ID } }, {}, true, 'mock'], // a Client ID alone is not enough for TIDAL
    ['auto', { spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }, { tidal: TIDAL_ID }, true, 'tidal'], // first CONNECTED service
    ['auto', { spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }, { spotify: ID_A, tidal: TIDAL_ID }, true, 'spotify'],
    ['auto', { spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }, {}, true, 'spotify'], // first CONFIGURED service
    ['auto', { spotify: { clientId: ID_A }, tidal: { clientId: TIDAL_ID } }, { tidal: TIDAL_ID }, true, 'spotify'], // TIDAL without a secret has no provider to be connected
    ['auto', { spotify: { clientId: ID_A } }, { spotify: ID_B }, true, 'spotify'], // tokens for another Client ID don't count as connected
    ['spotify', {}, {}, true, 'spotify'], // chosen but not configured: a stub that asks for setup
    ['spotify', { spotify: { clientId: ID_A } }, { spotify: ID_A }, true, 'spotify'],
    ['tidal', {}, {}, false, 'tidal'], // not available in this build: a stub
    ['tidal', {}, {}, true, 'tidal'], // chosen but not configured: a stub that asks for setup
    ['tidal', { tidal: { clientId: TIDAL_ID } }, {}, true, 'tidal'], // Client ID only: still the stub
    ['tidal', { tidal: TIDAL_CREDS }, { tidal: TIDAL_ID }, true, 'tidal'],
  ] as const)('musicSource=%s saved=%j signedIn=%j tidalAvailable=%s -> %s', async (source, creds, signedIn, tidalAvailable, expected) => {
    const h = await setup({ source, saved: creds as SavedCredentials, signedIn, unavailable: tidalAvailable ? [] : ['tidal'] });
    expect(h.active()).toBe(expected);
  });

  it('an environment Client ID counts as configured', async () => {
    const h = await setup({ env: { spotify: { clientId: ID_A } } });
    expect(h.active()).toBe('spotify');
    expect(h.music.connections.get('spotify')).toMatchObject({ configured: true, clientIdSource: 'env' });
  });

  it('an environment TIDAL Client ID + Client Secret count as configured, and TIDAL shows under "auto"', async () => {
    const h = await setup({ env: { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } } });
    expect(h.active()).toBe('tidal');
    expect(h.music.connections.get('tidal')).toMatchObject({ configured: true, clientIdSource: 'env', clientSecretConfigured: true, clientSecretSource: 'env' });
    expect(h.latest('tidal').settings).toMatchObject({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
  });

  it('describe() says what the user would see', async () => {
    expect((await setup({ source: 'spotify' })).music.describe()).toBe('Spotify (needs a Client ID)');
    expect((await setup({ source: 'tidal' })).music.describe()).toBe('TIDAL (needs Client ID + Secret)');
    expect((await setup({ source: 'tidal', saved: saved({ tidal: { clientId: TIDAL_ID } }) })).music.describe()).toBe('TIDAL (needs Client ID + Secret)');
    // TIDAL's catalog works from the Client ID + Secret alone; an account sign-in is a bonus.
    expect((await setup({ source: 'tidal', saved: saved({ tidal: TIDAL_CREDS }) })).music.describe()).toBe('TIDAL (catalog ready)');
    expect((await setup({ source: 'tidal', saved: saved({ tidal: TIDAL_CREDS }), signedIn: { tidal: TIDAL_ID } })).music.describe()).toBe('TIDAL (catalog ready, signed in)');
    // A service with no implementation in this build (the generic path).
    expect((await setup({ source: 'tidal', unavailable: ['tidal'] })).music.describe()).toBe('TIDAL (not available in this version yet)');
    expect((await setup({ source: 'spotify', unavailable: ['spotify'] })).music.describe()).toBe('Spotify (not available in this version yet)');
    expect((await setup({ saved: saved({ spotify: { clientId: ID_A } }) })).music.describe()).toBe('Spotify (not signed in yet)');
    expect((await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } })).music.describe()).toBe('Spotify');
  });

  it('loads the saved Client IDs from disk at startup, before ready resolves', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A, redirectUri: 'https://car.example.com/cb' } }) });
    expect(h.latest('spotify').settings).toEqual({ clientId: ID_A, redirectUri: 'https://car.example.com/cb', scopes: '' });
  });

  it('loads a saved TIDAL Client Secret at startup and builds the provider with it', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }) });
    expect(h.latest('tidal').settings).toEqual({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback', scopes: TIDAL_DEFAULT_SCOPES });
  });

  it('never builds a TIDAL provider from a Client ID alone, and Spotify never gets a secret', async () => {
    const h = await setup({ saved: saved({ tidal: { clientId: TIDAL_ID }, spotify: { clientId: ID_A } }) });
    expect(h.built.map((b) => b.state.get().provider)).toEqual(['spotify']);
    expect(h.latest('spotify').settings).not.toHaveProperty('clientSecret');
  });
});

describe('the stand-in shown for a service that is chosen but unusable', () => {
  it('asks for setup: needs-auth state, library calls reject with an auth LibraryError, commands do nothing', async () => {
    const h = await setup({ source: 'spotify' });
    const m = h.music.media;
    expect(m.state.get()).toMatchObject({ provider: 'spotify', status: 'needs-auth', playing: false, track: null });
    expect(m.state.get().error).toBeUndefined();
    const lib = m.library;
    const calls: Array<() => Promise<unknown>> = [
      () => lib.home(),
      () => lib.playlists(),
      () => lib.liked(),
      () => lib.albums(),
      () => lib.artists(),
      () => lib.search('x'),
      () => lib.playlist('1'),
      () => lib.album('1'),
      () => lib.queue(),
      () => lib.devices(),
      () => lib.transfer('d'),
      () => lib.setLiked('spotify:track:1', true),
    ];
    for (const call of calls) {
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LibraryError);
      expect(err).toMatchObject({ message: "Spotify isn't set up yet", code: 'auth' });
    }
    await m.command({ cmd: 'play' });
    expect(h.calls).toEqual([]); // reached no real player
  });

  it('TIDAL chosen without its Client Secret asks for setup, like any service that is not configured yet', async () => {
    for (const creds of [undefined, { tidal: { clientId: TIDAL_ID } }]) {
      const h = await setup({ source: 'tidal', ...(creds ? { saved: saved(creds) } : {}) });
      expect(h.music.media.state.get()).toMatchObject({ provider: 'tidal', status: 'needs-auth', playing: false, track: null });
      expect(h.music.media.state.get().error).toBeUndefined();
      await expect(h.music.media.library.home()).rejects.toMatchObject({ code: 'auth', message: "TIDAL isn't set up yet" });
      await expect(h.music.media.library.search('x')).rejects.toBeInstanceOf(LibraryError);
      expect(h.built).toHaveLength(0); // nothing real was built
    }
  });

  it('says plainly that a service is not available in this build when it has no implementation', async () => {
    const t = await setup({ source: 'tidal', unavailable: ['tidal'] });
    expect(t.music.media.state.get()).toMatchObject({ provider: 'tidal', status: 'needs-auth', error: "TIDAL isn't available in this version yet" });
    await expect(t.music.media.library.home()).rejects.toMatchObject({ code: 'auth', message: "TIDAL isn't available in this version yet" });
    // Even with everything a real TIDAL would need saved, there is nothing to build.
    const withCreds = await setup({ source: 'tidal', unavailable: ['tidal'], saved: saved({ tidal: TIDAL_CREDS }) });
    expect(withCreds.built).toHaveLength(0);
    expect(withCreds.music.media.state.get()).toMatchObject({ provider: 'tidal', error: "TIDAL isn't available in this version yet" });
    const s = await setup({ source: 'spotify', unavailable: ['spotify'], saved: saved({ spotify: { clientId: ID_A } }) });
    expect(s.built).toHaveLength(0);
    expect(s.music.media.state.get()).toMatchObject({ provider: 'spotify', error: "Spotify isn't available in this version yet" });
  });

  it('becomes the real TIDAL provider as soon as the Client ID and the Client Secret are saved', async () => {
    const h = await setup({ source: 'tidal' });
    await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(h.built).toHaveLength(0); // the Client ID alone is not enough
    expect(h.music.media.state.get().status).toBe('needs-auth');
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    expect(h.latest('tidal').settings.clientSecret).toBe(TIDAL_SECRET);
    expect(h.music.media.state.get()).toMatchObject({ provider: 'tidal', status: 'ready' });
    await h.music.media.command({ cmd: 'play' });
    expect(h.calls).toContain('tidal:play');
  });

  it('becomes the real provider as soon as a Client ID is saved', async () => {
    const h = await setup({ source: 'spotify' });
    const seen: string[] = [];
    h.music.media.state.subscribe((s) => seen.push(`${s.provider}/${s.status}`));
    await h.music.connections.save('spotify', { clientId: ID_A });
    expect(seen).toEqual(['spotify/ready']); // the new provider's own state, published once, immediately
    expect(h.latest('spotify').settings.clientId).toBe(ID_A);
    await h.music.media.command({ cmd: 'play' });
    expect(h.calls).toContain('spotify:play');
  });
});

describe('switching', () => {
  it('only the active provider is started; stop() stops it', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }) });
    h.music.media.start();
    expect(h.calls).toEqual(['spotify:start']); // TIDAL is configured too but inactive: it must not poll
    h.music.media.stop();
    expect(h.calls).toEqual(['spotify:start', 'spotify:stop']);
  });

  it('a provider chosen before start() is not started early', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    expect(h.calls).toEqual([]);
  });

  it('leaving a playing service pauses it best-effort, stops it, starts the new one and publishes its state at once', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    h.music.media.start();
    const sp = h.latest('spotify');
    sp.state.update({ playing: true });
    h.calls.length = 0;
    const seen: Array<[string, boolean]> = [];
    h.music.media.state.subscribe((s) => seen.push([s.provider, s.playing]));

    h.setSource('demo');

    expect(seen).toEqual([['mock', false]]);
    expect(h.calls).toEqual(['spotify:pause', 'spotify:stop', 'mock:start']);
    expect(sp.state.active).toBe(0); // unsubscribed
    expect(h.active()).toBe('mock');
  });

  it('does not pause a service that is not playing', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    h.music.media.start();
    h.calls.length = 0;
    h.setSource('demo');
    expect(h.calls).toEqual(['spotify:stop', 'mock:start']);
  });

  it('survives a pause that fails', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    const sp = h.latest('spotify');
    sp.state.update({ playing: true });
    sp.command = () => Promise.reject(new Error('device gone'));
    h.setSource('demo');
    await new Promise((r) => setImmediate(r));
    expect(h.active()).toBe('mock');
  });

  it('survives a pause that throws synchronously', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    const sp = h.latest('spotify');
    sp.state.update({ playing: true });
    sp.command = () => {
      throw new Error('boom');
    };
    expect(() => h.setSource('demo')).not.toThrow();
    expect(h.active()).toBe('mock');
  });

  it('once switched, the old provider no longer reaches the app and commands go to the new one', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    const sp = h.latest('spotify');
    h.setSource('demo');
    h.calls.length = 0;
    const seen: string[] = [];
    h.music.media.state.subscribe((s) => seen.push(s.provider));
    sp.state.update({ status: 'error' }); // late chatter from the old service
    expect(seen).toEqual([]);
    await h.music.media.command({ cmd: 'toggle' });
    await h.music.media.library.transfer('dev-1');
    expect(await h.music.media.library.setLiked('mock:track:1', true)).toBe(true);
    expect(h.calls).toEqual(['mock:toggle', 'mock:transfer:dev-1', 'mock:setLiked:mock:track:1']);
  });

  it('does not restart a hub that was stopped', async () => {
    const h = await setup({ source: 'demo', saved: saved({ spotify: { clientId: ID_A } }) });
    h.music.media.start();
    h.music.media.stop();
    h.calls.length = 0;
    h.setSource('spotify');
    expect(h.calls).toEqual(['mock:stop']);
  });

  it('switching to the same provider again changes nothing', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    h.music.media.start();
    h.calls.length = 0;
    const seen: unknown[] = [];
    h.music.media.state.subscribe((s) => seen.push(s));
    h.settings.update({ theme: 'daylight' }); // unrelated settings change
    h.setSource('spotify');
    expect(h.calls).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('mirrors every state change of the active provider', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    const sp = h.latest('spotify');
    sp.state.update({ playing: true, status: 'ready' });
    expect(h.music.media.state.get()).toMatchObject({ provider: 'spotify', playing: true });
    sp.state.update({ volume: 12 });
    expect(h.music.media.state.get().volume).toBe(12);
  });

  it('under "auto" it looks again when the active service signs out behind its back (login lapsed)', async () => {
    const h = await setup({
      saved: saved({ spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }),
      signedIn: { spotify: ID_A, tidal: TIDAL_ID },
    });
    expect(h.active()).toBe('spotify');
    delete h.vault.spotify; // the refresh token was revoked
    h.latest('spotify').state.update({ status: 'needs-auth' });
    expect(h.active()).toBe('tidal');
  });

  it('but an explicit choice is never overridden', async () => {
    const h = await setup({
      source: 'spotify',
      saved: saved({ spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }),
      signedIn: { tidal: TIDAL_ID },
    });
    h.latest('spotify').state.update({ status: 'needs-auth' });
    expect(h.active()).toBe('spotify');
  });
});

describe('dispose', () => {
  it('stops every provider and the demo, and releases every subscription', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }) });
    h.music.media.start();
    const sp = h.latest('spotify');
    const td = h.latest('tidal');
    h.calls.length = 0;
    h.music.dispose();
    expect(h.calls.sort()).toEqual(['mock:stop', 'spotify:stop', 'tidal:stop']);
    expect(sp.state.active).toBe(0);
    expect(td.state.active).toBe(0);
    expect(h.demo.state.active).toBe(0);
    h.calls.length = 0;
    h.setSource('demo'); // settings changes no longer matter
    expect(h.calls).toEqual([]);
    expect(h.active()).toBe('spotify');
    h.music.dispose(); // idempotent
  });

  it('a switch leaves exactly one subscription on the active provider and none on the others', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    const sp = h.latest('spotify');
    for (const s of ['demo', 'spotify', 'demo', 'spotify', 'demo', 'spotify'] as const) h.setSource(s);
    expect(sp.state.active).toBe(1);
    expect(h.demo.state.active).toBe(0);
    h.setSource('demo');
    expect(sp.state.active).toBe(0);
    expect(h.demo.state.active).toBe(1);
  });
});

describe('connections: describing a service', () => {
  it('lists Spotify then TIDAL with the exact Redirect URI to register', async () => {
    const h = await setup();
    const list = h.music.connections.list();
    expect(list.map((c) => c.service)).toEqual(['spotify', 'tidal']);
    expect(list[0]).toEqual({
      service: 'spotify',
      label: 'Spotify',
      available: true,
      configured: false,
      clientId: '',
      clientIdSource: 'none',
      dashboardUrl: 'https://developer.spotify.com/dashboard',
      redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback',
      redirectUriSource: 'default',
      connected: false,
      loginPending: false,
    });
    expect(list[1]).toEqual({
      service: 'tidal',
      label: 'TIDAL',
      available: true,
      configured: false, // TIDAL needs a Client ID AND a Client Secret
      clientId: '',
      clientIdSource: 'none',
      clientSecretConfigured: false,
      clientSecretSource: 'none',
      dashboardUrl: 'https://developer.tidal.com/dashboard',
      redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback',
      redirectUriSource: 'default',
      requestedScopes: TIDAL_DEFAULT_SCOPES,
      connected: false,
      loginPending: false,
    });
  });

  it('a service with no implementation in this build says so, and can still be described', async () => {
    const h = await setup({ unavailable: ['tidal'] });
    expect(h.music.connections.get('tidal')).toMatchObject({ service: 'tidal', label: 'TIDAL', available: false, configured: false, connected: false });
    expect(h.music.connections.get('spotify')).toMatchObject({ available: true });
    const s = await setup({ unavailable: ['spotify'] });
    expect(s.music.connections.get('spotify')).toMatchObject({ available: false });
  });

  it('TIDAL is configured only with BOTH the Client ID and the Client Secret', async () => {
    const idOnly = await setup({ saved: saved({ tidal: { clientId: TIDAL_ID } }) });
    expect(idOnly.music.connections.get('tidal')).toMatchObject({ configured: false, clientId: TIDAL_ID, clientSecretConfigured: false, clientSecretSource: 'none' });
    const both = await setup({ saved: saved({ tidal: TIDAL_CREDS }) });
    expect(both.music.connections.get('tidal')).toMatchObject({ configured: true, clientId: TIDAL_ID, clientSecretConfigured: true, clientSecretSource: 'saved' });
    const secretOnly = await setup({ saved: saved({ tidal: { clientSecret: TIDAL_SECRET } }) });
    expect(secretOnly.music.connections.get('tidal')).toMatchObject({ configured: false, clientId: '', clientSecretConfigured: true });
    expect(secretOnly.built).toHaveLength(0);
  });

  it('says where the TIDAL Client ID and Client Secret come from: saved wins over the environment, each on its own', async () => {
    const env = { tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } };
    expect((await setup({ env })).music.connections.get('tidal')).toMatchObject({ clientIdSource: 'env', clientSecretSource: 'env', configured: true });
    // Secret saved, ID from the environment.
    const secretSaved = await setup({ env, saved: saved({ tidal: { clientSecret: TIDAL_SECRET_2 } }) });
    expect(secretSaved.music.connections.get('tidal')).toMatchObject({ clientIdSource: 'env', clientSecretSource: 'saved' });
    expect(secretSaved.latest('tidal').settings.clientSecret).toBe(TIDAL_SECRET_2);
    // ID saved, secret from the environment.
    const idSaved = await setup({ env, saved: saved({ tidal: { clientId: TIDAL_ID_2 } }) });
    expect(idSaved.music.connections.get('tidal')).toMatchObject({ clientId: TIDAL_ID_2, clientIdSource: 'saved', clientSecretSource: 'env', configured: true });
    // An environment secret the app would refuse counts as none.
    expect((await setup({ env: { tidal: { clientId: TIDAL_ID, clientSecret: 'has a space' } } })).music.connections.get('tidal')).toMatchObject({
      configured: false,
      clientSecretConfigured: false,
      clientSecretSource: 'none',
    });
  });

  it('never reports a Client Secret for Spotify, even one saved in the file by hand', async () => {
    const h = await setup({ saved: { spotify: { clientId: ID_A, clientSecret: TIDAL_SECRET } } as SavedCredentials });
    const c = h.music.connections.get('spotify');
    expect(c).not.toHaveProperty('clientSecretConfigured');
    expect(c).not.toHaveProperty('clientSecretSource');
    expect(h.latest('spotify').settings).not.toHaveProperty('clientSecret');
  });

  it('never passes on the Client Secret: not in list(), get(), or anything a TIDAL provider adds', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }), signedIn: { tidal: TIDAL_ID }, leak: true });
    const text = JSON.stringify(h.music.connections.list()) + JSON.stringify(h.music.connections.get('tidal'));
    expect(text).not.toContain(TIDAL_SECRET);
    expect(text).not.toContain(LEAK);
    expect(h.music.connections.get('tidal')).toMatchObject({ connected: true, clientSecretConfigured: true });
    expect(h.latest('tidal').settings.clientSecret).toBe(TIDAL_SECRET); // the provider itself does get it
  });

  it('saved values win over the environment', async () => {
    const h = await setup({
      env: { spotify: { clientId: ID_B, redirectUri: 'https://env.example.com/cb' } },
      saved: saved({ spotify: { clientId: ID_A } }),
    });
    expect(h.music.connections.get('spotify')).toMatchObject({
      clientId: ID_A,
      clientIdSource: 'saved',
      redirectUri: 'https://env.example.com/cb',
      redirectUriSource: 'env',
    });
    expect(h.latest('spotify').settings).toMatchObject({ clientId: ID_A, redirectUri: 'https://env.example.com/cb' });
  });

  it('reports sign-in details from the provider, field by field', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    h.latest('spotify').connection = () => ({
      connected: true,
      loginPending: true,
      problem: 'permissions',
      message: 'Sign in again',
      connectedAt: 1,
      loginExpiresAt: 2,
      scopes: ['a', 'b'],
    });
    expect(h.music.connections.get('spotify')).toMatchObject({
      connected: true,
      loginPending: true,
      problem: 'permissions',
      message: 'Sign in again',
      connectedAt: 1,
      loginExpiresAt: 2,
      scopes: ['a', 'b'],
    });
  });

  it('shows TIDAL permissions only for TIDAL', async () => {
    const h = await setup({ env: { tidal: { clientId: TIDAL_ID, scopes: 'a.read,b.write' } }, saved: saved({ spotify: { clientId: ID_A, scopes: 'x y' } }) });
    expect(h.music.connections.get('tidal').requestedScopes).toBe('a.read b.write');
    expect(h.music.connections.get('spotify').requestedScopes).toBeUndefined();
  });

  it('never passes on anything a provider adds beyond the contract', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A }, leak: true });
    const text = JSON.stringify(h.music.connections.list()) + JSON.stringify(h.music.connections.get('spotify'));
    expect(text).not.toContain(LEAK);
    expect(h.music.connections.get('spotify').connected).toBe(true);
  });
});

describe('connections: save', () => {
  it('saves a Client ID, writes credentials.json (0600) and builds the provider with the default Redirect URI', async () => {
    const h = await setup();
    const c = await h.music.connections.save('spotify', { clientId: ID_A.toUpperCase() });
    expect(c).toMatchObject({ configured: true, clientId: ID_A, clientIdSource: 'saved', redirectUriSource: 'default', connected: false });
    expect(h.latest('spotify').settings).toEqual({ clientId: ID_A, redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback', scopes: '' });
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ spotify: { clientId: ID_A } });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
    expect(h.active()).toBe('spotify'); // auto: now configured, so its Connect prompt shows instead of the demo
  });

  it('rejects an invalid Client ID in plain language, without echoing it, and saves nothing', async () => {
    const h = await setup();
    const typed = 'my-client-secret-0123';
    const err = await h.music.connections.save('spotify', { clientId: typed }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err).toMatchObject({ status: 400 });
    expect((err as Error).message).toMatch(/32 letters and numbers/);
    expect((err as Error).message).not.toContain(typed);
    for (const bad of ['', '  ', undefined, null, 42]) {
      await expect(h.music.connections.save('spotify', { clientId: bad as never })).rejects.toMatchObject({ status: 400, message: 'Enter your Client ID.' });
    }
    expect(await h.music.connections.save('spotify', { clientId: ID_A })).toMatchObject({ configured: true });
    await expect(h.music.connections.save('spotify', { clientId: 'zz' })).rejects.toBeInstanceOf(ConnectionError);
    expect(h.music.connections.get('spotify').clientId).toBe(ID_A); // the bad save changed nothing
  });

  it('rejects a Redirect URI Spotify would refuse, and a wrong type, saving nothing', async () => {
    const h = await setup();
    await expect(h.music.connections.save('spotify', { clientId: ID_A, redirectUri: 'http://localhost:8787/cb' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/127\.0\.0\.1/),
    });
    await expect(h.music.connections.save('spotify', { clientId: ID_A, redirectUri: 7 as never })).rejects.toMatchObject({ status: 400 });
    await expect(h.music.connections.save('spotify', { clientId: ID_A, scopes: {} as never })).rejects.toMatchObject({ status: 400 });
    await expect(h.music.connections.save('tidal', { clientId: TIDAL_ID, scopes: 'bad;scope' })).rejects.toMatchObject({ status: 400 });
    expect(h.music.connections.get('spotify').configured).toBe(false);
    expect(h.built).toHaveLength(0);
  });

  it('a different Client ID signs the old account out; a redirect-only change keeps the sign-in', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    const first = h.latest('spotify');
    expect(h.music.connections.get('spotify').connected).toBe(true);

    // Same Client ID, new Redirect URI: tokens stay, the provider is rebuilt with the new address.
    const c1 = await h.music.connections.save('spotify', { clientId: ID_A, redirectUri: 'https://car.example.com/cb' });
    expect(c1).toMatchObject({ connected: true, redirectUri: 'https://car.example.com/cb', redirectUriSource: 'saved' });
    expect(h.calls).not.toContain('spotify:logout');
    expect(h.built).toHaveLength(2);
    expect(h.latest('spotify')).not.toBe(first);
    expect(h.latest('spotify').settings.redirectUri).toBe('https://car.example.com/cb');
    expect(first.state.active).toBe(0); // the replaced provider is let go of
    expect(h.calls).toContain('spotify:stop');

    // Saving exactly the same thing again builds nothing new.
    await h.music.connections.save('spotify', { clientId: ID_A, redirectUri: 'https://car.example.com/cb' });
    expect(h.built).toHaveLength(2);

    // Different Client ID: tokens belong to the old one and must go.
    const c2 = await h.music.connections.save('spotify', { clientId: ID_B });
    expect(h.calls.filter((c) => c === 'spotify:logout')).toHaveLength(1);
    expect(h.vault.spotify).toBeUndefined();
    expect(c2).toMatchObject({ clientId: ID_B, connected: false });
    expect(h.built).toHaveLength(3);
    expect(h.latest('spotify').settings).toMatchObject({ clientId: ID_B, redirectUri: 'https://car.example.com/cb' });
  });

  it('still saves when signing out the previous Client ID fails', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      h.latest('spotify').logout = () => Promise.reject(new Error('disk full'));
      const c = await h.music.connections.save('spotify', { clientId: ID_B });
      expect(c).toMatchObject({ clientId: ID_B });
      expect(h.latest('spotify').settings.clientId).toBe(ID_B);
      expect(quiet).toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  it('the first Client ID has nothing to sign out', async () => {
    const h = await setup();
    await h.music.connections.save('spotify', { clientId: ID_A });
    expect(h.calls).not.toContain('spotify:logout');
  });

  it('saving the Client ID the environment already provides keeps the sign-in', async () => {
    const h = await setup({ env: { spotify: { clientId: ID_A } }, signedIn: { spotify: ID_A } });
    const c = await h.music.connections.save('spotify', { clientId: ID_A });
    expect(h.calls).not.toContain('spotify:logout');
    expect(c).toMatchObject({ clientIdSource: 'saved', connected: true });
    expect(h.built).toHaveLength(1); // nothing changed, so nothing was rebuilt
  });

  it('an omitted Redirect URI/permissions are left alone; null puts the default back', async () => {
    const h = await setup();
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'https://car.example.com/t', scopes: 'a.read b.read' });
    expect(h.music.connections.get('tidal')).toMatchObject({ redirectUri: 'https://car.example.com/t', redirectUriSource: 'saved', requestedScopes: 'a.read b.read' });
    await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(h.music.connections.get('tidal')).toMatchObject({ redirectUri: 'https://car.example.com/t', requestedScopes: 'a.read b.read', configured: true });
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, redirectUri: null, scopes: null });
    const c = h.music.connections.get('tidal');
    expect(c).toMatchObject({ redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback', redirectUriSource: 'default', configured: true });
    expect(c.requestedScopes).toBe(TIDAL_DEFAULT_SCOPES); // the built-in permissions are what is requested again
  });

  it('saving the Client ID alone for a service with no implementation still keeps it, and nothing is built', async () => {
    const h = await setup({ unavailable: ['tidal'] });
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(c).toMatchObject({ service: 'tidal', available: false, configured: false, clientId: TIDAL_ID, clientIdSource: 'saved', connected: false });
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: { clientId: TIDAL_ID } });
    expect(h.built).toHaveLength(0);
    expect(h.active()).toBe('mock'); // and the demo stays: there is nothing to connect to
    // Even Client ID + Secret together only make it "configured": there is still nothing to build or sign in to.
    const both = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    expect(both).toMatchObject({ available: false, configured: true, clientSecretConfigured: true, connected: false });
    expect(h.built).toHaveLength(0);
    expect(h.active()).toBe('mock');
  });

  it('saves a TIDAL Client ID + Client Secret: credentials.json (0600) keeps both, the answer carries neither secret nor leak', async () => {
    const h = await setup({ leak: true });
    const c = await h.music.connections.save('tidal', { clientId: ` "${TIDAL_ID}" `, clientSecret: ` "${TIDAL_SECRET}" ` });
    expect(c).toMatchObject({ service: 'tidal', available: true, configured: true, clientId: TIDAL_ID, clientIdSource: 'saved', clientSecretConfigured: true, clientSecretSource: 'saved', connected: false });
    expect(JSON.stringify(c)).not.toContain(TIDAL_SECRET);
    expect(JSON.stringify(c)).not.toContain(LEAK);
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
    expect(h.latest('tidal').settings).toEqual({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback', scopes: TIDAL_DEFAULT_SCOPES });
    expect(h.active()).toBe('tidal'); // auto: TIDAL is configured now
  });

  it('a TIDAL Client ID alone is saved but is not "configured": no provider, the demo stays', async () => {
    const h = await setup();
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(c).toMatchObject({ available: true, configured: false, clientId: TIDAL_ID, clientSecretConfigured: false, clientSecretSource: 'none' });
    expect(h.built).toHaveLength(0);
    expect(h.active()).toBe('mock');
    // The secret can follow later, with the same Client ID.
    const done = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    expect(done).toMatchObject({ configured: true, clientSecretConfigured: true });
    expect(h.built).toHaveLength(1);
    expect(h.active()).toBe('tidal');
  });

  it('rejects a bad Client Secret in plain language without echoing it, and saves nothing', async () => {
    const h = await setup();
    for (const bad of ['tiny', 'has a space in it', 'x'.repeat(600), 'tidal-secret-\u00e9\u00e9\u00e9\u00e9', 42, {}]) {
      const err = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: bad as never }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectionError);
      expect(err).toMatchObject({ status: 400 });
      if (typeof bad === 'string') expect((err as Error).message).not.toContain(bad);
    }
    expect(h.music.connections.get('tidal')).toMatchObject({ clientId: '', clientSecretConfigured: false });
    expect(h.built).toHaveLength(0);
    await expect(readFile(join(dir, CREDENTIALS_FILE), 'utf8')).rejects.toThrow(); // nothing was written
  });

  it('Spotify has no Client Secret: sending one is refused and nothing is saved', async () => {
    const h = await setup();
    await expect(h.music.connections.save('spotify', { clientId: ID_A, clientSecret: TIDAL_SECRET })).rejects.toMatchObject({
      status: 400,
      message: 'This service does not use a Client Secret here.',
    });
    expect(h.music.connections.get('spotify').configured).toBe(false);
    expect(h.built).toHaveLength(0);
  });

  it('an omitted secret keeps the saved one; a new one replaces it, rebuilds the provider and keeps the sign-in', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }), signedIn: { tidal: TIDAL_ID } });
    const first = h.latest('tidal');
    expect(h.music.connections.get('tidal').connected).toBe(true);

    // Same Client ID, no secret sent: the saved secret stays and nothing is rebuilt.
    await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(h.built).toHaveLength(1);
    expect(h.music.connections.get('tidal')).toMatchObject({ configured: true, clientSecretConfigured: true });

    // Same Client ID, new secret: a new provider with the new secret; the account sign-in belongs to the Client ID, so it stays.
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 });
    expect(c).toMatchObject({ configured: true, connected: true, clientSecretSource: 'saved' });
    expect(h.calls).not.toContain('tidal:logout');
    expect(h.built).toHaveLength(2);
    expect(h.latest('tidal').settings.clientSecret).toBe(TIDAL_SECRET_2);
    expect(first.state.active).toBe(0); // the replaced provider is let go of
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 } });
  });

  it('a different Client ID signs the old account out and drops the old secret unless a new one is sent', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }), signedIn: { tidal: TIDAL_ID } });
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID_2 });
    expect(h.calls.filter((x) => x === 'tidal:logout')).toHaveLength(1);
    expect(c).toMatchObject({ clientId: TIDAL_ID_2, configured: false, clientSecretConfigured: false, clientSecretSource: 'none', connected: false });
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: { clientId: TIDAL_ID_2 } });
    expect(h.active()).toBe('mock'); // TIDAL is no longer usable, so "auto" lets go of it
    // With the new secret in the same save everything is replaced at once.
    const again = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 });
    expect(again).toMatchObject({ clientId: TIDAL_ID, configured: true, clientSecretConfigured: true });
    expect(h.latest('tidal').settings).toMatchObject({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET_2 });
  });

  it('a null Client Secret removes the saved one; an environment secret then applies', async () => {
    const h = await setup({ env: { tidal: { clientSecret: TIDAL_SECRET_2 } }, saved: saved({ tidal: TIDAL_CREDS }) });
    expect(h.music.connections.get('tidal')).toMatchObject({ clientSecretSource: 'saved' });
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: null });
    expect(c).toMatchObject({ configured: true, clientSecretSource: 'env' });
    expect(h.latest('tidal').settings.clientSecret).toBe(TIDAL_SECRET_2);
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: { clientId: TIDAL_ID } });
    // Without an environment secret, removing it makes TIDAL unconfigured again.
    const g = await setup({ saved: saved({ tidal: TIDAL_CREDS }) });
    expect(await g.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: null })).toMatchObject({ configured: false, clientSecretConfigured: false });
    expect(g.active()).toBe('mock');
  });

  it('an environment secret survives a different saved Client ID (it is not ours to drop)', async () => {
    const h = await setup({ env: { tidal: { clientSecret: TIDAL_SECRET } }, saved: saved({ tidal: { clientId: TIDAL_ID } }) });
    const c = await h.music.connections.save('tidal', { clientId: TIDAL_ID_2 });
    expect(c).toMatchObject({ clientId: TIDAL_ID_2, configured: true, clientSecretSource: 'env' });
    expect(h.latest('tidal').settings).toMatchObject({ clientId: TIDAL_ID_2, clientSecret: TIDAL_SECRET });
  });

  it('saving a TIDAL secret writes nothing to the console', async () => {
    const h = await setup({ leak: true });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
      await h.music.connections.save('tidal', { clientId: 'tidalClient456', clientSecret: 'nope' }).catch(() => undefined);
      await h.music.connections.test('tidal');
      await h.music.connections.signOut('tidal', { forget: true });
      expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(TIDAL_SECRET);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('two quick saves are applied in order', async () => {
    const h = await setup();
    await Promise.all([h.music.connections.save('spotify', { clientId: ID_A }), h.music.connections.save('spotify', { clientId: ID_B })]);
    expect(h.music.connections.get('spotify').clientId).toBe(ID_B);
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ spotify: { clientId: ID_B } });
  });

  it('an unknown service is a 404', async () => {
    const h = await setup();
    await expect(h.music.connections.save('apple' as never, { clientId: ID_A })).rejects.toMatchObject({ status: 404 });
    expect(() => h.music.connections.get('apple' as never)).toThrow(ConnectionError);
  });
});

describe('connections: sign out and forget', () => {
  it('says plainly when the saved sign-in could not be removed (and keeps the connection state)', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    h.latest('spotify').logout = () => Promise.reject(new Error('Could not remove the saved sign-in: disk full'));
    const err = await h.music.connections.signOut('spotify').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as Error).message).toBe('Could not remove the saved sign-in: disk full');
    expect(h.music.connections.get('spotify')).toMatchObject({ connected: true, configured: true });
  });

  it('sign out drops the tokens but keeps the Client ID', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    const c = await h.music.connections.signOut('spotify');
    expect(c).toMatchObject({ connected: false, configured: true, clientId: ID_A });
    expect(h.calls).toContain('spotify:logout');
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ spotify: { clientId: ID_A } });
    expect(h.active()).toBe('spotify');
  });

  it('forget also removes what was saved; the demo returns under "auto"', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A, redirectUri: 'https://car.example.com/cb' } }), signedIn: { spotify: ID_A } });
    const first = h.latest('spotify');
    const c = await h.music.connections.signOut('spotify', { forget: true });
    expect(c).toMatchObject({ configured: false, clientId: '', clientIdSource: 'none', connected: false, redirectUriSource: 'default' });
    expect(h.calls).toContain('spotify:logout');
    expect(h.calls).toContain('spotify:stop');
    expect(first.state.active).toBe(0);
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({});
    expect(h.active()).toBe('mock');
  });

  it('forget under an explicit choice leaves the stand-in that asks for setup', async () => {
    const h = await setup({ source: 'spotify', saved: saved({ spotify: { clientId: ID_A } }) });
    await h.music.connections.signOut('spotify', { forget: true });
    expect(h.music.media.state.get()).toMatchObject({ provider: 'spotify', status: 'needs-auth' });
    await expect(h.music.media.library.liked()).rejects.toMatchObject({ code: 'auth' });
  });

  it('forget falls back to the environment Client ID, signed out', async () => {
    const h = await setup({ env: { spotify: { clientId: ID_B } }, saved: saved({ spotify: { clientId: ID_A } }), signedIn: { spotify: ID_A } });
    const c = await h.music.connections.signOut('spotify', { forget: true });
    expect(c).toMatchObject({ clientId: ID_B, clientIdSource: 'env', connected: false });
    expect(h.latest('spotify').settings.clientId).toBe(ID_B);
  });

  it('signing out a service that was never set up is harmless', async () => {
    const h = await setup();
    expect(await h.music.connections.signOut('tidal', { forget: true })).toMatchObject({ configured: false, connected: false });
  });

  it('TIDAL: sign out drops the account sign-in but keeps the Client ID and the Client Secret', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }), signedIn: { tidal: TIDAL_ID } });
    const c = await h.music.connections.signOut('tidal');
    expect(c).toMatchObject({ connected: false, configured: true, clientId: TIDAL_ID, clientSecretConfigured: true, clientSecretSource: 'saved' });
    expect(h.calls).toContain('tidal:logout');
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({ tidal: TIDAL_CREDS });
    expect(h.active()).toBe('tidal'); // its catalog still works without the account
  });

  it('TIDAL: forget removes the Client ID, the Client Secret and the permissions, and stops the provider', async () => {
    const h = await setup({ source: 'tidal', saved: saved({ tidal: { ...TIDAL_CREDS, redirectUri: 'https://car.example.com/t', scopes: 'a.read' } }), signedIn: { tidal: TIDAL_ID } });
    const first = h.latest('tidal');
    const c = await h.music.connections.signOut('tidal', { forget: true });
    expect(c).toMatchObject({ configured: false, clientId: '', clientIdSource: 'none', clientSecretConfigured: false, clientSecretSource: 'none', connected: false, redirectUriSource: 'default' });
    expect(c.requestedScopes).toBe(TIDAL_DEFAULT_SCOPES);
    expect(JSON.stringify(c)).not.toContain(TIDAL_SECRET);
    expect(h.calls).toContain('tidal:logout');
    expect(h.calls).toContain('tidal:stop');
    expect(first.state.active).toBe(0);
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({});
    // Chosen explicitly, TIDAL is now the stand-in that asks for setup.
    expect(h.music.media.state.get()).toMatchObject({ provider: 'tidal', status: 'needs-auth' });
    await expect(h.music.media.library.liked()).rejects.toMatchObject({ code: 'auth', message: "TIDAL isn't set up yet" });
  });

  it('TIDAL: forget falls back to the environment Client ID and Client Secret', async () => {
    const h = await setup({ env: { tidal: { clientId: TIDAL_ID_2, clientSecret: TIDAL_SECRET_2 } }, saved: saved({ tidal: TIDAL_CREDS }) });
    expect(h.latest('tidal').settings).toMatchObject({ clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const c = await h.music.connections.signOut('tidal', { forget: true });
    expect(c).toMatchObject({ configured: true, clientId: TIDAL_ID_2, clientIdSource: 'env', clientSecretConfigured: true, clientSecretSource: 'env' });
    expect(h.latest('tidal').settings).toMatchObject({ clientId: TIDAL_ID_2, clientSecret: TIDAL_SECRET_2 });
  });
});

describe('connections: sign-in', () => {
  it('beginLogin asks for the Client ID first (TIDAL: the Client ID and the Client Secret)', async () => {
    const h = await setup();
    expect(() => h.music.connections.beginLogin('spotify')).toThrow(expect.objectContaining({ message: 'Save your Client ID first', status: 400 }));
    const needsBoth = expect.objectContaining({ message: 'Save your TIDAL Client ID and Client Secret first', status: 400 });
    expect(() => h.music.connections.beginLogin('tidal')).toThrow(needsBoth);
    await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(() => h.music.connections.beginLogin('tidal')).toThrow(needsBoth); // the Client ID alone is not enough
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const login = new URL(h.music.connections.beginLogin('tidal'));
    expect(login.origin).toBe('https://tidal.example');
    expect(login.searchParams.get('client_id')).toBe(TIDAL_ID);
    expect(login.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8787/auth/tidal/callback');
    expect(login.href).not.toContain(TIDAL_SECRET); // the account sign-in never carries the Client Secret
    await h.music.connections.save('spotify', { clientId: ID_A });
    const url = new URL(h.music.connections.beginLogin('spotify'));
    expect(url.origin).toBe('https://spotify.example');
    expect(url.searchParams.get('client_id')).toBe(ID_A);
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8787/auth/spotify/callback');
  });

  it('a service with no implementation explains that sign-in is not available (409), saved or not', async () => {
    const h = await setup({ unavailable: ['tidal'], saved: saved({ tidal: TIDAL_CREDS }) });
    const unavailable = { status: 409, message: 'TIDAL sign-in is not available in this version yet.' };
    expect(() => h.music.connections.beginLogin('tidal')).toThrow(expect.objectContaining(unavailable));
    await expect(h.music.connections.complete('tidal', 'c', 's')).rejects.toMatchObject(unavailable);
    await expect(h.music.connections.paste('tidal', 'code=1&state=2')).rejects.toMatchObject(unavailable);
    expect(() => h.music.connections.beginLogin('spotify')).toThrow(expect.objectContaining({ status: 400, message: 'Save your Client ID first' }));
    expect(h.built).toHaveLength(0);
  });

  it('complete() finishes the sign-in and the new connection shows up', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    await h.music.connections.complete('spotify', 'the-code', 'the-state');
    expect(h.calls).toContain('spotify:finishLogin:the-code:the-state');
    expect(h.music.connections.get('spotify').connected).toBe(true);
  });

  it('a sign-in that finishes makes "auto" switch to that service', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A }, tidal: TIDAL_CREDS }) });
    expect(h.active()).toBe('spotify'); // first configured
    await h.music.connections.complete('tidal', 'c', 's');
    expect(h.active()).toBe('tidal'); // the only connected one
    await h.music.connections.paste('spotify', 'http://127.0.0.1:8787/auth/spotify/callback?code=c&state=s');
    expect(h.active()).toBe('spotify'); // both connected: the first
    await h.music.connections.signOut('spotify');
    expect(h.active()).toBe('tidal');
  });

  it('turns a failed sign-in into a message the user can read', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    await expect(h.music.connections.complete('spotify', 'bad', 's')).rejects.toMatchObject({ status: 400, message: 'Spotify did not accept the sign-in code.' });
    await expect(h.music.connections.paste('spotify', 'nonsense')).rejects.toMatchObject({ status: 400, message: 'That does not look like the address you were sent to.' });
    await expect(h.music.connections.complete('spotify', 'c', 's')).resolves.toBeUndefined();
  });

  it('never lets a long or odd provider error through unbounded', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    h.latest('spotify').finishLogin = async () => {
      throw new Error('x'.repeat(5000));
    };
    const err = (await h.music.connections.complete('spotify', 'c', 's').catch((e: unknown) => e)) as Error;
    expect(err.message.length).toBeLessThanOrEqual(300);
    h.latest('spotify').finishLogin = () => Promise.reject('just a string');
    await expect(h.music.connections.complete('spotify', 'c', 's')).rejects.toMatchObject({ message: 'Something went wrong. Try again.' });
  });

  it('paste() returns the updated connection', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    const c = await h.music.connections.paste('spotify', 'http://127.0.0.1:8787/auth/spotify/callback?code=c&state=s');
    expect(c).toMatchObject({ connected: true });
    await expect(h.music.connections.paste('spotify', 'x')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('paste/complete before a Client ID is saved say so', async () => {
    const h = await setup();
    await expect(h.music.connections.paste('spotify', 'code=1&state=2')).rejects.toMatchObject({ status: 400, message: 'Save your Client ID first' });
    await expect(h.music.connections.complete('spotify', 'c', 's')).rejects.toMatchObject({ status: 400, message: 'Save your Client ID first' });
    const needsBoth = { status: 400, message: 'Save your TIDAL Client ID and Client Secret first' };
    await expect(h.music.connections.paste('tidal', 'code=1&state=2')).rejects.toMatchObject(needsBoth);
    await expect(h.music.connections.complete('tidal', 'c', 's')).rejects.toMatchObject(needsBoth);
  });

  it('TIDAL: a sign-in needs the secret too; with both saved, it finishes and shows up as connected', async () => {
    const h = await setup({ saved: saved({ tidal: { clientId: TIDAL_ID } }) });
    await expect(h.music.connections.complete('tidal', 'c', 's')).rejects.toMatchObject({ status: 400, message: 'Save your TIDAL Client ID and Client Secret first' });
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    await h.music.connections.complete('tidal', 'c', 's');
    expect(h.music.connections.get('tidal')).toMatchObject({ connected: true, configured: true });
  });
});

describe('connections: test', () => {
  it('reports each situation', async () => {
    const h = await setup();
    expect(await h.music.connections.test('spotify')).toEqual({ ok: false, message: 'Save your Client ID first' });
    expect(await h.music.connections.test('tidal')).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' });
    await h.music.connections.save('tidal', { clientId: TIDAL_ID });
    expect(await h.music.connections.test('tidal')).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' }); // the ID alone is not testable
    await h.music.connections.save('spotify', { clientId: ID_A });
    expect(await h.music.connections.test('spotify')).toEqual({ ok: false, message: 'Spotify rejected the saved sign-in' });
    await h.music.connections.complete('spotify', 'c', 's');
    expect(await h.music.connections.test('spotify')).toEqual({ ok: true, message: 'Spotify answered' });
  });

  it('a service with no implementation has nothing to test and says so', async () => {
    const h = await setup({ unavailable: ['tidal'], saved: saved({ tidal: TIDAL_CREDS }) });
    expect(await h.music.connections.test('tidal')).toEqual({ ok: false, message: 'TIDAL is not available in this version yet.' });
    expect(h.built).toHaveLength(0);
  });

  it('TIDAL: with the Client ID + Client Secret saved, the test is whatever the provider answers, trimmed to the contract', async () => {
    const h = await setup({ saved: saved({ tidal: TIDAL_CREDS }), leak: true });
    h.latest('tidal').test = async () => ({ ok: true, message: 'TIDAL catalog connected', token: LEAK, clientSecret: TIDAL_SECRET }) as never;
    const ok = await h.music.connections.test('tidal');
    expect(ok).toEqual({ ok: true, message: 'TIDAL catalog connected' });
    h.latest('tidal').test = async () => ({ ok: false, message: 'TIDAL refused the Client ID or Client Secret'.padEnd(500, '.') });
    const refused = await h.music.connections.test('tidal');
    expect(refused.ok).toBe(false);
    expect(refused.message.length).toBeLessThanOrEqual(300);
    h.latest('tidal').test = async () => {
      throw new Error(`offline ${TIDAL_SECRET}`);
    };
    const failed = await h.music.connections.test('tidal');
    expect(failed).toEqual({ ok: false, message: "The test couldn't be completed. Check the internet connection and try again." });
    expect(JSON.stringify([ok, refused, failed])).not.toContain(TIDAL_SECRET);
  });

  it('TIDAL: saving the secret is what makes the test possible, and a forgotten secret takes it away again', async () => {
    const h = await setup();
    await h.music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    h.latest('tidal').test = async () => ({ ok: true, message: 'TIDAL catalog connected' });
    expect(await h.music.connections.test('tidal')).toEqual({ ok: true, message: 'TIDAL catalog connected' });
    await h.music.connections.signOut('tidal', { forget: true });
    expect(await h.music.connections.test('tidal')).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' });
  });

  it('never throws and never passes on extra fields', async () => {
    const h = await setup({ saved: saved({ spotify: { clientId: ID_A } }) });
    h.latest('spotify').test = async () => ({ ok: true, message: 'fine', token: LEAK }) as never;
    const r = await h.music.connections.test('spotify');
    expect(r).toEqual({ ok: true, message: 'fine' });
    h.latest('spotify').test = async () => {
      throw new Error(`boom ${LEAK}`);
    };
    const failed = await h.music.connections.test('spotify');
    expect(failed.ok).toBe(false);
    expect(failed.message).not.toContain(LEAK);
  });
});

describe('the real defaults', () => {
  afterEach(() => vi.unstubAllEnvs());
  const cfg = {
    port: 9000,
    spotify: { clientId: ID_A, redirectUri: '', deviceName: 'Head Unit', pollMs: 3000 },
    tidal: { clientId: '', clientSecret: '', redirectUri: '', scopes: '' },
  };
  const noSpotify = { ...cfg.spotify, clientId: '' };

  it('builds the real Spotify provider from the environment Client ID and the demo otherwise', async () => {
    const fetchCalls: string[] = [];
    const music = createMusic({
      store: new JsonStore(dir),
      settings: new Observable(DEFAULT_SETTINGS),
      config: cfg,
      fetch: (async (url: string) => {
        fetchCalls.push(String(url));
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    disposers.push(() => music.dispose());
    await music.ready;
    expect(music.media.state.get()).toMatchObject({ provider: 'spotify', status: 'needs-auth' });
    expect(music.connections.get('spotify')).toMatchObject({ available: true, configured: true, clientIdSource: 'env', redirectUri: 'http://127.0.0.1:9000/auth/spotify/callback' });
    const u = new URL(music.connections.beginLogin('spotify'));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('client_id')).toBe(ID_A);
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9000/auth/spotify/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(music.connections.get('spotify').loginPending).toBe(true);
    // TIDAL is built in too, and asks for its Client ID + Client Secret.
    expect(music.connections.get('tidal')).toMatchObject({ available: true, configured: false, clientSecretConfigured: false });
    expect(fetchCalls).toEqual([]); // creating it and asking for a login address touched no network

    // Forgetting a saved ID never touches the environment's.
    await music.connections.save('spotify', { clientId: ID_B });
    expect(music.connections.get('spotify')).toMatchObject({ clientId: ID_B, clientIdSource: 'saved' });
    await music.connections.signOut('spotify', { forget: true });
    expect(music.connections.get('spotify')).toMatchObject({ clientId: ID_A, clientIdSource: 'env' });
  });

  it('builds the real TIDAL provider from the environment Client ID + Client Secret, without the network or the secret in its sign-in address', async () => {
    const fetchCalls: string[] = [];
    const music = createMusic({
      store: new JsonStore(dir),
      settings: new Observable(DEFAULT_SETTINGS),
      config: { ...cfg, spotify: noSpotify, tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: '', scopes: '' } },
      fetch: (async (url: string) => {
        fetchCalls.push(String(url));
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    disposers.push(() => music.dispose());
    await music.ready;
    expect(music.media.state.get().provider).toBe('tidal'); // "auto": TIDAL is the only configured service
    expect(music.describe()).toBe('TIDAL (catalog ready)');
    expect(music.connections.get('tidal')).toMatchObject({
      available: true,
      configured: true,
      clientIdSource: 'env',
      clientSecretConfigured: true,
      clientSecretSource: 'env',
      redirectUri: 'http://127.0.0.1:9000/auth/tidal/callback',
      requestedScopes: TIDAL_DEFAULT_SCOPES,
    });
    const u = new URL(music.connections.beginLogin('tidal'));
    expect(u.searchParams.get('client_id')).toBe(TIDAL_ID);
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9000/auth/tidal/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.href).not.toContain(TIDAL_SECRET);
    expect(music.connections.get('tidal').loginPending).toBe(true);
    expect(JSON.stringify(music.connections.list())).not.toContain(TIDAL_SECRET);
    expect(fetchCalls).toEqual([]);
  });

  it('reads TIDAL_CLIENT_SECRET from the process environment only when the config carries no secret at all', async () => {
    vi.stubEnv('TIDAL_CLIENT_SECRET', TIDAL_SECRET);
    const withoutKey = createMusic({
      store: new JsonStore(dir),
      settings: new Observable(DEFAULT_SETTINGS),
      config: { ...cfg, spotify: noSpotify, tidal: { clientId: TIDAL_ID, redirectUri: '', scopes: '' } },
    });
    disposers.push(() => withoutKey.dispose());
    await withoutKey.ready;
    expect(withoutKey.connections.get('tidal')).toMatchObject({ configured: true, clientSecretSource: 'env' });
    // An explicit (empty) config value is the config's answer: no secret.
    const empty = createMusic({
      store: new JsonStore(dir),
      settings: new Observable(DEFAULT_SETTINGS),
      config: { ...cfg, spotify: noSpotify, tidal: { clientId: TIDAL_ID, clientSecret: '', redirectUri: '', scopes: '' } },
    });
    disposers.push(() => empty.dispose());
    await empty.ready;
    expect(empty.connections.get('tidal')).toMatchObject({ configured: false, clientSecretSource: 'none' });
  });

  it('the real TIDAL provider saved through the hub: test(), sign-out and forget never put the secret in a URL, a message or the console', async () => {
    const urls: string[] = [];
    const music = createMusic({
      store: new JsonStore(dir),
      settings: new Observable(DEFAULT_SETTINGS),
      config: { ...cfg, spotify: noSpotify },
      fetch: (async (url: string) => {
        urls.push(String(url));
        return new Response('{}', { status: 500 });
      }) as unknown as typeof fetch,
    });
    disposers.push(() => music.dispose());
    await music.ready;
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const saved = await music.connections.save('tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
      expect(saved).toMatchObject({ available: true, configured: true, clientSecretConfigured: true, clientSecretSource: 'saved' });
      const result = await music.connections.test('tidal');
      expect(result.ok).toBe(false); // the fake TIDAL answered 500
      expect(result.message).not.toBe('');
      expect(JSON.stringify([saved, result, music.connections.list()])).not.toContain(TIDAL_SECRET);
      await music.connections.signOut('tidal');
      const forgotten = await music.connections.signOut('tidal', { forget: true });
      expect(forgotten).toMatchObject({ configured: false, clientSecretConfigured: false });
      expect(await music.connections.test('tidal')).toEqual({ ok: false, message: 'Save your TIDAL Client ID and Client Secret first' });
      expect(urls.length).toBeGreaterThan(0); // the test really asked TIDAL
      expect(urls.some((u) => u.includes(TIDAL_SECRET))).toBe(false);
      expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toContain(TIDAL_SECRET);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))).toEqual({}); // forgotten means gone from disk
  });

  it('uses the built-in demo with no Client ID anywhere, and that demo plays', async () => {
    const music = createMusic({ store: new JsonStore(dir), settings: new Observable(DEFAULT_SETTINGS), config: { ...cfg, spotify: { ...cfg.spotify, clientId: '' } }, mock: createMockMedia(), allowDemo: true });
    disposers.push(() => music.dispose());
    await music.ready;
    expect(music.media.state.get().provider).toBe('mock');
    music.media.start();
    await music.media.command({ cmd: 'play' });
    expect(music.media.state.get().playing).toBe(true);
    expect((await music.media.library.playlists()).length).toBeGreaterThan(0);
    music.dispose();
  });
});
