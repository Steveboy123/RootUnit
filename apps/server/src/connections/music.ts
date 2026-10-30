import {
  MUSIC_SERVICES,
  SERVICE_INFO,
  validateClientId,
  validateClientSecret,
  type MediaState,
  type MusicService,
  type SaveConnectionRequest,
  type ServiceConnection,
  type Settings,
  type TestConnectionResult,
} from '@headunit/shared';
import type { Config } from '../config';
import { LibraryError, type LibraryProvider } from '../library/library';
import { Observable } from '../observable';
import type { MediaProvider } from '../providers/media';
import { createSpotifyMedia } from '../providers/mediaSpotify';
import { createTidalMedia, TIDAL_DEFAULT_SCOPES } from '../providers/mediaTidal';
import type { JsonStore } from '../store';
import { loadCredentials, resolveService, saveServiceCredentials, type EnvService, type SavedCredentials } from './credentials';
import type { MusicServiceProvider, ServiceSettings, SpotifyPlayerCredential, TidalPlayerCredentialBundle } from './service';

/** A request the user can fix. `status` becomes the HTTP status; `message` is plain language and safe to show. */
export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 400,
  ) {
    super(message);
  }
}

export interface ConnectionsApi {
  list(): ServiceConnection[];
  get(service: MusicService): ServiceConnection;
  /** Save the Client ID (and optional overrides). A different Client ID signs the old account out. */
  save(service: MusicService, req: SaveConnectionRequest): Promise<ServiceConnection>;
  /** Sign out; with `forget` also remove the saved Client ID / redirect / permissions. */
  signOut(service: MusicService, opts?: { forget?: boolean }): Promise<ServiceConnection>;
  /** Start a sign-in and return the service's authorize address. */
  beginLogin(service: MusicService): string;
  /** Finish a sign-in from the redirect's `code` and `state`. */
  complete(service: MusicService, code: string, state: string): Promise<void>;
  /** Finish a sign-in from a pasted redirect address. */
  paste(service: MusicService, text: string): Promise<ServiceConnection>;
  /** One cheap request to prove the sign-in works. Never throws. */
  test(service: MusicService): Promise<TestConnectionResult>;
  /** Short-lived Spotify playback token for the local kiosk. */
  spotifyPlayerCredentials(): Promise<SpotifyPlayerCredential>;
  /** Short-lived TIDAL player credentials for the local kiosk. */
  tidalPlayerCredentials(): Promise<TidalPlayerCredentialBundle>;

}

export type ServiceFactory = (settings: ServiceSettings) => MusicServiceProvider;

export interface MusicDeps {
  store: JsonStore;
  settings: Observable<Settings>;
  /**
   * Only the environment layer and the port are used. `tidal.clientSecret` is the environment's secret; when the
   * config does not carry one, `TIDAL_CLIENT_SECRET` is read from the process environment.
   */
  config: {
    port: number;
    spotify: Pick<Config['spotify'], 'clientId' | 'redirectUri' | 'deviceName' | 'pollMs'>;
    tidal: Config['tidal'] & { clientSecret?: string };
  };
  fetch?: typeof fetch;
  now?: () => number;
  /** A service without a factory is "not available in this build". */
  factories?: Partial<Record<MusicService, ServiceFactory>>;
  /**
   * The offline demo player. It is only ever used when `allowDemo` is true (explicit demo mode, HEADUNIT_DEMO=1): then it is what
   * `auto` resolves to while no real service is configured. A production Pi never passes it and never plays anything fake.
   */
  mock?: MediaProvider;
  allowDemo?: boolean;
}

export interface Music {
  /** The hub the rest of the app uses as its one MediaProvider. */
  media: MediaProvider;
  connections: ConnectionsApi;
  /** Resolves once the saved Client IDs are loaded and the first active service is chosen. Await it before serving. */
  ready: Promise<void>;
  /** One line for the startup log describing the selected real music service. */
  describe(): string;
  /** Stop everything and release every subscription and timer. */
  dispose(): void;
}

