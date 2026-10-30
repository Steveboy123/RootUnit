import type { JsonStore } from '../store';

export interface YouTubeTrack {
  id: string;
  title: string;
  artist: string;
  artUrl?: string;
  durationMs: number;
}

export interface YouTubePlaylist {
  id: string;
  title: string;
  artist: string;
  artUrl?: string;
  trackCount?: number;
}

export interface YouTubeSearchResults {
  tracks: YouTubeTrack[];
  playlists: YouTubePlaylist[];
}

export interface YouTubePlaylistView {
  playlist: YouTubePlaylist;
  tracks: YouTubeTrack[];
}

export class YouTubeError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

interface StoredYouTubeConfig {
  apiKey?: string;
}

type FetchLike = typeof fetch;

const API = 'https://www.googleapis.com/youtube/v3';

const asObject = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const asString = (v: unknown) => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function durationMs(iso: string): number {
  const m = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d = '0', h = '0', min = '0', sec = '0'] = m;
  return Math.round((Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(sec)) * 1000);
}

function thumb(snippet: Record<string, unknown>): string | undefined {
  const thumbs = asObject(snippet.thumbnails);
  for (const name of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const t = asObject(thumbs?.[name]);
    const url = asString(t?.url);
    if (url) return url;
  }
  return undefined;
}

function googleMessage(body: unknown): string {
  const o = asObject(body);
  const error = asObject(o?.error);
  const msg = asString(error?.message);
  const reasons = Array.isArray(error?.errors) ? error.errors : [];
  const first = asObject(reasons[0]);
  const reason = asString(first?.reason);
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'YouTube Data API quota is used up for now. Try again after Google resets the quota.';
  if (reason === 'keyInvalid' || reason === 'badRequest') return 'The YouTube Data API key was rejected. Check the key in YouTube Music setup.';
  return msg ? `YouTube: ${msg.slice(0, 220)}` : 'YouTube could not complete that request.';
}

export function validYouTubeApiKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
  // Google API keys currently begin with AIza. Keep a little format tolerance while rejecting obvious junk/secrets.
  return /^AIza[0-9A-Za-z_-]{20,80}$/.test(key) ? key : null;
}

