import { describe, expect, it } from 'vitest';
import { LibraryError } from './library';
import { createSpotifyLibrary } from './spotifyLibrary';

type Call = { method: string; path: string; body?: unknown };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const status = (n: number, text = '') => new Response(text || null, { status: n });

function make(handler: (c: Call) => Response | null | Promise<Response | null>, playing = false) {
  const calls: Call[] = [];
  const lib = createSpotifyLibrary({
    isPlaying: () => playing,
    api: async (method, path, body) => {
      const c = { method, path, body };
      calls.push(c);
      return handler(c);
    },
  });
  return { lib, calls };
}

const T = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name: `Song ${id}`,
  duration_ms: 200_000,
  artists: [{ name: 'A' }, { name: 'B' }],
  album: { name: 'Alb', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] },
  ...extra,
});
const album = (id: string) => ({ id, uri: `spotify:album:${id}`, name: `Album ${id}`, artists: [{ name: 'Art' }], images: [{ url: 'a', width: 300 }], total_tracks: 9 });
const artist = (id: string) => ({ id, uri: `spotify:artist:${id}`, name: `Artist ${id}`, images: [{ url: 'x', width: 160 }] });

describe('mapping', () => {
  it('maps tracks, choosing the artwork closest to tile size and skipping non-music entries', async () => {
    const { lib } = make(() =>
      json({
        items: [
          { track: T('1') },
          { track: { type: 'episode', id: 'e', uri: 'spotify:episode:e' } },
          { track: T('local', { is_local: true }) },
          { track: null },
          { track: T('2') },
        ],
      }),
    );
    const liked = await lib.liked();
    expect(liked.map((t) => t.id)).toEqual(['1', '2']);
    expect(liked[0]).toEqual({ id: '1', uri: 'spotify:track:1', title: 'Song 1', artist: 'A, B', album: 'Alb', artUrl: 'mid', durationMs: 200_000 });
  });

  it('lists saved albums, followed artists and playlists', async () => {
    const { lib, calls } = make((c) => {
      if (c.path.startsWith('/me/albums')) return json({ items: [{ album: album('1') }, { album: null }] });
      if (c.path.startsWith('/me/following')) return json({ artists: { items: [artist('9')] } });
      return json({ items: [{ id: 'p', uri: 'spotify:playlist:p', name: 'P', owner: { display_name: 'Me' }, items: { total: 12 }, images: [] }, null] });
    });
    expect(await lib.albums()).toEqual([{ id: '1', uri: 'spotify:album:1', type: 'album', name: 'Album 1', subtitle: 'Art', artUrl: 'a', trackCount: 9 }]);
    expect((await lib.artists())[0]).toMatchObject({ type: 'artist', name: 'Artist 9', subtitle: 'Artist', artUrl: 'x' });
    expect(await lib.playlists()).toEqual([{ id: 'p', uri: 'spotify:playlist:p', type: 'playlist', name: 'P', subtitle: 'by Me', artUrl: undefined, trackCount: 12 }]);
    expect(calls.map((c) => c.path)).toEqual(['/me/albums?limit=50&offset=0', '/me/following?type=artist&limit=50', '/me/playlists?limit=50&offset=0']);
  });

  it('carries explicit and playable through, and leaves playable unknown when Spotify does not say', async () => {
    const { lib } = make(() => json({ items: [{ track: T('1', { explicit: true, is_playable: false }) }, { track: T('2', { explicit: false, is_playable: true }) }, { track: T('3') }] }));
    const [a, b, c] = await lib.liked();
    expect(a).toMatchObject({ explicit: true, playable: false });
    expect(b).toMatchObject({ explicit: false, playable: true });
    expect('playable' in c! || 'explicit' in c!).toBe(false);
  });
});