export function isMusicService(v: unknown): v is MusicService {
  return typeof v === 'string' && (MUSIC_SERVICES as string[]).includes(v);
}

const noop = () => undefined;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Only the message of a provider's failure reaches the user; anything else about it stays in the server. */
function asConnectionError(err: unknown): ConnectionError {
  if (err instanceof ConnectionError) return err;
  const message = err instanceof Error ? err.message.trim().slice(0, 300) : '';
  return new ConnectionError(message || 'Something went wrong. Try again.');
}

/** Shown while a service is chosen but can't be used: the Music page turns this into its Connect/Setup prompt. */
function createStub(service: MusicService, available: boolean, now: () => number): MediaProvider {
  const label = SERVICE_INFO[service].label;
  const message = available ? `${label} isn't set up yet` : `${label} isn't available in this version yet`;
  const fail = <T>() => Promise.reject<T>(new LibraryError(message, 'auth'));
  const library: LibraryProvider = {
    home: fail,
    playlists: fail,
    liked: fail,
    albums: fail,
    artists: fail,
    search: fail,
    playlist: fail,
    album: fail,
    queue: fail,
    devices: fail,
    transfer: fail,
    setLiked: fail,
  };
  return {
    state: new Observable<MediaState>({
      provider: service,
      status: 'needs-auth',
      playing: false,
      track: null,
      progressMs: 0,
      progressTs: now(),
      volume: 50,
      shuffle: false,
      repeat: 'off',
      ...(available ? {} : { error: message }),
    }),
    library,
    command: async () => undefined,
    start: noop,
    stop: noop,
  };
}

/** The currently selected music service/provider ('demo' only in explicit demo mode). */
interface Active {
  service: MusicService | 'demo';
  media: MediaProvider;
}

