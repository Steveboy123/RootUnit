import type { CatalogTrack, MediaCommand, MediaState, RepeatMode } from '@headunit/shared';
import { createDemoCatalog, type DemoCatalog } from './demoCatalog';
import { LibraryError, type LibraryProvider } from '../library/library';
import { Observable } from '../observable';
import type { MediaProvider } from '../providers/media';

/** The offline demo player + library: everything works with no Spotify account or internet. */
export function createMockMedia(
  now: () => number = Date.now,
  catalog: DemoCatalog = createDemoCatalog(),
): MediaProvider & { tick(): void; catalog: DemoCatalog } {
  let queue: CatalogTrack[] = catalog.playlistTracks(4);
  let index = 0;
  /** Tracks added with "play next"/"add to queue" that sit right after the current one. */
  let queued = 0;
  let anchorMs = 0;
  let anchorTs = now();
  let playing = false;
  let timer: NodeJS.Timeout | null = null;

  const state = new Observable<MediaState>({
    provider: 'mock',
    status: 'ready',
    playing: false,
    track: queue[0] ?? null,
    progressMs: 0,
    progressTs: anchorTs,
    volume: 70,
    shuffle: false,
    repeat: 'off',
    deviceName: catalog.activeDeviceName(),
    liked: queue[0] ? catalog.isLiked(queue[0].id) : undefined,
  });

  const position = () => (playing ? anchorMs + (now() - anchorTs) : anchorMs);

  function publish(patch: Partial<MediaState> = {}) {
    const track = queue[index] ?? null;
    state.set({
      ...state.get(),
      playing,
      track,
      progressMs: Math.min(position(), track?.durationMs ?? 0),
      progressTs: now(),
      deviceName: catalog.activeDeviceName(),
      liked: track ? catalog.isLiked(track.id) : undefined,
      ...patch,
    });
  }

  function goTo(i: number, autoplay = playing) {
    const next = (i + queue.length) % queue.length;
    if (next === index + 1 && queued > 0) queued--; // advanced into a queued track
    index = next;
    anchorMs = 0;
    anchorTs = now();
    playing = autoplay;
    if (autoplay && queue[index]) catalog.played(queue[index]!.id);
    publish();
  }

  function setPlaying(p: boolean) {
    anchorMs = position();
    anchorTs = now();
    playing = p;
    if (p && anchorMs === 0 && queue[index]) catalog.played(queue[index]!.id);
    publish();
  }

  /** Start a new list of tracks at `offset`. */
  function start(list: CatalogTrack[], offset = 0) {
    if (list.length === 0) return;
    queue = list;
    queued = 0;
    goTo(Math.min(Math.max(0, offset), list.length - 1), true);
  }

  /** Auto-advance at track end. Public so tests can drive it. */
  function tick() {
    const track = queue[index];
    if (!playing || !track || position() < track.durationMs) return;
    const { repeat } = state.get();
    if (repeat === 'track') return goTo(index);
    if (index === queue.length - 1 && repeat === 'off') {
      anchorMs = 0;
      anchorTs = now();
      playing = false;
      return publish();
    }
    goTo(index + 1);
  }

  const itemOrThrow = <T>(v: T | undefined, what: string): T => {
    if (!v) throw new LibraryError(`${what} not found`);
    return v;
  };

  const library: LibraryProvider = {
    home: async () => catalog.home(),
    playlists: async () => catalog.playlists(),
    liked: async () => catalog.likedTracks(),
    albums: async () => catalog.albums(),
    artists: async () => catalog.artists(),
    search: async (q) => catalog.search(q),
    playlist: async (id) => ({ item: itemOrThrow(catalog.playlistItemById(id), 'Playlist'), tracks: catalog.playlistTracks(Number(id)) }),
    album: async (id) => ({ item: itemOrThrow(catalog.albumItemById(id), 'Album'), tracks: catalog.albumTracks(Number(id)) }),
    queue: async () => ({ current: queue[index] ?? null, next: queue.slice(index + 1, index + 31) }),
    devices: async () => catalog.devices(),
    async transfer(id) {
      if (!catalog.transfer(id)) throw new LibraryError('Unknown device');
      publish();
    },
    async setLiked(uri, on) {
      const result = catalog.setLiked(uri, on);
      publish();
      return result;
    },
  };

  /** "mock:playlist:3" → its tracks. */
  const contextTracks = (uri: string): CatalogTrack[] => {
    const m = /^mock:(playlist|album|artist):(\d+)$/.exec(uri);
    if (!m) return [];
    const id = Number(m[2]);
    return m[1] === 'playlist' ? catalog.playlistTracks(id) : m[1] === 'album' ? catalog.albumTracks(id) : catalog.artistTracks(id);
  };

  return {
    state,
    library,
    catalog,
    tick,
    start() {
      if (timer) return;
      timer = setInterval(tick, 250);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async command(c: MediaCommand) {
      switch (c.cmd) {
        case 'play':
          return setPlaying(true);
        case 'pause':
          return setPlaying(false);
        case 'toggle':
          return setPlaying(!playing);
        case 'next':
          return goTo(index + 1);
        case 'prev':
          // Like most players: restart the track if we're past 3 s, else go back.
          return position() > 3000 ? goTo(index) : goTo(index - 1);
        case 'seek': {
          const dur = queue[index]?.durationMs ?? 0;
          anchorMs = Math.max(0, Math.min(c.positionMs, dur));
          anchorTs = now();
          return publish();
        }
        case 'volume':
          return publish({ volume: Math.max(0, Math.min(100, Math.round(c.volume))) });
        case 'shuffle':
          return publish({ shuffle: c.enabled });
        case 'repeat':
          return publish({ repeat: c.mode as RepeatMode });
        case 'playContext':
          return start(contextTracks(c.uri), c.offset);
        case 'playTracks':
          return start(c.uris.map((u) => catalog.trackByUri(u)).filter((t): t is CatalogTrack => !!t), c.offset);
        case 'queueAdd': {
          const t = catalog.trackByUri(c.uri);
          if (!t) return;
          queue.splice(index + 1 + queued, 0, t);
          queued++;
          return publish();
        }
      }
    },
  };
}