describe('paging', () => {
  const offsetOf = (path: string) => Number(new URL(path, 'http://x').searchParams.get('offset'));
  const fifty = (from: number) => Array.from({ length: 50 }, (_, i) => ({ track: T(`t${from + i}`) }));

  it('pages saved tracks 50 at a time and stops at 200 (a car screen does not need more)', async () => {
    const { lib, calls } = make((c) => json({ items: fifty(offsetOf(c.path)), next: 'more' }));
    const liked = await lib.liked();
    expect(liked).toHaveLength(200);
    expect(calls.map((c) => c.path)).toEqual([0, 50, 100, 150].map((o) => `/me/tracks?limit=50&offset=${o}`));
  });
  it('stops when Spotify says there is no next page', async () => {
    const { lib, calls } = make((c) => (offsetOf(c.path) === 0 ? json({ items: fifty(0), next: 'more' }) : json({ items: [{ track: T('last') }], next: null })));
    expect((await lib.liked()).map((t) => t.id).slice(-2)).toEqual(['t49', 'last']);
    expect(calls).toHaveLength(2);
  });
  it('pages saved albums and playlists the same way', async () => {
    const albums = make((c) => json({ items: offsetOf(c.path) === 0 ? Array.from({ length: 50 }, (_, i) => ({ album: album(`a${i}`) })) : [{ album: album('z') }], next: offsetOf(c.path) === 0 ? 'more' : null }));
    expect(await albums.lib.albums()).toHaveLength(51);
    const lists = make((c) => json({ items: offsetOf(c.path) === 0 ? Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, uri: `u${i}`, name: 'P' })) : [{ id: 'z', uri: 'uz', name: 'Z' }], next: offsetOf(c.path) === 0 ? 'more' : null }));
    expect(await lists.lib.playlists()).toHaveLength(51);
    expect(lists.calls.map((c) => c.path)).toEqual(['/me/playlists?limit=50&offset=0', '/me/playlists?limit=50&offset=50']);
  });
  it('pages followed artists with the "after" cursor', async () => {
    const { lib, calls } = make((c) =>
      c.path.includes('after=')
        ? json({ artists: { items: [artist('c')], next: null, cursors: { after: null } } })
        : json({ artists: { items: [artist('a'), artist('b')], next: 'more', cursors: { after: 'b' } } }),
    );
    expect((await lib.artists()).map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(calls.map((c) => c.path)).toEqual(['/me/following?type=artist&limit=50', '/me/following?type=artist&limit=50&after=b']);
  });
  it('asks for just one page of playlists on the home screen', async () => {
    const { lib, calls } = make((c) => (c.path.startsWith('/me/playlists') ? json({ items: [{ id: 'p', uri: 'u', name: 'P' }], next: 'more' }) : json({ items: [] })));
    await lib.home();
    expect(calls.filter((c) => c.path.startsWith('/me/playlists')).map((c) => c.path)).toEqual(['/me/playlists?limit=50&offset=0']);
  });
});

describe('home', () => {
  const routes = (c: Call) => {
    if (c.path.startsWith('/me/player/recently-played')) return json({ items: [{ track: T('1') }, { track: T('2') }, { track: T('1') }, { track: T('3') }] });
    if (c.path.startsWith('/me/top/tracks')) return json({ items: [T('9')] });
    if (c.path.startsWith('/me/top/artists')) return json({ items: [artist('5')] });
    return json({ items: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, uri: `spotify:playlist:p${i}`, name: `P${i}` })) });
  };
  it('combines history (de-duplicated), top items and playlists', async () => {
    const { lib } = make(routes);
    const h = await lib.home();
    expect(h.recent.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(h.topTracks.map((t) => t.id)).toEqual(['9']);
    expect(h.topArtists[0]!.name).toBe('Artist 5');
    expect(h.playlists).toHaveLength(6);
  });
  it('still returns what it can when some endpoints are refused', async () => {
    const { lib } = make((c) => (c.path.startsWith('/me/top') ? status(403, 'Insufficient client scope') : routes(c)));
    const h = await lib.home();
    expect(h.topTracks).toEqual([]);
    expect(h.recent).toHaveLength(3);
  });
  it('reports a clear "reconnect" error when nothing is permitted', async () => {
    const { lib } = make(() => status(403, '{"error":{"message":"Insufficient client scope"}}'));
    const err = await lib.home().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryError);
    expect(err.code).toBe('scope');
    expect(err.message).toMatch(/Reconnect Spotify/);
  });
});

