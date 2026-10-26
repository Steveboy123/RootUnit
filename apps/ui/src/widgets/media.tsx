import { AudioLines, Bluetooth, Music, Radio as RadioIcon, Smartphone } from 'lucide-react';
import type { LibraryHome } from '@headunit/shared';
import { AlbumArt } from '../components/AlbumArt';
import { LikeButton } from '../components/LikeButton';
import { Transport } from '../components/Transport';
import { Eq } from '../components/ui';
import { useApi } from '../lib/api';
import { providerLabel } from '../lib/connections';
import { formatMs } from '../lib/format';
import { useProgressMs } from '../lib/useProgress';
import { useHeadUnit, type MusicTab } from '../store';

/** Shown instead of the player when there is nothing to play yet. */
export function MediaNotice({ compact = false }: { compact?: boolean }) {
  const media = useHeadUnit((s) => s.media);
  const go = useHeadUnit((s) => s.go);
  if (!media) return null;
  const msg =
    media.status === 'needs-auth'
      ? `Connect ${providerLabel(media.provider)}`
      : media.status === 'no-device'
        ? 'Choose a music source'
        : media.status === 'error'
          ? (media.error ?? `${providerLabel(media.provider)} error`)
          : 'Nothing playing';
  return (
    <div className="w-empty">
      <span className="w-empty-icon">
        <Music />
      </span>
      <b>{msg}</b>
      {!compact && (
        <button type="button" className="btn small" onClick={() => go('media')}>
          Open Music
        </button>
      )}
    </div>
  );
}

interface View {
  title: string;
  sub: string;
  art?: string;
  progress: { at: number; total: number } | null;
  tab?: MusicTab;
  route: 'media' | 'devices';
  kind: 'radio' | 'local' | 'bluetooth' | 'media';
  playing: boolean;
}

/** The dashboard player follows the source that is actually audible: radio, a browser player, Bluetooth, then Spotify/TIDAL. */
export function NowPlayingWidget() {
  const media = useHeadUnit((s) => s.media);
  const local = useHeadUnit((s) => s.localNowPlaying);
  const bt = useHeadUnit((s) => s.devices?.media);
  const radio = useHeadUnit((s) => s.radio);
  const go = useHeadUnit((s) => s.go);
  const setTab = useHeadUnit((s) => s.setMusicTab);
  const progress = useProgressMs(media);

  const station = radio?.playing ? radio.stations.find((s) => s.id === radio.stationId) : undefined;
  const bluetoothActive = !station && !local && bt && (bt.status === 'playing' || (!media?.playing && bt.status === 'paused')) && Boolean(bt.title || bt.artist);
  const track = media?.track;
  if (!station && !local && !bluetoothActive && (!media || !track)) return <MediaNotice />;

  let view: View;
  if (station) {
    view = { title: station.name, sub: radio?.status === 'error' ? 'Reconnecting…' : (radio?.nowPlaying ?? station.genre ?? 'Live radio'), art: station.logo, progress: null, tab: 'radio', route: 'media', kind: 'radio', playing: true };
  } else if (local) {
    view = { title: local.title, sub: `${local.artist} · ${local.source === 'tidal' ? 'TIDAL' : 'YouTube Music'}`, art: local.artUrl, progress: { at: local.progressMs, total: local.durationMs }, tab: local.source, route: 'media', kind: 'local', playing: local.playing };
  } else if (bluetoothActive && bt) {
    const quality = bt.codec ? ` · ${bt.codec.replace('_', '-').toUpperCase()}` : '';
    view = {
      title: bt.title || 'Bluetooth audio',
      sub: `${bt.artist || bt.deviceName || 'Phone'} · Bluetooth${quality}`,
      art: bt.artUrl,
      progress: bt.durationMs && bt.durationMs > 0 ? { at: bt.positionMs ?? 0, total: bt.durationMs } : null,
      route: 'devices',
      kind: 'bluetooth',
      playing: bt.status === 'playing',
    };
  } else {
    view = {
      title: track!.title,
      sub: `${track!.artist} · ${media?.provider === 'tidal' ? 'TIDAL' : media?.provider === 'mock' ? 'Demo' : 'Spotify'}`,
      art: track!.artUrl,
      progress: { at: progress, total: track!.durationMs },
      tab: media?.provider === 'tidal' ? 'tidal' : 'spotify',
      route: 'media',
      kind: 'media',
      playing: Boolean(media?.playing),
    };
  }
  const open = () => {
    if (view.tab) setTab(view.tab);
    go(view.route === 'devices' ? 'devices' : 'nowplaying');
  };
  const pct = view.progress && view.progress.total > 0 ? Math.min(1, Math.max(0, view.progress.at / view.progress.total)) : null;

  return (
    <div className="w-np">
      <button type="button" className="w-np-art" onClick={open} aria-label="Open the player" data-no-swipe>
        <AlbumArt artUrl={view.art} playing={view.playing} size="sm" label={view.title} fallback={view.kind === 'radio' ? <RadioIcon /> : view.kind === 'bluetooth' ? <Bluetooth /> : <Smartphone />} />
      </button>
      <div className="w-np-body">
        <div className="w-np-meta">
          <div className="grow">
            <div className="w-np-title truncate">{view.title}</div>
            <div className="w-np-sub truncate">{view.sub}</div>
          </div>
          {view.kind === 'media' && media?.provider === 'spotify' && <LikeButton />}
        </div>
        {pct === null ? (
          <div className="w-np-live">
            <Eq on={view.playing} /> {view.kind === 'radio' ? 'LIVE' : view.kind === 'bluetooth' ? 'BLUETOOTH' : 'PLAYING'}
          </div>
        ) : (
          <div className="w-np-progress">
            <div className="w-np-bar">
              <i style={{ transform: `scaleX(${pct})` }} />
            </div>
            <div className="w-np-times num">
              <span>{formatMs(view.progress!.at)}</span>
              <span>{formatMs(view.progress!.total)}</span>
            </div>
          </div>
        )}
        <Transport />
      </div>
    </div>
  );
}

