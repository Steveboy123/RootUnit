import type { CatalogItem, CatalogTrack, ConnectDevice, LibraryHome, QueueView, SearchResults, TrackListing } from '@headunit/shared';
import { LibraryError, type LibraryProvider } from './library';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Api = (method: string, path: string, body?: unknown) => Promise<Response | null>;

export interface SpotifyLibraryDeps {
  api: Api;
  /** Is something playing right now? Transferring playback keeps that state. */
  isPlaying(): boolean;
}

export type SpotifyLibrary = LibraryProvider & {
  /** Is this track saved? `undefined` if it can't be determined (e.g. missing permission). */
  contains(uri: string): Promise<boolean | undefined>;
};

/** Pick the artwork closest to a tile size (Spotify lists several sizes, largest first). */
function art(images?: Array<{ url: string; width?: number | null }>): string | undefined {
  if (!images?.length) return undefined;
  const sized = images.filter((i) => typeof i.width === 'number');
  if (!sized.length) return images[0]!.url;
  return sized.reduce((best, i) => (Math.abs(i.width! - 300) < Math.abs(best.width! - 300) ? i : best)).url;
}

/**
 * The human-readable message out of a failed Web API response: `{error: {status, message}}` (the documented
 * shape), a bare `{error: "…"}`, or plain text. Never throws; empty when there is nothing usable.
 */
export async function readApiMessage(res: Response): Promise<string> {
  let text = '';
  try {
    text = (await res.clone().text()).trim();
  } catch {
    return '';
  }
  let message = text;
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.error_description ?? j?.error ?? j?.message;
    message = typeof m === 'string' ? m : '';
  } catch {
    // Not JSON: use the text as-is, unless it is markup (a proxy's error page).
    if (text.startsWith('<')) message = '';
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 200);
}

const names = (artists?: Array<{ name: string }>) => (artists ?? []).map((a) => a.name).join(', ');

function track(t: any, fallbackAlbum?: { name?: string; art?: string }): CatalogTrack | null {
  if (!t || t.type === 'episode' || t.is_local || !t.id || !t.uri) return null;
  return {
    id: t.id,
    uri: t.uri,
    title: t.name ?? 'Unknown',
    artist: names(t.artists),
    album: t.album?.name ?? fallbackAlbum?.name ?? '',
    artUrl: art(t.album?.images) ?? fallbackAlbum?.art,
    durationMs: t.duration_ms ?? 0,
    // `is_playable` only appears when Spotify applied track relinking; absent means "unknown", not "no".
    ...(typeof t.is_playable === 'boolean' ? { playable: t.is_playable } : {}),
    ...(typeof t.explicit === 'boolean' ? { explicit: t.explicit } : {}),
  };
}
const tracks = (list: any[] | undefined, fb?: Parameters<typeof track>[1]) => (list ?? []).map((t) => track(t, fb)).filter((t): t is CatalogTrack => t !== null);

/**
 * Tracks of one playlist/album. `raw` must be every entry in Spotify's order, nulls/local files/episodes included:
 * `position` is the index Spotify itself uses for "start playing at", so it is taken before anything is dropped.
 */
function listTracks(raw: any[], fallbackAlbum?: Parameters<typeof track>[1]): CatalogTrack[] {
  const out: CatalogTrack[] = [];
  raw.forEach((t, position) => {
    const mapped = track(t, fallbackAlbum);
    if (mapped) out.push({ ...mapped, position });
  });
  return out;
}

const playlistItem = (p: any): CatalogItem | null =>
  p?.id
    ? {
        id: p.id,
        uri: p.uri,
        type: 'playlist',
        name: p.name ?? 'Playlist',
        // February 2026 renamed a playlist's `tracks` to `items`; accept both.
        subtitle: p.owner?.display_name ? `by ${p.owner.display_name}` : undefined,
        artUrl: art(p.images),
        trackCount: p.items?.total ?? p.tracks?.total,
      }
    : null;

