import { APPEARANCE_RANGES, type ThemeId } from '@headunit/shared';
import { hexToRgb } from '../color';
import type { OnAccentMode, Palette, Scheme } from './types';

/**
 * WCAG contrast maths for the theme engine (spec §5). Pure functions, no DOM.
 *
 * Colours are `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` strings, or already-parsed Rgba objects. Translucent colours must be
 * composited over what is behind them (composite) before they are measured: luminance and contrast ignore alpha.
 */

export interface Rgba {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}
export type Color = string | Rgba;

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const FN = /^rgba?\(([^()]*)\)$/i;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function channel(part: string): number | null {
  const pct = part.endsWith('%');
  const n = Number(pct ? part.slice(0, -1) : part);
  if (part === '' || !Number.isFinite(n)) return null;
  return clamp(pct ? (n / 100) * 255 : n, 0, 255);
}

function alphaOf(part: string): number | null {
  const pct = part.endsWith('%');
  const n = Number(pct ? part.slice(0, -1) : part);
  if (part === '' || !Number.isFinite(n)) return null;
  return clamp(pct ? n / 100 : n, 0, 1);
}

/** Parse `#rgb`, `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` (commas or spaces, alpha 0..1 or %). Null when it is anything else. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  if (HEX6.test(s)) {
    const [r, g, b] = hexToRgb(s);
    return { r, g, b, a: 1 };
  }
  const short = HEX3.exec(s);
  if (short) return { r: parseInt(short[1]! + short[1]!, 16), g: parseInt(short[2]! + short[2]!, 16), b: parseInt(short[3]! + short[3]!, 16), a: 1 };
  const fn = FN.exec(s);
  if (!fn) return null;
  const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const rgb = parts.slice(0, 3).map(channel);
  const a = parts.length === 4 ? alphaOf(parts[3]!) : 1;
  if (rgb.some((v) => v === null) || a === null) return null;
  return { r: rgb[0]!, g: rgb[1]!, b: rgb[2]!, a };
}

/** Like parseColor but for values that must be valid (palette tokens): throws with the offending text. */
export function toRgba(c: Color): Rgba {
  if (typeof c !== 'string') return c;
  const p = parseColor(c);
  if (!p) throw new Error(`Unparseable colour: ${JSON.stringify(c)}`);
  return p;
}

