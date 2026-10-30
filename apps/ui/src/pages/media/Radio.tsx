import { useState } from 'react';
import { Edit3, Globe, Plus, Radio as RadioIcon, Search, Star, Trash2 } from 'lucide-react';
import type { RadioStation } from '@headunit/shared';
import { AlbumArt } from '../../components/AlbumArt';
import { Transport } from '../../components/Transport';
import { Badge, Banner, DrivingGate, Eq, Sheet, Spinner, TextField } from '../../components/ui';
import { useHeadUnit } from '../../store';

function FindSheet({ onClose }: { onClose(): void }) {
  const cmd = useHeadUnit((s) => s.radio_cmd);
  const have = useHeadUnit((s) => s.radio?.stations ?? []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RadioStation[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [byUrl, setByUrl] = useState(false);

  const search = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/radio/search?q=${encodeURIComponent(q)}`);
      const body = (await r.json()) as RadioStation[] | { error: string };
      if (!r.ok) throw new Error('error' in body ? body.error : 'Search failed');
      setResults(body as RadioStation[]);
    } catch (e) {
      setResults(null);
      setError(`${(e as Error).message}. Searching needs an internet connection (e.g. your phone's hotspot).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Find stations" onClose={onClose}>
      <DrivingGate what="Finding stations">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="field grow">
            <Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Station name, e.g. jazz" aria-label="Search stations" />
          </div>
          <button className="btn primary" type="submit" disabled={busy || q.trim().length < 2}>
            {busy ? <Spinner size={18} /> : 'Search'}
          </button>
        </form>
        {error && <Banner tone="warn">{error}</Banner>}
        {results?.length === 0 && <div className="dim">No working stations found.</div>}
        <div className="lib-list stagger">
          {results?.map((r, i) => {
            const added = have.some((h) => h.id === r.id);
            return (
              <div key={r.id} className="lib-row" style={{ ['--i' as string]: i }}>
                <div className="lib-main">
                  <span className="lib-art" style={r.logo ? { backgroundImage: `url(${JSON.stringify(r.logo)})` } : undefined}>
                    {!r.logo && <RadioIcon />}
                  </span>
                  <span className="lib-text">
                    <b className="truncate">{r.name}</b>
                    <small className="truncate">{r.genre ?? 'Internet radio'}</small>
                  </span>
                </div>
                <button type="button" className="btn small" disabled={added} onClick={() => cmd({ cmd: 'add', name: r.name, url: r.url, genre: r.genre, logo: r.logo })}>
                  {added ? (
                    'Added'
                  ) : (
                    <>
                      <Plus /> Add
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn ghost" onClick={() => setByUrl((v) => !v)} style={{ alignSelf: 'flex-start' }}>
          <Globe /> Add by stream address
        </button>
        {byUrl && (
          <div className="col">
            <TextField label="Name" value={name} maxLength={60} onChange={setName} />
            <TextField label="Stream address (http/https)" value={url} onChange={setUrl} placeholder="https://…/stream.mp3" />
            <button
              type="button"
              className="btn primary"
              disabled={!name.trim() || !/^https?:\/\//i.test(url.trim())}
              onClick={() => {
                cmd({ cmd: 'add', name: name.trim(), url: url.trim() });
                setName('');
                setUrl('');
              }}
            >
              Add station
            </button>
          </div>
        )}
      </DrivingGate>
    </Sheet>
  );
}

/** Internet radio: the station playing, big, with its live "now playing" line, and the station list with favourites first. */
export function RadioPane() {
  const radio = useHeadUnit((s) => s.radio);
  const cmd = useHeadUnit((s) => s.radio_cmd);
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  if (!radio) return null;
  const station = radio.stations.find((s) => s.id === radio.stationId);
  const fav = station ? radio.favorites.includes(station.id) : false;
  const sorted = [...radio.stations].sort((a, b) => Number(radio.favorites.includes(b.id)) - Number(radio.favorites.includes(a.id)));
  const live = radio.status === 'playing';
  return (
    <div className="page fixed music">
      <section className="card music-player">
        <div className="music-art">
          <AlbumArt artUrl={station?.logo} playing={live} fallback={<RadioIcon />} label={station?.name} />
        </div>
        <div className="music-titles" key={station?.id ?? 'none'}>
          <b className="display truncate">{station?.name ?? 'Radio'}</b>
          <div className="radio-ticker" data-on={Boolean(radio.nowPlaying)}>
            <span className="fx">{radio.nowPlaying ?? station?.genre ?? 'Pick a station'}</span>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          {radio.status === 'error' ? (
            <Badge tone="warn">{radio.error ?? 'Stream problem'} — retrying</Badge>
          ) : radio.status === 'connecting' ? (
            <Badge>Connecting…</Badge>
          ) : live ? (
            <Badge tone="danger" live>
              LIVE
            </Badge>
          ) : (
            <Badge>Stopped</Badge>
          )}
        </div>
        <div className="np-controls">
          <button type="button" className="icon-btn" data-active={fav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} disabled={!station} onClick={() => station && cmd({ cmd: 'favorite', id: station.id, on: !fav })}>
            <Star fill={fav ? 'currentColor' : 'none'} />
          </button>
          <Transport source="radio" />
          <span className="icon-btn" aria-hidden />
        </div>
      </section>

      <section className="card music-side">
        <div className="row">
          <span className="eyebrow row grow" style={{ gap: 6 }}>
            <RadioIcon size={16} /> Stations · {radio.stations.length}
          </span>
          <button type="button" className="btn small" onClick={() => setFinding(true)}>
            <Globe /> Find
          </button>
          <button type="button" className="icon-btn" data-active={editing} aria-label="Edit stations" onClick={() => setEditing((e) => !e)}>
            <Edit3 />
          </button>
        </div>
        <div className="lib-list stagger" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {sorted.map((s, i) => {
            const on = radio.playing && radio.stationId === s.id;
            const isFav = radio.favorites.includes(s.id);
            return (
              <div key={s.id} className="lib-row" data-on={on} style={{ ['--i' as string]: i }}>
                <button type="button" className="lib-main" data-knob-item onClick={() => cmd({ cmd: 'play', id: s.id })}>
                  <span className="lib-art" style={s.logo ? { backgroundImage: `url(${JSON.stringify(s.logo)})` } : undefined}>
                    {!s.logo && <RadioIcon />}
                  </span>
                  <span className="lib-text">
                    <b className="truncate">
                      {on && <Eq on />} {s.name}
                    </b>
                    <small className="truncate">{on && radio.nowPlaying ? radio.nowPlaying : (s.genre ?? 'Internet radio')}</small>
                  </span>
                </button>
                {editing ? (
                  <button type="button" className="icon-btn" aria-label={`Remove ${s.name}`} onClick={() => cmd({ cmd: 'remove', id: s.id })}>
                    <Trash2 className="tone-danger" />
                  </button>
                ) : (
                  <button type="button" className="icon-btn" data-active={isFav} aria-label={`Favourite ${s.name}`} onClick={() => cmd({ cmd: 'favorite', id: s.id, on: !isFav })}>
                    <Star fill={isFav ? 'currentColor' : 'none'} />
                  </button>
                )}
              </div>
            );
          })}
          {sorted.length === 0 && <div className="dim">No stations. Tap Find to add some.</div>}
        </div>
      </section>
      {finding && <FindSheet onClose={() => setFinding(false)} />}
    </div>
  );
}
