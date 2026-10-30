import { useEffect, useRef, useState } from 'react';
import { ListMusic, Mic2, Music2, Radio as RadioIcon, Repeat, Repeat1, Shuffle, Sparkles, Volume2 } from 'lucide-react';
import { ALBUM_MOTIONS, type AlbumMotion, type LyricsResult, type QueueView, type RepeatMode } from '@headunit/shared';
import { ALBUM_MOTION_INFO } from '../lib/appearanceInfo';
import { AlbumArt } from '../components/AlbumArt';
import { LikeButton } from '../components/LikeButton';
import { Transport } from '../components/Transport';
import { Banner, Empty, Eq, Segment, Slider, Spinner } from '../components/ui';
import { useApi } from '../lib/api';
import { formatMs } from '../lib/format';
import { lyricIndexAt, lyricsQuery, lyricsView } from '../lib/lyrics';
import { useNowPlaying, type NowPlayingView } from '../lib/nowPlaying';
import { useHeadUnit } from '../store';

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' };

/** The artwork styles by name (Settings and the chips under the player). */
export const ALBUM_MOTION_LABELS: Record<AlbumMotion, string> = Object.fromEntries(ALBUM_MOTIONS.map((m) => [m, ALBUM_MOTION_INFO[m].label])) as Record<AlbumMotion, string>;

/** The full-screen player: whatever is playing, large, with lyrics or the queue alongside. */
export function NowPlayingPage() {
  const np = useNowPlaying();
  const go = useHeadUnit((s) => s.go);
  if (!np) {
    return (
      <div className="page">
        <Empty
          icon={Music2}
          title="Nothing is playing"
          action={
            <button type="button" className="btn primary" onClick={() => go('media')}>
              Open Music
            </button>
          }
        >
          Start something in Music, or tune the radio, and it will show here.
        </Empty>
      </div>
    );
  }
  return (
    <div className="page fixed nowplaying">
      <Player np={np} />
      <SidePanel np={np} />
    </div>
  );
}

function Player({ np }: { np: NowPlayingView }) {
  const media = useHeadUnit((s) => s.media);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const system = useHeadUnit((s) => s.system);
  const patchSystem = useHeadUnit((s) => s.patchSystem);
  const go = useHeadUnit((s) => s.go);
  const setTab = useHeadUnit((s) => s.setMusicTab);
  const mode = useHeadUnit((s) => s.settings?.albumMotion ?? 'vinyl');
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const [seek, setSeek] = useState<number | null>(null);
  const server = np.kind === 'media' && media;

  return (
    <section className="np-main">
      <div className="np-stage">
        <button
          type="button"
          className="np-art"
          onClick={() => {
            if (np.tab) setTab(np.tab);
            go(np.route);
          }}
          aria-label={`Open ${np.sourceLabel}`}
          data-no-swipe
        >
          <AlbumArt artUrl={np.artUrl} playing={np.playing} size="lg" label={np.title} fallback={np.kind === 'radio' ? <RadioIcon size={56} /> : <Music2 size={56} />} />
        </button>
      </div>

      <div className="np-info">
        <div className="np-titles" key={np.title}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <h2 className="grow display">{np.title}</h2>
            {server && media.provider === 'spotify' && <LikeButton />}
          </div>
          <div className="np-artist">{[np.artist, np.album].filter(Boolean).join(' · ')}</div>
          <span className="badge" data-tone="info">
            {np.playing && <Eq on />} {np.sourceLabel}
          </span>
        </div>

        {np.progressMs !== null && np.durationMs !== null ? (
          <div className="np-seek" data-no-swipe>
            {np.canSeek ? (
              <Slider label="Seek" min={0} max={Math.max(np.durationMs, 1)} step={1000} value={seek ?? np.progressMs} onChange={setSeek} onCommit={(v) => { setSeek(null); cmd({ cmd: 'seek', positionMs: v }); }} />
            ) : (
              <div className="w-np-bar">
                <i style={{ transform: `scaleX(${Math.min(1, np.progressMs / np.durationMs)})` }} />
              </div>
            )}
            <div className="row num dim" style={{ justifyContent: 'space-between', fontSize: '0.82rem' }}>
              <span>{formatMs(seek ?? np.progressMs)}</span>
              <span>-{formatMs(Math.max(0, np.durationMs - (seek ?? np.progressMs)))}</span>
            </div>
          </div>
        ) : (
          <div className="row dim" style={{ gap: 8, fontWeight: 700, letterSpacing: '0.1em', fontSize: '0.8rem' }}>
            <Eq on={np.playing} /> LIVE
          </div>
        )}

        <div className="np-controls">
          {server ? (
            <button type="button" className="icon-btn" data-active={media.shuffle} aria-label="Shuffle" aria-pressed={media.shuffle} onClick={() => cmd({ cmd: 'shuffle', enabled: !media.shuffle })}>
              <Shuffle />
            </button>
          ) : (
            <span className="icon-btn" />
          )}
          <Transport size="md" />
          {server ? (
            <button type="button" className="icon-btn" data-active={media.repeat !== 'off'} aria-label={`Repeat ${media.repeat}`} onClick={() => cmd({ cmd: 'repeat', mode: NEXT_REPEAT[media.repeat] })}>
              {media.repeat === 'track' ? <Repeat1 /> : <Repeat />}
            </button>
          ) : (
            <span className="icon-btn" />
          )}
        </div>

        {system && (
          <div className="row" data-no-swipe>
            <Volume2 size={19} className="dim" />
            <Slider label="Volume" value={system.muted ? 0 : system.volume} onChange={(v) => patchSystem({ volume: v, muted: false })} />
          </div>
        )}
        <ModeChips mode={mode} onMode={(m) => patchSettings({ albumMotion: m })} />
      </div>
    </section>
  );
}

