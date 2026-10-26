import { luminance } from './themes/contrast';

/**
 * Reading a picture for the backdrop: a few vivid colours (ambient blobs, the stand-in gradient) and how bright it is where text
 * will sit (the adaptive legibility floor, see backdrop.ts). Everything here fails soft: bad input gives an empty answer, a picture
 * the browser will not let us read gives null, nothing throws. The pure parts take raw RGBA bytes so they are unit-tested without a DOM.
 */

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const HUE_BUCKETS = 36; // 10 degrees each
const MIN_HUE_GAP = 30;

/** Hue (0..360), saturation and lightness (0..1) of a colour given as 0..255 channels. */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
const toHex = ([r, g, b]: [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Hue (0..360) of a `#rrggbb` colour; 0 for anything else. */
export function hueOf(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? toHsl(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16))[0] : 0;
}

/** The same colour with its hue turned by `degrees` (saturation and lightness kept); `#rrggbb` in, `#rrggbb` out. Anything else comes back unchanged. */
export function shiftHue(hex: string, degrees: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || !Number.isFinite(degrees)) return hex;
  const [h, sat, l] = toHsl(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16));
  return toHex(fromHsl((((h + degrees) % 360) + 360) % 360, sat, l));
}

/** Make a picture's colour usable as a glow: vivid enough to read as a colour, neither near-black nor washed out. Hue is kept. */
function vivid([r, g, b]: [number, number, number]): [number, number, number] {
  const [h, s, l] = toHsl(r, g, b);
  return fromHsl(h, Math.min(1, Math.max(0.5, s)), Math.min(0.64, Math.max(0.4, l)));
}

// ---------------------------------------------------------------------------
// Dominant colours
// ---------------------------------------------------------------------------

/**
 * Up to `n` distinct vivid colours (`#rrggbb`) that represent a picture, most dominant first.
 *
 * Same idea as accent.ts's dominantColor: pixels are bucketed by hue and a bucket scores by how many saturated, mid-tone pixels it
 * holds (greys, near-black and near-white are ignored). Then colours are picked greedily from the best bucket down, skipping any
 * hue closer than 30 degrees to one already chosen, so the result is a set of genuinely different colours rather than three
 * shades of one. Buckets that hold almost nothing next to the winner (stray pixels) are never used.
 *
 * Fewer than `n` come back when the picture does not have that many distinct colours, and [] for a picture with no colour at all
 * (greys, black, white, transparent), an empty buffer, or input that is not pixels. Never throws.
 * Each colour is nudged to saturation >= 0.5 and lightness 0.4..0.64 so it still reads as a colour when used as a soft glow.
 */
export function dominantColors(rgba: ArrayLike<number>, n = 3): string[] {
  try {
    const want = Math.min(8, Math.floor(Number.isFinite(n) ? n : 3));
    if (want <= 0 || !rgba || !(rgba.length >= 4)) return [];

    const score = new Float64Array(HUE_BUCKETS);
    const sum = new Float64Array(HUE_BUCKETS * 3); // weighted r,g,b
    for (let i = 0; i + 3 < rgba.length; i += 4) {
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      if (!(rgba[i + 3]! >= 200) || !(r >= 0) || !(g >= 0) || !(b >= 0)) continue; // transparent or garbage (NaN fails every comparison)
      const [h, s, l] = toHsl(r, g, b);
      const d = Math.max(r, g, b) / 255 - Math.min(r, g, b) / 255;
      if (d < 0.12 || l < 0.12 || l > 0.9) continue; // grey, black or white
      const k = Math.min(HUE_BUCKETS - 1, Math.floor((h / 360) * HUE_BUCKETS));
      const w = s * (1 - Math.abs(l - 0.5)); // prefer saturated, mid-tone pixels
      score[k]! += w;
      sum[k * 3]! += r * w;
      sum[k * 3 + 1]! += g * w;
      sum[k * 3 + 2]! += b * w;
    }

    // Smooth over the neighbouring buckets so a hue that straddles a bucket edge is not split into two weak candidates.
    const at = (k: number) => (k + HUE_BUCKETS) % HUE_BUCKETS;
    const smooth = Array.from({ length: HUE_BUCKETS }, (_, k) => score[k]! + 0.5 * (score[at(k - 1)]! + score[at(k + 1)]!));
    const order = smooth.map((v, k) => [v, k] as const).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]);
    if (order.length === 0) return [];
    const best = order[0]![0];

    const picked: Array<{ hue: number; hex: string }> = [];
    for (const [value, k] of order) {
      if (picked.length >= want || value < best * 0.12) break;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (const j of [at(k - 1), k, at(k + 1)]) {
        r += sum[j * 3]!;
        g += sum[j * 3 + 1]!;
        b += sum[j * 3 + 2]!;
        w += score[j]!;
      }
      if (w <= 0) continue;
      const rgb = vivid([r / w, g / w, b / w]);
      const hue = toHsl(...rgb)[0];
      if (picked.some((p) => hueGap(p.hue, hue) < MIN_HUE_GAP)) continue;
      picked.push({ hue, hex: toHex(rgb) });
    }
    return picked.map((p) => p.hex);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Brightness