describe('search', () => {
  it('asks for at most 10 per type (development-mode cap), skipping null entries', async () => {
    const { lib, calls } = make(() =>
      json({ tracks: { items: [T('1'), null] }, albums: { items: [album('1'), null] }, artists: { items: [artist('1')] }, playlists: { items: [null, { id: 'p', uri: 'u', name: 'P' }] } }),
    );
    const r = await lib.search('  daft punk ');
    expect(calls[0]!.path).toBe('/search?q=daft%20punk&type=track,album,artist,playlist&limit=10');
    expect(r.tracks).toHaveLength(1);
    expect(r.albums).toHaveLength(1);
    expect(r.artists).toHaveLength(1);
    expect(r.playlists.map((p) => p.id)).toEqual(['p']);
  });
  it('does not query for tiny input', async () => {
    const { lib, calls } = make(() => json({}));
    expect(await lib.search('a')).toEqual({ tracks: [], albums: [], artists: [], playlists: [] });
    expect(calls).toHaveLength(0);
  });
  it('encodes hostile input', async () => {
    const { lib, calls } = make(() => json({}));
    await lib.search('a&limit=50&type=user#');
    expect(calls[0]!.path).toContain('q=a%26limit%3D50%26type%3Duser%23');
    expect(calls[0]!.path.match(/limit=/g)).toHaveLength(1);
  });
});

