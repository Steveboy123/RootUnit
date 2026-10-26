import {
  ALBUM_MOTIONS,
  BACKGROUNDS,
  BUILTIN_WALLPAPERS,
  DASH_SCENES,
  DOCK_STYLES,
  FONTS,
  GAUGE_STYLES,
  GLASS_FINISHES,
  MASCOT_AURAS,
  MASCOT_MOTIONS,
  PAGE_TRANSITIONS,
  STANDBY_STYLES,
  SURFACES,
  TOUCH_FX,
  type Background,
  type DepthStyle,
  type FontId,
  type Settings,
  type Shape,
  type Surface,
  type ThemeId,
  type TouchFx,
} from '@headunit/shared';
import { HIGH_VISIBILITY, PALETTE_LIST } from './themes';

/**
 * "Surprise me": a random look that still hangs together. It starts from a palette (and that palette's own accent, which is always
 * readable on it), then picks the rest, keeping the pairings a designer would: a terminal panel gets a mono face and square corners, clay
 * and bubbles are round, brutalist cards are flat with a hard press, light palettes skip the neon tube and the green-screen. Everything
 * else is left to chance. The mascot's place, the music-reactive light and day/night switching are left as they are.
 */
export type SurprisePatch = Partial<Pick<Settings, 'theme' | 'accent' | 'surface' | 'background' | 'wallpaper' | 'shape' | 'effects' | 'albumMotion' | 'depthStyle' | 'motionSpeed' | 'dashScene' | 'glassFinish' | 'font' | 'transition' | 'touchFx' | 'gaugeStyle' | 'standbyStyle' | 'dockStyle' | 'mascotMotion' | 'mascotAura' | 'autoTheme'>>;

/** The backgrounds drawn by the app itself: not "none", not the album art, not a wallpaper (wallpapers are picked separately). */
const NOT_GENERATED: readonly Background[] = ['none', 'art-blur', 'art-cover', 'art-ambient', 'wallpaper'];
const GENERATED = BACKGROUNDS.filter((b) => !NOT_GENERATED.includes(b));
/** Surfaces drawn in light on a dark page; on a light palette they look wrong. */
const DARK_ONLY_SURFACES: readonly Surface[] = ['neon', 'terminal', 'hud'];
const DEPTHS: readonly DepthStyle[] = ['flat', 'soft', 'deep', 'crystal', 'float', 'bevel', 'layered'];

/** Mulberry32, so a seed always gives the same look (tests, and "show me that one again"). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function surpriseLook(rand: () => number = Math.random): SurprisePatch {
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
  const palette = pick(PALETTE_LIST.filter((p) => !HIGH_VISIBILITY.has(p.id)));
  const light = palette.scheme === 'light';
  const surface = pick(light ? SURFACES.filter((s) => !DARK_ONLY_SURFACES.includes(s)) : SURFACES);

  let shape: Shape = pick(['sharp', 'soft', 'round'] as const);
  let font: FontId = pick(FONTS);
  let depthStyle: DepthStyle = pick(DEPTHS);
  let touchFx: TouchFx = pick(TOUCH_FX.filter((t) => t !== 'none'));
  if (surface === 'terminal' || surface === 'hud') {
    shape = 'sharp';
    font = pick(['mono', 'tech'] as const);
    depthStyle = 'flat';
  } else if (surface === 'brutal') {
    shape = rand() < 0.5 ? 'sharp' : 'soft';
    depthStyle = 'flat';
    touchFx = pick(['press', 'pop'] as const);
  } else if (surface === 'clay' || surface === 'aero') {
    shape = 'round';
    depthStyle = pick(['soft', 'float'] as const);
  }

  const useWallpaper = rand() < 0.45;
  const dockStyle = pick(DOCK_STYLES.filter((d) => !(light && d === 'neon')));
  const dashScene = rand() < 0.15 ? 'off' : pick(DASH_SCENES.filter((s) => s !== 'off' && !(light && s === 'matrix')));
  return {
    theme: palette.id as ThemeId,
    accent: palette.accentDefault.toLowerCase(),
    autoTheme: false,
    surface,
    background: useWallpaper ? 'wallpaper' : pick(GENERATED),
    ...(useWallpaper ? { wallpaper: pick(BUILTIN_WALLPAPERS) } : {}),
    shape,
    effects: rand() < 0.6 ? 'full' : 'balanced',
    albumMotion: pick(ALBUM_MOTIONS.filter((m) => m !== 'still')),
    depthStyle,
    motionSpeed: pick(['calm', 'calm', 'lively', 'cinematic'] as const),
    dashScene,
    glassFinish: pick(GLASS_FINISHES),
    font,
    transition: pick(PAGE_TRANSITIONS.filter((t) => t !== 'none')),
    touchFx,
    gaugeStyle: pick(GAUGE_STYLES),
    standbyStyle: pick(STANDBY_STYLES),
    dockStyle,
    mascotMotion: pick(MASCOT_MOTIONS.filter((m) => m !== 'still')),
    mascotAura: pick(MASCOT_AURAS),
  };
}
