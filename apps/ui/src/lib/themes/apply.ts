import {
  ALBUM_MOTIONS,
  APPEARANCE_RANGES,
  BACKGROUNDS,
  DASH_SCENES,
  DEFAULT_SETTINGS,
  DEPTH_STYLES,
  DOCK_STYLES,
  EFFECTS,
  FONTS,
  GAUGE_STYLES,
  GLASS_FINISHES,
  MOTION_SPEEDS,
  PAGE_TRANSITIONS,
  SHAPES,
  SURFACES,
  TOUCH_FX,
  type Settings,
  type Shape,
  type ThemeId,
} from '@headunit/shared';
import { hexToRgb } from '../color';
import { accentFor, composite, contrastRatio, parseColor, thresholdsFor, toHex, toRgba } from './contrast';
import { paletteOf } from './registry';
import type { Palette } from './types';

/** Every CSS variable a palette sets. tokens.css keeps a `:root` fallback for each of these (a test keeps the two in sync). */
export const PALETTE_CSS_VARS = [
  '--bg',
  '--bg2',
  '--nav',
  '--card',
  '--card-hi',
  '--border',
  '--border-strong',
  '--text',
  '--dim',
  '--track',
  '--shadow',
  '--glow',
  '--ok',
  '--warn',
  '--danger',
  '--glass-fill',
  '--glass-border',
  '--glass-hi',
  '--scrim',
  '--ink-rgb',
  '--bg-rgb',
  '--bg2-rgb',
  '--ok-rgb',
  '--warn-rgb',
  '--danger-rgb',
  '--glass-rgb',
  '--glass-alpha',
  '--bw-min',
] as const;
export type PaletteCssVar = (typeof PALETTE_CSS_VARS)[number];

/** The variables that come from the user's choices rather than from the palette. */
export const APPEARANCE_CSS_VARS = [
  '--accent',
  '--accent-rgb',
  '--accent-2',
  '--accent-2-rgb',
  '--accent-text',
  '--on-accent',
  '--bg-blur',
  '--bg-dim',
  '--glass-a',
  '--radius-scale',
  '--text-scale',
  '--scene-k',
  '--tempo',
  '--amp',
] as const;

/** Corner radii in the stylesheets are multiplied by this (`calc(14px * var(--radius-scale))`). */
export const RADIUS_SCALE: Record<Shape, number> = { sharp: 0.35, soft: 1, round: 1.65 };

/** Animation tempo (duration multiplier) and amplitude per motion setting. `off` stops decorative motion altogether (see motion.css). */
export const MOTION_FEEL: Record<Settings['motionSpeed'], { tempo: number; amp: number }> = {
  off: { tempo: 1, amp: 0 },
  calm: { tempo: 1.3, amp: 0.6 },
  lively: { tempo: 0.7, amp: 0.85 },
  cinematic: { tempo: 1, amp: 1 },
};

/** `r,g,b` of an opaque or translucent colour, for `rgba(var(--x-rgb), alpha)` in CSS. */
function rgbTriple(c: string): string {
  const { r, g, b } = toRgba(c);
  return [r, g, b].map((v) => Math.round(v)).join(',');
}

/**
 * The ink that overlays (hover, pressed, dividers, tracks) are drawn with: white on dark palettes and the palette's own text colour on
 * light ones, so one rule works everywhere.
 */
export function inkRgb(p: Pick<Palette, 'scheme' | 'text'>): string {
  return p.scheme === 'dark' ? '255,255,255' : rgbTriple(p.text);
}

/** A palette as CSS variables. Values are exactly the palette's strings; `--glow` is its number. */
export function paletteVars(p: Palette): Record<PaletteCssVar, string> {
  const glass = parseColor(p.glassFill);
  return {
    '--bg': p.bg,
    '--bg2': p.bg2,
    '--nav': p.nav,
    '--card': p.card,
    '--card-hi': p.cardHi,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--text': p.text,
    '--dim': p.dim,
    '--track': p.track,
    '--shadow': p.shadow,
    '--glow': String(p.glow),
    '--ok': p.ok,
    '--warn': p.warn,
    '--danger': p.danger,
    '--glass-fill': p.glassFill,
    '--glass-border': p.glassBorder,
    '--glass-hi': p.glassHighlight,
    '--scrim': p.scrim,
    '--ink-rgb': inkRgb(p),
    '--bg-rgb': rgbTriple(p.bg),
    '--bg2-rgb': rgbTriple(p.bg2),
    '--ok-rgb': rgbTriple(p.ok),
    '--warn-rgb': rgbTriple(p.warn),
    '--danger-rgb': rgbTriple(p.danger),
    '--glass-rgb': rgbTriple(p.glassFill),
    '--glass-alpha': String(Math.round((glass?.a ?? 0.08) * 1000) / 1000),
    '--bw-min': thresholdsFor(p).text >= 7 ? '2px' : '1px',
  };
}

/** A palette (by id) as CSS variables. */
export function themeVars(id: ThemeId): Record<PaletteCssVar, string> {
  return paletteVars(paletteOf(id));
}

