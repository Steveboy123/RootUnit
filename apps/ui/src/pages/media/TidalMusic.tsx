import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Disc3, Info, ListMusic, LoaderCircle, Music2, Pause, Play, Search, Settings as SettingsIcon, SkipBack, SkipForward, Smartphone, UserRound, Volume2 } from 'lucide-react';
import type { CatalogItem, CatalogTrack, SearchResults, TrackListing } from '@headunit/shared';
import { CopyButton } from '../../components/CopyButton';
import { DrivingGate } from '../../components/ui';
import { AlbumArt } from '../../components/AlbumArt';
import { QrCode } from '../../components/QrCode';
import { ServiceCard } from '../../components/music/ServiceCard';
import { Sheet } from '../../components/ui';
import { Slider } from '../../components/ui';
import { apiRequest } from '../../lib/api';
import { useConnections } from '../../lib/connections';
import { formatMs } from '../../lib/format';
import { loadTidalTrack, resetTidalPlayer, tidalMediaElement, tidalPause, tidalPlay, tidalPositionSeconds, tidalSeek, tidalSetVolume, tidyTidalPlaybackError, type TidalCredentialSource } from '../../lib/tidalPlayer';
import { useHeadUnit } from '../../store';

function Art({ url, icon: Icon = Music2 }: { url?: string; icon?: typeof Music2 }) {
  return <span className="ytm-art">{url ? <img src={url} alt="" draggable={false} /> : <Icon />}</span>;
}

function ItemIcon({ type }: { type: CatalogItem['type'] }) {
  return type === 'album' ? <Disc3 /> : type === 'artist' ? <UserRound /> : <ListMusic />;
}

/** The track's page on tidal.com. It is for the driver's phone (QR code, copy): the kiosk never navigates away from the head-unit UI. */
export const tidalTrackUrl = (id: string) => `https://tidal.com/browse/track/${encodeURIComponent(id)}`;

/** Native playback uses TIDAL's official Web Player SDK. Ordinary third-party app credentials may still be limited to previews by TIDAL. */
export const TIDAL_NATIVE_NOTE = 'Native TIDAL player · full-track access depends on the playback access TIDAL grants to your developer app.';

/**
 * Resolves true once the server's active music provider is TIDAL, or false after `ms`. The music hub switches synchronously when the
 * saved source changes and broadcasts the new media state, so this is how a page learns that its next /api/library/* request will be
 * answered by TIDAL (those routes serve whichever service is active; they take no service parameter).
 */
export function whenProviderIsTidal(ms = 4000): Promise<boolean> {
  const is = () => useHeadUnit.getState().media?.provider === 'tidal';
  if (is()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useHeadUnit.subscribe(() => {
      if (is()) done(true);
    });
    function done(ok: boolean) {
      clearTimeout(timer);
      unsubscribe();
      resolve(ok);
    }
    timer = setTimeout(() => done(is()), ms);
  });
}

/** Search box for the TIDAL catalog. It needs the keyboard, so it is behind the same "typing is locked while driving" gate as Spotify, radio and YouTube Music. */
export function TidalSearchBar({ text, onText, onSearch, searching }: { text: string; onText(v: string): void; onSearch(): void; searching: boolean }) {
  return (
    <DrivingGate what="TIDAL search">
      <form
        className="tidal-searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <div className="tidal-search-field">
          <Search aria-hidden="true" />
          <input value={text} onChange={(e) => onText(e.target.value)} placeholder="Search TIDAL tracks, albums, artists, playlists" aria-label="Search TIDAL" />
        </div>
        <button className="btn primary tidal-search-button" disabled={searching || !text.trim()}>{searching ? 'Searching…' : 'Search'}</button>
      </form>
    </DrivingGate>
  );
}

