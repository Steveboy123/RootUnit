import type { CatalogItem, CatalogTrack, ConnectDevice, SearchResults } from '@headunit/shared';
import { cover, initials } from './cover';

/**
 * An offline catalog (fictional artists) so every library feature can be designed, tested and
 * demoed with no Spotify account. It mirrors the shapes the real Spotify adapter returns.
 */
interface AlbumDef {
  id: number;
  name: string;
  artist: string;
  /** [trackId, title, seconds] */
  tracks: Array<[number, string, number]>;
}

const ALBUMS: AlbumDef[] = [
  { id: 1, name: 'Chrome Skies', artist: 'The Neon Drifters', tracks: [[1, 'Midnight Highway', 214], [7, 'Neon Rain', 198], [8, 'Afterglow', 232], [9, 'Signal Lights', 207], [10, 'Chrome Skies', 251]] },
  { id: 2, name: 'Long Way Home', artist: 'Alma Vega', tracks: [[2, 'Rearview', 187], [11, 'Dust & Diesel', 221], [12, 'Mile Marker', 194], [13, 'Lantern Road', 238]] },
  { id: 3, name: 'Open Road', artist: 'Static Harbor', tracks: [[3, 'Tailwind', 241], [14, 'Cruise Control', 205], [15, 'Open Road', 226], [16, 'Horizon Line', 212], [17, 'Slipstream', 189]] },
  { id: 4, name: 'Exit 42', artist: 'Juno & The Wire', tracks: [[4, 'Golden Hour Exit', 203], [18, 'Overdrive', 215], [19, 'Last Light', 244], [20, 'Copper Skyline', 199]] },
  { id: 5, name: 'Concrete Bloom', artist: 'Kite Season', tracks: [[5, 'Overpass', 176], [21, 'Underpass', 183], [22, 'Rooftop Static', 209], [23, 'Bloom', 225]] },
  { id: 6, name: 'Empty Tank', artist: 'Marrow Lane', tracks: [[6, 'Low Fuel Light', 229], [24, 'Reserve', 201], [25, 'Gas Station Hymn', 217], [26, 'Rolling on Fumes', 236]] },
  { id: 7, name: 'Velvet Hours', artist: 'Velvet Static', tracks: [[27, 'Velvet Hours', 233], [28, 'Night Shift', 208], [29, 'Parking Lot Moon', 246], [30, 'Streetlight Waltz', 192]] },
  { id: 8, name: 'Paper Maps', artist: 'Paper Lanterns', tracks: [[31, 'Paper Maps', 219], [32, 'Wrong Turn', 184], [33, 'Scenic Route', 227], [34, 'Detour Dreams', 240], [35, 'Home Stretch', 203]] },
];

const PLAYLISTS: Array<{ id: number; name: string; tracks: number[] }> = [
  { id: 1, name: 'Road Trip', tracks: [1, 2, 3, 4] },
  { id: 2, name: 'Late Night Drive', tracks: [4, 5, 6] },
  { id: 3, name: 'Focus', tracks: [2, 5] },
  { id: 4, name: 'Everything', tracks: [1, 2, 3, 4, 5, 6] },
  { id: 5, name: 'Morning Commute', tracks: [27, 28, 2, 15, 16, 31] },
  { id: 6, name: 'Highway Anthems', tracks: [1, 3, 14, 15, 18, 19, 4] },
  { id: 7, name: 'Chill Roads', tracks: [13, 12, 20, 29, 30, 34] },
  { id: 8, name: 'Rainy Day Drive', tracks: [7, 8, 21, 22, 28, 33] },
];

const INITIAL_LIKED = [1, 3, 5, 14, 15, 18, 27, 31];
const INITIAL_RECENT = [3, 2, 1, 6, 5, 4, 15, 27];
const TOP_TRACKS = [1, 15, 14, 18, 3, 2, 27, 19, 31, 8];

const trackUri = (id: number) => `mock:track:${id}`;
const idOfUri = (uri: string) => Number(/^mock:track:(\d+)$/.exec(uri)?.[1]);

