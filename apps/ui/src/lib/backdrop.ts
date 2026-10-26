import { APPEARANCE_RANGES, type Background, type Effects } from '@headunit/shared';
import { shiftHue, type ArtAnalysis } from './art';
import { MAX_DIM, composite, overArtChecker, parseColor, toHex, toRgba, type Color, type Rgba } from './themes/contrast';
import type { Palette } from './themes/types';
import { wallpaperUrl } from './wallpapers';

/**
 * The backdrop as data. planBackdrop() turns the settings, the picture and the palette into every layer to draw and how dark the scrim
 * must be; layers/Backdrop.tsx only renders it. Pure, so the rules that keep text readable are tested rather than eyeballed.
 *
 * Layers, bottom to top:
 *   1. base     the palette's page gradient with a soft accent glow (always)
 *   2. mode     a picture, colour clouds or a generated pattern (one or more elements; crossfades when `key` changes)
 *   3. scrim    the palette's scrim colour; its OPACITY is the dim, so changing it is compositor-only
 *   4. vignette pictures only
 *
 * The dim is max(bgDim, legibility floor). The floor is measured from what is actually behind the text: the picture's own analysis, or,
 * for generated looks, the strongest colour the layer can produce over the page. An unknown picture uses the palette's worst case.
 */

/** Drift animations a layer may carry (motion.css / layers.css). They only run at Full effects. */
export type Drift = 'drift-a' | 'drift-b' | 'drift-c' | 'pan-x' | 'grid-scroll' | 'twinkle' | 'spin-slow' | 'rise';

export interface CssLayer {
  kind: 'css';
  /** CSS background-image (one or more comma-separated layers). */
  image: string;
  size?: string;
  position?: string;
  repeat?: string;
  /** Extra class for shaped layers (the perspective grid floor, the sun). */
  shape?: 'floor' | 'sun' | 'blob' | 'band' | 'rays';
  /** Blob placement, percent of the screen. */
  box?: { x: number; y: number; w: number; h: number };
  opacity?: number;
  drift?: Drift;
  /** Seconds, so blobs drift out of step. */
  period?: number;
  delay?: number;
}

export interface ImageLayer {
  kind: 'image';
  url: string;
  variant: 'blur' | 'cover' | 'wallpaper';
  blur: number;
  cors: boolean;
}

export type Layer = CssLayer | ImageLayer;

export interface ScrimPlan {
  color: string;
  /** 0..1: the scrim element's `opacity`. */
  opacity: number;
  /** Whole percent in force: max(bgDim, floor). */
  dim: number;
  floor: number;
  source: 'none' | 'measured' | 'generated' | 'worst-case';
}

export interface BackdropPlan {
  background: Background;
  effects: Effects;
  /** Changes exactly when the mode layer's content does: Backdrop crossfades then. */
  key: string;
  /** True when a picture mode has no picture and the accent-built stand-in is shown. */
  fallback: boolean;
  base: string;
  layers: Layer[];
  vignette: string | null;
  scrim: ScrimPlan;
  /** Drift animations run (Full effects only). */
  drift: boolean;
}

export interface PlanInput {
  background: Background;
  effects: Effects;
  palette: Palette;
  /** The accent in force (after accentFor) and its gradient partner. */
  accent: string;
  accent2: string;
  /** The art the art modes show, once loaded; null/undefined when nothing plays or it failed. */
  artUrl?: string | null;
  /** What is known about the picture shown (art or wallpaper); null = not known. */
  analysis?: ArtAnalysis | null;
  wallpaper?: string;
  /** False when the wallpaper failed to load (the stand-in is drawn). */
  wallpaperOk?: boolean;
  cors?: boolean;
  bgBlur?: number;
  bgDim?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** `rgba(r, g, b, a)` from a `#rrggbb` (anything unreadable counts as black). */
export function rgbaOf(hex: string, alpha: number): string {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${num(clamp(alpha, 0, 1))})`;
}

/**
 * The smallest dim that holds for every colour in `colors`. Dim only ever helps, so a colour that already passes at the best dim
 * found so far cannot raise it and is skipped without searching.
 */
export function floorOver(palette: Palette, colors: readonly Color[]): number {
  const passes = overArtChecker(palette);
  let floor = 0;
  const seen = new Set<string>();
  for (const c of colors) {
    const key = typeof c === 'string' ? c : `${c.r},${c.g},${c.b},${c.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const art = toRgba(c);
    if (passes(floor, art)) continue;
    let d = floor + 1;
    while (d < MAX_DIM && !passes(d, art)) d++;
    floor = d;
  }
  return floor;
}