const albumItem = (a: any): CatalogItem | null =>
  a?.id ? { id: a.id, uri: a.uri, type: 'album', name: a.name, subtitle: names(a.artists), artUrl: art(a.images), trackCount: a.total_tracks } : null;

const artistItem = (a: any): CatalogItem | null =>
  a?.id ? { id: a.id, uri: a.uri, type: 'artist', name: a.name, subtitle: 'Artist', artUrl: art(a.images) } : null;

const compact = <T>(list: Array<T | null>): T[] => list.filter((x): x is T => x !== null);

/** The id out of "spotify:track:ID". */
const idOf = (uri: string) => uri.split(':').pop() ?? uri;
/** What the saved-state lookup accepts (`/me/library/contains` also lists artists). */
const URI = /^spotify:(track|album|artist|playlist):[A-Za-z0-9]{1,40}$/;
/** What the save/remove call accepts: its documented types have no `artist` (following artists is a separate call). */
const SAVABLE = /^spotify:(track|album|playlist):[A-Za-z0-9]{1,40}$/;
/** When the consolidated `/me/library` answers like this, a track can still go through the older `/me/tracks`. */
const OLD_ENDPOINT_STATUSES = new Set([403, 404, 405]);

/** The most any paged endpoint returns per request (the documented `limit` maximum). */
const PAGE = 50;
/** Saved tracks/albums, playlists and followed artists: plenty for a car screen, and a handful of requests. */
const LIST_CAP = 200;
/** Entries read from one playlist or album. Each one is still addressable: `position` keeps Spotify's numbering. */
const TRACKS_CAP = 400;
/** Requests needed to reach a cap with full pages; also the most we make, so a server answering short pages can't keep us looping. */
const maxPages = (cap: number) => Math.ceil(cap / PAGE);

/**
 * Library features on the Spotify Web API, written against Spotify's reference as of its 2026 changes
 * (see docs/spotify.md and the "not tested live" note there): playlist items come from `/items` (50 per page),
 * library saves go through `/me/library` with URIs, search is capped at 10 results per type.
 * Where an endpoint may be refused to development-mode apps, a track falls back to the older form.
 */
