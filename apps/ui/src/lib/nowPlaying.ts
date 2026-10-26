import type { DevicesState, MediaState, RadioState } from '@headunit/shared';
import type { LocalNowPlaying, MusicTab } from '../store';
import { useHeadUnit } from '../store';
import { useProgressMs } from './useProgress';

/** Everything a screen needs to show "what is playing", whichever source it comes from. */
export interface NowPlayingView {
  kind: 'radio' | 'local' | 'bluetooth' | 'media';
  title: string;
  artist: string;
  album: string;
  artUrl?: string;
  /** Null for a live stream (radio) or when the source does not say. */
  durationMs: number | null;
  progressMs: number | null;
  playing: boolean;
  /** "Spotify", "TIDAL", "YouTube Music", "Radio", "Bluetooth", "Demo". */
  sourceLabel: string;
  /** The Music tab (or page) that owns this source, so a tap can open it. */
  tab?: MusicTab;
  route: 'media' | 'devices';
  /** Whether the server can seek this source (only its own media provider). */
  canSeek: boolean;
}

export interface NowPlayingInput {
  media: MediaState | null;
  local: LocalNowPlaying | null;
  bluetooth: DevicesState['media'] | undefined;
  radio: RadioState | null;
}

const MEDIA_LABEL: Record<MediaState['provider'], string> = { spotify: 'Spotify', tidal: 'TIDAL', mock: 'Demo' };

/**
 * Follows what is actually audible, in this order: the radio, a player living in the browser (TIDAL / YouTube Music),
 * Bluetooth audio from a phone, then the server's music provider. Null when nothing has been chosen yet.
 * `mediaProgressMs` is the smoothly interpolated position of the server's media (see useProgressMs).
 */
export function selectNowPlaying(input: NowPlayingInput, mediaProgressMs: number): NowPlayingView | null {
  const { media, local, bluetooth: bt, radio } = input;

  const station = radio?.playing ? radio.stations.find((s) => s.id === radio.stationId) : undefined;
  if (station && radio) {
    return {
      kind: 'radio',
      title: station.name,
      artist: radio.status === 'error' ? 'Reconnecting…' : (radio.nowPlaying ?? station.genre ?? 'Live radio'),
      album: '',
      artUrl: station.logo,
      durationMs: null,
      progressMs: null,
      playing: true,
      sourceLabel: 'Radio',
      tab: 'radio',
      route: 'media',
      canSeek: false,
    };
  }

  if (local) {
    return {
      kind: 'local',
      title: local.title,
      artist: local.artist,
      album: local.album ?? '',
      artUrl: local.artUrl,
      durationMs: local.durationMs > 0 ? local.durationMs : null,
      progressMs: local.durationMs > 0 ? local.progressMs : null,
      playing: local.playing,
      sourceLabel: local.source === 'tidal' ? 'TIDAL' : 'YouTube Music',
      tab: local.source,
      route: 'media',
      canSeek: false,
    };
  }

  const bluetoothActive = bt && (bt.status === 'playing' || (!media?.playing && bt.status === 'paused')) && Boolean(bt.title || bt.artist);
  if (bluetoothActive && bt) {
    return {
      kind: 'bluetooth',
      title: bt.title || 'Bluetooth audio',
      artist: bt.artist || bt.deviceName || 'Phone',
      album: bt.album ?? '',
      artUrl: bt.artUrl,
      durationMs: bt.durationMs && bt.durationMs > 0 ? bt.durationMs : null,
      progressMs: bt.durationMs && bt.durationMs > 0 ? (bt.positionMs ?? 0) : null,
      playing: bt.status === 'playing',
      sourceLabel: 'Bluetooth',
      route: 'devices',
      canSeek: false,
    };
  }

  const track = media?.track;
  if (media && track) {
    return {
      kind: 'media',
      title: track.title,
      artist: track.artist,
      album: track.album,
      artUrl: track.artUrl,
      durationMs: track.durationMs > 0 ? track.durationMs : null,
      progressMs: track.durationMs > 0 ? mediaProgressMs : null,
      playing: media.playing,
      sourceLabel: MEDIA_LABEL[media.provider],
      tab: media.provider === 'tidal' ? 'tidal' : 'spotify',
      route: 'media',
      canSeek: true,
    };
  }
  return null;
}

/** The current now-playing view, kept up to date (the server's own track is interpolated smoothly between updates). */
export function useNowPlaying(): NowPlayingView | null {
  const media = useHeadUnit((s) => s.media);
  const local = useHeadUnit((s) => s.localNowPlaying);
  const bluetooth = useHeadUnit((s) => s.devices?.media);
  const radio = useHeadUnit((s) => s.radio);
  const progress = useProgressMs(media);
  return selectNowPlaying({ media, local, bluetooth, radio }, progress);
}
