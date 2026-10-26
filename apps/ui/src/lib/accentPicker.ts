import { accentFor, contrastRatio, type Palette } from './themes';

/**
 * The custom accent: two knobs, hue and lightness, at a fixed vivid saturation. Every colour goes through accentFor, so one that would
 * be under 3:1 against the palette's background is lightened or darkened just enough: what is stored and drawn is always readable.
 */
export const ACCENT_SATURATION = 85;
export const ACCENT_LIGHTNESS = { min: 20, max: 85 } as const;
export const ACCENT_HUE = { min: 0, max: 359 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** h 0..360, s and l 0..100 -> `#rrggbb` (lowercase, as the settings validator stores it). */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    return ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[f(0), f(8), f(4)]
    .map((v) =>
      Math.round(clamp(v, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** `#rrggbb` -> { h 0..360, s 0..100, l 0..100 } (whole numbers). Anything unparseable reads as a neutral cyan. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return { h: 190, s: ACCENT_SATURATION, l: 60 };
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export interface PickedAccent {
  /** What the sliders asked for. */
  requested: string;
  /** What is stored and drawn: the request, nudged only as far as needed to reach 3:1 on the palette's background. */
  accent: string;
  onAccent: string;
  /** True when the nudge changed the colour. */
  adjusted: boolean;
  /** Contrast of `accent` on the palette's background. Always >= 3. */
  ratio: number;
}

/** The colour for a hue and lightness on this palette, never below 3:1 against its background. */
export function pickAccent(palette: Pick<Palette, 'bg' | 'scheme' | 'accentDefault' | 'onAccentMode'>, hue: number, lightness: number): PickedAccent {
  const requested = hslToHex(clamp(Math.round(hue), ACCENT_HUE.min, ACCENT_HUE.max), ACCENT_SATURATION, clamp(Math.round(lightness), ACCENT_LIGHTNESS.min, ACCENT_LIGHTNESS.max));
  const { accent, onAccent } = accentFor(palette, requested);
  return { requested, accent, onAccent, adjusted: accent !== requested, ratio: contrastRatio(accent, palette.bg) };
}

/** `4.6:1` */
export const ratioText = (ratio: number): string => `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
