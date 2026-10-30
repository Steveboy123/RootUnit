import { describe, expect, it } from 'vitest';
import { parseGeocoding, parseOpenMeteo } from '../features/weather';
import { parseLrc } from '../features/lyrics';
import { createDemoFetch, demoLrc } from './net';

const NOW = new Date(2026, 3, 10, 9, 0).getTime();
const get = async (url: string) => createDemoFetch(() => NOW)(url);

describe('demo network', () => {
  it('answers the forecast in the shape the real weather service accepts, with dates from today', async () => {
    const parsed = parseOpenMeteo(await (await get('https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=0')).json());
    expect(parsed?.current).toMatchObject({ tempC: 14.2, code: 2, isDay: true });
    expect(parsed?.daily.map((d) => d.date)).toEqual(['2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13']);
    for (const d of parsed!.daily) expect(d.maxC).toBeGreaterThan(d.minC);
  });
  it('searches places by part of the name, and finds nothing for nonsense', async () => {
    const hit = parseGeocoding(await (await get('https://geocoding-api.open-meteo.com/v1/search?name=ber')).json());
    expect(hit.map((p) => p.name)).toEqual(['Berlin']);
    expect(parseGeocoding(await (await get('https://geocoding-api.open-meteo.com/v1/search?name=zzzz')).json())).toEqual([]);
  });
  it('gives lyrics the lyric parser can follow, spread across the track and in order', async () => {
    const r = (await (await get('https://lrclib.net/api/get?track_name=Midnight+Highway&artist_name=X&duration=214')).json()) as { syncedLyrics: string };
    const lines = parseLrc(r.syncedLyrics);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines[0]!.t).toBeGreaterThanOrEqual(0);
    expect(lines.at(-1)!.t).toBeLessThan(214_000);
    expect(lines.map((l) => l.t)).toEqual([...lines.map((l) => l.t)].sort((a, b) => a - b));
  });
  it('keeps a short track’s lines inside its length', () => {
    const lines = parseLrc(demoLrc(60));
    expect(lines.at(-1)!.t).toBeLessThan(60_000);
  });
  it('finds no lyrics through search, and says ok to any other address', async () => {
    expect(await (await get('https://lrclib.net/api/search?track_name=x&artist_name=y')).json()).toEqual([]);
    expect((await get('http://192.168.1.20/door/open')).status).toBe(200);
  });
});
