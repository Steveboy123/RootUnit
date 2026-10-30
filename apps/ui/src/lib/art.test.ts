import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeImage, analyzePixels, backdropArtUrl, cachedArt, clearArtCache, colorsFromImage, dominantColors, hueOf, loadArt } from './art';
import { luminance } from './themes/contrast';

type Rgb = [number, number, number];
const fill = (rgb: Rgb, n: number, a = 255) => Array.from({ length: n }, () => [...rgb, a]).flat();
const px = (...parts: number[][]) => Uint8ClampedArray.from(parts.flat());
/** A w x h picture from a per-pixel function. */
const picture = (w: number, h: number, f: (x: number, y: number) => Rgb | [number, number, number, number]) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = f(x, y) as [number, number, number, number?];
      out.set([r, g, b, a], (y * w + x) * 4);
    }
  return out;
};
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const lumOf = (rgb: Rgb) => luminance({ r: rgb[0], g: rgb[1], b: rgb[2], a: 1 });

const RED: Rgb = [230, 40, 60];
const GREEN: Rgb = [30, 200, 90];
const BLUE: Rgb = [40, 90, 230];

describe('dominantColors', () => {
  it('returns up to n distinct vivid colours, most dominant first', () => {
    const colors = dominantColors(px(fill(BLUE, 600), fill(RED, 300), fill(GREEN, 150), fill([120, 120, 120], 900)), 3);
    expect(colors).toHaveLength(3);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    // Blue is the biggest area, then red, then green.
    expect(hueOf(colors[0]!)).toBeGreaterThan(200);
    expect(hueOf(colors[0]!)).toBeLessThan(250);
    expect(hueGap(hueOf(colors[1]!), 352)).toBeLessThan(20);
    expect(hueGap(hueOf(colors[2]!), 140)).toBeLessThan(25);
  });

  it('keeps every pair of colours at least 30 degrees apart in hue', () => {
    // A rainbow sweep: many neighbouring hues, so the greedy pick has to skip close ones.
    const rainbow = picture(72, 4, (x) => {
      const h = (x / 72) * 360;
      const c = 0.8;
      const xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const [r, g, b] = h < 60 ? [c, xx, 0] : h < 120 ? [xx, c, 0] : h < 180 ? [0, c, xx] : h < 240 ? [0, xx, c] : h < 300 ? [xx, 0, c] : [c, 0, xx];
      return [Math.round((r + 0.1) * 255), Math.round((g + 0.1) * 255), Math.round((b + 0.1) * 255)];
    });
    for (const n of [2, 3, 5, 8]) {
      const colors = dominantColors(rainbow, n);
      expect(colors.length, `n=${n}`).toBeGreaterThan(0);
      expect(colors.length, `n=${n}`).toBeLessThanOrEqual(n);
      for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) expect(hueGap(hueOf(colors[i]!), hueOf(colors[j]!)), `${colors[i]} vs ${colors[j]}`).toBeGreaterThanOrEqual(30);
    }
  });

  it('does not pad with near-duplicates when the picture has fewer colours than asked for', () => {
    expect(dominantColors(px(fill(RED, 500), fill([240, 70, 40], 400)), 3)).toHaveLength(1); // red and red-orange are ~15 degrees apart
    expect(dominantColors(px(fill(RED, 500)), 3)).toHaveLength(1);
    expect(dominantColors(px(fill(RED, 500), fill(BLUE, 500)), 3)).toHaveLength(2);
  });

  it('ignores a few stray pixels of another colour', () => {
    expect(dominantColors(px(fill(GREEN, 600), fill(RED, 6)), 3)).toHaveLength(1);
  });

  it('prefers the vivid colour to the bigger grey area', () => {
    const [c] = dominantColors(px(fill([120, 120, 120], 800), fill(RED, 200)));
    expect(c).toBeDefined();
    expect(hueGap(hueOf(c!), 352)).toBeLessThan(15);
  });

  it('is empty for a picture with no colour', () => {
    expect(dominantColors(px(fill([128, 128, 128], 100)))).toEqual([]);
    expect(dominantColors(px(fill([0, 0, 0], 100)))).toEqual([]);
    expect(dominantColors(px(fill([255, 255, 255], 100)))).toEqual([]);
    expect(dominantColors(px(fill(RED, 100, 0)))).toEqual([]); // transparent
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [
      new Uint8ClampedArray(0),
      [],
      [1, 2, 3],
      [NaN, NaN, NaN, NaN, 1, 2, 3, 255],
      [Infinity, -Infinity, 5, 255],
      Array.from({ length: 40 }, () => undefined),
      null,
      undefined,
      'rgba',
      42,
      {},
      { length: 8 },
    ];
    for (const input of odd) expect(() => dominantColors(input as ArrayLike<number>), String(input)).not.toThrow();
    expect(dominantColors(null as unknown as number[])).toEqual([]);
    expect(dominantColors(px(fill(RED, 100)), 0)).toEqual([]);
    expect(dominantColors(px(fill(RED, 100)), -4)).toEqual([]);
    expect(dominantColors(px(fill(RED, 100)), Number.NaN)).toHaveLength(1); // NaN -> the default of 3
    expect(dominantColors(px(fill(RED, 100)), 1.9)).toHaveLength(1);
    expect(dominantColors(px(fill(RED, 100)), Number.POSITIVE_INFINITY).length).toBeLessThanOrEqual(8);
  });

  it('returns colours that read as colours: saturated, mid lightness, never near-black or near-white', () => {
    for (const dark of [[10, 10, 90], [90, 10, 10], [10, 90, 10]] as Rgb[]) {
      const [c] = dominantColors(px(fill(dark, 400)));
      expect(c).toBeDefined();
      expect(lumOf([parseInt(c!.slice(1, 3), 16), parseInt(c!.slice(3, 5), 16), parseInt(c!.slice(5, 7), 16)])).toBeGreaterThan(0.02);
    }
    const [pale] = dominantColors(px(fill([250, 200, 200], 400)));
    expect(pale === undefined || lumOf([parseInt(pale.slice(1, 3), 16), parseInt(pale.slice(3, 5), 16), parseInt(pale.slice(5, 7), 16)]) < 0.7).toBe(true);
  });
});