/** Below this blur radius (px) the "blurred" picture still shows detail, so the sharp-picture measure applies as well. */
export const SHARP_BLUR_PX = 16;
/** What the blurred layer's saturate() does to the picture. */
export const BLUR_SATURATE = 1.5;

/** CSS saturate(): the filter matrix, so the floor is measured on the colours the blurred layer really shows. */
export function saturated(c: string, s: number): Rgba {
  const p = parseColor(c) ?? { r: 0, g: 0, b: 0, a: 1 };
  const [r, g, b] = [p.r, p.g, p.b];
  const m = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ] as const;
  const ch = (row: readonly [number, number, number]) => clamp(Math.round(row[0] * r + row[1] * g + row[2] * b), 0, 255);
  return { r: ch(m[0]), g: ch(m[1]), b: ch(m[2]), a: 1 };
}

/** The legibility floor for a photograph. Unknown picture: the palette's worst-case minDim (always safe). */
export function photoFloor(palette: Palette, analysis: ArtAnalysis | null | undefined, sharp: boolean, blur: number): { floor: number; source: ScrimPlan['source'] } {
  if (!analysis) return { floor: palette.minDim, source: 'worst-case' };
  const dark = palette.scheme === 'dark';
  const colors: Color[] = [];
  if (!sharp) for (const c of analysis.cells) colors.push(saturated(c, BLUR_SATURATE));
  if (sharp || blur < SHARP_BLUR_PX) {
    const c = dark ? analysis.p95Color : analysis.p05Color;
    colors.push(sharp ? (HEX.test(c) ? c : dark ? '#ffffff' : '#000000') : saturated(c, BLUR_SATURATE));
  }
  return { floor: floorOver(palette, colors), source: 'measured' };
}

/** A colour at `alpha` laid over the page: what one bright spot of a generated layer looks like. */
const over = (palette: Palette, hex: string, alpha: number): Rgba => composite(rgbaOf(hex, alpha), palette.bg);
/** Two translucent colours stacked over the page (where clouds overlap). */
const over2 = (palette: Palette, a: [string, number], b: [string, number]): Rgba => composite(rgbaOf(b[0], b[1]), composite(rgbaOf(a[0], a[1]), palette.bg));

/** The ink a pattern is drawn with: white on dark palettes, the text colour on light ones. */
const inkOf = (p: Palette) => (p.scheme === 'dark' ? '#ffffff' : toHex(p.text));

const svgUri = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/** A star tile (seeded, so it is stable). */
function starTile(color: string, seed: number, n: number, size: number): string {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let body = '';
  for (let i = 0; i < n; i++) {
    const r = rand() < 0.1 ? 1.6 : rand() < 0.45 ? 1.1 : 0.7;
    body += `<circle cx='${(rand() * size).toFixed(1)}' cy='${(rand() * size).toFixed(1)}' r='${r}' fill='${color}' opacity='${(0.35 + rand() * 0.6).toFixed(2)}'/>`;
  }
  return svgUri(body, size, size);
}

/** The base: the palette's page gradient with a soft accent glow in two corners. */
export function baseLayer(p: Palette, accent: string, accent2: string): string {
  return [
    `radial-gradient(70% 60% at 0% 0%, ${rgbaOf(accent, p.glow * 0.85)}, transparent 70%)`,
    `radial-gradient(60% 60% at 100% 100%, ${rgbaOf(accent2, p.glow * 0.55)}, transparent 70%)`,
    `linear-gradient(180deg, ${p.bg2}, ${p.bg})`,
  ].join(', ');
}

