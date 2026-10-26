import { useEffect, useState } from 'react';
import { Cast, Music, Repeat, Repeat1, Shuffle, Volume2 } from 'lucide-react';
import { SERVICE_INFO, type MusicService, type RepeatMode } from '@headunit/shared';
import { AlbumArt } from '../../components/AlbumArt';
import { LikeButton } from '../../components/LikeButton';
import { ConnectSheet } from '../../components/music/ConnectSheet';
import { Library } from '../../components/music/Library';
import { ServiceCard } from '../../components/music/ServiceCard';
import { Transport } from '../../components/Transport';
import { Banner, Sheet, Slider } from '../../components/ui';
import { connectBlurb, serviceOfProvider, setupBlurb, unavailableBlurb, useConnections } from '../../lib/connections';
import { formatMs } from '../../lib/format';
import { useProgressMs } from '../../lib/useProgress';
import { useHeadUnit } from '../../store';
import { RadioPane } from './Radio';
import { TidalMusicPage } from './TidalMusic';
import { YouTubeMusicPage } from './YouTubeMusic';

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' };

/** Shown when the active music service has no usable sign-in: set it up here, or sign in. Works for Spotify and TIDAL. */
function NeedsAuth({ service }: { service: MusicService }) {
  const label = SERVICE_INFO[service].label;
  const go = useHeadUnit((s) => s.go);
  const toast = useHeadUnit((s) => s.showToast);
  const { services, error, update } = useConnections();
  const [setup, setSetup] = useState(false);
  const conn = services?.find((c) => c.service === service);
  const connected = conn?.connected === true;
  useEffect(() => {
    if (setup && connected) {
      setSetup(false);
      toast(`Signed in to ${label}`);
    }
  }, [setup, connected, label, toast]);

  let body;
  if (!conn && !error) {
    body = <p className="dim">Checking your {label} setup…</p>;
  } else if (conn && !conn.available) {
    body = (
      <>
        <h2 className="display">{label} isn’t available in this build</h2>
        <p className="dim">{unavailableBlurb(label)}</p>
        <button type="button" className="btn primary" onClick={() => go('settings')}>
          Open Settings
        </button>
      </>
    );
  } else if (conn && !conn.configured) {
    body = (
      <>
        <h2 className="display">Set up {label}</h2>
        <p className="dim">{setupBlurb(service)}</p>
        <button type="button" className="btn primary" onClick={() => setSetup(true)}>
          Set up {label}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <h2 className="display">{conn?.problem ? `Sign in to ${label} again` : `Connect ${label}`}</h2>
        <p className="dim">{conn?.message ?? connectBlurb(service)}</p>
        <a className="btn primary" href={`/auth/${service}/login`}>
          Connect {label}
        </a>
        {conn && (
          <button type="button" className="btn ghost" onClick={() => setSetup(true)}>
            Sign in from your phone
          </button>
        )}
      </>
    );
  }
  return (
    <div className="page">
      <div className="card music-hero">
        <span className="music-hero-icon fx">
          <Music />
        </span>
        {body}
        {!conn && error && <div className="dim">Couldn’t read the {label} setup: {error}</div>}
      </div>
      {setup && conn && (
        <Sheet title={`${conn.configured ? 'Sign in to' : 'Set up'} ${label}`} onClose={() => setSetup(false)}>
          <ServiceCard conn={conn} onChanged={update} />
        </Sheet>
      )}
    </div>
  );
}

function SpotifyPane() {
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const demo = useHeadUnit((s) => s.demo);
  useEffect(() => {
    // Opening this tab chooses Spotify, except in demo mode, where the simulated player is the one on offer.
    if (!demo) patchSettings({ musicSource: 'spotify' });
  }, [patchSettings, demo]);
  const media = useHeadUnit((s) => s.media);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const progress = useProgressMs(media);
  const [picking, setPicking] = useState(false);
  const [seek, setSeek] = useState<number | null>(null);
  if (!media) return null;
  if (media.status === 'needs-auth') return <NeedsAuth service={serviceOfProvider(media.provider) ?? 'spotify'} />;
  const track = media.track;
  const dur = track?.durationMs ?? 0;
  const at = seek ?? progress;

  return (
    <div className="page fixed music">
      <section className="card music-player">
        {media.status === 'no-device' && <Banner>No active player. Tap “Play on…” and choose RPI Headunit Native Connect for the 320 kbps Pi output.</Banner>}
        {media.status === 'error' && <Banner tone="warn">{media.error}</Banner>}
        <div className="music-art">
          <AlbumArt artUrl={track?.artUrl} playing={media.playing} fallback={<Music />} label={track?.title} />
        </div>
        <div className="music-titles" key={track?.id ?? 'none'}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="display truncate">{track?.title ?? 'Nothing playing'}</b>
              <span className="dim truncate">{[track?.artist, track?.album].filter(Boolean).join(' · ')}</span>
            </div>
            <LikeButton />
          </div>
        </div>
        <div className="music-seek" data-no-swipe>
          <Slider label="Seek" min={0} max={Math.max(dur, 1)} step={1000} value={at} onChange={setSeek} onCommit={(v) => { setSeek(null); cmd({ cmd: 'seek', positionMs: v }); }} />
          <div className="row num dim" style={{ justifyContent: 'space-between', fontSize: '0.8rem' }}>
            <span>{formatMs(at)}</span>
            <span>{formatMs(dur)}</span>
          </div>
        </div>
        <div className="np-controls">
          <button type="button" className="icon-btn" data-active={media.shuffle} aria-label="Shuffle" aria-pressed={media.shuffle} onClick={() => cmd({ cmd: 'shuffle', enabled: !media.shuffle })}>
            <Shuffle />
          </button>
          <Transport source="media" />
          <button type="button" className="icon-btn" data-active={media.repeat !== 'off'} aria-label={`Repeat ${media.repeat}`} onClick={() => cmd({ cmd: 'repeat', mode: NEXT_REPEAT[media.repeat] })}>
            {media.repeat === 'track' ? <Repeat1 /> : <Repeat />}
          </button>
        </div>
        <div className="row" data-no-swipe>
          <Volume2 size={18} className="dim" />
          <Slider label="Player volume" value={media.volume} throttleMs={150} onChange={(v) => cmd({ cmd: 'volume', volume: v })} />
          <button type="button" className="btn small" onClick={() => setPicking(true)} aria-label="Choose where to play">
            <Cast />
            <span className="truncate" style={{ maxWidth: 110 }}>{media.deviceName ?? 'Play on…'}</span>
          </button>
        </div>
      </section>
      <section className="card music-side">
        <Library />
      </section>
      {picking && <ConnectSheet onClose={() => setPicking(false)} />}
    </div>
  );
}

/** The music hub; its source tabs (Spotify, TIDAL, YouTube Music, Radio) live in the status bar. */
export function MediaPage() {
  const tab = useHeadUnit((s) => s.musicTab);
  return (
    <div className="layer music-host" key={tab} style={{ pointerEvents: 'auto' }}>
      {tab === 'radio' ? <RadioPane /> : tab === 'tidal' ? <TidalMusicPage /> : tab === 'youtube-music' ? <YouTubeMusicPage /> : <SpotifyPane />}
    </div>
  );
}
