import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Disc3, Heart, History, Library as LibraryIcon, ListMusic, ListPlus, Mic2, Play, Search, Shuffle, Sparkles, UserRound } from 'lucide-react';
import type { CatalogItem, CatalogTrack, LibraryHome, QueueView, SearchResults, TrackListing } from '@headunit/shared';
import { useApi } from '../../lib/api';
import { formatMs } from '../../lib/format';
import { useHeadUnit } from '../../store';
import { DrivingGate, Eq, Spinner } from '../ui';
import { ErrorNotice } from './ErrorNotice';

type Tab = 'home' | 'playlists' | 'liked' | 'albums' | 'artists' | 'search' | 'queue';
const TABS: Array<{ id: Tab; label: string; icon: typeof LibraryIcon }> = [
  { id: 'home', label: 'For you', icon: Sparkles },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'liked', label: 'Liked', icon: Heart },
  { id: 'albums', label: 'Albums', icon: Disc3 },
  { id: 'artists', label: 'Artists', icon: Mic2 },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'queue', label: 'Queue', icon: History },
];

export const Art = ({ url, round, icon: Icon = LibraryIcon }: { url?: string; round?: boolean; icon?: typeof LibraryIcon }) => (
  <span className="lib-art" data-round={round} style={url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined}>
    {!url && <Icon />}
  </span>
);

/** One track: tap to play (from here), + to queue. */
export function TrackRow({ t, onPlay, playing, onQueue, index = 0 }: { t: CatalogTrack; onPlay(): void; playing?: boolean; onQueue?(): void; index?: number }) {
  const cmd = useHeadUnit((s) => s.media_cmd);
  const toast = useHeadUnit((s) => s.showToast);
  const queue =
    onQueue ??
    (() => {
      cmd({ cmd: 'queueAdd', uri: t.uri });
      toast(`“${t.title}” added to the queue`);
    });
  return (
    <div className="lib-row" data-on={playing} style={{ ['--i' as string]: index }}>
      <button type="button" className="lib-main" data-knob-item onClick={onPlay} disabled={t.playable === false}>
        <Art url={t.artUrl} />
        <span className="lib-text">
          <b className="truncate">
            {playing && <Eq on />} {t.title}
          </b>
          <small className="truncate">
            {t.explicit && <span className="lib-e">E</span>}
            {t.artist}
          </small>
        </span>
        <span className="lib-dur num">{formatMs(t.durationMs)}</span>
      </button>
      <button type="button" className="icon-btn" aria-label={`Add ${t.title} to the queue`} onClick={queue}>
        <ListPlus />
      </button>
    </div>
  );
}

function TrackList({ tracks, empty = 'Nothing here yet' }: { tracks: CatalogTrack[]; empty?: string }) {
  const cmd = useHeadUnit((s) => s.media_cmd);
  const current = useHeadUnit((s) => s.media?.track?.id);
  if (tracks.length === 0) return <div className="dim lib-pad">{empty}</div>;
  return (
    <div className="lib-list stagger">
      {tracks.map((t, i) => (
        // Spotify takes at most 100 URIs, so play from this track onwards.
        <TrackRow key={`${t.id}-${i}`} index={i} t={t} playing={t.id === current} onPlay={() => cmd({ cmd: 'playTracks', uris: tracks.slice(i, i + 100).map((x) => x.uri) })} />
      ))}
    </div>
  );
}