describe('analyzePixels', () => {
  it('measures a flat white picture as fully bright and a black one as dark', () => {
    const white = analyzePixels(picture(32, 32, () => [255, 255, 255]), 32, 32)!;
    expect(white.peak).toBeCloseTo(1, 5);
    expect(white.p95).toBeCloseTo(1, 5);
    const black = analyzePixels(picture(32, 32, () => [0, 0, 0]), 32, 32)!;
    expect(black.peak).toBe(0);
    expect(black.p95).toBe(0);
  });

  it('peak is the brightest 8x8 cell average; p95 ignores a small highlight', () => {
    // 64x64, dark everywhere except one 8x8 white cell (1.6 % of the pixels).
    const spot = picture(64, 64, (x, y) => (x >= 24 && x < 32 && y >= 40 && y < 48 ? [255, 255, 255] : [20, 20, 20]));
    const a = analyzePixels(spot, 64, 64)!;
    expect(a.peak).toBeCloseTo(1, 3);
    expect(a.p95).toBeCloseTo(lumOf([20, 20, 20]), 3);
  });

  it('averages a cell before measuring it: fine black-and-white stripes read as mid grey, not white', () => {
    const stripes = picture(64, 64, (x) => (x % 2 === 0 ? [255, 255, 255] : [0, 0, 0]));
    const a = analyzePixels(stripes, 64, 64)!;
    expect(a.peak).toBeCloseTo(lumOf([127.5, 127.5, 127.5]), 2);
    expect(a.p95).toBeCloseTo(1, 5); // sharp: the white stripes are the 95th percentile
    expect(a.peak).toBeLessThan(0.3);
  });

  it('p95 is the 95th percentile: 5 percent bright pixels are the threshold', () => {
    const w = 100;
    const mostlyDark = picture(w, 100, (x, y) => (y * w + x < 600 ? [255, 255, 255] : [0, 0, 0])); // 6 % white
    expect(analyzePixels(mostlyDark, w, 100)!.p95).toBeCloseTo(1, 5);
    const fewer = picture(w, 100, (x, y) => (y * w + x < 400 ? [255, 255, 255] : [0, 0, 0])); // 4 % white
    expect(analyzePixels(fewer, w, 100)!.p95).toBe(0);
  });

  it('carries the dominant colours along', () => {
    const a = analyzePixels(picture(32, 32, (x) => (x < 20 ? RED : BLUE)), 32, 32)!;
    expect(a.colors).toHaveLength(2);
  });

  it('works for non-square pictures and sizes that are not a multiple of 8', () => {
    const a = analyzePixels(picture(50, 21, (x) => (x < 25 ? [255, 255, 255] : [0, 0, 0])), 50, 21)!;
    expect(a.peak).toBeCloseTo(1, 3);
    expect(analyzePixels(picture(3, 3, () => [200, 100, 50]), 3, 3)).not.toBeNull();
    expect(analyzePixels(picture(1, 1, () => [200, 100, 50]), 1, 1)).not.toBeNull();
  });

  it('leaves transparent pixels out of every measure', () => {
    const half = picture(32, 32, (x) => (x < 16 ? [255, 255, 255, 0] : [30, 30, 30, 255]));
    const a = analyzePixels(half, 32, 32)!;
    expect(a.peak).toBeCloseTo(lumOf([30, 30, 30]), 3);
    expect(a.p95).toBeCloseTo(lumOf([30, 30, 30]), 3);
    expect(analyzePixels(picture(8, 8, () => [255, 255, 255, 0]), 8, 8)).toBeNull();
  });

  it('is null (not a throw) for input that does not describe a picture', () => {
    expect(analyzePixels(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(analyzePixels(new Uint8ClampedArray(16), 4, 4)).toBeNull(); // buffer too short for 4x4
    expect(analyzePixels(new Uint8ClampedArray(64), 2.5, 2)).toBeNull();
    expect(analyzePixels(new Uint8ClampedArray(64), -4, -4)).toBeNull();
    expect(analyzePixels(null as unknown as number[], 4, 4)).toBeNull();
    expect(analyzePixels(Array.from({ length: 64 }, () => NaN), 4, 4)).toBeNull();
  });

  it('peak never exceeds the brightest pixel and never falls below the average', () => {
    const noise = picture(64, 64, (x, y) => {
      const v = (x * 37 + y * 91 + x * y * 7) % 256;
      return [v, (v * 3) % 256, (v * 7) % 256];
    });
    const a = analyzePixels(noise, 64, 64)!;
    let max = 0;
    for (let i = 0; i < noise.length; i += 4) max = Math.max(max, lumOf([noise[i]!, noise[i + 1]!, noise[i + 2]!]));
    expect(a.peak).toBeLessThanOrEqual(max + 1e-9);
    expect(a.p95).toBeLessThanOrEqual(max + 1e-9);
    expect(a.peak).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Loading: a fake Image and canvas stand in for the browser
// ---------------------------------------------------------------------------

type Outcome = 'ok' | 'error';
let outcomes: (url: string, cors: boolean) => Outcome;
let pixels: Uint8ClampedArray;
let taint: boolean;
let created: FakeImage[];

class FakeImage {
  crossOrigin: string | undefined;
  decoding = '';
  naturalWidth = 64;
  naturalHeight = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    created.push(this);
  }
  set src(url: string) {
    if (url === '') return;
    queueMicrotask(() => (outcomes(url, this.crossOrigin === 'anonymous') === 'ok' ? this.onload?.() : this.onerror?.()));
  }
  decode() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  clearArtCache();
  created = [];
  outcomes = () => 'ok';
  taint = false;
  pixels = picture(64, 64, (x) => (x < 40 ? RED : [255, 255, 255]));
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: () => {
          if (taint) throw new DOMException('tainted', 'SecurityError');
          return { data: pixels };
        },
      }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('loadArt / analyzeImage / colorsFromImage', () => {
  it('decodes the picture CORS-enabled and analyses its pixels', async () => {
    const art = await loadArt('https://cdn.example/a.jpg');
    expect(art.ok).toBe(true);
    expect(art.cors).toBe(true);
    expect(art.analysis).not.toBeNull();
    expect(art.analysis!.colors.length).toBeGreaterThan(0);
    expect(art.analysis!.peak).toBeGreaterThan(0.5);
    expect(await analyzeImage('https://cdn.example/a.jpg')).toEqual(art.analysis);
    expect(await colorsFromImage('https://cdn.example/a.jpg')).toEqual(art.analysis!.colors);
  });

  it('loads a URL once however many callers ask, and remembers it', async () => {
    const url = 'https://cdn.example/once.jpg';
    const [a, b] = await Promise.all([loadArt(url), analyzeImage(url)]);
    await colorsFromImage(url);
    expect(created).toHaveLength(1);
    expect(b).toEqual(a.analysis);
    expect(cachedArt(url)).toBeDefined();
    expect(cachedArt('https://cdn.example/never.jpg')).toBeUndefined();
  });

  it('is null (not a throw) when the canvas is tainted, but the picture is still fine to show', async () => {
    taint = true;
    const art = await loadArt('https://cdn.example/t.jpg');
    expect(art).toEqual({ ok: true, cors: true, analysis: null });
    expect(await analyzeImage('https://cdn.example/t.jpg')).toBeNull();
    expect(await colorsFromImage('https://cdn.example/t.jpg')).toBeNull();
  });

  it('falls back to a plain load when the server sends no CORS headers: shows fine, pixels unreadable', async () => {
    outcomes = (_url, cors) => (cors ? 'error' : 'ok');
    const art = await loadArt('https://nocors.example/a.jpg');
    expect(art).toEqual({ ok: true, cors: false, analysis: null });
    expect(created.map((i) => i.crossOrigin)).toEqual(['anonymous', undefined]);
  });

  it('reports a picture that cannot be loaded at all, and retries it next time', async () => {
    outcomes = () => 'error';
    const url = 'https://cdn.example/missing.jpg';
    expect(await loadArt(url)).toEqual({ ok: false, cors: false, analysis: null });
    expect(await analyzeImage(url)).toBeNull();
    expect(cachedArt(url)).toBeUndefined();
    outcomes = () => 'ok';
    expect((await loadArt(url)).ok).toBe(true);
  });

  it('keeps only the most recent few pictures', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://cdn.example/${i}.jpg`);
    for (const u of urls) await loadArt(u);
    expect(cachedArt(urls[0]!)).toBeUndefined();
    expect(cachedArt(urls[3]!)).toBeUndefined();
    expect(cachedArt(urls[11]!)).toBeDefined();
    expect(cachedArt(urls[4]!)).toBeDefined();
  });

  it('answers without a browser (no Image / document): not ok, no throw', async () => {
    vi.unstubAllGlobals();
    clearArtCache();
    expect(await loadArt('https://cdn.example/x.jpg')).toEqual({ ok: false, cors: false, analysis: null });
    expect(await analyzeImage('https://cdn.example/x.jpg')).toBeNull();
  });
});


describe('backdropArtUrl', () => {
  it('uses the same-origin proxy for remote artwork only', () => {
    expect(backdropArtUrl('https://i.scdn.co/image/abc?x=1')).toBe('/api/art?url=https%3A%2F%2Fi.scdn.co%2Fimage%2Fabc%3Fx%3D1');
    expect(backdropArtUrl('/api/wallpapers/user:test.jpg')).toBe('/api/wallpapers/user:test.jpg');
    expect(backdropArtUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });
});
