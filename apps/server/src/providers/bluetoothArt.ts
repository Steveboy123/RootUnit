const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { until: number; url?: string }>();

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function score(result: any, title: string, artist: string, album: string): number {
  const rt = norm(result.trackName);
  const ra = norm(result.artistName);
  const ral = norm(result.collectionName);
  const t = norm(title);
  const a = norm(artist);
  const al = norm(album);
  let n = 0;
  if (t && rt === t) n += 8;
  else if (t && (rt.includes(t) || t.includes(rt))) n += 4;
  if (a && ra === a) n += 6;
  else if (a && (ra.includes(a) || a.includes(ra))) n += 3;
  if (al && ral === al) n += 4;
  else if (al && (ral.includes(al) || al.includes(ral))) n += 2;
  return n;
}

/**
 * Bluetooth AVRCP normally gives title/artist/album but not the cover bitmap. For a nicer car UI,
 * do a best-effort public catalog lookup. Playback never depends on this: network/error/no-match => no art.
 */
export async function lookupBluetoothArt(title?: string, artist?: string, album?: string): Promise<string | undefined> {
  const key = [norm(title), norm(artist), norm(album)].join('|');
  if (!norm(title) && !norm(album)) return undefined;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;

  try {
    const term = [artist, title || album].filter(Boolean).join(' ').trim();
    if (!term) return undefined;
    const u = new URL('https://itunes.apple.com/search');
    u.searchParams.set('term', term);
    u.searchParams.set('media', 'music');
    u.searchParams.set('entity', 'song');
    u.searchParams.set('limit', '8');
    const r = await fetch(u, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'RPI-Head-Unit/1.0' } });
    if (!r.ok) throw new Error(`catalog ${r.status}`);
    const body = (await r.json()) as any;
    const results = Array.isArray(body?.results) ? body.results : [];
    const ranked = results
      .map((x: any) => ({ x, n: score(x, title ?? '', artist ?? '', album ?? '') }))
      .sort((a: any, b: any) => b.n - a.n);
    const best = ranked[0]?.n >= 6 ? ranked[0].x : undefined;
    let url = typeof best?.artworkUrl100 === 'string' ? best.artworkUrl100 : undefined;
    if (url) url = url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    cache.set(key, { until: Date.now() + TTL_MS, ...(url ? { url } : {}) });
    return url;
  } catch {
    cache.set(key, { until: Date.now() + 15 * 60 * 1000 });
    return undefined;
  }
}