/** Colour clouds as separate elements, so each drifts on its own with transforms only. */
function blobs(list: Array<{ color: string; alpha: number; x: number; y: number; w: number; h: number }>, drift: boolean): CssLayer[] {
  const drifts: Drift[] = ['drift-a', 'drift-b', 'drift-c'];
  return list.map((b, i) => ({
    kind: 'css',
    shape: 'blob',
    image: `radial-gradient(closest-side, ${rgbaOf(b.color, b.alpha)}, ${rgbaOf(b.color, b.alpha * 0.45)} 45%, transparent 100%)`,
    box: { x: b.x, y: b.y, w: b.w, h: b.h },
    drift: drift ? drifts[i % drifts.length] : undefined,
    period: 38 + i * 9,
    delay: -i * 7,
  }));
}

interface Generated {
  layers: CssLayer[];
  /** The strongest colours the layers produce over the page: the legibility floor is measured on these. */
  peaks: Color[];
}

/** Every generated look: how it is drawn, and its brightest spots. */
function generated(bg: Background, p: Palette, accent: string, accent2: string, drift: boolean, artColors: string[] = []): Generated {
  const ink = inkOf(p);
  const third = shiftHue(accent, -70);
  const fourth = shiftHue(accent, 150);
  switch (bg) {
    case 'gradient':
      return {
        layers: [{ kind: 'css', image: `linear-gradient(155deg, ${rgbaOf(accent, 0.34)} 0%, ${rgbaOf(accent2, 0.16)} 45%, transparent 75%), radial-gradient(80% 60% at 85% 100%, ${rgbaOf(accent2, 0.24)}, transparent 70%)` }],
        peaks: [over(p, accent, 0.34), over(p, accent2, 0.24)],
      };
    case 'aurora': {
      const list = [
        { color: accent, alpha: 0.46, x: -10, y: -5, w: 75, h: 55 },
        { color: accent2, alpha: 0.4, x: 45, y: -10, w: 70, h: 50 },
        { color: p.ok, alpha: 0.28, x: 25, y: 45, w: 80, h: 55 },
      ];
      return { layers: blobs(list, drift), peaks: [over2(p, [accent, 0.46], [accent2, 0.4]), over2(p, [accent2, 0.4], [p.ok, 0.28])] };
    }
    case 'mesh': {
      const list = [
        { color: accent, alpha: 0.5, x: -15, y: -15, w: 70, h: 70 },
        { color: accent2, alpha: 0.42, x: 55, y: -20, w: 65, h: 70 },
        { color: third, alpha: 0.34, x: 45, y: 45, w: 70, h: 70 },
        { color: fourth, alpha: 0.26, x: -10, y: 50, w: 60, h: 65 },
      ];
      return { layers: blobs(list, drift), peaks: [over2(p, [accent, 0.5], [accent2, 0.42]), over2(p, [third, 0.34], [fourth, 0.26]), over2(p, [accent2, 0.42], [third, 0.34])] };
    }
    case 'art-ambient': {
      const colors = artColors.length ? artColors : [accent, accent2, third];
      const list = colors.slice(0, 3).map((c, i) => ({ color: c, alpha: [0.55, 0.45, 0.38][i]!, x: [-12, 50, 20][i]!, y: [-10, -5, 45][i]!, w: [75, 65, 75][i]!, h: [70, 65, 60][i]! }));
      const peaks: Color[] = list.map((b) => over(p, b.color, b.alpha));
      if (list.length > 1) peaks.push(over2(p, [list[0]!.color, list[0]!.alpha], [list[1]!.color, list[1]!.alpha]));
      return { layers: blobs(list, drift), peaks };
    }
    case 'grid':
      return {
        layers: [
          { kind: 'css', shape: 'band', image: `linear-gradient(to top, ${rgbaOf(accent, 0.32)}, transparent 60%)` },
          {
            kind: 'css',
            shape: 'floor',
            image: `repeating-linear-gradient(90deg, ${rgbaOf(accent, 0.55)} 0 1.5px, transparent 1.5px 64px), repeating-linear-gradient(0deg, ${rgbaOf(accent, 0.55)} 0 1.5px, transparent 1.5px 64px)`,
            drift: drift ? 'grid-scroll' : undefined,
          },
        ],
        peaks: [over(p, accent, 0.32), over(p, accent, 0.3)],
      };
    case 'weave':
      return {
        layers: [{ kind: 'css', image: `repeating-linear-gradient(45deg, ${rgbaOf(ink, 0.05)} 0 2px, transparent 2px 8px), repeating-linear-gradient(-45deg, ${rgbaOf(ink, 0.05)} 0 2px, transparent 2px 8px), radial-gradient(90% 70% at 50% 0%, ${rgbaOf(accent, 0.14)}, transparent 70%)`, size: '16px 16px, 16px 16px, 100% 100%' }],
        peaks: [over2(p, [ink, 0.1], [accent, 0.14])],
      };
    case 'stars': {
      const star = p.scheme === 'dark' ? '#ffffff' : toHex(p.text);
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(80% 60% at 70% 20%, ${rgbaOf(accent, 0.18)}, transparent 70%), radial-gradient(60% 50% at 10% 90%, ${rgbaOf(accent2, 0.14)}, transparent 70%)` },
          { kind: 'css', image: starTile(star, 7, 70, 420), size: '420px 420px', repeat: 'repeat' },
          { kind: 'css', image: starTile(star, 9, 30, 300), size: '300px 300px', repeat: 'repeat', drift: drift ? 'twinkle' : undefined },
        ],
        peaks: [over2(p, [accent, 0.18], [star, 0.25])],
      };
    }
    case 'hex':
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(70% 60% at 50% 40%, ${rgbaOf(accent, 0.16)}, transparent 75%)` },
          {
            kind: 'css',
            image: svgUri(`<path d='M28 0 L56 16 L56 48 L28 64 L0 48 L0 16 Z M28 64 L28 97' fill='none' stroke='${rgbaOf(accent, 0.26)}' stroke-width='1.3'/>`, 56, 97),
            size: '56px 97px',
            repeat: 'repeat',
          },
        ],
        peaks: [over2(p, [accent, 0.16], [accent, 0.18])],
      };
    case 'topo': {
      let body = '';
      for (let i = 0; i < 7; i++) {
        const r = 30 + i * 34;
        body += `<path d='M${300 - r} 300 C${300 - r} ${300 - r * 1.1} ${300 + r * 0.9} ${300 - r} ${300 + r} ${300 - r * 0.15} S${300 + r * 0.2} ${300 + r * 1.1} ${300 - r} 300 Z' fill='none' stroke='${rgbaOf(accent, 0.24 - i * 0.015)}' stroke-width='1.4'/>`;
      }
      return {
        layers: [{ kind: 'css', image: `${svgUri(body, 600, 600)}, radial-gradient(70% 60% at 30% 30%, ${rgbaOf(accent2, 0.12)}, transparent 70%)`, size: '600px 600px, 100% 100%', repeat: 'repeat, no-repeat' }],
        peaks: [over2(p, [accent2, 0.12], [accent, 0.2])],
      };
    }
    case 'circuit': {
      const s = rgbaOf(accent, 0.3);
      const f = rgbaOf(accent, 0.45);
      const body =
        `<g fill='none' stroke='${s}' stroke-width='1.5'><path d='M0 40 H60 L80 60 H160'/><path d='M40 0 V30 L60 50 V120 L80 140 H200'/><path d='M120 0 V40 L140 60 V100'/><path d='M0 160 H40 L60 180 V200'/><path d='M100 200 V170 L120 150 H160 L180 130 V60'/></g>` +
        `<g fill='${f}'><circle cx='160' cy='60' r='4'/><circle cx='60' cy='120' r='4'/><circle cx='140' cy='100' r='4'/><circle cx='180' cy='60' r='3'/><circle cx='40' cy='160' r='3'/><rect x='92' y='92' width='16' height='16' rx='2'/></g>`;
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(70% 60% at 60% 40%, ${rgbaOf(accent, 0.14)}, transparent 75%)` },
          { kind: 'css', image: svgUri(body, 200, 200), size: '200px 200px', repeat: 'repeat' },
        ],
        peaks: [over2(p, [accent, 0.14], [accent, 0.3])],
      };
    }
    case 'dots':
      return {
        layers: [{ kind: 'css', image: `radial-gradient(circle, ${rgbaOf(accent, 0.38)} 1.7px, transparent 2.2px), linear-gradient(180deg, ${rgbaOf(accent2, 0.1)}, transparent 60%)`, size: '22px 22px, 100% 100%', repeat: 'repeat, no-repeat' }],
        peaks: [over2(p, [accent2, 0.1], [accent, 0.2])],
      };
    case 'waves': {
      const w = (y: number, amp: number, len: number, color: string, a: number) => {
        let d = `M0 300 L0 ${y}`;
        for (let x = 0; x < 800; x += len) d += ` Q${x + len / 4} ${y - amp} ${x + len / 2} ${y} T${x + len} ${y}`;
        return `<path d='${d} L800 300 Z' fill='${rgbaOf(color, a)}'/>`;
      };
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(80% 60% at 50% 0%, ${rgbaOf(accent2, 0.16)}, transparent 70%)` },
          { kind: 'css', shape: 'band', image: svgUri(w(120, 30, 200, accent2, 0.16) + w(170, 24, 160, accent, 0.2) + w(220, 18, 266.67, accent, 0.26), 800, 300), size: '800px 100%', repeat: 'repeat-x', position: 'bottom left', drift: drift ? 'pan-x' : undefined },
        ],
        peaks: [over2(p, [accent2, 0.16], [accent, 0.26]), over2(p, [accent, 0.2], [accent, 0.26])],
      };
    }
    case 'synthsun':
      return {
        layers: [
          { kind: 'css', image: `linear-gradient(180deg, transparent 30%, ${rgbaOf(accent2, 0.22)} 58%, transparent 62%), radial-gradient(70% 50% at 50% 60%, ${rgbaOf(accent, 0.2)}, transparent 70%)` },
          { kind: 'css', shape: 'sun', image: `linear-gradient(180deg, ${rgbaOf(accent2, 0.62)}, ${rgbaOf(accent, 0.62)})`, drift: drift ? 'rise' : undefined },
          {
            kind: 'css',
            shape: 'floor',
            image: `repeating-linear-gradient(90deg, ${rgbaOf(accent, 0.5)} 0 1.5px, transparent 1.5px 64px), repeating-linear-gradient(0deg, ${rgbaOf(accent, 0.5)} 0 1.5px, transparent 1.5px 64px)`,
            drift: drift ? 'grid-scroll' : undefined,
          },
        ],
        peaks: [over(p, accent2, 0.62), over(p, accent, 0.62), over2(p, [accent2, 0.22], [accent, 0.3])],
      };
    case 'bokeh': {
      const colors = [accent, accent2, third, p.warn, accent, fourth];
      const list = colors.map((c, i) => ({ color: c, alpha: 0.34, x: [5, 62, 30, 78, 45, 12][i]!, y: [10, 6, 52, 58, 24, 66][i]!, w: [22, 16, 28, 18, 12, 20][i]!, h: [22, 16, 28, 18, 12, 20][i]! }));
      return { layers: blobs(list, drift).map((l) => ({ ...l, image: l.image.replace('45%', '60%') })), peaks: [over2(p, [accent, 0.34], [accent2, 0.34])] };
    }
    case 'scanlines':
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(80% 60% at 50% 0%, ${rgbaOf(accent, 0.16)}, transparent 70%), radial-gradient(ellipse at center, transparent 60%, ${rgbaOf(p.scrim, 0.5)})` },
          { kind: 'css', image: `repeating-linear-gradient(0deg, ${rgbaOf(ink, 0.05)} 0 1px, transparent 1px 3px)`, size: '100% 3px', repeat: 'repeat' },
        ],
        peaks: [over2(p, [accent, 0.16], [ink, 0.05])],
      };
    case 'halftone': {
      // Comic-book dots that shrink from the top-left corner to nothing: one stretched SVG, drawn once.
      const ink2 = p.scheme === 'dark' ? accent : toHex(p.text);
      let body = '';
      for (let y = 9; y < 450; y += 18)
        for (let x = 9; x < 800; x += 18) {
          const t = 1 - Math.min(1, (x / 800) * 0.7 + (y / 450) * 0.6);
          if (t > 0.04) body += `<circle cx='${x}' cy='${y}' r='${(t * 8.5).toFixed(1)}'/>`;
        }
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(90% 70% at 100% 100%, ${rgbaOf(accent2, 0.16)}, transparent 70%)` },
          { kind: 'css', image: svgUri(`<g fill='${rgbaOf(ink2, 0.24)}'>${body}</g>`, 800, 450), size: 'cover', position: 'top left' },
        ],
        peaks: [over2(p, [accent2, 0.16], [ink2, 0.24])],
      };
    }
    case 'lowpoly': {
      // Faceted triangles: a jittered grid split into two triangles a cell, each a mix of the two accents with its own strength.
      let a = 7;
      const rand = () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        return a / 0x7fffffff;
      };
      const cols = 10;
      const rows = 6;
      const pts: Array<Array<[number, number]>> = [];
      for (let r = 0; r <= rows; r++) {
        pts.push([]);
        for (let c = 0; c <= cols; c++) {
          const edgeX = c === 0 || c === cols;
          const edgeY = r === 0 || r === rows;
          pts[r]!.push([c * 80 + (edgeX ? 0 : (rand() - 0.5) * 50), r * 75 + (edgeY ? 0 : (rand() - 0.5) * 46)]);
        }
      }
      let body = '';
      const tri = (q: Array<[number, number]>, t: number, alpha: number) => {
        const colour = t < 0.5 ? accent : accent2;
        body += `<path d='M${q.map(([x, y]) => `${x.toFixed(0)} ${y.toFixed(0)}`).join(' L')} Z' fill='${rgbaOf(colour, alpha)}' stroke='${rgbaOf(colour, alpha)}' stroke-width='0.6'/>`;
      };
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const [p00, p01, p10, p11] = [pts[r]![c]!, pts[r]![c + 1]!, pts[r + 1]![c]!, pts[r + 1]![c + 1]!];
          const t = (c + r * 0.6) / (cols + rows * 0.6);
          const fade = 0.06 + (1 - r / rows) * 0.12;
          tri([p00, p01, p10], t + (rand() - 0.5) * 0.3, fade + rand() * 0.12);
          tri([p01, p11, p10], t + (rand() - 0.5) * 0.3, fade + rand() * 0.12);
        }
      return {
        layers: [{ kind: 'css', image: svgUri(body, 800, 450), size: 'cover', position: 'center' }],
        peaks: [over(p, accent, 0.32), over(p, accent2, 0.32)],
      };
    }
    case 'rays':
      return {
        layers: [
          { kind: 'css', image: `radial-gradient(70% 55% at 50% 100%, ${rgbaOf(accent, 0.3)}, transparent 70%)` },
          {
            kind: 'css',
            shape: 'rays',
            image: `repeating-conic-gradient(from 0deg, ${rgbaOf(accent2, 0.13)} 0deg 5deg, transparent 5deg 13deg), radial-gradient(closest-side, transparent 6%, ${rgbaOf(p.bg, 0.9)} 100%)`,
            drift: drift ? 'spin-slow' : undefined,
          },
        ],
        peaks: [over2(p, [accent, 0.3], [accent2, 0.13])],
      };
    case 'plasma': {
      const list = [
        { color: accent, alpha: 0.52, x: -20, y: 10, w: 70, h: 80 },
        { color: third, alpha: 0.42, x: 30, y: -30, w: 70, h: 75 },
        { color: accent2, alpha: 0.48, x: 55, y: 35, w: 65, h: 75 },
        { color: fourth, alpha: 0.36, x: 10, y: 55, w: 55, h: 60 },
        { color: accent, alpha: 0.3, x: 70, y: -15, w: 45, h: 50 },
      ];
      return { layers: blobs(list, drift), peaks: [over2(p, [accent, 0.52], [third, 0.42]), over2(p, [accent2, 0.48], [fourth, 0.36]), over2(p, [third, 0.42], [accent2, 0.48])] };
    }
    default:
      return { layers: [], peaks: [] };
  }
}