/** `#rrggbb` (channels rounded and clamped; alpha dropped). */
export function toHex(c: Color): string {
  const { r, g, b } = toRgba(c);
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** `fg` laid over `bg` (the normal "over" operator). Channels come back rounded like a browser's 8-bit compositor. */
export function composite(fg: Color, bg: Color): Rgba {
  const f = toRgba(fg);
  const b = toRgba(bg);
  const a = f.a + b.a * (1 - f.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (fc: number, bc: number) => Math.round((fc * f.a + bc * b.a * (1 - f.a)) / a);
  return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a };
}

/** WCAG 2 relative luminance, 0 (black) .. 1 (white). */
export function luminance(c: Color): number {
  const { r, g, b } = toRgba(c);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, 1 .. 21. Order does not matter. */
export function contrastRatio(a: Color, b: Color): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export interface Thresholds {
  /** Primary text on bg and on cards. */
  text: number;
  /** Secondary text on cards and bg. */
  dim: number;
  /** Primary text over art / glass at the minimum dim. */
  textOverArt: number;
  /** Secondary text over art / glass at the minimum dim. */
  dimOverArt: number;
  /** Accent (and accentDefault) against bg. */
  accent: number;
  /** Text drawn on top of the accent. */
  onAccent: number;
  /** ok / warn / danger against bg. */
  status: number;
}

/** The two accessibility palettes are held to AAA (7:1) for text; everything else to AA (4.5:1). */
const STRICT: ReadonlySet<ThemeId> = new Set<ThemeId>(['contrast', 'sunlit']);

export function thresholdsFor(palette: Pick<Palette, 'id'>): Thresholds {
  const strict = STRICT.has(palette.id);
  return {
    text: strict ? 7 : 4.5,
    dim: strict ? 7 : 4.5,
    textOverArt: strict ? 7 : 4.5,
    // Secondary labels over a picture are held to 3:1 (spec §5 sets 4.5 for dim text on cards; over the worst-case picture that bar
    // would need ~85–90 % dimming and leave nothing of the art, and Daylight's legacy dim colour could not reach it at any allowed dim).
    dimOverArt: strict ? 7 : 3,
    accent: 3,
    onAccent: 4.5,
    status: 3,
  };
}

/** Ink colours tried first on top of an accent; pure black / white are the fallback that always reaches 4.5:1. */
export const INK_DARK = '#06121a';
export const INK_LIGHT = '#ffffff';

/** The picture that makes text hardest to read: pure white behind light text, pure black behind dark text. */
export function worstCaseArt(scheme: Scheme): string {
  return scheme === 'dark' ? '#ffffff' : '#000000';
}

type DimInput = Pick<Palette, 'id' | 'scheme' | 'text' | 'dim' | 'scrim' | 'glassFill' | 'card' | 'cardHi'>;

/** The backdrop the UI sits on when the picture is `art` and the scrim is laid over it at `dimPercent`. */
export function backdropAt(palette: Pick<Palette, 'scrim' | 'scheme'>, dimPercent: number, art: Color = worstCaseArt(palette.scheme)): Rgba {
  const a = clamp(dimPercent, 0, 100) / 100;
  const scrim = toRgba(palette.scrim);
  return composite({ ...scrim, a }, art);
}

export interface OverArt {
  dimPercent: number;
  /** Primary text on the dimmed worst-case backdrop. */
  text: number;
  /** Secondary text on the same. */
  dim: number;
  /** Primary / secondary text on a glass surface (full glassFill) over that backdrop. */
  glassText: number;
  glassDim: number;
  /** Primary / secondary text on a solid card (`card`) and on the raised fill (`cardHi`: buttons, chips, inputs) over that backdrop. */
  cardText: number;
  cardDim: number;
  cardHiText: number;
  cardHiDim: number;
}

/** Contrast ratios of text over a picture (default: the worst-case one) dimmed by `dimPercent`. */
export function overArt(palette: DimInput, dimPercent: number, art: Color = worstCaseArt(palette.scheme)): OverArt {
  const backdrop = backdropAt(palette, dimPercent, art);
  const glass = composite(palette.glassFill, backdrop);
  const card = composite(palette.card, backdrop);
  const cardHi = composite(palette.cardHi, backdrop);
  return {
    dimPercent,
    text: contrastRatio(palette.text, backdrop),
    dim: contrastRatio(palette.dim, backdrop),
    glassText: contrastRatio(palette.text, glass),
    glassDim: contrastRatio(palette.dim, glass),
    cardText: contrastRatio(palette.text, card),
    cardDim: contrastRatio(palette.dim, card),
    cardHiText: contrastRatio(palette.text, cardHi),
    cardHiDim: contrastRatio(palette.dim, cardHi),
  };
}

export function passesOverArt(palette: DimInput, dimPercent: number, art: Color = worstCaseArt(palette.scheme)): boolean {
  const t = thresholdsFor(palette);
  const r = overArt(palette, dimPercent, art);
  return (
    r.text >= t.textOverArt && r.glassText >= t.textOverArt && r.cardText >= t.textOverArt && r.cardHiText >= t.textOverArt &&
    r.dim >= t.dimOverArt && r.glassDim >= t.dimOverArt && r.cardDim >= t.dimOverArt && r.cardHiDim >= t.dimOverArt
  );
}

/**
 * passesOverArt for one palette with its colours parsed and their luminances computed once, for loops over hundreds of picture
 * colours (the Backdrop's legibility floor). Gives exactly the answers of passesOverArt(palette, dim, art) — a test pins that.
 */
export function overArtChecker(palette: DimInput): (dimPercent: number, art: Color) => boolean {
  const t = thresholdsFor(palette);
  const scrim = toRgba(palette.scrim);
  const glassFill = toRgba(palette.glassFill);
  const card = toRgba(palette.card);
  const cardHi = toRgba(palette.cardHi);
  const lText = luminance(palette.text);
  const lDim = luminance(palette.dim);
  const ratio = (l: number, other: number) => (Math.max(l, other) + 0.05) / (Math.min(l, other) + 0.05);
  return (dimPercent, art) => {
    const backdrop = composite({ ...scrim, a: clamp(dimPercent, 0, 100) / 100 }, art);
    const surfaces = [backdrop, composite(glassFill, backdrop), composite(card, backdrop), composite(cardHi, backdrop)];
    for (const s of surfaces) {
      const l = luminance(s);
      if (ratio(lText, l) < t.textOverArt || ratio(lDim, l) < t.dimOverArt) return false;
    }
    return true;
  };
}

/** The highest dim the UI offers: the same number the settings validator clamps bgDim to (one source, so the two cannot drift). */
export const MAX_DIM = APPEARANCE_RANGES.bgDim.max;

/**
 * The smallest whole-percent dim (0..90) at which text and secondary text — bare, on glass, on a solid card and on the raised
 * card fill (buttons, chips and inputs sit on that one) — all reach their thresholds over the worst-case picture composited
 * with the palette's scrim. If even 90 % is not enough this returns 90 (the UI cap) and the
 * palette test fails, so a badly chosen palette is caught in CI rather than on the road.
 */
export function minDimFor(palette: DimInput): number {
  for (let d = 0; d <= MAX_DIM; d++) if (passesOverArt(palette, d)) return d;
  return MAX_DIM;
}

/** Relative luminance of the worst-case picture: 1 (white) behind light text on dark palettes, 0 (black) behind dark text on light ones. */
export function worstCaseLuminance(scheme: Scheme): number {
  return scheme === 'dark' ? 1 : 0;
}

/**
 * The grey (`#rrggbb`) whose WCAG relative luminance is `lum` (0..1; anything else is clamped, NaN counts as the worst case).
 * The channel is rounded toward the picture that is harder for this scheme (up for dark palettes, down for light ones), so the
 * grey is never kinder than the luminance asked for.
 */
export function greyOfLuminance(lum: number, scheme: Scheme = 'dark'): Rgba {
  const l = clamp(Number.isFinite(lum) ? lum : worstCaseLuminance(scheme), 0, 1);
  const enc = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const v255 = enc * 255;
  const v = clamp(scheme === 'dark' ? Math.ceil(v255 - 1e-9) : Math.floor(v255 + 1e-9), 0, 255);
  return { r: v, g: v, b: v, a: 1 };
}

/**
 * Like minDimFor, for a picture that is not the worst case: the smallest whole-percent dim (0..90) at which every rule minDimFor
 * checks (text and secondary text, bare, on glass, on a card and on the raised card fill) still passes over a grey of relative
 * luminance `artLuminance` (0 black .. 1 white) with the scrim laid over it. Same maths, a different picture colour.
 *
 * `artLuminance` is the part of the picture that is hardest on the text: for light text that is the highest luminance, for dark
 * text (light palettes) the lowest. For dark palettes the answer rises with luminance, for light palettes it falls; at
 * worstCaseLuminance(scheme) it equals minDimFor(palette) (= palette.minDim). Returns 90 (the cap) when even that is not enough.
 *
 * A grey is only a stand-in: the scrim is composited per channel, so a saturated picture of the same luminance can need a few
 * percent (dark palettes) to a few tens of percent (light palettes) more or less. When the real colour is known use minDimForColor.
 */
export function minDimForArt(palette: DimInput, artLuminance: number): number {
  return minDimForColor(palette, greyOfLuminance(artLuminance, palette.scheme));
}

/** minDimForArt for a picture of one known colour (the real thing, not a grey of the same luminance). */
export function minDimForColor(palette: DimInput, art: Color): number {
  for (let d = 0; d <= MAX_DIM; d++) if (passesOverArt(palette, d, art)) return d;
  return MAX_DIM;
}

// ---------------------------------------------------------------------------
// Accent
// ---------------------------------------------------------------------------

/** Ink for text drawn on `accent`: always >= 4.5:1. `mode` is honoured when that ink is legible, otherwise the better ink is used. */
export function onAccentFor(accent: Color, mode: OnAccentMode = 'auto'): string {
  const dark = contrastRatio(INK_DARK, accent);
  const light = contrastRatio(INK_LIGHT, accent);
  const better = dark >= light ? INK_DARK : INK_LIGHT;
  const preferred = mode === 'dark' ? INK_DARK : mode === 'light' ? INK_LIGHT : better;
  if (contrastRatio(preferred, accent) >= 4.5) return preferred;
  if (Math.max(dark, light) >= 4.5) return better;
  // Mid-tone accents sit between what the soft ink and white can reach: pure black or white always gets there (>= 4.58).
  return contrastRatio('#000000', accent) >= contrastRatio('#ffffff', accent) ? '#000000' : '#ffffff';
}

export interface AccentResult {
  /** `#rrggbb`: the requested accent, nudged only as far as needed to reach 3:1 on the palette's bg. */
  accent: string;
  /** `#rrggbb`: legible ink (>= 4.5:1) for text on that accent. */
  onAccent: string;
}

/**
 * Make any accent safe on this palette. Dark palettes lighten it, light palettes darken it, by mixing toward white / black one
 * percent at a time (hue is preserved) until it reaches 3:1 against bg. An accent that already passes is returned unchanged.
 * Anything that is not a colour (not a string, or text parseColor cannot read) falls back to the palette's own accentDefault.
 */
export function accentFor(palette: Pick<Palette, 'bg' | 'scheme' | 'accentDefault' | 'onAccentMode'>, accentHex: string): AccentResult {
  const base = (typeof accentHex === 'string' ? parseColor(accentHex) : null) ?? toRgba(palette.accentDefault);
  const target = palette.scheme === 'dark' ? 255 : 0;
  let accent = toHex(base);
  for (let t = 0; t <= 100 && contrastRatio(accent, palette.bg) < 3; t++) {
    const k = t / 100;
    accent = toHex({ r: base.r + (target - base.r) * k, g: base.g + (target - base.g) * k, b: base.b + (target - base.b) * k, a: 1 });
  }
  return { accent, onAccent: onAccentFor(accent, palette.onAccentMode) };
}

// ---------------------------------------------------------------------------
// Report (tests and debugging)
// ---------------------------------------------------------------------------

export interface Check {
  name: string;
  ratio: number;
  min: number;
  ok: boolean;
}

export interface PaletteReport {
  id: Palette['id'];
  /** Every rule of spec §5 for this palette, with the measured ratio. */
  checks: Check[];
  failures: Check[];
  /** Recomputed (not the stored palette.minDim). */
  minDim: number;
  ok: boolean;
}

/** The accent swatches the Settings screen offers; every one must be usable on every palette (after accentFor). */
export function paletteReport(palette: Palette, swatches: readonly string[] = []): PaletteReport {
  const t = thresholdsFor(palette);
  const checks: Check[] = [];
  const add = (name: string, ratio: number, min: number) => checks.push({ name, ratio, min, ok: ratio >= min });
  const onBg = (c: Color) => composite(c, palette.bg);
  // Sheets, dialogs and the page's far end sit on bg2, and the rail / top bar on nav: cards and buttons are drawn over those too.
  const onBg2 = (c: Color) => composite(c, palette.bg2);

  add('text on bg', contrastRatio(palette.text, palette.bg), t.text);
  add('text on card', contrastRatio(palette.text, onBg(palette.card)), t.text);
  add('text on cardHi', contrastRatio(palette.text, onBg(palette.cardHi)), t.text);
  add('dim on bg', contrastRatio(palette.dim, palette.bg), t.dim);
  add('dim on card', contrastRatio(palette.dim, onBg(palette.card)), t.dim);
  add('dim on cardHi', contrastRatio(palette.dim, onBg(palette.cardHi)), t.dim);
  add('text on bg2', contrastRatio(palette.text, palette.bg2), t.text);
  add('dim on bg2', contrastRatio(palette.dim, palette.bg2), t.dim);
  add('text on nav', contrastRatio(palette.text, palette.nav), t.text);
  add('dim on nav', contrastRatio(palette.dim, palette.nav), t.dim);
  add('text on card over bg2', contrastRatio(palette.text, onBg2(palette.card)), t.text);
  add('text on cardHi over bg2', contrastRatio(palette.text, onBg2(palette.cardHi)), t.text);
  add('dim on card over bg2', contrastRatio(palette.dim, onBg2(palette.card)), t.dim);
  add('dim on cardHi over bg2', contrastRatio(palette.dim, onBg2(palette.cardHi)), t.dim);
  add('accentDefault on bg', contrastRatio(palette.accentDefault, palette.bg), t.accent);
  add('onAccent on accentDefault', contrastRatio(accentFor(palette, palette.accentDefault).onAccent, palette.accentDefault), t.onAccent);
  for (const s of swatches) {
    const r = accentFor(palette, s);
    add(`swatch ${s} on bg`, contrastRatio(r.accent, palette.bg), t.accent);
    add(`onAccent on swatch ${s}`, contrastRatio(r.onAccent, r.accent), t.onAccent);
  }
  add('ok on bg', contrastRatio(palette.ok, palette.bg), t.status);
  add('warn on bg', contrastRatio(palette.warn, palette.bg), t.status);
  add('danger on bg', contrastRatio(palette.danger, palette.bg), t.status);

  const minDim = minDimFor(palette);
  const art = overArt(palette, minDim);
  add(`text over worst-case art at ${minDim}%`, art.text, t.textOverArt);
  add(`dim over worst-case art at ${minDim}%`, art.dim, t.dimOverArt);
  add(`text on glass over worst-case art at ${minDim}%`, art.glassText, t.textOverArt);
  add(`dim on glass over worst-case art at ${minDim}%`, art.glassDim, t.dimOverArt);
  add(`text on card over worst-case art at ${minDim}%`, art.cardText, t.textOverArt);
  add(`dim on card over worst-case art at ${minDim}%`, art.cardDim, t.dimOverArt);
  add(`text on cardHi over worst-case art at ${minDim}%`, art.cardHiText, t.textOverArt);
  add(`dim on cardHi over worst-case art at ${minDim}%`, art.cardHiDim, t.dimOverArt);

  const failures = checks.filter((c) => !c.ok);
  return { id: palette.id, checks, failures, minDim, ok: failures.length === 0 };
}
