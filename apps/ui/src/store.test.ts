import type { MediaState, RadioState } from '@headunit/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectBackdropArt, selectTrackArt, useHeadUnit, type ArtState, type LocalNowPlaying } from './store';

const radio = (over: Partial<RadioState> = {}): RadioState => ({
  status: 'playing',
  playing: true,
  stationId: 's1',
  session: 1,
  stations: [
    { id: 's1', name: 'One', url: 'http://x/1', kind: 'internet', logo: 'https://logos/one.png' },
    { id: 's2', name: 'Two', url: 'http://x/2', kind: 'internet' },
  ],
  favorites: [],
  ...over,
});

const media = (artUrl?: string): MediaState => ({ track: { title: 't', artist: 'a', album: 'b', durationMs: 1000, ...(artUrl ? { artUrl } : {}) } }) as unknown as MediaState;

/** These tests only care about the art, so a local player may be given as just `{ artUrl }`. */
type StateOver = Omit<Partial<ArtState>, 'localNowPlaying'> & { localNowPlaying?: Partial<LocalNowPlaying> | null };
const state = (over: StateOver = {}): ArtState => ({ radio: null, media: null, localNowPlaying: null, ...over }) as ArtState;

describe('selectBackdropArt', () => {
  it('uses the media track art when nothing else is playing', () => {
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg') }))).toBe('https://art/media.jpg');
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg'), radio: radio({ playing: false }) }))).toBe('https://art/media.jpg');
  });

  it('prefers art published by a local player over the media track', () => {
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg'), localNowPlaying: { artUrl: 'https://art/yt.jpg' } }))).toBe('https://art/yt.jpg');
  });

  it('shows no picture when the local player has a track without art, rather than the cover of the stale server track', () => {
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg'), localNowPlaying: {} }))).toBeUndefined();
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg'), localNowPlaying: { artUrl: '' } }))).toBeUndefined();
    // ...and the server's track is used again once the page reports nothing selected.
    expect(selectBackdropArt(state({ media: media('https://art/media.jpg'), localNowPlaying: null }))).toBe('https://art/media.jpg');
  });

  it('prefers the radio station logo over everything while radio plays', () => {
    const s = state({ radio: radio(), media: media('https://art/media.jpg'), localNowPlaying: { artUrl: 'https://art/yt.jpg' } });
    expect(selectBackdropArt(s)).toBe('https://logos/one.png');
  });

  it('shows no picture for a playing station without a logo, rather than the cover of whatever played before', () => {
    const s = state({ radio: radio({ stationId: 's2' }), media: media('https://art/media.jpg'), localNowPlaying: { artUrl: 'https://art/yt.jpg' } });
    expect(selectBackdropArt(s)).toBeUndefined();
    expect(selectBackdropArt(state({ radio: radio({ stationId: 'gone' }), media: media('https://art/media.jpg') }))).toBeUndefined();
    expect(selectBackdropArt(state({ radio: radio({ stationId: null }), media: media('https://art/media.jpg') }))).toBeUndefined();
  });

  it('is undefined with nothing to show', () => {
    expect(selectBackdropArt(state())).toBeUndefined();
    expect(selectBackdropArt(state({ media: media() }))).toBeUndefined();
    expect(selectBackdropArt(state({ media: { track: undefined } as unknown as MediaState }))).toBeUndefined();
  });
});

describe('selectTrackArt (what tints the accent: never a radio logo)', () => {
  it('is the local player\'s art while it has a track, else the media art', () => {
    expect(selectTrackArt(state({ media: media('m'), localNowPlaying: { artUrl: 'l' } }))).toBe('l');
    expect(selectTrackArt(state({ media: media('m'), localNowPlaying: {} }))).toBeUndefined();
    expect(selectTrackArt(state({ media: media('m') }))).toBe('m');
    expect(selectTrackArt(state({ radio: radio(), media: media('m') }))).toBe('m');
    expect(selectTrackArt(state())).toBeUndefined();
  });
});

describe('setLocalNowPlaying', () => {
  beforeEach(() => useHeadUnit.setState({ localNowPlaying: null }));

  it('publishes and clears', () => {
    useHeadUnit.getState().setLocalNowPlaying({ artUrl: 'https://art/a.jpg' } as LocalNowPlaying);
    expect(useHeadUnit.getState().localNowPlaying).toEqual({ artUrl: 'https://art/a.jpg' });
    expect(selectBackdropArt(useHeadUnit.getState())).toBe('https://art/a.jpg');
    useHeadUnit.getState().setLocalNowPlaying(null);
    expect(useHeadUnit.getState().localNowPlaying).toBeNull();
  });

  it('does not notify subscribers when the same art is published again', () => {
    const { setLocalNowPlaying } = useHeadUnit.getState();
    setLocalNowPlaying({ artUrl: 'https://art/a.jpg' } as LocalNowPlaying);
    let calls = 0;
    const off = useHeadUnit.subscribe(() => calls++);
    setLocalNowPlaying({ artUrl: 'https://art/a.jpg' } as LocalNowPlaying);
    setLocalNowPlaying({ artUrl: 'https://art/a.jpg' } as LocalNowPlaying);
    expect(calls).toBe(0);
    setLocalNowPlaying({ artUrl: 'https://art/b.jpg' } as LocalNowPlaying);
    expect(calls).toBe(1);
    setLocalNowPlaying(null);
    setLocalNowPlaying(null);
    expect(calls).toBe(2);
    off();
  });

  it('tells "nothing selected" apart from "selected, no art"', () => {
    const { setLocalNowPlaying } = useHeadUnit.getState();
    setLocalNowPlaying({} as LocalNowPlaying);
    expect(useHeadUnit.getState().localNowPlaying).toEqual({});
    setLocalNowPlaying(null);
    expect(useHeadUnit.getState().localNowPlaying).toBeNull();
  });
});