export function createMusic(deps: MusicDeps): Music {
  const { store, settings, config } = deps;
  const now = deps.now ?? Date.now;

  const factories: Partial<Record<MusicService, ServiceFactory>> = {
    spotify: (s) =>
      createSpotifyMedia({
        config: { clientId: s.clientId, redirectUri: s.redirectUri, deviceName: config.spotify.deviceName, pollMs: config.spotify.pollMs },
        store,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      }),
    tidal: (s) =>
      createTidalMedia({
        config: s,
        store,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.now ? { now: deps.now } : {}),
      }),
    ...deps.factories,
  };
  const isAvailable = (s: MusicService) => typeof factories[s] === 'function';
  const demo: Active | null = deps.allowDemo && deps.mock ? { service: 'demo', media: deps.mock } : null;

  let saved: SavedCredentials = {};
  /** One provider per configured, available service. `key` says which settings it was built from. */
  const slots: Partial<Record<MusicService, { key: string; provider: MusicServiceProvider }>> = {};
  const stubs = new Map<MusicService, Active>();

  const envFor = (s: MusicService): EnvService =>
    s === 'spotify'
      ? { clientId: config.spotify.clientId, redirectUri: config.spotify.redirectUri }
      : {
          clientId: config.tidal.clientId,
          clientSecret: config.tidal.clientSecret ?? process.env.TIDAL_CLIENT_SECRET ?? '',
          redirectUri: config.tidal.redirectUri,
          scopes: config.tidal.scopes,
        };
  const resolved = (s: MusicService) => resolveService(s, saved, envFor(s), config.port, s === 'tidal' ? TIDAL_DEFAULT_SCOPES : '');

  /** Make the provider for `service` match the resolved settings. Returns the provider it replaced, if any. */
  function reconcile(service: MusicService): MusicServiceProvider | undefined {
    const factory = factories[service];
    const r = resolved(service);
    const credentialsReady = service === 'tidal' ? Boolean(r.clientId && r.clientSecret) : Boolean(r.clientId);
    const want = factory && credentialsReady ? [r.clientId, r.clientSecret, r.redirectUri, r.scopes].join('\n') : null;
    const cur = slots[service];
    if ((cur?.key ?? null) === want) return undefined;
    if (factory && want) slots[service] = {
      key: want,
      provider: factory({ clientId: r.clientId, ...(service === 'tidal' ? { clientSecret: r.clientSecret } : {}), redirectUri: r.redirectUri, scopes: r.scopes }),
    };
    else delete slots[service];
    return cur?.provider;
  }

  // ---- The hub ------------------------------------------------------------

  let initialised = false;
  let disposed = false;
  let started = false;
  let current: Active = demo ?? serviceActive('spotify');
  let unwatch: () => void = noop;
  const state = new Observable<MediaState>(current.media.state.get());

  function serviceActive(service: MusicService): Active {
    const slot = slots[service];
    if (slot) return { service, media: slot.provider };
    let stub = stubs.get(service);
    if (!stub) stubs.set(service, (stub = { service, media: createStub(service, isAvailable(service), now) }));
    return stub;
  }

  /**
   * `auto`: first connected service, then first configured service, otherwise (demo mode only) the demo player, otherwise Spotify's
   * setup prompt. A saved `demo` source is honoured only in demo mode; anywhere else it behaves like `auto`.
   */
  function desired(): Active {
    const source = settings.get().musicSource as string;
    if (source === 'spotify' || source === 'tidal') return serviceActive(source);
    if (source === 'demo' && demo) return demo;
    for (const s of MUSIC_SERVICES) if (slots[s]?.provider.connection().connected) return serviceActive(s);
    for (const s of MUSIC_SERVICES) if (slots[s]) return serviceActive(s);
    return demo ?? serviceActive('spotify');
  }

  function watch(a: Active) {
    unwatch = a.media.state.subscribe((v) => {
      state.set(v);
      // A service's sign-in can lapse while it plays; `auto` then has to look again.
      if (a.service && settings.get().musicSource === 'auto') evaluate();
    });
  }

  function activate(next: Active) {
    if (next.media === current.media) return;
    const prev = current;
    unwatch();
    // Services are never mixed: leaving one for another must not leave it playing.
    if (prev.service !== next.service && prev.media.state.get().playing) {
      try {
        void Promise.resolve(prev.media.command({ cmd: 'pause' })).catch(noop);
      } catch {
        // Best effort.
      }
    }
    prev.media.stop();
    current = next;
    watch(next);
    state.set(next.media.state.get());
    if (started) next.media.start();
  }

  function evaluate() {
    if (!initialised || disposed) return;
    activate(desired());
  }

  const library: LibraryProvider = {
    home: () => current.media.library.home(),
    playlists: () => current.media.library.playlists(),
    liked: () => current.media.library.liked(),
    albums: () => current.media.library.albums(),
    artists: () => current.media.library.artists(),
    search: (q) => current.media.library.search(q),
    playlist: (id) => current.media.library.playlist(id),
    album: (id) => current.media.library.album(id),
    queue: () => current.media.library.queue(),
    devices: () => current.media.library.devices(),
    transfer: (id) => current.media.library.transfer(id),
    setLiked: (uri, on) => current.media.library.setLiked(uri, on),
  };

  const media: MediaProvider = {
    state,
    library,
    command: (c) => current.media.command(c),
    start() {
      started = true;
      current.media.start();
    },
    stop() {
      started = false;
      current.media.stop();
    },
  };

  watch(current);
  const unsettings = settings.subscribe(() => evaluate());

  const ready = (async () => {
    saved = await loadCredentials(store);
    for (const s of MUSIC_SERVICES) reconcile(s);
    initialised = true;
    evaluate();
  })();
  void ready.catch((err) => console.error('[music]', err));

  // ---- Connections --------------------------------------------------------

  /** Saves and sign-outs run one after another so two quick taps can't interleave their file writes. */
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn);
    queue = run.then(noop, noop);
    return run;
  }

  function assertService(service: unknown): asserts service is MusicService {
    if (!isMusicService(service)) throw new ConnectionError('Unknown music service', 404);
  }

  /** The provider for `service`, or the plain-language reason there isn't one. */
  function providerFor(service: MusicService): MusicServiceProvider {
    assertService(service);
    if (!isAvailable(service)) throw new ConnectionError(`${SERVICE_INFO[service].label} sign-in is not available in this version yet.`, 409);
    const slot = slots[service];
    if (!slot) throw new ConnectionError(service === 'tidal' ? 'Save your TIDAL Client ID and Client Secret first' : 'Save your Client ID first');
    return slot.provider;
  }

  /** Everything Settings shows. Fields are copied one by one so nothing a provider adds can leak out. */
  function compose(service: MusicService): ServiceConnection {
    const info = SERVICE_INFO[service];
    const r = resolved(service);
    const auth = slots[service]?.provider.connection();
    return {
      service,
      label: info.label,
      available: isAvailable(service),
      configured: service === 'tidal' ? r.clientId !== '' && r.clientSecret !== '' : r.clientId !== '',
      clientId: r.clientId,
      clientIdSource: r.clientIdSource,
      ...(service === 'tidal'
        ? { clientSecretConfigured: r.clientSecret !== '', clientSecretSource: r.clientSecretSource }
        : {}),
      dashboardUrl: info.dashboardUrl,
      redirectUri: r.redirectUri,
      redirectUriSource: r.redirectUriSource,
      // Spotify's permissions are fixed by the app; only TIDAL's can be chosen.
      ...(service === 'tidal' && r.scopes ? { requestedScopes: r.scopes } : {}),
      connected: auth?.connected === true,
      loginPending: auth?.loginPending === true,
      ...(auth?.problem ? { problem: auth.problem } : {}),
      ...(auth?.message ? { message: auth.message } : {}),
      ...(auth?.connectedAt !== undefined ? { connectedAt: auth.connectedAt } : {}),
      ...(auth?.loginExpiresAt !== undefined ? { loginExpiresAt: auth.loginExpiresAt } : {}),
      ...(auth?.scopes ? { scopes: [...auth.scopes] } : {}),
    };
  }

  /**
   * A freshly built Spotify provider reads its saved sign-in from disk a moment after it is created and says "not
   * connected" until then. When the old one was connected and its tokens are kept, wait (briefly) for the new one
   * to agree, so the answer to the save isn't wrong.
   */
  async function settle(wasConnected: boolean, provider: MusicServiceProvider) {
    for (let i = 0; wasConnected && i < 50 && !provider.connection().connected; i++) await sleep(10);
  }

  const connections: ConnectionsApi = {
    list: () => MUSIC_SERVICES.map(compose),

    get(service) {
      assertService(service);
      return compose(service);
    },

    save: (service, req) =>
      exclusive(async () => {
        await ready;
        assertService(service);
        const body = (typeof req === 'object' && req !== null ? req : {}) as Partial<SaveConnectionRequest>;
        const id = validateClientId(service, body.clientId);
        if (!id.ok) throw new ConnectionError(id.error);
        if (body.clientSecret !== undefined && body.clientSecret !== null) {
          if (service !== 'tidal') throw new ConnectionError('This service does not use a Client Secret here.');
          const secret = validateClientSecret(service, body.clientSecret);
          if (!secret.ok) throw new ConnectionError(secret.error);
          body.clientSecret = secret.value;
        }
        if (body.redirectUri !== undefined && body.redirectUri !== null && typeof body.redirectUri !== 'string') throw new ConnectionError('Enter a web address.');
        if (body.scopes !== undefined && body.scopes !== null && typeof body.scopes !== 'string') throw new ConnectionError('Enter permissions separated by spaces.');

        const previous = slots[service];
        const clientIdChanged = id.value !== resolved(service).clientId;
        try {
          saved = await saveServiceCredentials(store, service, {
            clientId: id.value,
            ...(service === 'tidal'
              ? { clientSecret: body.clientSecret === undefined && clientIdChanged ? null : body.clientSecret }
              : {}),
            redirectUri: body.redirectUri,
            scopes: body.scopes,
          });
        } catch (err) {
          throw asConnectionError(err); // validation of the Redirect URI / permissions
        }
        // Tokens belong to one Client ID: the old sign-in must go before anything else can pick them up. If that
        // fails the save still goes ahead: a provider never accepts tokens issued to a different Client ID anyway.
        if (clientIdChanged) await previous?.provider.logout().catch((err) => console.error('[music] could not sign out the previous Client ID', err));
        const keepsSignIn = !clientIdChanged && previous?.provider.connection().connected === true;
        const replaced = reconcile(service);
        const slot = slots[service];
        if (slot && replaced) await settle(keepsSignIn, slot.provider);
        evaluate();
        replaced?.stop();
        return compose(service);
      }),

    signOut: (service, opts) =>
      exclusive(async () => {
        await ready;
        assertService(service);
        try {
          await slots[service]?.provider.logout();
        } catch (err) {
          throw asConnectionError(err); // e.g. "could not remove the saved sign-in": say so instead of a generic error
        }
        let replaced: MusicServiceProvider | undefined;
        if (opts?.forget) {
          saved = await saveServiceCredentials(store, service, { clientId: null, ...(service === 'tidal' ? { clientSecret: null } : {}), redirectUri: null, scopes: null });
          replaced = reconcile(service);
        }
        evaluate();
        replaced?.stop();
        return compose(service);
      }),

    beginLogin(service) {
      if (!initialised) throw new ConnectionError('The head unit is still starting up. Try again in a moment.');
      return providerFor(service).beginLogin();
    },

    async complete(service, code, st) {
      await ready;
      const provider = providerFor(service);
      try {
        await provider.finishLogin(code, st);
      } catch (err) {
        throw asConnectionError(err);
      }
      evaluate();
    },

    async paste(service, text) {
      await ready;
      const provider = providerFor(service);
      try {
        await provider.finishLoginFromPaste(text);
      } catch (err) {
        throw asConnectionError(err);
      }
      evaluate();
      return compose(service);
    },

    async test(service) {
      await ready;
      assertService(service);
      const label = SERVICE_INFO[service].label;
      if (!isAvailable(service)) return { ok: false, message: `${label} is not available in this version yet.` };
      const slot = slots[service];
      if (!slot) return { ok: false, message: service === 'tidal' ? 'Save your TIDAL Client ID and Client Secret first' : 'Save your Client ID first' };
      try {
        const r = await slot.provider.test();
        return { ok: r.ok === true, message: String(r.message ?? '').slice(0, 300) };
      } catch {
        return { ok: false, message: "The test couldn't be completed. Check the internet connection and try again." };
      } finally {
        evaluate(); // a failed test can reveal that the sign-in has lapsed
      }
    },

    async spotifyPlayerCredentials() {
      await ready;
      const provider = providerFor('spotify');
      if (!provider.spotifyPlayerCredentials) throw new ConnectionError('Spotify local playback is not available in this build.', 409);
      try {
        return await provider.spotifyPlayerCredentials();
      } catch (err) {
        throw asConnectionError(err);
      }
    },

    async tidalPlayerCredentials() {
      await ready;
      const provider = providerFor('tidal');
      if (!provider.playerCredentials) throw new ConnectionError('TIDAL native playback is not available in this build.', 409);
      try {
        return await provider.playerCredentials();
      } catch (err) {
        throw asConnectionError(err);
      }
    },
  };

  return {
    media,
    connections,
    ready,
    describe() {
      const { service } = current;
      if (service === 'demo') return 'demo';
      const label = SERVICE_INFO[service].label;
      if (!isAvailable(service)) return `${label} (not available in this version yet)`;
      const slot = slots[service];
      if (!slot) return service === 'tidal' ? `${label} (needs Client ID + Secret)` : `${label} (needs a Client ID)`;
      const signedIn = slot.provider.connection().connected;
      // TIDAL's catalog and developer-preview playback work from Client ID + Secret alone; a user sign-in is optional and may carry wider playback entitlement.
      if (service === 'tidal') return signedIn ? `${label} (catalog ready, signed in)` : `${label} (catalog ready)`;
      return signedIn ? label : `${label} (not signed in yet)`;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsettings();
      unwatch();
      unwatch = noop;
      for (const slot of Object.values(slots)) slot.provider.stop();
      if (demo) demo.media.stop();
    },
  };
}
