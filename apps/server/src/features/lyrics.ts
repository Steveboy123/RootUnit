import type { LyricLine, LyricsResult } from '@headunit/shared';

const BASE = 'https://lrclib.net/api';
const USER_AGENT = 'RPI-Head-Unit/2.0 (car head unit; https://github.com/steveboy123/rpi-head-unit)';
const TTL_MS = 24 * 3600_000;
const MISS_TTL_MS = 3600_000;
const MAX_ENTRIES = 200;

/**
 * Parse LRC: lines like `[01:23.45] words`, several stamps on one line (a repeated chorus), `[mm:ss]` without hundredths,
 * and an `[offset:+250]` header (milliseconds, positive = lyrics appear earlier). Other tags (`[ar:...]`) are ignored.
 * An empty line keeps its time with empty text: it marks an instrumental gap, and the screen shows a rest.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]/im.exec(lrc);
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim().slice(0, 200);
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0;
      const t = Number(m[1]) * 60_000 + Number(m[2]) * 1000 + frac - offset;
      if (Number.isFinite(t)) lines.push({ t: Math.max(0, t), text });
    }
  }
  return lines.sort((a, b) => a.t - b.t).slice(0, 1500);
}

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  /** Track length in seconds. */
  durationS?: number;
}

/** Validate a query from the screen: bounded text, a sane duration. Null when there is nothing to look up. */
export function sanitizeLyricsQuery(q: Record<string, unknown>): LyricsQuery | null {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = text(q.title, 120);
  const artist = text(q.artist, 120);
  if (!title || !artist) return null;
  const album = text(q.album, 120);
  const d = typeof q.duration === 'string' || typeof q.duration === 'number' ? Number(q.duration) : NaN;
  return { title, artist, ...(album ? { album } : {}), ...(Number.isFinite(d) && d > 0 && d < 3600 * 3 ? { durationS: Math.round(d) } : {}) };
}

interface LrcLibRecord {
  trackName?: unknown;
  artistName?: unknown;
  duration?: unknown;
  instrumental?: unknown;
  plainLyrics?: unknown;
  syncedLyrics?: unknown;
}

const toResult = (r: LrcLibRecord): LyricsResult => {
  const synced = typeof r.syncedLyrics === 'string' && r.syncedLyrics ? parseLrc(r.syncedLyrics) : [];
  return {
    synced: synced.length > 0 ? synced : null,
    plain: typeof r.plainLyrics === 'string' && r.plainLyrics ? r.plainLyrics.slice(0, 20_000) : null,
    instrumental: r.instrumental === true,
  };
};

export class LyricsService {
  private cache = new Map<string, { at: number; value: LyricsResult | null }>();

  constructor(
    private f: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** Lyrics for a track from lrclib.net, or null when it has none. Throws only when the service cannot be reached. */
  async get(q: LyricsQuery): Promise<LyricsResult | null> {
    const key = [q.title, q.artist, q.album ?? '', q.durationS ?? ''].join('\u0000').toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < (hit.value ? TTL_MS : MISS_TTL_MS)) return hit.value;

    let value = await this.exact(q);
    if (!value) value = await this.search(q);
    this.remember(key, value);
    return value;
  }

  private async request(path: string): Promise<unknown | null> {
    const r = await this.f(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('The lyrics service is not available right now.');
    return r.json();
  }

  private async exact(q: LyricsQuery): Promise<LyricsResult | null> {
    const p = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
    if (q.album) p.set('album_name', q.album);
    if (q.durationS) p.set('duration', String(q.durationS));
    const r = await this.request(`/get?${p}`);
    return r && typeof r === 'object' ? toResult(r as LrcLibRecord) : null;
  }

  /** The exact lookup needs the album and length to match; a search is more forgiving (a "Remastered" album, a live length). */
  private async search(q: LyricsQuery): Promise<LyricsResult | null> {
    const p = new URLSearchParams({ track_name: q.title, artist_name: q.artist });
    const list = await this.request(`/search?${p}`);
    if (!Array.isArray(list)) return null;
    const near = (list as LrcLibRecord[]).filter((r) => typeof r === 'object' && r !== null && (!q.durationS || typeof r.duration !== 'number' || Math.abs(r.duration - q.durationS) <= 4));
    // Prefer one with synced lyrics, since that is what the screen can follow along with.
    const best = near.find((r) => typeof r.syncedLyrics === 'string' && r.syncedLyrics) ?? near.find((r) => typeof r.plainLyrics === 'string' && r.plainLyrics);
    return best ? toResult(best) : null;
  }

  private remember(key: string, value: LyricsResult | null): void {
    this.cache.set(key, { at: this.now(), value });
    // Oldest out first (Map keeps insertion order).
    while (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
  }
}
