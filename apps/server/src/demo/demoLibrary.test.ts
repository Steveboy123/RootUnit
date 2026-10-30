import { describe, expect, it } from 'vitest';
import { createMockMedia } from '../demo/mediaMock';
import { LibraryError } from '../library/library';

function setup() {
  let t = 1_000_000;
  const m = createMockMedia(() => t);
  return { m, lib: m.library, advance: (ms: number) => void (t += ms) };
}

describe('demo catalog / library', () => {
  it('has a believable library', async () => {
    const { lib } = setup();
    const home = await lib.home();
    expect(home.recent.length).toBeGreaterThanOrEqual(6);
    expect(home.topTracks.length).toBeGreaterThanOrEqual(8);
    expect(home.topArtists).toHaveLength(6);
    expect(home.playlists).toHaveLength(6);
    expect((await lib.playlists()).length).toBe(8);
    expect((await lib.albums()).length).toBe(8);
    expect((await lib.artists()).length).toBe(8);
    expect((await lib.liked()).length).toBeGreaterThanOrEqual(8);
    for (const t of await lib.liked()) expect(t.artUrl).toMatch(/^data:image\/svg/);
  });

  it('search matches titles, artists, albums and playlists case-insensitively, capped at 10', async () => {
    const { lib } = setup();
    const r = await lib.search('NEON');
    expect(r.artists.map((a) => a.name)).toContain('The Neon Drifters');
    expect(r.tracks.some((t) => t.title === 'Neon Rain')).toBe(true);
    expect((await lib.search('drive')).playlists.map((p) => p.name)).toEqual(expect.arrayContaining(['Late Night Drive', 'Rainy Day Drive']));
    expect((await lib.search('a')).tracks).toEqual([]); // too short
    expect((await lib.search('e')).tracks).toEqual([]);
    expect((await lib.search('an')).tracks.length).toBeLessThanOrEqual(10);
  });

  it('opens playlists and albums, and rejects unknown ones', async () => {
    const { lib } = setup();
    const pl = await lib.playlist('3');
    expect(pl.item.name).toBe('Focus');
    expect(pl.tracks.map((t) => t.title)).toEqual(['Rearview', 'Overpass']);
    const al = await lib.album('1');
    expect(al.item).toMatchObject({ name: 'Chrome Skies', subtitle: 'The Neon Drifters' });
    expect(al.tracks).toHaveLength(5);
    await expect(lib.playlist('999')).rejects.toBeInstanceOf(LibraryError);
    await expect(lib.album('nope')).rejects.toThrow(/not found/);
  });
});

describe('demo player: play commands', () => {
  it('plays a playlist from a given track and continues the playlist', async () => {
    const { m } = setup();
    await m.command({ cmd: 'playContext', uri: 'mock:playlist:6', offset: 2 }); // Highway Anthems
    expect(m.state.get()).toMatchObject({ playing: true });
    expect(m.state.get().track?.title).toBe('Cruise Control');
    await m.command({ cmd: 'next' });
    expect(m.state.get().track?.title).toBe('Open Road');
  });

  it('plays an album and an artist', async () => {
    const { m } = setup();
    await m.command({ cmd: 'playContext', uri: 'mock:album:7' });
    expect(m.state.get().track?.title).toBe('Velvet Hours');
    await m.command({ cmd: 'playContext', uri: 'mock:artist:2' }); // Alma Vega
    expect(m.state.get().track?.artist).toBe('Alma Vega');
  });

  it('plays an arbitrary list of tracks from an offset, ignoring unknown URIs', async () => {
    const { m } = setup();
    await m.command({ cmd: 'playTracks', uris: ['mock:track:31', 'mock:track:nope', 'mock:track:32', 'mock:track:33'], offset: 1 });
    expect(m.state.get().track?.title).toBe('Wrong Turn');
    await m.command({ cmd: 'playTracks', uris: ['bogus'] }); // nothing valid → no change
    expect(m.state.get().track?.title).toBe('Wrong Turn');
    await m.command({ cmd: 'playTracks', uris: ['mock:track:31'], offset: 99 }); // clamped
    expect(m.state.get().track?.title).toBe('Paper Maps');
  });

  it('ignores an unknown context', async () => {
    const { m } = setup();
    const before = m.state.get().track?.id;
    await m.command({ cmd: 'playContext', uri: 'mock:playlist:999' });
    await m.command({ cmd: 'playContext', uri: 'spotify:album:xyz' });
    expect(m.state.get().track?.id).toBe(before);
  });
});