/** Playlist / album / artist rows. Artists have no page (Spotify removed those endpoints) so they just play. */
function ItemList({ items, onOpen, empty }: { items: CatalogItem[]; onOpen(i: CatalogItem): void; empty?: string }) {
  if (items.length === 0) return <div className="dim lib-pad">{empty ?? 'Nothing here yet'}</div>;
  return (
    <div className="lib-list stagger">
      {items.map((i, n) => (
        <div key={i.id} className="lib-row" style={{ ['--i' as string]: n }}>
          <button type="button" className="lib-main" data-knob-item onClick={() => onOpen(i)}>
            <Art url={i.artUrl} round={i.type === 'artist'} icon={i.type === 'artist' ? UserRound : LibraryIcon} />
            <span className="lib-text">
              <b className="truncate">{i.name}</b>
              <small className="truncate">{i.subtitle ?? ''}</small>
            </span>
            {i.type === 'artist' && <Play size={18} className="dim" />}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Tiles({ items, onOpen, round }: { items: Array<{ key: string; name: string; sub?: string; art?: string }>; onOpen(i: number): void; round?: boolean }) {
  return (
    <div className="lib-tiles stagger">
      {items.map((it, i) => (
        <button key={it.key} type="button" className="lib-tile" data-knob-item onClick={() => onOpen(i)} style={{ ['--i' as string]: i }}>
          <Art url={it.art} round={round} />
          <b className="truncate">{it.name}</b>
          {it.sub && <small className="truncate">{it.sub}</small>}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lib-section">
      <div className="section-title">{title}</div>
      {children}
    </section>
  );
}

/** Wraps a request's states so each view only renders the happy path. */
function Loaded<T>({ q, children }: { q: ReturnType<typeof useApi<T>>; children(d: T): ReactNode }) {
  if (q.error) return <ErrorNotice error={q.error} onRetry={q.reload} />;
  if (!q.data)
    return (
      <div className="lib-pad" style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  return <>{children(q.data)}</>;
}

function Detail({ type, id, onBack }: { type: 'playlist' | 'album'; id: string; onBack(): void }) {
  const q = useApi<TrackListing>(`/api/library/${type}/${encodeURIComponent(id)}`);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const current = useHeadUnit((s) => s.media?.track?.id);
  return (
    <div className="lib-detail">
      <button type="button" className="btn small" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft /> Back
      </button>
      <Loaded q={q}>
        {(d) => (
          <>
            <div className="lib-detail-head">
              <Art url={d.item.artUrl} />
              <div className="col" style={{ gap: 6, minWidth: 0 }}>
                <h3 className="display truncate">{d.item.name}</h3>
                <span className="dim">{[d.item.subtitle, `${d.tracks.length} tracks`].filter(Boolean).join(' · ')}</span>
                <div className="row wrap">
                  <button type="button" className="btn small primary" onClick={() => cmd({ cmd: 'playContext', uri: d.item.uri, offset: 0 })}>
                    <Play fill="currentColor" /> Play
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      // Sent in this order; the server makes play wait for the shuffle request to finish.
                      cmd({ cmd: 'shuffle', enabled: true });
                      cmd({ cmd: 'playContext', uri: d.item.uri });
                    }}
                  >
                    <Shuffle /> Shuffle
                  </button>
                </div>
              </div>
            </div>
            <div className="lib-list stagger">
              {d.tracks.map((t, i) => (
                <TrackRow key={`${t.id}-${i}`} index={i} t={t} playing={t.id === current} onPlay={() => cmd({ cmd: 'playContext', uri: d.item.uri, offset: t.position ?? i })} />
              ))}
              {d.tracks.length === 0 && <div className="dim lib-pad">No playable tracks.</div>}
            </div>
          </>
        )}
      </Loaded>
    </div>
  );
}

function SearchView({ open }: { open(i: CatalogItem): void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const cmd = useHeadUnit((s) => s.media_cmd);
  const q = useApi<SearchResults>(query.length >= 2 ? `/api/library/search?q=${encodeURIComponent(query)}` : null);
  const hit = useMemo(() => q.data, [q.data]);
  const empty = hit && !hit.tracks.length && !hit.albums.length && !hit.artists.length && !hit.playlists.length;
  return (
    <div className="col">
      <DrivingGate what="Search">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(text.trim());
          }}
        >
          <div className="field grow">
            <Search />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Songs, albums, artists, playlists" aria-label="Search music" />
          </div>
          <button className="btn primary" type="submit" disabled={text.trim().length < 2}>
            Search
          </button>
        </form>
      </DrivingGate>
      {query.length >= 2 && q.loading && !q.data && <div className="dim lib-pad">Searching…</div>}
      {q.error && <ErrorNotice error={q.error} onRetry={q.reload} />}
      {empty && <div className="dim lib-pad">Nothing found for “{query}”.</div>}
      {hit && !empty && (
        <>
          {hit.tracks.length > 0 && (
            <Section title="Songs">
              <TrackList tracks={hit.tracks} />
            </Section>
          )}
          {hit.artists.length > 0 && (
            <Section title="Artists">
              <ItemList items={hit.artists} onOpen={(a) => cmd({ cmd: 'playContext', uri: a.uri })} />
            </Section>
          )}
          {hit.albums.length > 0 && (
            <Section title="Albums">
              <ItemList items={hit.albums} onOpen={open} />
            </Section>
          )}
          {hit.playlists.length > 0 && (
            <Section title="Playlists">
              <ItemList items={hit.playlists} onOpen={open} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function QueueTab() {
  const trackId = useHeadUnit((s) => s.media?.track?.id);
  const q = useApi<QueueView>('/api/queue', trackId);
  return (
    <Loaded q={q}>
      {(d) => (
        <>
          {d.current && (
            <Section title="Now playing">
              <TrackList tracks={[d.current]} />
            </Section>
          )}
          <Section title={`Next up${d.next.length ? ` · ${d.next.length}` : ''}`}>
            <TrackList tracks={d.next} empty="The queue is empty — tap ＋ on any song to add it." />
          </Section>
        </>
      )}
    </Loaded>
  );
}

function HomeTab({ open }: { open(i: CatalogItem): void }) {
  const trackId = useHeadUnit((s) => s.media?.track?.id);
  const cmd = useHeadUnit((s) => s.media_cmd);
  const q = useApi<LibraryHome>('/api/library/home', trackId);
  return (
    <Loaded q={q}>
      {(h) => (
        <>
          {h.recent.length > 0 && (
            <Section title="Jump back in">
              <Tiles items={h.recent.map((t) => ({ key: t.id, name: t.title, sub: t.artist, art: t.artUrl }))} onOpen={(i) => cmd({ cmd: 'playTracks', uris: h.recent.slice(i, i + 100).map((t) => t.uri) })} />
            </Section>
          )}
          {h.topTracks.length > 0 && (
            <Section title="Your top tracks">
              <TrackList tracks={h.topTracks.slice(0, 5)} />
            </Section>
          )}
          {h.topArtists.length > 0 && (
            <Section title="Your top artists">
              <Tiles round items={h.topArtists.map((a) => ({ key: a.id, name: a.name, art: a.artUrl }))} onOpen={(i) => cmd({ cmd: 'playContext', uri: h.topArtists[i]!.uri })} />
            </Section>
          )}
          {h.playlists.length > 0 && (
            <Section title="Your playlists">
              <Tiles items={h.playlists.map((p) => ({ key: p.id, name: p.name, sub: p.subtitle, art: p.artUrl }))} onOpen={(i) => open(h.playlists[i]!)} />
            </Section>
          )}
        </>
      )}
    </Loaded>
  );
}

/** The music library of the server's provider (Spotify, or TIDAL through the hub): home, playlists, liked, albums, artists, search, queue. */
export function Library() {
  const cmd = useHeadUnit((s) => s.media_cmd);
  const [tab, setTab] = useState<Tab>('home');
  const [detail, setDetail] = useState<{ type: 'playlist' | 'album'; id: string } | null>(null);
  const open = (i: CatalogItem) => (i.type === 'artist' ? cmd({ cmd: 'playContext', uri: i.uri }) : setDetail({ type: i.type, id: i.id }));
  const playlists = useApi<CatalogItem[]>(tab === 'playlists' && !detail ? '/api/library/playlists' : null);
  const liked = useApi<CatalogTrack[]>(tab === 'liked' && !detail ? '/api/library/liked' : null);
  const albums = useApi<CatalogItem[]>(tab === 'albums' && !detail ? '/api/library/albums' : null);
  const artists = useApi<CatalogItem[]>(tab === 'artists' && !detail ? '/api/library/artists' : null);
  return (
    <div className="library" data-no-swipe>
      <div className="chips scroll" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id && !detail}
            className="chip"
            data-active={tab === id && !detail}
            onClick={() => {
              setTab(id);
              setDetail(null);
            }}
          >
            <Icon />
            {label}
          </button>
        ))}
      </div>
      <div className="lib-body" key={detail ? `d:${detail.id}` : tab}>
        {detail ? (
          <Detail type={detail.type} id={detail.id} onBack={() => setDetail(null)} />
        ) : tab === 'home' ? (
          <HomeTab open={open} />
        ) : tab === 'playlists' ? (
          <Loaded q={playlists}>{(d) => <ItemList items={d} onOpen={open} empty="No playlists yet" />}</Loaded>
        ) : tab === 'liked' ? (
          <Loaded q={liked}>{(d) => <TrackList tracks={d} empty="No liked songs yet — tap ♥ on a song you love." />}</Loaded>
        ) : tab === 'albums' ? (
          <Loaded q={albums}>{(d) => <ItemList items={d} onOpen={open} empty="No saved albums" />}</Loaded>
        ) : tab === 'artists' ? (
          <Loaded q={artists}>{(d) => <ItemList items={d} onOpen={open} empty="You aren’t following any artists" />}</Loaded>
        ) : tab === 'search' ? (
          <SearchView open={open} />
        ) : (
          <QueueTab />
        )}
      </div>
    </div>
  );
}