describe('playlist and album detail', () => {
  const meta = { id: 'p', uri: 'spotify:playlist:p', name: 'Road', images: [{ url: 'i', width: 300 }], owner: { display_name: 'Me' } };
  const offsetOf = (path: string) => Number(new URL(path, 'http://x').searchParams.get('offset'));

  it('reads the new playlist shape ({item}) and the old one ({track}) from /items, 50 per page', async () => {
    const { lib, calls } = make((c) => {
      if (c.path.includes('/items')) return json({ items: [{ item: T('1') }, { track: T('2') }, { item: null }] });
      return json(meta);
    });
    const l = await lib.playlist('p');
    expect(l.item).toMatchObject({ id: 'p', name: 'Road', subtitle: 'by Me', artUrl: 'i' });
    expect(l.tracks.map((t) => t.id)).toEqual(['1', '2']);
    expect(calls.some((c) => c.path === '/playlists/p/items?limit=50&offset=0')).toBe(true);
    expect(calls.some((c) => c.path.includes('limit=100'))).toBe(false); // 50 is the documented maximum
  });
  it('asks for the track total so the header can say how many tracks there are', async () => {
    const { lib, calls } = make((c) => (c.path.includes('/items') ? json({ items: [] }) : json({ ...meta, items: { total: 120 } })));
    expect((await lib.playlist('p')).item.trackCount).toBe(120);
    expect(calls.find((c) => c.path.startsWith('/playlists/p?'))!.path).toContain('items.total');
  });
  it('numbers tracks by Spotify position, counting entries that are not shown (null, local, episode)', async () => {
    const { lib } = make((c) => {
      if (c.path.includes('/items'))
        return json({
          items: [
            { item: T('a') }, // 0
            { item: null }, // 1 (removed/unavailable)
            { item: T('local', { is_local: true }) }, // 2
            { item: { type: 'episode', id: 'e', uri: 'spotify:episode:e' } }, // 3
            { track: T('b') }, // 4 (old shape)
            { item: T('c') }, // 5
          ],
        });
      return json(meta);
    });
    const l = await lib.playlist('p');
    expect(l.tracks.map((t) => [t.id, t.position])).toEqual([
      ['a', 0],
      ['b', 4],
      ['c', 5],
    ]);
  });
  it('keeps positions counting across pages', async () => {
    const { lib, calls } = make((c) => {
      if (!c.path.includes('/items')) return json(meta);
      if (offsetOf(c.path) === 0) return json({ items: Array.from({ length: 50 }, (_, i) => ({ item: i === 3 ? null : T(`t${i}`) })), next: 'more' });
      return json({ items: [{ item: T('late') }, { item: T('later') }], next: null });
    });
    const l = await lib.playlist('p');
    expect(l.tracks).toHaveLength(51);
    expect(l.tracks.find((t) => t.id === 't4')!.position).toBe(4);
    expect(l.tracks.slice(-2).map((t) => [t.id, t.position])).toEqual([
      ['late', 50],
      ['later', 51],
    ]);
    expect(calls.filter((c) => c.path.includes('/items')).map((c) => c.path)).toEqual(['/playlists/p/items?limit=50&offset=0', '/playlists/p/items?limit=50&offset=50']);
  });
  it('stops reading a very long playlist at 400 entries, positions intact', async () => {
    const { lib, calls } = make((c) => (c.path.includes('/items') ? json({ items: Array.from({ length: 50 }, (_, i) => ({ item: T(`t${offsetOf(c.path) + i}`) })), next: 'more' }) : json(meta)));
    const l = await lib.playlist('p');
    expect(l.tracks).toHaveLength(400);
    expect(l.tracks[399]!.position).toBe(399);
    expect(calls.filter((c) => c.path.includes('/items'))).toHaveLength(8);
  });
  it('falls back to /tracks if /items is not found', async () => {
    const { lib, calls } = make((c) => {
      if (c.path.includes('/items')) return status(404);
      if (c.path.includes('/tracks')) return json({ items: [{ track: T('7') }] });
      return status(404);
    });
    const l = await lib.playlist('p');
    expect(l.tracks.map((t) => t.id)).toEqual(['7']);
    expect(l.item.name).toBe('Playlist'); // metadata unavailable → neutral, not a crash
    expect(calls.map((c) => c.path)).toContain('/playlists/p/tracks?limit=50&offset=0');
  });
  it('does not use the deprecated /tracks for other failures', async () => {
    const { lib, calls } = make((c) => (c.path.includes('/items') ? status(400) : json(meta)));
    await expect(lib.playlist('p')).rejects.toMatchObject({ code: 'unavailable' });
    expect(calls.some((c) => c.path.includes('/playlists/p/tracks'))).toBe(false);
  });
  it('does not mask an auth problem by falling back', async () => {
    const { lib } = make((c) => (c.path.includes('/items') ? status(401) : json({})));
    await expect(lib.playlist('p')).rejects.toMatchObject({ code: 'auth' });
  });
  it('still lets you open a playlist you neither own nor collaborate on: no track list, but Play works', async () => {
    const { lib, calls } = make((c) => (c.path.includes('/items') ? json({ error: { status: 403, message: 'Forbidden' } }, 403) : json(meta)));
    const l = await lib.playlist('p');
    expect(l.tracks).toEqual([]);
    expect(l.item).toMatchObject({ id: 'p', uri: 'spotify:playlist:p', name: 'Road' });
    expect(calls.some((c) => c.path.includes('/playlists/p/tracks'))).toBe(false);
  });
  it('but a 403 about missing permissions is still a "reconnect"', async () => {
    const { lib } = make((c) => (c.path.includes('/items') ? json({ error: { status: 403, message: 'Insufficient client scope' } }, 403) : json(meta)));
    await expect(lib.playlist('p')).rejects.toMatchObject({ code: 'scope' });
  });
  it('fills album tracks with the album name and artwork, numbered by position', async () => {
    const { lib } = make(() => json({ ...album('a1'), tracks: { items: [{ type: 'track', id: 't1', uri: 'spotify:track:t1', name: 'One', duration_ms: 1000, artists: [{ name: 'Art' }] }] } }));
    const l = await lib.album('a1');
    expect(l.item.name).toBe('Album a1');
    expect(l.tracks[0]).toMatchObject({ title: 'One', album: 'Album a1', artUrl: 'a', position: 0 });
  });
  it('follows an album\'s track list past its first page (boxed sets)', async () => {
    const t = (i: number) => ({ type: 'track', id: `t${i}`, uri: `spotify:track:t${i}`, name: `S${i}`, duration_ms: 1, artists: [{ name: 'Art' }] });
    const { lib, calls } = make((c) =>
      c.path.startsWith('/albums/a1/tracks') ? json({ items: [t(2), t(3)], next: null }) : json({ ...album('a1'), tracks: { items: [t(0), t(1)], next: 'https://api.spotify.com/v1/albums/a1/tracks?offset=2' } }),
    );
    const l = await lib.album('a1');
    expect(l.tracks.map((x) => [x.id, x.position])).toEqual([['t0', 0], ['t1', 1], ['t2', 2], ['t3', 3]]);
    expect(calls.map((c) => c.path)).toEqual(['/albums/a1', '/albums/a1/tracks?limit=50&offset=2']);
  });
  it('encodes ids in the URL', async () => {
    const { lib, calls } = make(() => json({ items: [] }));
    await lib.playlist('x/../me').catch(() => {});
    expect(calls.every((c) => !c.path.includes('/../'))).toBe(true);
  });
});