/** "Open on your phone": a QR code and a short address the driver's phone can open, shown on demand. */
export function PhoneLinkSheet({ track, onClose }: { track: CatalogTrack; onClose(): void }) {
  const url = tidalTrackUrl(track.id);
  return (
    <Sheet title="Open on your phone" onClose={onClose}>
      <div className="svc-phone-top">
        <div className="qr-frame">
          <QrCode value={url} label={`QR code to open ${track.title} on TIDAL`} />
        </div>
        <div className="svc-phone-text">
          <p>
            Point your phone’s camera at the code to open <b>{track.title}</b> in TIDAL.
          </p>
          <p className="dim small">No camera? Copy this address and open it in your phone’s browser:</p>
          <div className="copy-row">
            <div className="copy-box copy-long">{url}</div>
            <CopyButton text={url} what="TIDAL track address" />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** Native TIDAL player card: no iframe. TIDAL's Web Player SDK owns the hidden audio element; this UI owns every visible control. */
export function TidalPlayerCard({
  current,
  queue,
  index,
  onStep,
  onPhone,
  onSettings,
}: {
  current: CatalogTrack | null;
  queue: CatalogTrack[];
  index: number;
  onStep(index: number): void;
  onPhone(): void;
  onSettings(): void;
}) {
  const canPrev = index > 0;
  const canNext = index >= 0 && index + 1 < queue.length;
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(current?.durationMs ?? 0);
  const [volume, setVolume] = useState(70);
  const [credentialSource, setCredentialSource] = useState<TidalCredentialSource | null>(null);
  const [preview, setPreview] = useState(false);
  const [retry, setRetry] = useState(0);
  const seq = useRef(0);
  const endedFor = useRef('');
  const onStepRef = useRef(onStep);
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  onStepRef.current = onStep;
  queueRef.current = queue;
  indexRef.current = index;

  useEffect(() => {
    const n = ++seq.current;
    endedFor.current = '';
    setError('');
    setPositionMs(0);
    setDurationMs(current?.durationMs ?? 0);
    setPreview(false);
    if (!current) {
      setPlaying(false);
      setLoading(false);
      setCredentialSource(null);
      return;
    }
    setLoading(true);
    void loadTidalTrack(current.id)
      .then(({ credentialSource: source, mediaElement }) => {
        if (n !== seq.current) return;
        setCredentialSource(source);
        setPlaying(true);
        if (mediaElement && Number.isFinite(mediaElement.duration) && mediaElement.duration > 0) {
          const actual = Math.round(mediaElement.duration * 1000);
          setDurationMs(actual);
          setPreview(actual <= 35_000 && (current.durationMs ?? 0) > 60_000);
        }
      })
      .catch((e) => {
        if (n !== seq.current) return;
        setPlaying(false);
        setError(tidyTidalPlaybackError(e));
      })
      .finally(() => {
        if (n === seq.current) setLoading(false);
      });
    return () => {
      seq.current++;
    };
  }, [current?.id, retry]);

  // The official SDK exposes both position and its media element. Polling makes the UI resilient even if an SDK event is missed.
  useEffect(() => {
    if (!current) return;
    let dead = false;
    const tick = async () => {
      try {
        const [seconds, media] = await Promise.all([tidalPositionSeconds(), tidalMediaElement()]);
        if (dead) return;
        setPositionMs(Math.round(seconds * 1000));
        if (media) {
          if (Number.isFinite(media.duration) && media.duration > 0) {
            const actual = Math.round(media.duration * 1000);
            setDurationMs(actual);
            setPreview(actual <= 35_000 && (current.durationMs ?? 0) > 60_000);
          }
          setPlaying(!media.paused && !media.ended);
          if (media.ended && endedFor.current !== current.id) {
            endedFor.current = current.id;
            const i = indexRef.current;
            if (i >= 0 && i + 1 < queueRef.current.length) onStepRef.current(i + 1);
          }
        }
      } catch {
        // Loading/error state already reports actionable failures. A missed progress tick is harmless.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 500);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [current?.id]);

  useEffect(() => () => { void resetTidalPlayer().catch(() => undefined); }, []);

  const toggle = async () => {
    if (!current || loading) return;
    try {
      if (playing) {
        await tidalPause();
        setPlaying(false);
      } else {
        await tidalPlay();
        setPlaying(true);
      }
    } catch (e) {
      setError(tidyTidalPlaybackError(e));
    }
  };

  // Publish the native browser player to the dashboard so Home now-playing is TIDAL-aware, not Spotify-only.
  const setLocalNowPlaying = useHeadUnit((st) => st.setLocalNowPlaying);
  useEffect(() => {
    if (!current) {
      setLocalNowPlaying(null);
      return;
    }
    setLocalNowPlaying({
      source: 'tidal',
      id: current.id,
      title: current.title,
      artist: current.artist,
      album: current.album,
      artUrl: current.artUrl,
      durationMs: Math.max(durationMs || current.durationMs || 0, 0),
      progressMs: Math.max(0, positionMs),
      playing,
      volume,
    });
  }, [current?.id, current?.title, current?.artist, current?.album, current?.artUrl, current?.durationMs, durationMs, positionMs, playing, volume, setLocalNowPlaying]);
  useEffect(() => () => setLocalNowPlaying(null), [setLocalNowPlaying]);

  // Hardware knob / dashboard controls can operate this local player even while this page is not the source of the button press.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; action?: string }>).detail;
      if (detail?.source !== 'tidal' || !current) return;
      if (detail.action === 'toggle') void toggle();
      else if (detail.action === 'next') {
        const i = indexRef.current;
        if (i >= 0 && i + 1 < queueRef.current.length) onStepRef.current(i + 1);
      } else if (detail.action === 'prev') {
        const i = indexRef.current;
        if (i > 0) onStepRef.current(i - 1);
        else void tidalSeek(0);
      }
    };
    window.addEventListener('headunit:local-media-command', onCommand);
    return () => window.removeEventListener('headunit:local-media-command', onCommand);
  }, [current?.id, loading, playing]);

  const actualDuration = Math.max(durationMs || current?.durationMs || 0, 1);
  const status = preview || credentialSource === 'client' ? 'Developer preview' : credentialSource === 'user' ? 'Account playback' : 'Native Web Player';

  return (
    <section className="ytm-player-card tidal-native-player">
      <div className="ytm-head">
        <div>
          <div className="ytm-brand tidal-brand">TIDAL</div>
          <h2>{current?.title ?? 'Choose something to play'}</h2>
          <div className="dim ellip">{current ? [current.artist, current.album].filter(Boolean).join(' · ') : 'Search TIDAL and tap a track · native head-unit playback'}</div>
        </div>
        <button className="icon-btn" aria-label="TIDAL connection settings" onClick={onSettings}>
          <SettingsIcon />
        </button>
      </div>

      <div className="tidal-native-art-wrap">
        <div className="tidal-native-art">
          <AlbumArt artUrl={current?.artUrl} playing={playing} fallback={<Music2 />} />
          {loading && <span className="tidal-native-loading" aria-label="Loading TIDAL track"><LoaderCircle /></span>}
        </div>
      </div>

      <div className="tidal-native-status">
        <span className="svc-pill" data-on={credentialSource === 'user' && !preview}>{status}</span>
        <span className="dim small">Audio: RPI Headunit</span>
      </div>

      {error && (
        <div className="notice warn tidal-playback-error">
          <span>{error}</span>
          <button className="btn small" onClick={() => setRetry((v) => v + 1)}>Retry</button>
        </div>
      )}

      <div className="mp-seek tidal-native-seek" data-no-swipe>
        <span>{formatMs(positionMs)}</span>
        <Slider
          label="TIDAL seek"
          min={0}
          max={actualDuration}
          step={1000}
          value={Math.min(positionMs, actualDuration)}
          throttleMs={250}
          onChange={(v) => {
            setPositionMs(v);
            void tidalSeek(v / 1000).catch((e) => setError(tidyTidalPlaybackError(e)));
          }}
        />
        <span>{formatMs(actualDuration)}</span>
      </div>

      <div className="ytm-controls tidal-native-controls">
        <button className="icon-btn" disabled={!canPrev || loading} aria-label="Previous TIDAL track" onClick={() => onStep(Math.max(0, index - 1))}><SkipBack /></button>
        <button className="ytm-play" disabled={!current || loading} aria-label={playing ? 'Pause TIDAL' : 'Play TIDAL'} onClick={() => void toggle()}>
          {loading ? <LoaderCircle className="spin" /> : playing ? <Pause /> : <Play />}
        </button>
        <button className="icon-btn" disabled={!canNext || loading} aria-label="Next TIDAL track" onClick={() => onStep(Math.min(queue.length - 1, index + 1))}><SkipForward /></button>
      </div>

      <div className="mp-foot tidal-native-foot" data-no-swipe>
        <Volume2 size={18} className="dim" />
        <Slider
          label="TIDAL player volume"
          value={volume}
          onChange={(v) => {
            setVolume(v);
            void tidalSetVolume(v).catch((e) => setError(tidyTidalPlaybackError(e)));
          }}
        />
        <button className="btn tidal-phone-btn" disabled={!current} onClick={onPhone}>
          <Smartphone size={17} /> Open on phone
        </button>
      </div>

      <p className="tidal-note">
        <Info size={16} aria-hidden="true" />
        <span>{TIDAL_NATIVE_NOTE}</span>
      </p>

      {queue.length > 1 && (
        <details className="ytm-queue">
          <summary>Queue · {queue.length}</summary>
          <div className="ytm-queue-list">
            {queue.map((t, i) => (
              <button key={`${t.id}-${i}`} data-on={i === index} data-knob-item onClick={() => onStep(i)}>
                <span>{i + 1}</span><span className="ellip">{t.title}<small>{t.artist}</small></span>
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function TidalMusicPage() {
  const patchSettings = useHeadUnit((s) => s.patchSettings);
  const musicSource = useHeadUnit((s) => s.settings?.musicSource);
  const radioCmd = useHeadUnit((s) => s.radio_cmd);
  const radioPlaying = useHeadUnit((s) => s.radio?.playing ?? false);
  const { services, error: connectionError, update, reload } = useConnections();
  const conn = services?.find((s) => s.service === 'tidal');

  const [setup, setSetup] = useState(false);
  const [phone, setPhone] = useState(false);
  const [text, setText] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [detail, setDetail] = useState<TrackListing | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [queue, setQueue] = useState<CatalogTrack[]>([]);
  const [index, setIndex] = useState(-1);

  const current = index >= 0 ? queue[index] ?? null : null;

  /**
   * Starting a TIDAL track is what makes TIDAL the music source (the hub then pauses Spotify) and silences the radio. Merely opening this
   * page does neither: a passenger browsing TIDAL must not lose the radio, and the saved source must not change until something plays.
   */
  const claimAudio = () => {
    if (musicSource !== 'tidal') patchSettings({ musicSource: 'tidal' });
    if (radioPlaying) radioCmd({ cmd: 'stop' });
  };

  /**
   * Browsing needs the hub on TIDAL too: /api/library/* answers for the ACTIVE service only (there is no ?service=), so a search made while
   * Spotify is active would list Spotify tracks here. Nothing changes while the hub already is on TIDAL (a TIDAL-only 'auto' setup);
   * otherwise the first search or album / playlist open, which are deliberate taps, switches it, as playing does. Opening the page never does.
   */
  const ensureTidalHub = async () => {
    if (useHeadUnit.getState().media?.provider === 'tidal') return true;
    patchSettings({ musicSource: 'tidal' });
    return whenProviderIsTidal();
  };

  const play = (track: CatalogTrack, source: CatalogTrack[] = [track]) => {
    const i = Math.max(0, source.findIndex((t) => t.id === track.id));
    claimAudio();
    setQueue(source);
    setIndex(i);
  };

  const step = (i: number) => {
    claimAudio();
    setIndex(i);
  };

  const search = async () => {
    const q = text.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setDetail(null);
    try {
      if (!(await ensureTidalHub())) throw new Error('Could not switch the music source to TIDAL. Check the connection and try again.');
      setResults(await apiRequest<SearchResults>(`/api/library/search?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setResults(null);
      setSearchError(e instanceof Error ? e.message : 'TIDAL search failed.');
    } finally {
      setSearching(false);
    }
  };

  const openItem = async (item: CatalogItem) => {
    if (item.type === 'artist') return;
    setDetailBusy(true);
    setDetailError('');
    try {
      if (!(await ensureTidalHub())) throw new Error('Could not switch the music source to TIDAL. Check the connection and try again.');
      const path = item.type === 'album' ? 'album' : 'playlist';
      setDetail(await apiRequest<TrackListing>(`/api/library/${path}/${encodeURIComponent(item.id)}`));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Could not open this item.');
    } finally {
      setDetailBusy(false);
    }
  };

  const groups = useMemo(() => {
    if (!results) return [] as Array<{ title: string; items: CatalogItem[] }>;
    return [
      { title: 'Albums', items: results.albums },
      { title: 'Playlists', items: results.playlists },
      { title: 'Artists', items: results.artists },
    ].filter((g) => g.items.length > 0);
  }, [results]);

  if (!conn && !connectionError) {
    return <div className="center-card"><Music2 size={44} /><h2>Checking TIDAL…</h2></div>;
  }

  if (!conn?.configured) {
    return (
      <>
        <div className="ytm-setup-wrap">
          <div className="ytm-setup center-card">
            <div className="ytm-brand tidal-brand">TIDAL</div>
            <h2>Set up TIDAL</h2>
            <p>
              Create a free app on the TIDAL developer dashboard, then paste its Client ID and Client Secret. Search and playback then work right here;
              signing in to a TIDAL account is optional.
            </p>
            {connectionError && <div className="notice warn">{connectionError}</div>}
            {conn ? (
              <button className="btn primary big" onClick={() => setSetup(true)}>Set up TIDAL</button>
            ) : (
              <button className="btn primary big" onClick={() => void reload()}>Try again</button>
            )}
          </div>
        </div>
        {setup && conn && (
          <Sheet title="Set up TIDAL" onClose={() => setSetup(false)}>
            <ServiceCard conn={conn} onChanged={update} />
          </Sheet>
        )}
      </>
    );
  }

  return (
    <div className="ytm-page tidal-page">
      <TidalPlayerCard current={current} queue={queue} index={index} onStep={step} onPhone={() => setPhone(true)} onSettings={() => setSetup(true)} />

      <section className="ytm-browser tidal-browser">
        <TidalSearchBar text={text} onText={setText} onSearch={() => void search()} searching={searching} />

        {detail ? (
          <>
            <div className="ytm-detail-head tidal-detail-head">
              <button className="icon-btn" aria-label="Back to TIDAL search results" onClick={() => setDetail(null)}><ArrowLeft /></button>
              <div><b>{detail.item.name}</b><small className="dim">{detail.item.subtitle ?? `${detail.tracks.length} tracks`}</small></div>
            </div>
            <div className="ytm-list">
              {detail.tracks.map((t) => (
                <div className="ytm-row" key={t.id} data-on={current?.id === t.id}>
                  <button className="ytm-row-main" data-knob-item onClick={() => play(t, detail.tracks)}>
                    <Art url={t.artUrl} />
                    <span className="ytm-row-text"><b>{t.title}</b><small>{t.artist}</small></span>
                    <span className="ytm-time">{formatMs(t.durationMs)}</span>
                  </button>
                </div>
              ))}
              {detail.tracks.length === 0 && <div className="ytm-empty"><Music2 /><span>No playable tracks returned by TIDAL.</span></div>}
            </div>
          </>
        ) : (
          <>
            {searchError && <div className="notice warn">{searchError}</div>}
            {detailError && <div className="notice warn">{detailError}</div>}
            {detailBusy && <div className="dim pad">Loading from TIDAL…</div>}
            {!results && !searching && !searchError && (
              <div className="ytm-empty">
                <Search />
                <span>Search TIDAL. Tracks play in the native head-unit player.</span>
              </div>
            )}
            {results && (
              <>
                <div className="ytm-list-head"><h4>Tracks</h4><span className="dim">{results.tracks.length}</span></div>
                <div className="ytm-list">
                  {results.tracks.map((t) => (
                    <div className="ytm-row" key={t.id} data-on={current?.id === t.id}>
                      <button className="ytm-row-main" data-knob-item onClick={() => play(t, results.tracks)}>
                        <Art url={t.artUrl} />
                        <span className="ytm-row-text"><b>{t.title}</b><small>{t.artist}</small></span>
                        <span className="ytm-time">{formatMs(t.durationMs)}</span>
                      </button>
                    </div>
                  ))}
                  {results.tracks.length === 0 && <div className="dim pad">No tracks found.</div>}
                </div>

                {groups.map((group) => (
                  <div className="ytm-playlists" key={group.title}>
                    <h4>{group.title}</h4>
                    <div className="ytm-playlist-strip">
                      {group.items.map((item) => (
                        <button className="ytm-playlist" key={`${item.type}-${item.id}`} onClick={() => void openItem(item)} disabled={item.type === 'artist'}>
                          <span className="ytm-playlist-art">{item.artUrl ? <img src={item.artUrl} alt="" draggable={false} /> : <ItemIcon type={item.type} />}</span>
                          <span className="ellip"><b>{item.name}</b><small>{item.subtitle ?? (item.type === 'artist' ? 'Artist' : item.type)}</small></span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </section>

      {phone && current && <PhoneLinkSheet track={current} onClose={() => setPhone(false)} />}
      {setup && conn && (
        <Sheet title="TIDAL connection" onClose={() => setSetup(false)}>
          <ServiceCard conn={conn} onChanged={update} />
        </Sheet>
      )}
    </div>
  );
}
