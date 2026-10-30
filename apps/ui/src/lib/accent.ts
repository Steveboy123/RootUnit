/**
 * Pick one vivid colour that represents a picture, for tinting the interface with album art.
 *
 * Pixels are bucketed by hue; each bucket scores by how many pixels it has weighted by saturation
 * (greys and near-black/white are ignored — they'd give a dull accent). The winner is returned
 * brightened if needed so it stays readable on the dark themes.
 */
export function dominantColor(rgba: ArrayLike<number>): string | null {
  const BUCKETS = 24;
  const score = new Array<number>(BUCKETS).fill(0);
  const sum = Array.from({ length: BUCKETS }, () => [0, 0, 0, 0]); // r,g,b,count

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 255) < 200) continue; // transparent
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.12 || l < 0.12 || l > 0.9) continue; // grey, black or white
    const sat = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const k = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    score[k]! += sat * (1 - Math.abs(l - 0.5)); // prefer saturated, mid-tone pixels
    const s = sum[k]!;
    s[0]! += rgba[i]!;
    s[1]! += rgba[i + 1]!;
    s[2]! += rgba[i + 2]!;
    s[3]!++;
  }

  let best = -1;
  for (let k = 0; k < BUCKETS; k++) if (score[k]! > 0 && (best < 0 || score[k]! > score[best]!)) best = k;
  if (best < 0) return null;
  const s = sum[best]!;
  return ensureReadable([s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!]);
}

/** Lift dark colours so the accent stays visible on a dark background (relative luminance ≥ ~0.18). */
export function ensureReadable([r, g, b]: [number, number, number]): string {
  const lum = (c: [number, number, number]) => {
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  let c: [number, number, number] = [r, g, b];
  for (let i = 0; i < 12 && lum(c) < 0.18; i++) c = c.map((v) => v + (255 - v) * 0.15) as [number, number, number];
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Load an image and compute its accent. Resolves null if the pixels can't be read (e.g. no CORS). */
export function accentFromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 48; // a tiny copy is plenty
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(dominantColor(ctx.getImageData(0, 0, size, size).data));
      } catch {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