export function createSpotifyLibrary({ api, isPlaying }: SpotifyLibraryDeps): SpotifyLibrary {
  /** GET → JSON, translating HTTP failures into messages the UI can show. */
  async function get(path: string): Promise<any> {
    const res = await api('GET', path);
    return check(res).then(() => res!.json());
  }

  async function check(res: Response | null): Promise<void> {
    if (!res) throw new LibraryError('Connect Spotify first', 'auth');
    if (res.ok) return;
    if (res.status === 401) throw new LibraryError('Spotify login expired — reconnect', 'auth');
    if (res.status === 429) throw new LibraryError('Spotify is rate-limiting requests — try again in a moment', 'rate');
    if (res.status === 403) {
      // Spotify's 403 is generic, so the wording comes from its own message.
      const msg = await readApiMessage(res);
      if (/scope/i.test(msg)) throw new LibraryError('Reconnect Spotify to allow access to your library', 'scope');
      if (/premium/i.test(msg)) throw new LibraryError('Spotify Premium is required for this', 'unavailable');
      throw new LibraryError(msg ? `Spotify refused this request (403): ${msg}` : 'Spotify refused this request (403)', 'unavailable');
    }
    if (res.status === 404) throw new LibraryError('Not found', 'unavailable');
    throw new LibraryError(`Spotify error ${res.status}`, 'unavailable');
  }

  /** Follow an offset-paged endpoint until `next` runs out or `cap` items are loaded. */
  async function pages(path: string, cap: number): Promise<any[]> {
    const out: any[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let n = 0; n < maxPages(cap) && out.length < cap; n++) {
      const page = await get(`${path}${sep}limit=${PAGE}&offset=${out.length}`);
      const items: any[] = page.items ?? [];
      out.push(...items);
      if (!page.next || items.length === 0) break;
    }
    return out.slice(0, cap);
  }

  const playlistList = async (cap: number) => compact<CatalogItem>((await pages('/me/playlists', cap)).map(playlistItem));
  const playlists = () => playlistList(LIST_CAP);

  /** Followed artists are cursor-paged: each page says which artist id to continue `after`. */
  async function followedArtists(): Promise<any[]> {
    const out: any[] = [];
    let after = '';
    for (let n = 0; n < maxPages(LIST_CAP) && out.length < LIST_CAP; n++) {
      const page = (await get(`/me/following?type=artist&limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`)).artists;
      const items: any[] = page?.items ?? [];
      out.push(...items);
      after = typeof page?.cursors?.after === 'string' ? page.cursors.after : '';
      if (!page?.next || !after || items.length === 0) break;
    }
    return out.slice(0, LIST_CAP);
  }

  /**
   * Every entry of a playlist, nulls and local files included so the indexes match Spotify's positions.
   * `restricted`: Spotify only lists the tracks of playlists you own or collaborate on and answers 403 otherwise.
   */
  async function playlistEntries(eid: string): Promise<{ entries: any[]; restricted: boolean }> {
    const entries: any[] = [];
    let kind: 'items' | 'tracks' = 'items';
    for (let n = 0; n < maxPages(TRACKS_CAP) && entries.length < TRACKS_CAP; n++) {
      const res = await api('GET', `/playlists/${eid}/${kind}?limit=${PAGE}&offset=${entries.length}`);
      // `/items` is the current path; only a "not found" sends us to the deprecated `/tracks`.
      if (res?.status === 404 && kind === 'items' && entries.length === 0) {
        kind = 'tracks';
        n--; // switching endpoints is not a page
        continue;
      }
      if (res?.status === 403 && entries.length === 0 && !/scope/i.test(await readApiMessage(res))) return { entries, restricted: true };
      await check(res);
      const page = await res!.json();
      const items: any[] = page.items ?? [];
      entries.push(...items);
      if (!page.next || items.length === 0) break;
    }
    return { entries, restricted: false };
  }

  async function listing(kind: 'playlist' | 'album', id: string): Promise<TrackListing> {
    const eid = encodeURIComponent(id);
    if (kind === 'album') {
      const a = await get(`/albums/${eid}`);
      const item = albumItem(a)!;
      // The album comes with its first page of tracks; boxed sets and long compilations continue on `/albums/{id}/tracks`.
      const raw: any[] = [...(a.tracks?.items ?? [])];
      let more = Boolean(a.tracks?.next);
      for (let n = 0; more && n < maxPages(TRACKS_CAP) && raw.length < TRACKS_CAP; n++) {
        const page = await get(`/albums/${eid}/tracks?limit=${PAGE}&offset=${raw.length}`);
        const items: any[] = page.items ?? [];
        raw.push(...items);
        more = Boolean(page.next) && items.length > 0;
      }
      return { item, tracks: listTracks(raw, { name: a.name, art: art(a.images) }) };
    }
    const metaP = get(`/playlists/${eid}?fields=id,uri,name,images,owner(display_name),items.total,tracks.total`).catch(() => null);
    const { entries, restricted } = await playlistEntries(eid);
    const meta = await metaP;
    return {
      item: playlistItem(meta ? { ...meta, id } : { id, name: 'Playlist' })!,
      // Play and Shuffle still work for such a playlist (a playlist address is a valid thing to play); only the list is missing.
      // A playlist entry is {item: …} now and was {track: …}.
      tracks: restricted ? [] : listTracks(entries.map((it) => it?.item ?? it?.track)),
    };
  }

  async function contains(uri: string): Promise<boolean | undefined> {
    if (!URI.test(uri)) return undefined;
    try {
      let res = await api('GET', `/me/library/contains?uris=${encodeURIComponent(uri)}`);
      if (res && OLD_ENDPOINT_STATUSES.has(res.status) && uri.startsWith('spotify:track:')) res = await api('GET', `/me/tracks/contains?ids=${idOf(uri)}`);
      await check(res);
      return Boolean(((await res!.json()) as boolean[])[0]);
    } catch {
      return undefined;
    }
  }

  return {
    contains,

    async home(): Promise<LibraryHome> {
      const [recent, top, artists, lists] = await Promise.allSettled([
        get('/me/player/recently-played?limit=20'),
        get('/me/top/tracks?limit=10&time_range=short_term'),
        get('/me/top/artists?limit=6&time_range=medium_term'),
        playlistList(PAGE), // the home shelf shows six: one page is plenty
      ]);
      if ([recent, top, artists, lists].every((r) => r.status === 'rejected')) throw (recent as PromiseRejectedResult).reason;
      const ok = <T>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : undefined);
      const seen = new Set<string>();
      const recents = tracks(ok(recent)?.items?.map((i: any) => i.track)).filter((t) => !seen.has(t.id) && !!seen.add(t.id));
      return {
        recent: recents.slice(0, 8),
        topTracks: tracks(ok(top)?.items),
        topArtists: compact<CatalogItem>((ok(artists)?.items ?? []).map(artistItem)),
        playlists: (ok(lists) ?? []).slice(0, 6),
      };
    },

    playlists,
    async liked() {
      return tracks((await pages('/me/tracks', LIST_CAP)).map((i: any) => i.track));
    },
    async albums() {
      return compact<CatalogItem>((await pages('/me/albums', LIST_CAP)).map((i: any) => albumItem(i.album)));
    },
    async artists() {
      return compact<CatalogItem>((await followedArtists()).map(artistItem));
    },

    async search(query: string): Promise<SearchResults> {
      const q = query.trim().slice(0, 100);
      if (q.length < 2) return { tracks: [], albums: [], artists: [], playlists: [] };
      // limit=10: development-mode apps are capped at 10 results per type since February 2026.
      const r = await get(`/search?q=${encodeURIComponent(q)}&type=track,album,artist,playlist&limit=10`);
      return {
        tracks: tracks(r.tracks?.items),
        albums: compact<CatalogItem>((r.albums?.items ?? []).map(albumItem)),
        artists: compact<CatalogItem>((r.artists?.items ?? []).map(artistItem)),
        playlists: compact<CatalogItem>((r.playlists?.items ?? []).map(playlistItem)),
      };
    },

    playlist: (id) => listing('playlist', id),
    album: (id) => listing('album', id),

    async queue(): Promise<QueueView> {
      const r = await get('/me/player/queue');
      return { current: track(r.currently_playing), next: tracks(r.queue).slice(0, 30) };
    },

    async devices(): Promise<ConnectDevice[]> {
      return ((await get('/me/player/devices')).devices ?? [])
        .filter((d: any) => d?.id && !d.is_restricted)
        .map((d: any): ConnectDevice => ({ id: d.id, name: d.name, type: d.type ?? 'Unknown', active: Boolean(d.is_active) }));
    },

    async transfer(deviceId: string) {
      // Keep playing if we were; don't start music just because the user picked a device.
      await check(await api('PUT', '/me/player', { device_ids: [deviceId], play: isPlaying() }));
    },

    async setLiked(uri: string, on: boolean): Promise<boolean> {
      if (!SAVABLE.test(uri)) throw new LibraryError('That item can’t be saved');
      const method = on ? 'PUT' : 'DELETE';
      const first = await api(method, `/me/library?uris=${encodeURIComponent(uri)}`);
      let res = first;
      if (first && OLD_ENDPOINT_STATUSES.has(first.status) && uri.startsWith('spotify:track:')) {
        // The deprecated `/me/tracks` needs only `user-library-modify`, which we do ask for. (The consolidated call lists
        // more permissions in Spotify's reference; we don't request write access to playlists just for a heart button.)
        const id = idOf(uri);
        res = on ? await api('PUT', '/me/tracks', { ids: [id] }) : await api('DELETE', `/me/tracks?ids=${id}`);
        // If that fails too, report the refusal that started it rather than the old endpoint's "not found".
        if (first.status === 403 && !res?.ok) res = first;
      }
      await check(res);
      return on;
    },
  };
}