// ---------------------------------------------------------------------------

/** What the backdrop needs to know about a picture. Luminances are WCAG relative luminance, 0 (black) .. 1 (white). */
export interface ArtAnalysis {
  /** Up to three distinct vivid colours, most dominant first (may be empty for a grey picture). */
  colors: string[];
  /** The brightest cell of an 8x8 grid of local averages: what a heavily blurred copy shows behind text. */
  peak: number;
  /** 95th-percentile pixel luminance: how bright the sharp picture is, ignoring the odd highlight. */
  p95: number;
  /** The same two measures from the dark end (darkest cell, 5th percentile): the worst case behind dark text on a light palette. */
  low: number;
  p05: number;
  /** The 64 cell averages of the 8x8 grid, row by row (`#rrggbb`; an empty cell, one with no opaque pixel, repeats the picture's mean). */
  cells: string[];
  /** The colour of the pixel at the 95th / 5th percentile of luminance: contrast over a colour is not the same as over a grey of equal luminance. */
  p95Color: string;
  p05Color: string;
}

const GRID = 8;

const LINEAR = new Float64Array(256).map((_, v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});

const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/**
 * Analyse raw RGBA bytes of a `width` x `height` picture. Transparent pixels (alpha < 128) are left out of every measure.
 * Null when there is nothing to measure (no opaque pixel, or width/height/buffer that do not fit together). Never throws.
 */
export function analyzePixels(rgba: ArrayLike<number>, width: number, height: number, n = 3): ArtAnalysis | null {
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !rgba || rgba.length < width * height * 4) return null;
    const cell = new Float64Array(GRID * GRID * 4); // r, g, b sums and count
    const lums = new Float32Array(width * height);
    const rgb = new Uint8Array(width * height * 3);
    let count = 0;
    let mr = 0;
    let mg = 0;
    let mb = 0;
    for (let y = 0; y < height; y++) {
      const row = Math.min(GRID - 1, Math.floor((y * GRID) / height)) * GRID;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        if (!(rgba[i + 3]! >= 128) || !(r >= 0) || !(g >= 0) || !(b >= 0)) continue;
        const c = (row + Math.min(GRID - 1, Math.floor((x * GRID) / width))) * 4;
        cell[c]! += r;
        cell[c + 1]! += g;
        cell[c + 2]! += b;
        cell[c + 3]!++;
        const R = byte(r);
        const G = byte(g);
        const B = byte(b);
        rgb[count * 3] = R;
        rgb[count * 3 + 1] = G;
        rgb[count * 3 + 2] = B;
        lums[count] = 0.2126 * LINEAR[R]! + 0.7152 * LINEAR[G]! + 0.0722 * LINEAR[B]!;
        mr += R;
        mg += G;
        mb += B;
        count++;
      }
    }
    if (count === 0) return null;

    const mean: [number, number, number] = [mr / count, mg / count, mb / count];
    let peak = 0;
    let low = 1;
    const cells: string[] = [];
    for (let c = 0; c < GRID * GRID; c++) {
      const k = cell[c * 4 + 3]!;
      if (k === 0) {
        cells.push(toHex(mean));
        continue;
      }
      const avg: [number, number, number] = [cell[c * 4]! / k, cell[c * 4 + 1]! / k, cell[c * 4 + 2]! / k];
      const l = luminance({ r: avg[0], g: avg[1], b: avg[2], a: 1 });
      peak = Math.max(peak, l);
      low = Math.min(low, l);
      cells.push(toHex(avg));
    }

    const order = Uint32Array.from({ length: count }, (_, i) => i).sort((a, b) => lums[a]! - lums[b]!);
    const at = (q: number) => {
      const i = order[Math.min(count - 1, Math.max(0, q))]!;
      return { lum: lums[i]!, hex: toHex([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!]) };
    };
    const hi = at(Math.ceil(count * 0.95) - 1);
    const lo = at(Math.floor(count * 0.05));
    return { colors: dominantColors(rgba, n), peak, p95: hi.lum, low, p05: lo.lum, cells, p95Color: hi.hex, p05Color: lo.hex };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** What loading a picture gave: whether it can be shown, whether it was fetched CORS-enabled (so the <img> should be too), what it is like. */