describe('demo player: queue', () => {
  it('adds tracks right after the current one, in the order added', async () => {
    const { m, lib } = setup();
    await m.command({ cmd: 'playContext', uri: 'mock:playlist:1' }); // Road Trip: Midnight, Rearview, Tailwind, Golden Hour
    await m.command({ cmd: 'queueAdd', uri: 'mock:track:35' }); // Home Stretch
    await m.command({ cmd: 'queueAdd', uri: 'mock:track:34' }); // Detour Dreams
    let q = await lib.queue();
    expect(q.current?.title).toBe('Midnight Highway');
    expect(q.next.map((t) => t.title).slice(0, 4)).toEqual(['Home Stretch', 'Detour Dreams', 'Rearview', 'Tailwind']);
    await m.command({ cmd: 'next' });
    expect(m.state.get().track?.title).toBe('Home Stretch');
    // a track added now goes after the remaining queued one, not before it
    await m.command({ cmd: 'queueAdd', uri: 'mock:track:33' });
    q = await lib.queue();
    expect(q.next.map((t) => t.title).slice(0, 3)).toEqual(['Detour Dreams', 'Scenic Route', 'Rearview']);
  });

  it('ignores an unknown track', async () => {
    const { m, lib } = setup();
    const before = (await lib.queue()).next.length;
    await m.command({ cmd: 'queueAdd', uri: 'mock:track:9999' });
    expect((await lib.queue()).next.length).toBe(before);
  });
});

describe('demo player: likes, history, devices', () => {
  it('reports and toggles liked for the current track', async () => {
    const { m, lib } = setup();
    expect(m.state.get().liked).toBe(true); // Midnight Highway starts liked
    expect(await lib.setLiked('mock:track:1', false)).toBe(false);
    expect(m.state.get().liked).toBe(false);
    expect((await lib.liked()).some((t) => t.id === 'mock-1')).toBe(false);
    await lib.setLiked('mock:track:1', true);
    expect(m.state.get().liked).toBe(true);
    await lib.setLiked('mock:track:2', true); // not the current track
    expect(m.state.get().liked).toBe(true);
  });

  it('liked state follows the track as it changes', async () => {
    const { m } = setup();
    await m.command({ cmd: 'next' }); // Rearview — not liked
    expect(m.state.get().liked).toBe(false);
  });

  it('records what was played, newest first, without consecutive repeats', async () => {
    const { m, lib } = setup();
    await m.command({ cmd: 'playTracks', uris: ['mock:track:33', 'mock:track:34'] });
    await m.command({ cmd: 'next' });
    await m.command({ cmd: 'prev' }); // restarts or goes back — must not duplicate
    const recent = (await lib.home()).recent.map((t) => t.title);
    expect(recent[0]).toBe('Scenic Route');
    expect(recent.filter((t) => t === 'Detour Dreams')).toHaveLength(1);
  });

  it('lists devices and moves playback', async () => {
    const { m, lib } = setup();
    expect((await lib.devices()).filter((d) => d.active).map((d) => d.name)).toEqual(['Head Unit']);
    await lib.transfer('pixel');
    expect((await lib.devices()).filter((d) => d.active).map((d) => d.id)).toEqual(['pixel']);
    expect(m.state.get().deviceName).toBe("Alex's Pixel 8");
    await expect(lib.transfer('nope')).rejects.toThrow(/Unknown device/);
  });
});