describe('queue, devices, transfer', () => {
  it('maps the queue and skips podcast episodes', async () => {
    const { lib } = make(() => json({ currently_playing: T('1'), queue: [T('2'), { type: 'episode', id: 'e', uri: 'x' }, T('3')] }));
    const q = await lib.queue();
    expect(q.current?.id).toBe('1');
    expect(q.next.map((t) => t.id)).toEqual(['2', '3']);
  });
  it('handles an empty queue', async () => {
    const { lib } = make(() => json({ currently_playing: null, queue: [] }));
    expect(await lib.queue()).toEqual({ current: null, next: [] });
  });
  it('lists Connect devices, dropping restricted ones', async () => {
    const { lib } = make(() =>
      json({ devices: [{ id: 'd1', name: 'Head Unit', type: 'Automobile', is_active: true }, { id: 'd2', name: 'TV', type: 'TV', is_active: false, is_restricted: true }, { id: null, name: 'x' }, { id: 'd3', name: 'Phone', type: 'Smartphone' }] }),
    );
    expect(await lib.devices()).toEqual([
      { id: 'd1', name: 'Head Unit', type: 'Automobile', active: true },
      { id: 'd3', name: 'Phone', type: 'Smartphone', active: false },
    ]);
  });
  it('transfers playback, keeping the current play/pause state', async () => {
    const playing = make(() => status(204), true);
    await playing.lib.transfer('d9');
    expect(playing.calls[0]).toEqual({ method: 'PUT', path: '/me/player', body: { device_ids: ['d9'], play: true } });
    const paused = make(() => status(204), false);
    await paused.lib.transfer('d9');
    expect((paused.calls[0]!.body as { play: boolean }).play).toBe(false);
  });
});