export function createYouTubeMusic(deps: { store: JsonStore; envApiKey?: string; fetch?: FetchLike }) {
  const fetcher = deps.fetch ?? fetch;
  const envKey = validYouTubeApiKey(deps.envApiKey) ?? '';

  async function stored(): Promise<StoredYouTubeConfig> {
    return (asObject(await deps.store.read('youtube.json')) ?? {}) as StoredYouTubeConfig;
  }

  async function key(): Promise<{ value: string; source: 'saved' | 'env' | 'none' }> {
    const saved = validYouTubeApiKey((await stored()).apiKey);
    if (saved) return { value: saved, source: 'saved' };
    if (envKey) return { value: envKey, source: 'env' };
    return { value: '', source: 'none' };
  }

  async function request(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const k = await key();
    if (!k.value) throw new YouTubeError('Add a YouTube Data API key in YouTube Music setup first.', 409);
    const url = new URL(`${API}/${path}`);
    for (const [name, value] of Object.entries({ ...params, key: k.value })) url.searchParams.set(name, value);
    let res: Response;
    try {
      res = await fetcher(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new YouTubeError('Could not reach YouTube. Check the head unit internet connection.', 502);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) throw new YouTubeError(googleMessage(body), res.status === 403 ? 429 : 502);
    return asObject(body) ?? {};
  }

  async function videoDetails(ids: string[]): Promise<Map<string, YouTubeTrack>> {
    const clean = [...new Set(ids.filter((id) => /^[A-Za-z0-9_-]{6,20}$/.test(id)))].slice(0, 50);
    if (!clean.length) return new Map();
    const body = await request('videos', { part: 'snippet,contentDetails', id: clean.join(',') });
    const out = new Map<string, YouTubeTrack>();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const item = asObject(raw);
      const id = asString(item?.id);
      const sn = asObject(item?.snippet);
      const cd = asObject(item?.contentDetails);
      if (!id || !sn) continue;
      out.set(id, {
        id,
        title: decodeEntities(asString(sn.title) || 'Untitled'),
        artist: decodeEntities(asString(sn.channelTitle) || 'YouTube'),
        artUrl: thumb(sn),
        durationMs: durationMs(asString(cd?.duration)),
      });
    }
    return out;
  }

  return {
    async config() {
      const k = await key();
      return { configured: Boolean(k.value), source: k.source } as const;
    },

    async saveConfig(raw: unknown) {
      const apiKey = validYouTubeApiKey(raw);
      if (!apiKey) throw new YouTubeError('Enter a valid Google YouTube Data API key (it normally starts with “AIza”).');
      await deps.store.write('youtube.json', { apiKey });
      return { configured: true, source: 'saved' as const };
    },

    async clearConfig() {
      await deps.store.write('youtube.json', {});
      const k = await key();
      return { configured: Boolean(k.value), source: k.source } as const;
    },

    async search(query: string): Promise<YouTubeSearchResults> {
      const q = query.trim().slice(0, 100);
      if (q.length < 2) return { tracks: [], playlists: [] };

      const [videos, playlists] = await Promise.all([
        request('search', {
          part: 'snippet',
          q,
          type: 'video',
          videoCategoryId: '10',
          maxResults: '24',
          safeSearch: 'moderate',
        }),
        request('search', {
          part: 'snippet',
          q,
          type: 'playlist',
          maxResults: '12',
          safeSearch: 'moderate',
        }),
      ]);

      const videoIds = (Array.isArray(videos.items) ? videos.items : [])
        .map((raw) => asString(asObject(asObject(raw)?.id)?.videoId))
        .filter(Boolean);
      const detail = await videoDetails(videoIds);
      const tracks = videoIds.map((id) => detail.get(id)).filter((v): v is YouTubeTrack => Boolean(v));

      const playlistIds = (Array.isArray(playlists.items) ? playlists.items : [])
        .map((raw) => asString(asObject(asObject(raw)?.id)?.playlistId))
        .filter(Boolean)
        .slice(0, 12);
      let counts = new Map<string, number>();
      if (playlistIds.length) {
        const meta = await request('playlists', { part: 'contentDetails', id: playlistIds.join(',') });
        counts = new Map(
          (Array.isArray(meta.items) ? meta.items : [])
            .map((raw) => {
              const item = asObject(raw);
              return [asString(item?.id), asNumber(asObject(item?.contentDetails)?.itemCount) ?? 0] as const;
            })
            .filter(([id]) => Boolean(id)),
        );
      }

      const playlistResults: YouTubePlaylist[] = [];
      for (const raw of Array.isArray(playlists.items) ? playlists.items : []) {
        const item = asObject(raw);
        const id = asString(asObject(item?.id)?.playlistId);
        const sn = asObject(item?.snippet);
        if (!id || !sn) continue;
        playlistResults.push({
          id,
          title: decodeEntities(asString(sn.title) || 'Playlist'),
          artist: decodeEntities(asString(sn.channelTitle) || 'YouTube'),
          artUrl: thumb(sn),
          trackCount: counts.get(id),
        });
      }
      return { tracks, playlists: playlistResults };
    },

    async playlist(id: string): Promise<YouTubePlaylistView> {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new YouTubeError('That playlist ID is not valid.');
      const [meta, items] = await Promise.all([
        request('playlists', { part: 'snippet,contentDetails', id }),
        request('playlistItems', { part: 'contentDetails,snippet', playlistId: id, maxResults: '50' }),
      ]);
      const m = asObject((Array.isArray(meta.items) ? meta.items : [])[0]);
      const sn = asObject(m?.snippet);
      if (!m || !sn) throw new YouTubeError('That YouTube playlist could not be found.', 404);
      const ids = (Array.isArray(items.items) ? items.items : [])
        .map((raw) => asString(asObject(asObject(raw)?.contentDetails)?.videoId))
        .filter(Boolean);
      const details = await videoDetails(ids);
      const tracks = ids.map((videoId) => details.get(videoId)).filter((v): v is YouTubeTrack => Boolean(v));
      return {
        playlist: {
          id,
          title: decodeEntities(asString(sn.title) || 'Playlist'),
          artist: decodeEntities(asString(sn.channelTitle) || 'YouTube'),
          artUrl: thumb(sn),
          trackCount: asNumber(asObject(m.contentDetails)?.itemCount),
        },
        tracks,
      };
    },
  };
}
