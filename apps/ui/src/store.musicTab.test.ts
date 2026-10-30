import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type MusicSource, type ServerMessage } from '@headunit/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { apply, initialMusicTab, useHeadUnit, type MusicTab } from './store';

const open = (over: Partial<Parameters<typeof initialMusicTab>[0]> = {}): MusicTab =>
  initialMusicTab({ radioPlaying: false, musicSource: 'auto', provider: undefined, current: 'spotify', ...over });

describe('initialMusicTab: which Music tab the first snapshot opens', () => {
  it('opens TIDAL when TIDAL is the saved source, so the Spotify pane does not take the hub back', () => {
    expect(open({ musicSource: 'tidal', provider: 'tidal' })).toBe('tidal');
    expect(open({ musicSource: 'tidal', provider: undefined })).toBe('tidal'); // saved source wins even before the hub has caught up
  });

  it('opens TIDAL for "auto" while the hub resolved to TIDAL (a TIDAL-only setup), not on a Connect Spotify card', () => {
    expect(open({ musicSource: 'auto', provider: 'tidal' })).toBe('tidal');
  });

  it('opens the Spotify pane for spotify and auto when no TIDAL provider is active', () => {
    expect(open({ musicSource: 'spotify', provider: 'spotify' })).toBe('spotify');
    expect(open({ musicSource: 'auto', provider: 'spotify' })).toBe('spotify');
    expect(open({ musicSource: 'auto', provider: undefined })).toBe('spotify');
  });

  it('a saved Spotify source never opens TIDAL, even if the hub is still on it for a moment', () => {
    expect(open({ musicSource: 'spotify', provider: 'tidal' })).toBe('spotify');
  });

  it('opens Radio when a station is playing, whatever the saved source', () => {
    expect(open({ radioPlaying: true, musicSource: 'tidal', provider: 'tidal' })).toBe('radio');
    expect(open({ radioPlaying: true })).toBe('radio');
  });

  it('keeps the tab that was already selected when nothing says otherwise', () => {
    expect(open({ current: 'youtube-music' })).toBe('youtube-music');
    expect(open({ musicSource: 'spotify', current: 'radio' })).toBe('radio');
  });
});

describe('the first snapshot picks the Music tab; later ones leave it alone', () => {
  const snapshot = (over: { musicSource?: MusicSource; provider?: 'spotify' | 'tidal'; radioPlaying?: boolean } = {}) =>
    ({
      t: 'snapshot',
      settings: { ...DEFAULT_SETTINGS, musicSource: over.musicSource ?? 'auto' },
      layout: DEFAULT_LAYOUT,
      vehicle: null,
      media: { provider: over.provider ?? 'spotify' },
      system: null,
      projection: null,
      devices: null,
      radio: { playing: over.radioPlaying ?? false, stations: [], favorites: [] },
      camera: null,
      diagnostics: null,
    }) as unknown as ServerMessage;

  beforeEach(() => useHeadUnit.setState({ ready: false, musicTab: 'spotify' }));

  it('opens TIDAL on a boot whose saved source is TIDAL', () => {
    apply(snapshot({ musicSource: 'tidal', provider: 'tidal' }));
    expect(useHeadUnit.getState().ready).toBe(true);
    expect(useHeadUnit.getState().musicTab).toBe('tidal');
  });

  it('opens Spotify for the default auto source when Spotify is active', () => {
    apply(snapshot());
    expect(useHeadUnit.getState().musicTab).toBe('spotify');
  });

  it('a reconnect snapshot does not yank the tab the user chose (radio may be playing under it)', () => {
    apply(snapshot({ musicSource: 'tidal', provider: 'tidal' }));
    useHeadUnit.getState().setMusicTab('spotify');
    apply(snapshot({ musicSource: 'tidal', provider: 'tidal', radioPlaying: true }));
    expect(useHeadUnit.getState().musicTab).toBe('spotify');
  });
});