export function createDemoCatalog() {
  const albumArt = new Map(ALBUMS.map((a) => [a.id, cover(a.id + 20, initials(a.name))]));
  const artists = [...new Set(ALBUMS.map((a) => a.artist))].map((name, i) => ({ id: i + 1, name }));

  const tracks = new Map<number, CatalogTrack>();
  for (const a of ALBUMS) {
    for (const [id, title, sec] of a.tracks) {
      tracks.set(id, { id: `mock-${id}`, uri: trackUri(id), title, artist: a.artist, album: a.name, artUrl: albumArt.get(a.id), durationMs: sec * 1000 });
    }
  }
  const byUri = (uri: string) => tracks.get(idOfUri(uri));
  const all = () => [...tracks.values()];

  const liked = new Set(INITIAL_LIKED.map((id) => `mock-${id}`));
  let recent = INITIAL_RECENT.map((id) => tracks.get(id)!);
  const devices: Array<ConnectDevice & { name: string }> = [
    { id: 'head-unit', name: 'Head Unit', type: 'Automobile', active: true },
    { id: 'pixel', name: "Alex's Pixel 8", type: 'Smartphone', active: false },
    { id: 'kitchen', name: 'Kitchen speaker', type: 'Speaker', active: false },
  ];

  const albumItem = (a: AlbumDef): CatalogItem => ({ id: String(a.id), uri: `mock:album:${a.id}`, type: 'album', name: a.name, subtitle: a.artist, artUrl: albumArt.get(a.id), trackCount: a.tracks.length });
  const playlistItem = (p: (typeof PLAYLISTS)[number]): CatalogItem => ({
    id: String(p.id),
    uri: `mock:playlist:${p.id}`,
    type: 'playlist',
    name: p.name,
    subtitle: 'by Alex', // real Spotify playlists carry their owner here
    artUrl: cover(p.tracks[0]! + 10, initials(p.name)),
    trackCount: p.tracks.length,
  });
  const artistItem = (a: { id: number; name: string }): CatalogItem => ({
    id: String(a.id),
    uri: `mock:artist:${a.id}`,
    type: 'artist',
    name: a.name,
    subtitle: 'Artist',
    artUrl: cover(a.id + 40, initials(a.name), true),
    trackCount: all().filter((t) => t.artist === a.name).length,
  });

  const match = (q: string, ...fields: string[]) => fields.some((f) => f.toLowerCase().includes(q));

  return {
    tracks: all,
    trackByUri: byUri,
    albumTracks: (id: number) => (ALBUMS.find((a) => a.id === id)?.tracks ?? []).map(([t]) => tracks.get(t)!),
    playlistTracks: (id: number) => (PLAYLISTS.find((p) => p.id === id)?.tracks ?? []).map((t) => tracks.get(t)!),
    artistTracks: (id: number) => {
      const name = artists.find((a) => a.id === id)?.name;
      return all().filter((t) => t.artist === name);
    },

    isLiked: (trackId: string) => liked.has(trackId),
    setLiked(uri: string, on: boolean): boolean {
      const t = byUri(uri);
      if (!t) return false;
      if (on) liked.add(t.id);
      else liked.delete(t.id);
      return on;
    },
    /** Called by the player whenever a track starts, newest first, no consecutive repeats. */
    played(trackId: string) {
      const id = Number(trackId.replace('mock-', ''));
      const t = tracks.get(id);
      if (t && recent[0]?.id !== t.id) recent = [t, ...recent.filter((r) => r.id !== t.id)].slice(0, 20);
    },

    home: () => ({
      recent: recent.slice(0, 8),
      topTracks: TOP_TRACKS.map((id) => tracks.get(id)!),
      topArtists: artists.slice(0, 6).map(artistItem),
      playlists: PLAYLISTS.slice(0, 6).map(playlistItem),
    }),
    playlists: () => PLAYLISTS.map(playlistItem),
    albums: () => ALBUMS.map(albumItem),
    artists: () => artists.map(artistItem),
    likedTracks: () => all().filter((t) => liked.has(t.id)),

    search(query: string): SearchResults {
      const q = query.trim().toLowerCase();
      if (q.length < 2) return { tracks: [], albums: [], artists: [], playlists: [] };
      return {
        tracks: all().filter((t) => match(q, t.title, t.artist, t.album)).slice(0, 10),
        albums: ALBUMS.filter((a) => match(q, a.name, a.artist)).map(albumItem).slice(0, 10),
        artists: artists.filter((a) => match(q, a.name)).map(artistItem).slice(0, 10),
        playlists: PLAYLISTS.filter((p) => match(q, p.name)).map(playlistItem).slice(0, 10),
      };
    },
    playlistItemById: (id: string) => PLAYLISTS.filter((p) => String(p.id) === id).map(playlistItem)[0],
    albumItemById: (id: string) => ALBUMS.filter((a) => String(a.id) === id).map(albumItem)[0],

    devices: (): ConnectDevice[] => devices.map((d) => ({ ...d })),
    transfer(id: string): boolean {
      if (!devices.some((d) => d.id === id)) return false;
      for (const d of devices) d.active = d.id === id;
      return true;
    },
    activeDeviceName: () => devices.find((d) => d.active)?.name,
  };
}

export type DemoCatalog = ReturnType<typeof createDemoCatalog>;
