import { describe, expect, it } from 'vitest';
import type { MediaState, RadioState } from '@headunit/shared';
import type { LocalNowPlaying } from '../store';
import { selectNowPlaying, type NowPlayingInput } from './nowPlaying';

const media = (over: Partial<MediaState> = {}): MediaState => ({
  provider: 'spotify',
  status: 'ready',
  playing: true,
  track: { id: 't1', title: 'Midnight Highway', artist: 'The Neon Drifters', album: 'Chrome Skies', artUrl: 'http://art/1.jpg', durationMs: 200_000 },
  progressMs: 50_000,
  progressTs: 0,
  volume: 50,
  shuffle: false,
  repeat: 'off',
  ...over,
});
const radio = (over: Partial<RadioState> = {}): RadioState => ({
  status: 'playing',
  playing: true,
  stationId: 's1',
  session: 1,
  stations: [{ id: 's1', name: 'Groove Salad', url: 'http://x', kind: 'internet', genre: 'Ambient', logo: 'http://logo/gs.png' }],
  favorites: [],
  ...over,
});
const local = (over: Partial<LocalNowPlaying> = {}): LocalNowPlaying => ({ source: 'tidal', id: 'x', title: 'Local Song', artist: 'Local Artist', durationMs: 180_000, progressMs: 30_000, playing: true, ...over });
const input = (over: Partial<NowPlayingInput> = {}): NowPlayingInput => ({ media: null, local: null, bluetooth: undefined, radio: null, ...over });

describe('selectNowPlaying', () => {
  it('is null when nothing has been chosen', () => {
    expect(selectNowPlaying(input(), 0)).toBeNull();
    expect(selectNowPlaying(input({ media: media({ track: null }) }), 0)).toBeNull();
  });

  it('shows the server track with the interpolated position and a Spotify label', () => {
    const v = selectNowPlaying(input({ media: media() }), 77_000)!;
    expect(v).toMatchObject({ kind: 'media', title: 'Midnight Highway', artist: 'The Neon Drifters', album: 'Chrome Skies', durationMs: 200_000, progressMs: 77_000, playing: true, sourceLabel: 'Spotify', canSeek: true, tab: 'spotify', route: 'media' });
  });

  it('labels TIDAL and the demo player', () => {
    expect(selectNowPlaying(input({ media: media({ provider: 'tidal' }) }), 0)).toMatchObject({ sourceLabel: 'TIDAL', tab: 'tidal' });
    expect(selectNowPlaying(input({ media: media({ provider: 'mock' }) }), 0)).toMatchObject({ sourceLabel: 'Demo' });
  });

  it('radio wins over everything, and has no position', () => {
    const v = selectNowPlaying(input({ media: media(), local: local(), radio: radio({ nowPlaying: 'Artist - Track' }) }), 0)!;
    expect(v).toMatchObject({ kind: 'radio', title: 'Groove Salad', artist: 'Artist - Track', sourceLabel: 'Radio', progressMs: null, durationMs: null, canSeek: false, artUrl: 'http://logo/gs.png' });
  });

  it('radio that is merely selected but not playing does not take over', () => {
    expect(selectNowPlaying(input({ media: media(), radio: radio({ playing: false }) }), 0)!.kind).toBe('media');
  });

  it('says "Reconnecting…" while a station is failing, and falls back to the genre, then to "Live radio"', () => {
    expect(selectNowPlaying(input({ radio: radio({ status: 'error' }) }), 0)!.artist).toBe('Reconnecting…');
    expect(selectNowPlaying(input({ radio: radio() }), 0)!.artist).toBe('Ambient');
    const noGenre = radio({ stations: [{ id: 's1', name: 'X', url: 'http://x', kind: 'internet' }] });
    expect(selectNowPlaying(input({ radio: noGenre }), 0)!.artist).toBe('Live radio');
  });

  it('a browser-side player (TIDAL / YouTube Music) beats the server track', () => {
    const v = selectNowPlaying(input({ media: media(), local: local({ source: 'youtube-music' }) }), 0)!;
    expect(v).toMatchObject({ kind: 'local', title: 'Local Song', sourceLabel: 'YouTube Music', tab: 'youtube-music', progressMs: 30_000, canSeek: false });
  });

  it('a local player with no known length has no progress bar', () => {
    expect(selectNowPlaying(input({ local: local({ durationMs: 0 }) }), 0)).toMatchObject({ durationMs: null, progressMs: null });
  });

  it('Bluetooth audio shows when the phone is playing, or paused while the server is silent', () => {
    const bt = { status: 'playing' as const, title: 'Phone Song', artist: 'Phone Band', deviceName: 'Pixel', durationMs: 100_000, positionMs: 25_000, codec: 'aac' };
    expect(selectNowPlaying(input({ bluetooth: bt }), 0)).toMatchObject({ kind: 'bluetooth', title: 'Phone Song', artist: 'Phone Band', progressMs: 25_000, sourceLabel: 'Bluetooth', route: 'devices', playing: true, canSeek: false });
    expect(selectNowPlaying(input({ bluetooth: { ...bt, status: 'paused' } }), 0)).toMatchObject({ kind: 'bluetooth', playing: false });
    // paused phone while the server track is playing: the server wins
    expect(selectNowPlaying(input({ media: media(), bluetooth: { ...bt, status: 'paused' } }), 0)!.kind).toBe('media');
    // no metadata at all: not worth showing
    expect(selectNowPlaying(input({ bluetooth: { status: 'playing' } }), 0)).toBeNull();
    expect(selectNowPlaying(input({ bluetooth: { status: 'idle', title: 'x' } }), 0)).toBeNull();
  });
});
