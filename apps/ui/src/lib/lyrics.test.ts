import { describe, expect, it } from 'vitest';
import type { NowPlayingView } from './nowPlaying';
import { lyricIndexAt, lyricsQuery, lyricsView } from './lyrics';

const lines = [
  { t: 1000, text: 'one' },
  { t: 5000, text: 'two' },
  { t: 9000, text: '' },
  { t: 12000, text: 'three' },
];

describe('lyricIndexAt', () => {
  it('is -1 before the first line', () => {
    expect(lyricIndexAt(lines, 0, 0)).toBe(-1);
    expect(lyricIndexAt(lines, 999, 0)).toBe(-1);
  });
  it('picks the last line whose time has come', () => {
    expect(lyricIndexAt(lines, 1000, 0)).toBe(0);
    expect(lyricIndexAt(lines, 4999, 0)).toBe(0);
    expect(lyricIndexAt(lines, 5000, 0)).toBe(1);
    expect(lyricIndexAt(lines, 9500, 0)).toBe(2); // an instrumental rest is a line too
    expect(lyricIndexAt(lines, 999_999, 0)).toBe(3);
  });
  it('shows a line a little early so it lands as the singer starts', () => {
    expect(lyricIndexAt(lines, 4800, 250)).toBe(1);
    expect(lyricIndexAt(lines, 4800, 0)).toBe(0);
  });
  it('copes with no lines at all and with a single line', () => {
    expect(lyricIndexAt([], 5000)).toBe(-1);
    expect(lyricIndexAt([{ t: 100, text: 'x' }], 50, 0)).toBe(-1);
    expect(lyricIndexAt([{ t: 100, text: 'x' }], 150, 0)).toBe(0);
  });
  it('is fast and right on a long song', () => {
    const long = Array.from({ length: 1500 }, (_, i) => ({ t: i * 200, text: `l${i}` }));
    for (const i of [0, 1, 77, 1499]) expect(lyricIndexAt(long, i * 200 + 50, 0)).toBe(i);
  });
});

describe('lyricsQuery', () => {
  const np = (over: Partial<NowPlayingView> = {}): NowPlayingView => ({ kind: 'media', title: 'Song & Dance', artist: 'The Band', album: 'LP', durationMs: 215_400, progressMs: 0, playing: true, sourceLabel: 'Spotify', route: 'media', canSeek: true, ...over });
  it('encodes the title, artist, album and length in seconds', () => {
    expect(lyricsQuery(np())).toBe('title=Song+%26+Dance&artist=The+Band&album=LP&duration=215');
  });
  it('leaves out what is not known', () => {
    expect(lyricsQuery(np({ album: '', durationMs: null }))).toBe('title=Song+%26+Dance&artist=The+Band');
  });
  it('has nothing to look up for radio, or for nothing at all', () => {
    expect(lyricsQuery(np({ kind: 'radio' }))).toBeNull();
    expect(lyricsQuery(null)).toBeNull();
    expect(lyricsQuery(np({ artist: '' }))).toBeNull();
  });
});

describe('lyricsView', () => {
  it('prefers synced lines, then instrumental, then plain text, else none', () => {
    expect(lyricsView({ synced: lines, plain: 'x', instrumental: false })).toEqual({ kind: 'synced', lines });
    expect(lyricsView({ synced: null, plain: null, instrumental: true })).toEqual({ kind: 'instrumental' });
    expect(lyricsView({ synced: null, plain: 'words', instrumental: false })).toEqual({ kind: 'plain', text: 'words' });
    expect(lyricsView({ synced: [], plain: null, instrumental: false })).toEqual({ kind: 'none' });
    expect(lyricsView(null)).toEqual({ kind: 'none' });
  });
});
