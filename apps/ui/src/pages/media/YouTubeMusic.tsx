import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ListMusic,
  ListPlus,
  Music2,
  Pause,
  Play,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
} from 'lucide-react';
import { Slider } from '../../components/ui';
import { DrivingGate } from '../../components/ui';
import { apiRequest } from '../../lib/api';
import { formatMs } from '../../lib/format';
import { useHeadUnit } from '../../store';

interface YtConfig {
  configured: boolean;
  source: 'saved' | 'env' | 'none';
}

interface YtTrack {
  id: string;
  title: string;
  artist: string;
  artUrl?: string;
  durationMs: number;
}

interface YtPlaylist {
  id: string;
  title: string;
  artist: string;
  artUrl?: string;
  trackCount?: number;
}

interface YtSearchResults {
  tracks: YtTrack[];
  playlists: YtPlaylist[];
}

interface YtPlaylistView {
  playlist: YtPlaylist;
  tracks: YtTrack[];
}

interface YtPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YtPlayerEvent {
  data: number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          width: string;
          height: string;
          playerVars: Record<string, number | string>;
          events: {
            onReady(): void;
            onStateChange(e: YtPlayerEvent): void;
            onAutoplayBlocked?(): void;
            onError?(e: YtPlayerEvent): void;
          };
        },
      ) => YtPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiReady: Promise<void> | null = null;
function loadPlayerApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiReady) return ytApiReady;
  ytApiReady = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-headunit-youtube-player]');
    const oldReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      oldReady?.();
      resolve();
    };
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.dataset.headunitYoutubePlayer = '1';
    script.onerror = () => reject(new Error('Could not load the YouTube player. Check the internet connection.'));
    document.head.appendChild(script);
  });
  return ytApiReady;
}

const RECENT_KEY = 'headunit.youtubeMusic.recent.v1';
function readRecent(): YtTrack[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as YtTrack[]).filter((x) => x && typeof x.id === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: YtTrack[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 20)));
  } catch {
    // A locked-down browser may deny storage; playback still works.
  }
}

function TrackArt({ track }: { track: YtTrack }) {
  return <span className="ytm-art">{track.artUrl ? <img src={track.artUrl} alt="" draggable={false} /> : <Music2 />}</span>;
}

