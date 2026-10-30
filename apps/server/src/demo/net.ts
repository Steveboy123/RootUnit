/**
 * The outside world, simulated, for demo mode: the weather forecast, the place search and the lyrics service answer from here, so
 * the demo works with no internet and never sends anything anywhere. Anything else (a quick action's web-hook) is answered "ok".
 * It has the same shape as `fetch`, so the real services run unchanged on top of it.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const PLACES = [
  { name: 'London', latitude: 51.5072, longitude: -0.1276, country: 'United Kingdom', admin1: 'England' },
  { name: 'Paris', latitude: 48.8566, longitude: 2.3522, country: 'France', admin1: 'Île-de-France' },
  { name: 'Berlin', latitude: 52.52, longitude: 13.405, country: 'Germany', admin1: 'Berlin' },
  { name: 'New York', latitude: 40.7128, longitude: -74.006, country: 'United States', admin1: 'New York' },
  { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, country: 'Japan', admin1: 'Tokyo' },
  { name: 'Sydney', latitude: -33.8688, longitude: 151.2093, country: 'Australia', admin1: 'New South Wales' },
];

/** A mild, partly cloudy spring day with a shower on the way. */
export function demoForecast(now: number): unknown {
  const days = [0, 1, 2, 3].map((i) => isoDay(now + i * 86_400_000));
  return {
    current: { temperature_2m: 14.2, apparent_temperature: 12.8, relative_humidity_2m: 71, weather_code: 2, is_day: 1, wind_speed_10m: 17.3 },
    daily: {
      time: days,
      weather_code: [2, 61, 3, 1],
      temperature_2m_max: [16.1, 13.4, 15.0, 18.2],
      temperature_2m_min: [8.3, 9.1, 7.7, 9.9],
      precipitation_probability_max: [20, 75, 35, 5],
      sunrise: days.map((d) => `${d}T06:12`),
      sunset: days.map((d) => `${d}T19:48`),
    },
  };
}

/** Original words for the demo's made-up songs: about the road, spread evenly over the track so the lyric view has something to follow. */
const DEMO_LINES = [
  'Headlights on the wet black road',
  'Every mile a little lighter',
  'Radio low and the window cracked',
  'Chasing the edge of the morning',
  '',
  'Take the long way, take your time',
  'Nobody is waiting at the end of the line',
  'Counting the lamp posts, one by one',
  'Until the city is a faint glow behind',
  '',
  'Oh, keep it rolling, keep it free',
  'The needle steady, the sky wide open',
  'Keep it rolling, let it be',
  'Whatever we lost, we left it on the shoulder',
  '',
  'Slow down, the sunrise knows the way',
];

export function demoLrc(durationS: number): string {
  const lines = DEMO_LINES;
  const span = Math.max(30, durationS - 20);
  return lines
    .map((text, i) => {
      const t = 8 + (span * i) / lines.length;
      const m = Math.floor(t / 60);
      const s = (t % 60).toFixed(2).padStart(5, '0');
      return `[${pad(m)}:${s}] ${text}`;
    })
    .join('\n');
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createDemoFetch(now: () => number = Date.now): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'api.open-meteo.com') return json(demoForecast(now()));
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      const q = (url.searchParams.get('name') ?? '').toLowerCase();
      return json({ results: PLACES.filter((p) => p.name.toLowerCase().includes(q)) });
    }
    if (url.hostname === 'lrclib.net') {
      if (url.pathname.endsWith('/get')) {
        const duration = Number(url.searchParams.get('duration')) || 210;
        return json({ trackName: url.searchParams.get('track_name'), artistName: url.searchParams.get('artist_name'), duration, instrumental: false, plainLyrics: DEMO_LINES.join('\n'), syncedLyrics: demoLrc(duration) });
      }
      return json([]);
    }
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
}