const PICTURE_MODES: ReadonlySet<Background> = new Set<Background>(['art-blur', 'art-cover', 'wallpaper']);

/** Turn the inputs into everything Backdrop draws. Total: anything unexpected degrades to a safe look, never a throw. */
export function planBackdrop(input: PlanInput): BackdropPlan {
  const { palette: p, accent, accent2 } = input;
  const effects = input.effects;
  const drift = effects === 'full';
  const bgBlur = clamp(finite(input.bgBlur, 28), APPEARANCE_RANGES.bgBlur.min, APPEARANCE_RANGES.bgBlur.max);
  const bgDim = clamp(finite(input.bgDim, 45), APPEARANCE_RANGES.bgDim.min, APPEARANCE_RANGES.bgDim.max);
  const base = baseLayer(p, accent, accent2);
  const baseGlowPeak = over(p, accent, p.glow * 0.85);
  const scrimFor = (floor: number, source: ScrimPlan['source'], useDim = true): ScrimPlan => {
    const dim = clamp(Math.max(useDim ? bgDim : 0, floor), 0, MAX_DIM);
    return { color: p.scrim, opacity: dim / 100, dim, floor, source };
  };

  let background = input.background;
  // A picture mode without its picture: the accent-built stand-in (colour clouds), so the screen is never blank.
  let fallback = false;
  if ((background === 'art-blur' || background === 'art-cover' || background === 'art-ambient') && !input.artUrl && background !== 'art-ambient') fallback = true;
  if (background === 'wallpaper' && (input.wallpaperOk === false || !wallpaperUrl(input.wallpaper))) fallback = true;

  if (background === 'none') {
    const floor = floorOver(p, [baseGlowPeak]);
    return { background, effects, key: 'none', fallback: false, base, layers: [], vignette: null, scrim: scrimFor(floor, floor > 0 ? 'generated' : 'none', false), drift };
  }

  if (fallback || (background === 'art-blur' && effects === 'minimal')) {
    // art-blur at Minimal draws no blur filter: its colours become still clouds instead.
    const g = generated('art-ambient', p, accent, accent2, drift && !fallback, input.analysis?.colors ?? []);
    const floor = floorOver(p, [baseGlowPeak, ...g.peaks]);
    return { background, effects, key: fallback ? `fallback:${accent}` : `glow:${input.artUrl}`, fallback, base, layers: g.layers, vignette: null, scrim: scrimFor(floor, 'generated'), drift };
  }

  if (PICTURE_MODES.has(background)) {
    const url = background === 'wallpaper' ? wallpaperUrl(input.wallpaper)! : input.artUrl!;
    const variant = background === 'art-blur' ? 'blur' : background === 'art-cover' ? 'cover' : 'wallpaper';
    const sharp = variant !== 'blur';
    const { floor, source } = photoFloor(p, input.analysis, sharp, bgBlur);
    const vignette = `radial-gradient(ellipse at center, transparent 55%, ${rgbaOf(p.scrim, 0.55)})`;
    const coverFade = variant === 'cover' ? `linear-gradient(90deg, ${p.bg} 0%, ${rgbaOf(p.bg, 0.85)} 30%, ${rgbaOf(p.bg, 0)} 70%)` : null;
    return {
      background,
      effects,
      key: `${variant}:${url}`,
      fallback: false,
      base,
      layers: [{ kind: 'image', url, variant, blur: variant === 'blur' ? bgBlur : 0, cors: input.cors === true }, ...(coverFade ? [{ kind: 'css', image: coverFade } as CssLayer] : [])],
      vignette,
      scrim: scrimFor(floor, source),
      drift,
    };
  }

  const g = generated(background, p, accent, accent2, drift, background === 'art-ambient' ? (input.analysis?.colors ?? []) : []);
  const floor = floorOver(p, [baseGlowPeak, ...g.peaks]);
  return {
    background,
    effects,
    key: background === 'art-ambient' ? `ambient:${input.artUrl ?? 'none'}:${(input.analysis?.colors ?? []).join(',')}` : `${background}:${accent}:${p.id}`,
    fallback: false,
    base,
    layers: g.layers,
    vignette: null,
    scrim: scrimFor(floor, 'generated'),
    drift,
  };
}