/** The artwork styles as a row of chips (Classic, Spinning vinyl, Floating 3D, Hologram…); the chosen one is kept in view. */
function ModeChips({ mode, onMode }: { mode: AlbumMotion; onMode(m: AlbumMotion): void }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [mode]);
  return (
    <div ref={row} className="chips scroll np-modes" role="radiogroup" aria-label="Artwork style" data-no-swipe>
      <Sparkles className="dim" size={16} aria-hidden="true" />
      {ALBUM_MOTIONS.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={m === mode} className="chip" data-active={m === mode} onClick={() => onMode(m)}>
          {ALBUM_MOTION_INFO[m].label}
        </button>
      ))}
    </div>
  );
}

function SidePanel({ np }: { np: NowPlayingView }) {
  const canQueue = np.kind === 'media';
  const [tab, setTab] = useState<'lyrics' | 'queue'>('lyrics');
  return (
    <section className="card np-side">
      {canQueue && (
        <Segment
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'lyrics', label: 'Lyrics', icon: Mic2 },
            { value: 'queue', label: 'Up next', icon: ListMusic },
          ]}
        />
      )}
      {tab === 'queue' && canQueue ? <QueuePanel /> : <LyricsPanel np={np} />}
    </section>
  );
}

/** What plays next (the server's music provider only). */
function QueuePanel() {
  const trackId = useHeadUnit((s) => s.media?.track?.id);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const q = useApi<QueueView>('/api/queue', trackId);
  if (q.loading && !q.data) return <div className="np-state"><Spinner /></div>;
  if (q.error) return <Banner tone="warn">{q.error.message}</Banner>;
  const next = q.data?.next ?? [];
  if (next.length === 0) return <Empty icon={ListMusic} title="Nothing queued" />;
  return (
    <div className="np-queue stagger" data-no-swipe>
      {next.slice(0, 30).map((t, i) => (
        <button key={`${t.id}-${i}`} type="button" className="np-queue-row" style={{ ['--i' as string]: i }} onClick={() => cmd({ cmd: 'playTracks', uris: next.slice(i).map((x) => x.uri) })}>
          <span className="np-queue-art" style={t.artUrl ? { backgroundImage: `url(${JSON.stringify(t.artUrl)})` } : undefined} />
          <span className="grow truncate">
            <b className="truncate" style={{ display: 'block' }}>{t.title}</b>
            <span className="dim truncate" style={{ display: 'block', fontSize: '0.82rem' }}>{t.artist}</span>
          </span>
          <span className="dim num" style={{ fontSize: '0.8rem' }}>{formatMs(t.durationMs)}</span>
        </button>
      ))}
    </div>
  );
}

/** Words: off until asked for (they send the song's name to lrclib.net), then synced lines that follow the music, or plain text. */
function LyricsPanel({ np }: { np: NowPlayingView }) {
  const enabled = useHeadUnit((s) => s.settings?.lyrics ?? false);
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const query = lyricsQuery(np);
  const { data, error, loading } = useApi<LyricsResult>(enabled && query ? `/api/lyrics?${query}` : null);

  if (np.kind === 'radio') return <Empty icon={Mic2} title="Live radio">There are no lyrics for a radio stream.</Empty>;
  if (!enabled) {
    return (
      <Empty
        icon={Mic2}
        title="Show lyrics"
        action={
          <button type="button" className="btn primary" onClick={() => patchSettings({ lyrics: true })}>
            Turn on lyrics
          </button>
        }
      >
        The title, artist and length of each song are looked up on lrclib.net, a free lyrics service. Nothing else is sent. You can turn this off again in Settings.
      </Empty>
    );
  }
  if (loading) return <div className="np-state"><Spinner /></div>;
  if (error) return <Banner tone="warn">{error.message}</Banner>;
  const view = lyricsView(data ?? null);
  if (view.kind === 'none') return <Empty icon={Mic2} title="No lyrics found" />;
  if (view.kind === 'instrumental') return <Empty icon={Music2} title="Instrumental" />;
  if (view.kind === 'plain') {
    return (
      <div className="np-lyrics plain" data-no-swipe>
        {view.text.split('\n').map((l, i) => (
          <p key={i}>{l || ' '}</p>
        ))}
      </div>
    );
  }
  return <SyncedLyrics lines={view.lines} progressMs={np.progressMs ?? 0} />;
}

function SyncedLyrics({ lines, progressMs }: { lines: Array<{ t: number; text: string }>; progressMs: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [touching, setTouching] = useState(false);
  const active = lyricIndexAt(lines, progressMs);
  // Keep the sung line in the middle, unless the person is reading ahead (a touch pauses following for a few seconds).
  useEffect(() => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>('[data-now="true"]');
    if (!el || !line || touching) return;
    el.scrollTo({ top: line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2, behavior: 'smooth' });
  }, [active, touching]);
  const hold = useRef<number | undefined>(undefined);
  const pause = () => {
    setTouching(true);
    window.clearTimeout(hold.current);
    hold.current = window.setTimeout(() => setTouching(false), 4000);
  };
  return (
    <div ref={box} className="np-lyrics" data-no-swipe onPointerDown={pause} onWheel={pause}>
      <div className="np-lyrics-pad" />
      {lines.map((l, i) => (
        <p key={i} data-now={i === active} data-past={i < active}>
          {l.text || '♪'}
        </p>
      ))}
      <div className="np-lyrics-pad" />
    </div>
  );
}