export function YouTubeMusicPage() {
  const mediaCmd = useHeadUnit((s) => s.media_cmd);
  const radioCmd = useHeadUnit((s) => s.radio_cmd);
  const mediaPlaying = useHeadUnit((s) => s.media?.playing ?? false);
  const radioPlaying = useHeadUnit((s) => s.radio?.playing ?? false);
  const toast = useHeadUnit((s) => s.showToast);

  const [config, setConfig] = useState<YtConfig | null>(null);
  const [setup, setSetup] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState('');

  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YtSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [detail, setDetail] = useState<YtPlaylistView | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const [queue, setQueue] = useState<YtTrack[]>([]);
  const [index, setIndex] = useState(-1);
  const [recent, setRecent] = useState<YtTrack[]>(readRecent);
  const current = index >= 0 ? queue[index] ?? null : null;
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  queueRef.current = queue;
  indexRef.current = index;

  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);

  const next = () => {
    setIndex((old) => {
      const n = old + 1;
      return n < queueRef.current.length ? n : old;
    });
  };
  const prev = () => setIndex((old) => Math.max(0, old - 1));
  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    let live = true;
    void apiRequest<YtConfig>('/api/youtube/config')
      .then((v) => live && setConfig(v))
      .catch(() => live && setConfig({ configured: false, source: 'none' }));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!current || !playerHost.current) return;
    let cancelled = false;
    setPlayerError('');
    setAutoplayBlocked(false);
    void loadPlayerApi()
      .then(() => {
        if (cancelled || !playerHost.current || !window.YT?.Player) return;
        if (player.current) {
          player.current.loadVideoById(current.id);
          return;
        }
        player.current = new window.YT.Player(playerHost.current, {
          videoId: current.id,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 1,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
          },
          events: {
            onReady: () => {
              player.current?.setVolume(volume);
              setPlayerReady(true);
            },
            onStateChange: (e) => {
              setPlaying(e.data === 1);
              if (e.data === 0) nextRef.current();
            },
            onAutoplayBlocked: () => setAutoplayBlocked(true),
            onError: () => setPlayerError('YouTube could not play this item. Try another result.'),
          },
        });
      })
      .catch((e: unknown) => setPlayerError(e instanceof Error ? e.message : 'Could not load YouTube.'));
    return () => {
      cancelled = true;
    };
    // volume is deliberately not a dependency: changing it should not reload the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const p = player.current;
      if (!p) return;
      try {
        setProgress(Math.max(0, p.getCurrentTime() * 1000));
        setDuration(Math.max(0, p.getDuration() * 1000));
      } catch {
        // Player may be between videos.
      }
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(
    () => () => {
      try {
        player.current?.destroy();
      } catch {
        // Already gone.
      }
      player.current = null;
    },
    [],
  );

  const stopOtherAudio = () => {
    if (mediaPlaying) mediaCmd({ cmd: 'pause' });
    if (radioPlaying) radioCmd({ cmd: 'stop' });
  };

  const remember = (track: YtTrack) => {
    setRecent((old) => {
      const nextRecent = [track, ...old.filter((x) => x.id !== track.id)].slice(0, 20);
      saveRecent(nextRecent);
      return nextRecent;
    });
  };

  const playList = (tracks: YtTrack[], start = 0) => {
    if (!tracks.length) return;
    stopOtherAudio();
    setQueue(tracks);
    setIndex(Math.min(Math.max(start, 0), tracks.length - 1));
    remember(tracks[Math.min(Math.max(start, 0), tracks.length - 1)]!);
  };

  useEffect(() => {
    if (current) remember(current);
    // Only update when the actual video changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const addQueue = (track: YtTrack) => {
    setQueue((old) => {
      if (indexRef.current < 0) {
        setIndex(0);
        stopOtherAudio();
        return [track];
      }
      return [...old, track];
    });
    toast(`“${track.title}” added to the queue`);
  };

  const search = async (q: string) => {
    const clean = q.trim();
    if (clean.length < 2) return;
    setQuery(clean);
    setSearching(true);
    setSearchError('');
    setDetail(null);
    try {
      setResults(await apiRequest<YtSearchResults>(`/api/youtube/search?q=${encodeURIComponent(clean)}`));
    } catch (e) {
      setResults(null);
      setSearchError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const openPlaylist = async (p: YtPlaylist) => {
    setDetailBusy(true);
    setSearchError('');
    try {
      setDetail(await apiRequest<YtPlaylistView>(`/api/youtube/playlist/${encodeURIComponent(p.id)}`));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Could not open that playlist.');
    } finally {
      setDetailBusy(false);
    }
  };

  const saveKey = async () => {
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = await apiRequest<YtConfig>('/api/youtube/config', 'PUT', { apiKey });
      setConfig(next);
      setApiKey('');
      setSetup(false);
      toast('YouTube Music API key saved');
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : 'Could not save the API key.');
    } finally {
      setSetupBusy(false);
    }
  };

  const clearKey = async () => {
    setSetupBusy(true);
    setSetupError('');
    try {
      const next = await apiRequest<YtConfig>('/api/youtube/config', 'DELETE');
      setConfig(next);
      setSetup(!next.configured);
      toast(next.configured ? 'Using the API key from .env' : 'YouTube Music API key removed');
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : 'Could not remove the API key.');
    } finally {
      setSetupBusy(false);
    }
  };

  const displayDuration = duration || current?.durationMs || 0;

  // Publish this Chromium-local player to the universal dashboard now-playing card.
  const setLocalNowPlaying = useHeadUnit((st) => st.setLocalNowPlaying);
  useEffect(() => {
    if (!current) {
      setLocalNowPlaying(null);
      return;
    }
    setLocalNowPlaying({
      source: 'youtube-music',
      id: current.id,
      title: current.title,
      artist: current.artist,
      artUrl: current.artUrl,
      durationMs: Math.max(0, displayDuration),
      progressMs: Math.max(0, progress),
      playing,
      volume,
    });
  }, [current?.id, current?.title, current?.artist, current?.artUrl, displayDuration, progress, playing, volume, setLocalNowPlaying]);
  useEffect(() => () => setLocalNowPlaying(null), [setLocalNowPlaying]);

  // Dashboard transport and the USB knob can control YouTube even when the button press originated outside this page.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; action?: string }>).detail;
      if (detail?.source !== 'youtube-music' || !current) return;
      if (detail.action === 'next') next();
      else if (detail.action === 'prev') {
        if (indexRef.current > 0) prev();
        else player.current?.seekTo(0, true);
      } else if (detail.action === 'toggle') {
        if (playing) player.current?.pauseVideo();
        else player.current?.playVideo();
      }
    };
    window.addEventListener('headunit:local-media-command', onCommand);
    return () => window.removeEventListener('headunit:local-media-command', onCommand);
  }, [current?.id, playing]);

  const list = detail?.tracks ?? results?.tracks ?? recent;
  const listTitle = detail ? detail.playlist.title : query ? `Songs · ${query}` : recent.length ? 'Recently played' : 'Find music';

  if (config === null) return <div className="center-card"><Music2 size={44} /><h2>YouTube Music</h2><p>Checking setup…</p></div>;

  if (!config.configured || setup) {
    return (
      <div className="ytm-setup-wrap">
        <div className="ytm-setup center-card">
          <Music2 size={48} />
          <h2>{config.configured ? 'YouTube Music setup' : 'Set up YouTube Music'}</h2>
          <p>
            This uses the official YouTube Data API for search/playlists and the official embedded YouTube player for playback. Enable <b>YouTube Data API v3</b>, create an API key, then paste it below.
          </p>
          <div className="ytm-setup-links">
            <a className="btn" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">Enable YouTube API</a>
            <a className="btn" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Create API key</a>
          </div>
          <div className="ytm-key-row">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIza…"
              autoComplete="off"
              aria-label="YouTube Data API key"
            />
            <button className="btn primary" disabled={setupBusy || apiKey.trim().length < 20} onClick={() => void saveKey()}>
              Save
            </button>
          </div>
          {setupError && <div className="notice warn">{setupError}</div>}
          <div className="dim small">The key is stored locally on the head unit and is only sent to Google by the backend.</div>
          {config.configured && (
            <div className="ytm-setup-actions">
              <button className="btn" onClick={() => setSetup(false)}>Back to music</button>
              {config.source === 'saved' && <button className="btn danger" disabled={setupBusy} onClick={() => void clearKey()}><Trash2 size={16} /> Remove saved key</button>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ytm-page">
      <section className="ytm-player-card">
        <div className="ytm-head">
          <div>
            <span className="ytm-brand"><Music2 size={18} /> YouTube Music</span>
            <h2>{current?.title ?? 'Choose something to play'}</h2>
            <div className="dim ellip">{current?.artist ?? 'Search songs and public playlists from the panel'}</div>
          </div>
          <button className="icon-btn" aria-label="YouTube Music setup" onClick={() => setSetup(true)}><Settings2 /></button>
        </div>

        <div className="ytm-video-shell" data-empty={!current || undefined}>
          {current ? <div ref={playerHost} className="ytm-video" /> : <div className="ytm-video-empty"><Music2 /><span>Nothing playing</span></div>}
        </div>

        {autoplayBlocked && <div className="notice">Autoplay was blocked. Tap Play on the YouTube player once, then the head-unit controls can take over.</div>}
        {playerError && <div className="notice warn">{playerError}</div>}

        <div className="ytm-seek" data-no-swipe>
          <span>{formatMs(progress)}</span>
          <Slider
            label="Seek YouTube Music"
            min={0}
            max={Math.max(displayDuration, 1)}
            step={1000}
            value={Math.min(progress, Math.max(displayDuration, 1))}
            throttleMs={250}
            onChange={(v) => {
              setProgress(v);
              player.current?.seekTo(v / 1000, true);
            }}
          />
          <span>{formatMs(displayDuration)}</span>
        </div>

        <div className="ytm-controls">
          <button className="icon-btn" aria-label="Previous" disabled={index <= 0} onClick={prev}><SkipBack /></button>
          <button
            className="ytm-play"
            aria-label={playing ? 'Pause' : 'Play'}
            disabled={!current || !playerReady}
            onClick={() => {
              stopOtherAudio();
              if (playing) player.current?.pauseVideo();
              else player.current?.playVideo();
            }}
          >
            {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
          </button>
          <button className="icon-btn" aria-label="Next" disabled={index < 0 || index >= queue.length - 1} onClick={next}><SkipForward /></button>
        </div>

        <div className="ytm-volume" data-no-swipe>
          <Volume2 size={18} className="dim" />
          <Slider
            label="YouTube Music volume"
            value={volume}
            onChange={(v) => {
              setVolume(v);
              player.current?.setVolume(v);
            }}
          />
          <span>{volume}%</span>
        </div>
      </section>

      <section className="ytm-browser">
        <DrivingGate what="YouTube Music search">
          <form
            className="searchbar ytm-search"
            onSubmit={(e) => {
              e.preventDefault();
              void search(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Songs, artists, playlists" aria-label="Search YouTube Music" />
            <button className="btn primary" type="submit" disabled={text.trim().length < 2 || searching}><Search size={18} /> Search</button>
          </form>
        </DrivingGate>

        {detail && (
          <div className="ytm-detail-head">
            <button className="btn small" onClick={() => setDetail(null)}><ArrowLeft size={16} /> Results</button>
            <button className="btn primary small" disabled={!detail.tracks.length} onClick={() => playList(detail.tracks, 0)}><Play size={16} fill="currentColor" /> Play playlist</button>
          </div>
        )}

        {searchError && <div className="notice warn">{searchError}</div>}
        {(searching || detailBusy) && <div className="dim pad">Loading from YouTube…</div>}

        {!detail && results?.playlists && results.playlists.length > 0 && (
          <div className="ytm-playlists">
            <h4>Playlists</h4>
            <div className="ytm-playlist-strip">
              {results.playlists.map((p) => (
                <button key={p.id} className="ytm-playlist" onClick={() => void openPlaylist(p)}>
                  <span className="ytm-playlist-art">{p.artUrl ? <img src={p.artUrl} alt="" draggable={false} /> : <ListMusic />}</span>
                  <span className="ellip"><b>{p.title}</b><small>{p.artist}{p.trackCount ? ` · ${p.trackCount}` : ''}</small></span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ytm-list-head">
          <h4>{listTitle}</h4>
          {queue.length > 0 && <span className="dim small">Queue: {index + 1}/{queue.length}</span>}
        </div>
        <div className="ytm-list">
          {list.map((t, i) => (
            <div className="ytm-row" key={`${t.id}-${i}`} data-on={current?.id === t.id || undefined}>
              <button className="ytm-row-main" data-knob-item onClick={() => playList(list, i)}>
                <TrackArt track={t} />
                <span className="ytm-row-text"><b>{t.title}</b><small>{t.artist}</small></span>
                <span className="ytm-time">{formatMs(t.durationMs)}</span>
              </button>
              <button className="icon-btn" aria-label={`Add ${t.title} to queue`} onClick={() => addQueue(t)}><ListPlus /></button>
            </div>
          ))}
          {!searching && !detailBusy && list.length === 0 && (
            <div className="ytm-empty"><Search /><b>Search YouTube Music</b><span>Results play inside the head-unit player — no separate YouTube app.</span></div>
          )}
        </div>

        {queue.length > 0 && (
          <details className="ytm-queue">
            <summary>Queue · {queue.length}</summary>
            <div className="ytm-queue-list">
              {queue.map((t, i) => (
                <button key={`${t.id}-${i}`} data-on={i === index || undefined} onClick={() => setIndex(i)}>
                  <span>{i + 1}</span><span className="ellip">{t.title}<small>{t.artist}</small></span>
                </button>
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