/** Rotate a colour's hue by `deg` degrees, keeping saturation and lightness. Used for the second gradient stop of the accent. */
export function shiftHueHex(hex: string, deg: number): string {
  const { r, g, b } = toRgba(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return toHex({ r, g, b, a: 1 });
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255, a: 1 });
}

/** What applyAppearance needs. `theme` is the palette in force right now (after auto day/night); `accent` the colour in force (album art or the setting). */
export type AppearanceInput = Pick<
  Settings,
  | 'surface'
  | 'background'
  | 'effects'
  | 'shape'
  | 'bgBlur'
  | 'bgDim'
  | 'glassOpacity'
  | 'albumMotion'
  | 'depthStyle'
  | 'motionSpeed'
  | 'dashScene'
  | 'glassFinish'
  | 'font'
  | 'textScale'
  | 'transition'
  | 'touchFx'
  | 'gaugeStyle'
  | 'dockStyle'
  | 'sceneIntensity'
> & {
  theme: ThemeId;
  accent: string;
};

export interface ResolvedAppearance {
  palette: Palette;
  /** Every enum setting, validated (an unknown value falls back to the default). These become data-* attributes on <html>. */
  attrs: {
    surface: Settings['surface'];
    bg: Settings['background'];
    effects: Settings['effects'];
    shape: Settings['shape'];
    albumMotion: Settings['albumMotion'];
    depth: Settings['depthStyle'];
    motion: Settings['motionSpeed'];
    scene: Settings['dashScene'];
    glass: Settings['glassFinish'];
    font: Settings['font'];
    transition: Settings['transition'];
    touch: Settings['touchFx'];
    gauge: Settings['gaugeStyle'];
    dock: Settings['dockStyle'];
  };
  /** The accent after accentFor (>= 3:1 on the palette's bg) and the ink for text on it (>= 4.5:1). */
  accent: string;
  /** A hue-shifted partner of the accent for two-stop gradients (also >= 3:1 on bg). */
  accent2: string;
  onAccent: string;
  /** The accent made safe for small TEXT and thin lines on this palette's surfaces (>= 4.5:1, 7:1 for the accessibility palettes). */
  accentText: string;
  /** Backdrop blur, px. */
  bgBlur: number;
  /** Backdrop dim, whole percent, never below palette.minDim. */
  dimPercent: number;
  /** Glass fill strength, 0..1. */
  glassA: number;
  /** Text size factor (0.85..1.3). */
  textScale: number;
  /** Scene busyness, 0.1..1. */
  sceneK: number;
}

/**
 * `accent` (already through accentFor, so >= 3:1 on bg) pushed further toward white / black, hue preserved, until it also reads as
 * small text: >= 4.5:1 (7:1 for contrast / sunlit) on the surfaces that text sits on.
 */
