/**
 * Test support: fake music services that record what they were asked to do and keep their "saved sign-in" in a
 * plain object, so tests can check the hub and the HTTP routes without Spotify, the network or the disk.
 */
import type { MediaState, MusicService } from '@headunit/shared';
import { Observable } from '../observable';
import type { MediaProvider } from '../providers/media';
import type { ServiceFactory } from './music';
import type { MusicServiceProvider, ServiceAuthInfo, ServiceSettings } from './service';

/** A value no response, log line or error message may ever contain. */
export const LEAK = 'SECRET-TOKEN-SENTINEL';

/** Counts live subscriptions so a leaked listener shows up as a number. */
export class CountingObservable<T> extends Observable<T> {
  active = 0;
  override subscribe(l: (v: T) => void): () => void {
    this.active++;
    const off = super.subscribe(l);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active--;
      off();
    };
  }
}

const initial = (provider: MediaState['provider']): MediaState => ({
  provider,
  status: 'ready',
  playing: false,
  track: null,
  progressMs: 0,
  progressTs: 0,
  volume: 50,
  shuffle: false,
  repeat: 'off',
});

export type FakeMedia = MediaProvider & { state: CountingObservable<MediaState> };

/** A player that records what it was asked to do (commands, transfers, likes). */
export function fakeMedia(provider: MediaState['provider'], calls: string[]): FakeMedia {
  const state = new CountingObservable<MediaState>(initial(provider));
  const note = (what: string) => calls.push(`${provider}:${what}`);
  return {
    state,
    library: {
      home: async () => ({ playlists: [], recent: [], topTracks: [], topArtists: [] }),
      playlists: async () => [],
      liked: async () => [],
      albums: async () => [],
      artists: async () => [],
      search: async () => ({ tracks: [], albums: [], artists: [], playlists: [] }),
      playlist: async () => Promise.reject(new Error('unused')),
      album: async () => Promise.reject(new Error('unused')),
      queue: async () => ({ current: null, next: [] }),
      devices: async () => [],
      transfer: async (id) => void note(`transfer:${id}`),
      setLiked: async (uri, on) => {
        note(`setLiked:${uri}`);
        return on;
      },
    },
    command: async (c) => {
      note(c.cmd);
      if (c.cmd === 'pause') state.update({ playing: false });
      if (c.cmd === 'play') state.update({ playing: true });
    },
    start: () => void note('start'),
    stop: () => void note('stop'),
  };
}

export interface Fake extends MusicServiceProvider {
  n: number;
  settings: ServiceSettings;
  state: CountingObservable<MediaState>;
}

export interface FakeWorld {
  /** Everything every fake was asked to do, in order ("spotify:start", "tidal:logout", …). */
  calls: string[];
  /** Every provider built, oldest first. */
  built: Fake[];
  /** Which Client ID each service's saved tokens were issued to (the fakes' stand-in for spotify.json). */
  vault: Partial<Record<MusicService, string>>;
  factory(service: MusicService): ServiceFactory;
}

export function createFakeWorld(opts: { signedIn?: Partial<Record<MusicService, string>>; leak?: boolean } = {}): FakeWorld {
  const calls: string[] = [];
  const built: Fake[] = [];
  const vault: Partial<Record<MusicService, string>> = { ...opts.signedIn };
  const factory =
    (service: MusicService): ServiceFactory =>
    (s: ServiceSettings) => {
      const base = fakeMedia(service, calls);
      const label = service === 'spotify' ? 'Spotify' : 'TIDAL';
      const connected = () => vault[service] === s.clientId;
      const fake: Fake = {
        ...base,
        n: built.length + 1,
        settings: s,
        state: base.state,
        beginLogin: () => `https://${service}.example/authorize?client_id=${s.clientId}&redirect_uri=${encodeURIComponent(s.redirectUri)}&n=${fake.n}`,
        finishLogin: async (code, st) => {
          if (code === 'bad') throw new Error(`${label} did not accept the sign-in code.`);
          calls.push(`${service}:finishLogin:${code}:${st}`);
          vault[service] = s.clientId;
        },
        finishLoginFromPaste: async (text) => {
          if (!text.includes('code=')) throw new Error('That does not look like the address you were sent to.');
          calls.push(`${service}:paste`);
          vault[service] = s.clientId;
        },
        logout: async () => {
          calls.push(`${service}:logout`);
          delete vault[service];
          base.state.update({ status: 'needs-auth', playing: false });
        },
        connection: () =>
          ({
            connected: connected(),
            loginPending: false,
            ...(opts.leak ? { accessToken: LEAK, refreshToken: LEAK, clientSecret: LEAK } : {}),
          }) as ServiceAuthInfo,
        test: async () => ({ ok: connected(), message: connected() ? `${label} answered` : `${label} rejected the saved sign-in` }),
        ...(service === 'tidal'
          ? {
              playerCredentials: async () => ({
                primary: { clientId: s.clientId, accessToken: 'fake-tidal-player-token', expiresAt: Date.now() + 60_000, scopes: ['playback'], source: 'client' as const },
              }),
            }
          : {}),
      };
      built.push(fake);
      return fake;
    };
  return { calls, built, vault, factory };
}