export interface LoadedArt {
  /** The browser decoded it: safe to show. */
  ok: boolean;
  /** It was loaded with `crossOrigin="anonymous"`; show it the same way so the browser reuses the decoded copy. */
  cors: boolean;
  /** Null when the pixels could not be read (cross-origin without CORS headers, a canvas that refused) or the load failed. */
  analysis: ArtAnalysis | null;
}

const FAILED: LoadedArt = { ok: false, cors: false, analysis: null };

/**
 * Chromium on the Pi can display remote cover art while still refusing canvas pixel reads because of CORS.
 * The backdrop needs those pixels for dominant colours/brightness, so remote HTTP(S) artwork is read through
 * the head-unit server's same-origin image proxy. Data/local/wallpaper URLs stay untouched.
 */
export function backdropArtUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/art?url=${encodeURIComponent(url)}` : url;
}
const SAMPLE = 64;
const LOAD_TIMEOUT_MS = 12_000;
const CACHE_MAX = 8;

const loaded = new Map<string, LoadedArt>(); // insertion order = recency (a small LRU)
const loading = new Map<string, Promise<LoadedArt>>();

function remember(url: string, art: LoadedArt) {
  loaded.delete(url);
  loaded.set(url, art);
  while (loaded.size > CACHE_MAX) loaded.delete(loaded.keys().next().value as string);
}

/** Decode `url` into an <img>; null when it fails or hangs. */
function decodeImage(url: string, cors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    let done = false;
    const img = new Image();
    const finish = (value: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!value) img.src = ''; // stop a hung download
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onerror = () => finish(null);
    img.onload = () => {
      // decode() makes the first paint cheap; browsers without it (or an SVG that refuses) are fine with the loaded image as is.
      if (typeof img.decode === 'function') img.decode().then(() => finish(img), () => finish(img));
      else finish(img);
    };
    img.src = url;
  });
}

function read(img: HTMLImageElement): ArtAnalysis | null {
  try {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    // SVGs without a width/height report 0: sample them as a square.
    const w = nw > 0 && nh > 0 ? (nw >= nh ? SAMPLE : Math.max(8, Math.round((SAMPLE * nw) / nh))) : SAMPLE;
    const h = nw > 0 && nh > 0 ? (nh >= nw ? SAMPLE : Math.max(8, Math.round((SAMPLE * nh) / nw))) : SAMPLE;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null; // a tainted canvas throws on getImageData
  }
}

async function load(url: string): Promise<LoadedArt> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return FAILED;
  try {
    const withCors = await decodeImage(url, true);
    if (withCors) return { ok: true, cors: true, analysis: read(withCors) };
    // The server may not send CORS headers: the picture still shows fine, we just cannot read its pixels.
    const plain = await decodeImage(url, false);
    return plain ? { ok: true, cors: false, analysis: null } : FAILED;
  } catch {
    return FAILED;
  }
}

/** A picture that was loaded earlier, if it is still in the small cache (so going back to a track paints at once). */
export function cachedArt(url: string): LoadedArt | undefined {
  const hit = loaded.get(url);
  if (hit) remember(url, hit); // refresh recency
  return hit;
}

/**
 * Load and read a picture once: decode it (CORS-enabled first, plain as a fallback), and analyse the pixels when the browser lets us.
 * Successful loads are cached per URL (a small LRU) and concurrent callers share one load; a failed load is not cached, so it can be retried.
 */
export function loadArt(url: string): Promise<LoadedArt> {
  const hit = cachedArt(url);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(url);
  if (pending) return pending;
  const p = load(url).then((art) => {
    loading.delete(url);
    if (art.ok) remember(url, art);
    return art;
  });
  loading.set(url, p);
  return p;
}

/** The analysis of a picture: colours plus peak and p95 luminance. Null when it could not be loaded or read (tainted, failed). */
export async function analyzeImage(url: string): Promise<ArtAnalysis | null> {
  return (await loadArt(url)).analysis;
}

/** Just the distinct vivid colours of a picture (tiny canvas copy); null when the pixels could not be read. */
export async function colorsFromImage(url: string): Promise<string[] | null> {
  return (await analyzeImage(url))?.colors ?? null;
}

/** Test hook: forget everything cached. */
export function clearArtCache() {
  loaded.clear();
  loading.clear();
}
