import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RadioCommand, RadioState, RadioStation } from '@headunit/shared';
import { Observable } from '../observable';
import type { JsonStore } from '../store';
import { IcyDemux } from './icy';

/**
 * Starter stations. These are well-known public streams, but I could not reach them from the build
 * environment, so they are unverified — a dead one just shows a clear error and can be removed.
 */
export const BUILTIN_STATIONS: RadioStation[] = [
  { id: 'somafm-groovesalad', name: 'SomaFM Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3', kind: 'internet', genre: 'Ambient · Downtempo' },
  { id: 'somafm-defcon', name: 'SomaFM DEF CON Radio', url: 'https://ice1.somafm.com/defcon-128-mp3', kind: 'internet', genre: 'Electronic' },
  { id: 'radioparadise', name: 'Radio Paradise', url: 'https://stream.radioparadise.com/mp3-128', kind: 'internet', genre: 'Eclectic' },
  { id: 'fip', name: 'FIP', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3', kind: 'internet', genre: 'Eclectic' },
];

const FILE = 'radio.json';
const START_GRACE_MS = 5000;

interface Persisted {
  custom: RadioStation[];
  removed: string[];
  favorites: string[];
  last: string | null;
}

export interface RadioDeps {
  store: JsonStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Called when radio starts, so the other audio source can pause. */
  onStart?: () => void;
  /** radio-browser.info compatible API base. */
  searchBase?: string;
}

export interface RadioProvider {
  readonly state: Observable<RadioState>;
  load(): Promise<void>;
  command(c: RadioCommand): Promise<void>;
  /** Proxy a station's audio to `res`, stripping ICY metadata and feeding "now playing". */
  stream(stationId: string, res: ServerResponse, signal: AbortSignal): Promise<void>;
  search(query: string): Promise<RadioStation[]>;
  /** Another source (Spotify) reports its playing flag; if it starts after us, we yield. */
  notifyMediaPlaying(playing: boolean): void;
}

const stationId = (url: string) => `c-${createHash('sha1').update(url).digest('hex').slice(0, 10)}`;

/** Validate an untrusted station; returns null unless it's a plain http(s) URL with a name. */
export function makeStation(input: { name?: unknown; url?: unknown; genre?: unknown; logo?: unknown } | null | undefined): RadioStation | null {
  if (!input || typeof input !== 'object') return null; // radio.json may be hand-edited or corrupt
  if (typeof input.name !== 'string' || typeof input.url !== 'string') return null;
  const name = input.name.trim().slice(0, 60);
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    return null;
  }
  if (!name || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  let logo: string | undefined;
  if (typeof input.logo === 'string') {
    try {
      const l = new URL(input.logo);
      if (l.protocol === 'https:') logo = l.href;
    } catch {
      /* ignore bad logo */
    }
  }
  return {
    id: stationId(url.href),
    name,
    url: url.href,
    kind: 'internet',
    ...(typeof input.genre === 'string' && input.genre.trim() ? { genre: input.genre.trim().slice(0, 40) } : {}),
    ...(logo ? { logo } : {}),
  };
}

export function createRadio(deps: RadioDeps): RadioProvider {
  const { store } = deps;
  const f = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const searchBase = deps.searchBase ?? 'https://all.api.radio-browser.info';

  let custom: RadioStation[] = [];
  let removed: string[] = [];
  let startedAt = 0;

  const stationsList = () => [...BUILTIN_STATIONS.filter((s) => !removed.includes(s.id)), ...custom];

  const state = new Observable<RadioState>({
    status: 'idle',
    playing: false,
    stationId: null,
    session: 0,
    stations: stationsList(),
    favorites: [],
  });

  const persist = () =>
    store.write(FILE, { custom, removed, favorites: state.get().favorites, last: state.get().stationId } satisfies Persisted);
  const refreshStations = () => state.update({ stations: stationsList() });
  const current = () => state.get().stations.find((s) => s.id === state.get().stationId);

  function play(id?: string) {
    const s = state.get();
    const target =
      s.stations.find((x) => x.id === (id ?? s.stationId)) ??
      s.stations.find((x) => s.favorites.includes(x.id)) ??
      s.stations[0];
    if (!target) return;
    startedAt = now();
    state.set({ ...s, playing: true, stationId: target.id, status: 'connecting', nowPlaying: undefined, error: undefined, session: s.session + 1 });
    deps.onStart?.();
    void persist();
  }

  function stop() {
    state.update({ playing: false, status: 'idle', nowPlaying: undefined, error: undefined });
  }

  function step(dir: 1 | -1) {
    const { stations, stationId: cur } = state.get();
    if (!stations.length) return;
    const i = stations.findIndex((s) => s.id === cur);
    play(stations[(i + dir + stations.length) % stations.length]!.id);
  }

  return {
    state,

    async load() {
      const raw = (await store.read(FILE)) as Partial<Persisted> | null;
      if (!raw) return;
      custom = (Array.isArray(raw.custom) ? raw.custom : []).map((c) => makeStation(c)).filter((x): x is RadioStation => x !== null);
      removed = Array.isArray(raw.removed) ? raw.removed.filter((x) => typeof x === 'string') : [];
      const stations = stationsList();
      state.update({
        stations,
        favorites: (Array.isArray(raw.favorites) ? raw.favorites : []).filter((id): id is string => stations.some((s) => s.id === id)),
        stationId: stations.some((s) => s.id === raw.last) ? (raw.last as string) : null,
      });
    },

    async command(c) {
      switch (c.cmd) {
        case 'play':
          return play(c.id);
        case 'stop':
          return stop();
        case 'toggle':
          return state.get().playing ? stop() : play();
        case 'next':
          return step(1);
        case 'prev':
          return step(-1);
        case 'favorite': {
          if (!state.get().stations.some((s) => s.id === c.id)) return;
          const favs = new Set(state.get().favorites);
          if (c.on) favs.add(c.id);
          else favs.delete(c.id);
          state.update({ favorites: [...favs] });
          void persist();
          return;
        }
        case 'add': {
          const st = makeStation(c);
          if (!st || state.get().stations.some((s) => s.id === st.id)) return;
          custom = [...custom, st];
          refreshStations();
          void persist();
          return;
        }
        case 'remove': {
          if (current()?.id === c.id) stop();
          if (BUILTIN_STATIONS.some((s) => s.id === c.id)) removed = [...new Set([...removed, c.id])];
          custom = custom.filter((s) => s.id !== c.id);
          state.update({
            stations: stationsList(),
            favorites: state.get().favorites.filter((id) => id !== c.id),
            ...(state.get().stationId === c.id ? { stationId: null } : {}),
          });
          void persist();
        }
      }
    },

    async stream(id, res, signal) {
      const st = state.get().stations.find((s) => s.id === id);
      if (!st) {
        res.writeHead(404).end();
        return;
      }
      const fail = (message: string) => {
        if (state.get().stationId === id && state.get().playing) state.update({ status: 'error', error: message });
      };
      const live = () => state.get().stationId === id && state.get().playing;

      let upstream: Response;
      try {
        upstream = await f(st.url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'HeadUnit/0.1' }, redirect: 'follow', signal });
      } catch (err) {
        if (!signal.aborted) fail(`Can't reach ${st.name} (${(err as Error).message})`);
        if (!res.headersSent) res.writeHead(502).end();
        return;
      }
      if (!upstream.ok || !upstream.body) {
        fail(`${st.name} responded ${upstream.status}`);
        if (!res.headersSent) res.writeHead(502).end();
        return;
      }

      const metaint = Number(upstream.headers.get('icy-metaint')) || 0;
      res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' });

      const body = Readable.fromWeb(upstream.body as never);
      let first = true;
      const markPlaying = () => {
        if (first && live()) {
          first = false;
          state.update({ status: 'playing', error: undefined });
        }
      };
      const demux =
        metaint > 0
          ? new IcyDemux(metaint, (title) => {
              if (live()) state.update({ nowPlaying: title });
            })
          : null;
      (demux ?? body).on('data', markPlaying);

      try {
        await (demux ? pipeline(body, demux, res) : pipeline(body, res));
        fail(`${st.name} ended the stream`);
      } catch (err) {
        if (!signal.aborted && !res.destroyed) fail(`${st.name} stream failed (${(err as Error).message})`);
      }
    },

    async search(query) {
      const q = query.trim().slice(0, 60);
      if (q.length < 2) return [];
      const url = new URL('/json/stations/search', searchBase);
      url.search = new URLSearchParams({ name: q, limit: '30', hidebroken: 'true', order: 'clickcount', reverse: 'true' }).toString();
      const res = await f(url, { headers: { 'User-Agent': 'HeadUnit/0.1' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Station search failed (${res.status})`);
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const out: RadioStation[] = [];
      for (const r of rows) {
        if (r.lastcheckok !== 1) continue;
        const st = makeStation({
          name: r.name,
          url: r.url_resolved || r.url,
          genre: typeof r.tags === 'string' ? r.tags.split(',').slice(0, 2).join(' · ') : undefined,
          logo: r.favicon,
        });
        if (st && !out.some((o) => o.id === st.id)) out.push(st);
        if (out.length >= 20) break;
      }
      return out;
    },

    notifyMediaPlaying(playing) {
      if (playing && state.get().playing && now() - startedAt > START_GRACE_MS) stop();
    },
  };
}