/** "Jump back in": tap a recently played track to resume from there. */
export function RecentTiles() {
  const trackId = useHeadUnit((s) => s.media?.track?.id);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const provider = useHeadUnit((s) => s.media?.provider);
  const q = useApi<LibraryHome>('/api/library/home', trackId);
  if (q.error) return <div className="w-empty">{q.error.code === 'scope' ? `Reconnect ${providerLabel(provider)} (Settings)` : q.error.message}</div>;
  const recent = q.data?.recent ?? [];
  if (recent.length === 0) return <div className="w-empty">{q.loading ? 'Loading…' : 'Nothing played yet'}</div>;
  return (
    <div className="w-recent stagger" data-no-swipe>
      {recent.slice(0, 8).map((t, i) => (
        <button key={t.id} type="button" className="w-recent-tile" style={{ ['--i' as string]: i }} onClick={() => cmd({ cmd: 'playTracks', uris: recent.slice(i, i + 100).map((x) => x.uri) })} aria-label={`Play ${t.title} by ${t.artist}`}>
          <span className="w-recent-art" style={t.artUrl ? { backgroundImage: `url(${JSON.stringify(t.artUrl)})` } : undefined} />
          <b className="truncate">{t.title}</b>
        </button>
      ))}
    </div>
  );
}

/** One-tap station buttons, like the preset buttons on a car radio. Uses your favourites. */
export function RadioPresets() {
  const radio = useHeadUnit((s) => s.radio);
  const cmd = useHeadUnit((s) => s.radio_cmd);
  if (!radio) return null;
  const favs = radio.stations.filter((s) => radio.favorites.includes(s.id));
  const list = (favs.length ? favs : radio.stations).slice(0, 8);
  return (
    <div className="w-presets" data-no-swipe>
      {list.map((s, i) => {
        const on = radio.playing && radio.stationId === s.id;
        return (
          <button key={s.id} type="button" className="w-preset" data-on={on} onClick={() => cmd(on ? { cmd: 'stop' } : { cmd: 'play', id: s.id })}>
            <span className="w-preset-n num">{i + 1}</span>
            {on ? <AudioLines /> : <RadioIcon />}
            <span className="truncate">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}