describe('liking tracks', () => {
  it('saves and removes through /me/library with URIs', async () => {
    const { lib, calls } = make(() => status(200));
    expect(await lib.setLiked('spotify:track:abc123', true)).toBe(true);
    expect(await lib.setLiked('spotify:track:abc123', false)).toBe(false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /me/library?uris=spotify%3Atrack%3Aabc123',
      'DELETE /me/library?uris=spotify%3Atrack%3Aabc123',
    ]);
  });
  it('falls back to the pre-consolidation endpoint for tracks, with the id in the body for saving', async () => {
    const { lib, calls } = make((c) => (c.path.startsWith('/me/library') ? status(404) : status(200)));
    await lib.setLiked('spotify:track:abc123', true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /me/library?uris=spotify%3Atrack%3Aabc123', 'PUT /me/tracks']);
    expect(calls[1]!.body).toEqual({ ids: ['abc123'] }); // Spotify's reference takes PUT /me/tracks ids in the body
    calls.length = 0;
    await lib.setLiked('spotify:track:abc123', false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /me/library?uris=spotify%3Atrack%3Aabc123', 'DELETE /me/tracks?ids=abc123']);
  });
  it('also tries the older endpoint when the consolidated one is forbidden (it lists permissions we do not ask for)', async () => {
    const { lib, calls } = make((c) => (c.path.startsWith('/me/library') ? status(403, 'Forbidden') : status(200)));
    await expect(lib.setLiked('spotify:track:abc123', true)).resolves.toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /me/library?uris=spotify%3Atrack%3Aabc123', 'PUT /me/tracks']);
  });
  it('reports the original refusal when the older endpoint is gone too', async () => {
    const { lib } = make((c) => (c.path.startsWith('/me/library') ? json({ error: { status: 403, message: 'Not allowed for this app' } }, 403) : status(404)));
    await expect(lib.setLiked('spotify:track:abc123', true)).rejects.toThrow(/403.*Not allowed for this app/);
  });
  it('does not push albums or playlists through the track endpoint', async () => {
    const { lib, calls } = make(() => status(403, 'Forbidden'));
    await expect(lib.setLiked('spotify:album:abc123', true)).rejects.toBeInstanceOf(LibraryError);
    expect(calls).toHaveLength(1);
  });
  it('saves albums and playlists through /me/library', async () => {
    const { lib, calls } = make(() => status(200));
    await lib.setLiked('spotify:album:al1', true);
    await lib.setLiked('spotify:playlist:pl1', false);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT /me/library?uris=spotify%3Aalbum%3Aal1', 'DELETE /me/library?uris=spotify%3Aplaylist%3Apl1']);
  });
  it('cannot save or remove an artist through /me/library (its documented types have no artist)', async () => {
    const { lib, calls } = make(() => status(200));
    await expect(lib.setLiked('spotify:artist:ar1', true)).rejects.toBeInstanceOf(LibraryError);
    expect(calls).toHaveLength(0);
  });
  it('refuses anything that is not a plain Spotify URI', async () => {
    const { lib, calls } = make(() => status(200));
    for (const bad of ['', 'abc', 'spotify:track:', 'spotify:track:a b', 'spotify:user:me', 'spotify:track:abc&foo=1', 'https://evil']) {
      await expect(lib.setLiked(bad, true)).rejects.toBeInstanceOf(LibraryError);
    }
    expect(calls).toHaveLength(0);
  });
  it('tells the user to reconnect when the library permission is missing', async () => {
    const { lib } = make(() => status(403, 'Insufficient client scope'));
    await expect(lib.setLiked('spotify:track:abc', true)).rejects.toMatchObject({ code: 'scope' });
  });
  it('checks saved state, with fallback and "unknown" on failure', async () => {
    const ok = make(() => json([true]));
    expect(await ok.lib.contains('spotify:track:abc')).toBe(true);
    expect(ok.calls[0]!.path).toBe('/me/library/contains?uris=spotify%3Atrack%3Aabc');
    const fb = make((c) => (c.path.startsWith('/me/library') ? status(405) : json([false])));
    expect(await fb.lib.contains('spotify:track:abc')).toBe(false);
    expect(fb.calls[1]!.path).toBe('/me/tracks/contains?ids=abc');
    const forbidden = make((c) => (c.path.startsWith('/me/library') ? status(403, 'Forbidden') : json([true])));
    expect(await forbidden.lib.contains('spotify:track:abc')).toBe(true);
    // The older endpoint only knows tracks: asking it about an album id would answer "no" for the wrong reason.
    const album = make(() => status(404));
    expect(await album.lib.contains('spotify:album:abc')).toBeUndefined();
    expect(album.calls).toHaveLength(1);
    const scope = make(() => status(403, 'Insufficient client scope'));
    expect(await scope.lib.contains('spotify:track:abc')).toBeUndefined();
    expect(await ok.lib.contains('not-a-uri')).toBeUndefined();
  });
});

describe('error translation', () => {
  const cases: Array<[Response | null, string, string]> = [
    [null, 'auth', 'Connect Spotify first'],
    [status(401), 'auth', 'expired'],
    [status(429), 'rate', 'rate-limiting'],
    [status(403, 'nope'), 'unavailable', 'Spotify refused this request (403): nope'], // was a blanket "Premium is required"
    [status(403, '{"error":{"status":403,"message":"Player command failed: Premium required"}}'), 'unavailable', 'Premium is required'],
    [status(403, '{"error":{"status":403,"message":"Insufficient client scope"}}'), 'scope', 'Reconnect Spotify'],
    [status(403), 'unavailable', 'Spotify refused this request (403)'],
    [status(404), 'unavailable', 'Not found'],
    [status(500), 'unavailable', '500'],
  ];
  it.each(cases)('maps %#', async (res, code, text) => {
    const { lib } = make(() => res);
    const err = await lib.liked().catch((e) => e);
    expect(err).toBeInstanceOf(LibraryError);
    expect(err.code).toBe(code);
    expect(err.message).toContain(text);
  });
});