export function accentTextFor(palette: Pick<Palette, 'id' | 'scheme' | 'bg' | 'bg2' | 'card' | 'text'>, accent: string): string {
  const need = thresholdsFor(palette).text === 7 ? 7 : 4.5;
  const surfaces = [palette.bg, palette.bg2, toHex(composite(palette.card, palette.bg))];
  const worst = (c: string) => Math.min(...surfaces.map((s) => contrastRatio(c, s)));
  const base = toRgba(accent);
  const target = palette.scheme === 'dark' ? 255 : 0;
  let out = toHex(base);
  for (let t = 0; t <= 100 && worst(out) < need; t++) {
    const k = t / 100;
    out = toHex({ r: base.r + (target - base.r) * k, g: base.g + (target - base.g) * k, b: base.b + (target - base.b) * k, a: 1 });
  }
  return worst(out) >= need ? out : toHex(palette.text);
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

const clampNum = (v: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** The dim (%) actually used: what the user asked for, raised to the palette's legibility minimum. */
export function effectiveDim(palette: Pick<Palette, 'minDim'>, bgDim: number): number {
  return Math.max(palette.minDim, Math.round(clampNum(bgDim, APPEARANCE_RANGES.bgDim, DEFAULT_SETTINGS.bgDim)));
}

/** Pure part of applyAppearance: validate/clamp every input and derive accent, ink and dim. */
export function resolveAppearance(input: AppearanceInput): ResolvedAppearance {
  const palette = paletteOf(input.theme);
  const { accent, onAccent } = accentFor(palette, input.accent);
  const d = DEFAULT_SETTINGS;
  return {
    palette,
    attrs: {
      surface: oneOf(SURFACES, input.surface, d.surface),
      bg: oneOf(BACKGROUNDS, input.background, d.background),
      effects: oneOf(EFFECTS, input.effects, d.effects),
      shape: oneOf(SHAPES, input.shape, d.shape),
      albumMotion: oneOf(ALBUM_MOTIONS, input.albumMotion, d.albumMotion),
      depth: oneOf(DEPTH_STYLES, input.depthStyle, d.depthStyle),
      motion: oneOf(MOTION_SPEEDS, input.motionSpeed, d.motionSpeed),
      scene: oneOf(DASH_SCENES, input.dashScene, d.dashScene),
      glass: oneOf(GLASS_FINISHES, input.glassFinish, d.glassFinish),
      font: oneOf(FONTS, input.font, d.font),
      transition: oneOf(PAGE_TRANSITIONS, input.transition, d.transition),
      touch: oneOf(TOUCH_FX, input.touchFx, d.touchFx),
      gauge: oneOf(GAUGE_STYLES, input.gaugeStyle, d.gaugeStyle),
      dock: oneOf(DOCK_STYLES, input.dockStyle, d.dockStyle),
    },
    accent,
    accent2: accentFor(palette, shiftHueHex(accent, 48)).accent,
    onAccent,
    accentText: accentTextFor(palette, accent),
    bgBlur: Math.round(clampNum(input.bgBlur, APPEARANCE_RANGES.bgBlur, d.bgBlur)),
    dimPercent: effectiveDim(palette, input.bgDim),
    glassA: clampNum(input.glassOpacity, APPEARANCE_RANGES.glassOpacity, d.glassOpacity) / 100,
    textScale: clampNum(input.textScale, APPEARANCE_RANGES.textScale, d.textScale) / 100,
    sceneK: clampNum(input.sceneIntensity, APPEARANCE_RANGES.sceneIntensity, d.sceneIntensity) / 100,
  };
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** All custom properties for a resolved appearance (palette + accent + numeric knobs). Only `--*` keys, so it is safe as a React `style`. */
export function appearanceVars(r: ResolvedAppearance): Record<string, string> {
  const feel = MOTION_FEEL[r.attrs.motion];
  return {
    ...paletteVars(r.palette),
    '--accent': r.accent,
    '--accent-rgb': hexToRgb(r.accent).join(','),
    '--accent-2': r.accent2,
    '--accent-2-rgb': hexToRgb(r.accent2).join(','),
    '--accent-text': r.accentText,
    '--on-accent': r.onAccent,
    '--bg-blur': `${r.bgBlur}px`,
    '--bg-dim': num(r.dimPercent / 100),
    '--glass-a': num(r.glassA),
    '--radius-scale': num(RADIUS_SCALE[r.attrs.shape]),
    '--text-scale': num(r.textScale),
    '--scene-k': num(r.sceneK),
    '--tempo': num(feel.tempo),
    '--amp': num(feel.amp),
  };
}

/** The slice of an element applyAppearance touches; an HTMLElement satisfies it (tests pass a small fake). */
export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
  style: { setProperty(name: string, value: string): void };
}

/**
 * Put the whole look on `root` (the <html> element): data-theme / -scheme and one data attribute per appearance choice, every palette
 * variable inline, `color-scheme`, and the numeric knobs. Returns what it resolved. Idempotent and cheap: call it whenever any input changes.
 */
export function applyAppearance(root: ThemeRoot, input: AppearanceInput): ResolvedAppearance {
  const r = resolveAppearance(input);
  root.dataset.theme = r.palette.id;
  root.dataset.scheme = r.palette.scheme;
  for (const [key, value] of Object.entries(r.attrs)) root.dataset[key] = value;
  for (const [name, value] of Object.entries(appearanceVars(r))) root.style.setProperty(name, value);
  root.style.setProperty('color-scheme', r.palette.scheme);
  return r;
}

/** The appearance inputs of a settings object, with `theme` and `accent` given (they may differ from the saved ones). */
export function appearanceInput(s: Settings, theme: ThemeId, accent: string): AppearanceInput {
  return {
    theme,
    accent,
    surface: s.surface,
    background: s.background,
    effects: s.effects,
    shape: s.shape,
    bgBlur: s.bgBlur,
    bgDim: s.bgDim,
    glassOpacity: s.glassOpacity,
    albumMotion: s.albumMotion,
    depthStyle: s.depthStyle,
    motionSpeed: s.motionSpeed,
    dashScene: s.dashScene,
    glassFinish: s.glassFinish,
    font: s.font,
    textScale: s.textScale,
    transition: s.transition,
    touchFx: s.touchFx,
    gaugeStyle: s.gaugeStyle,
    dockStyle: s.dockStyle,
    sceneIntensity: s.sceneIntensity,
  };
}

/**
 * Variables and attributes for a preview tile: spread them on the tile and everything inside that uses var(--bg), var(--card),
 * var(--text)… shows that combination. Anything not given comes from the defaults.
 */
export function previewOf(over: Partial<Settings> & { theme: ThemeId }): { vars: Record<string, string>; attrs: Record<string, string> } {
  const s = { ...DEFAULT_SETTINGS, ...over };
  const r = resolveAppearance(appearanceInput(s, over.theme, over.accent ?? paletteOf(over.theme).accentDefault));
  const attrs: Record<string, string> = { 'data-theme': r.palette.id, 'data-scheme': r.palette.scheme };
  for (const [key, value] of Object.entries(r.attrs)) attrs[`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = value;
  return { vars: appearanceVars(r), attrs };
}
