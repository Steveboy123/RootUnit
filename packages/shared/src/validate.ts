import { applyLauncherPatch, applyNavPatch, applyPanelPatch } from './nav';
import {
  ALBUM_MOTIONS,
  APPEARANCE_RANGES,
  BACKGROUNDS,
  BEAT_COLORS,
  BEAT_MODES,
  BEAT_SOURCES,
  DASH_SCENES,
  DEPTH_STYLES,
  DOCK_STYLES,
  EFFECTS,
  FONTS,
  GAUGE_STYLES,
  GLASS_FINISHES,
  MASCOT_AURAS,
  MASCOT_MOTIONS,
  MASCOT_VARIANTS,
  MOTION_SPEEDS,
  PAGE_TRANSITIONS,
  SHAPES,
  STANDBY_STYLES,
  SURFACES,
  THEME_IDS,
  TOUCH_FX,
  WALLPAPER_ID_RE,
} from './appearance';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  GRID_COLS,
  GRID_ROWS,
  type DashboardLayout,
  MUSIC_SOURCES,
  type MusicSource,
  type Settings,
  type WidgetConfig,
} from './types';
import { cleanLookName, LOOK_KEYS, lookOf, SAVED_LOOK_ID_RE, SAVED_LOOK_LIMITS, type LookValues, type SavedLook } from './looks';

const HEX = /^#[0-9a-fA-F]{6}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** `v` if it is one of `list` (compared as plain strings, so objects, arrays and prototype keys never match). */
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

/** A finite number rounded to a whole number and clamped into the range; anything else (strings, NaN, Infinity, null) is no value. */
const clampInt = (v: unknown, { min, max }: { min: number; max: number }): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;

/** Merge an untrusted patch over current settings, ignoring anything invalid. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const next = { ...current };
  if (!isObj(patch)) return next;
  const theme = oneOf(THEME_IDS, patch.theme);
  if (theme) next.theme = theme;
  if (typeof patch.accent === 'string' && HEX.test(patch.accent)) next.accent = patch.accent.toLowerCase();
  if (patch.units === 'metric' || patch.units === 'imperial') next.units = patch.units;
  if (typeof patch.clock24h === 'boolean') next.clock24h = patch.clock24h;
  if (typeof patch.autoTheme === 'boolean') next.autoTheme = patch.autoTheme;
  const dayTheme = oneOf(THEME_IDS, patch.dayTheme);
  if (dayTheme) next.dayTheme = dayTheme;
  const nightTheme = oneOf(THEME_IDS, patch.nightTheme);
  if (nightTheme) next.nightTheme = nightTheme;
  if (typeof patch.nightStart === 'string' && HHMM.test(patch.nightStart)) next.nightStart = patch.nightStart;
  if (typeof patch.nightEnd === 'string' && HHMM.test(patch.nightEnd)) next.nightEnd = patch.nightEnd;
  if (typeof patch.cameraMirror === 'boolean') next.cameraMirror = patch.cameraMirror;
  if (typeof patch.cameraGuides === 'boolean') next.cameraGuides = patch.cameraGuides;
  if (typeof patch.artAccent === 'boolean') next.artAccent = patch.artAccent;
  if (typeof patch.lockWhileDriving === 'boolean') next.lockWhileDriving = patch.lockWhileDriving;
  if (MUSIC_SOURCES.includes(patch.musicSource as MusicSource)) next.musicSource = patch.musicSource as MusicSource;
  if (patch.autoThemeMode === 'schedule' || patch.autoThemeMode === 'sun') next.autoThemeMode = patch.autoThemeMode;
  if (typeof patch.weather === 'boolean') next.weather = patch.weather;
  if (typeof patch.lyrics === 'boolean') next.lyrics = patch.lyrics;
  if (typeof patch.driveAuto === 'boolean') next.driveAuto = patch.driveAuto;
  const standbyMin = clampInt(patch.standbyMin, { min: 0, max: 120 });
  if (standbyMin !== null) next.standbyMin = standbyMin;
  // The three arrangements are objects, each applied by its own rules (see nav.ts); a patch without `version: 1` is ignored.
  if (Object.prototype.hasOwnProperty.call(patch, 'nav')) next.nav = applyNavPatch(current.nav, patch.nav);
  if (Object.prototype.hasOwnProperty.call(patch, 'launcher')) next.launcher = applyLauncherPatch(current.launcher, patch.launcher);
  if (Object.prototype.hasOwnProperty.call(patch, 'panel')) next.panel = applyPanelPatch(current.panel, patch.panel);

  // Appearance (theme engine). Enums by membership, numbers rounded + clamped, wallpaper by id pattern.
  const surface = oneOf(SURFACES, patch.surface);
  if (surface) next.surface = surface;
  const background = oneOf(BACKGROUNDS, patch.background);
  if (background) next.background = background;
  const effects = oneOf(EFFECTS, patch.effects);
  if (effects) next.effects = effects;
  const albumMotion = oneOf(ALBUM_MOTIONS, patch.albumMotion);
  if (albumMotion) next.albumMotion = albumMotion;
  const depthStyle = oneOf(DEPTH_STYLES, patch.depthStyle);
  if (depthStyle) next.depthStyle = depthStyle;
  const motionSpeed = oneOf(MOTION_SPEEDS, patch.motionSpeed);
  if (motionSpeed) next.motionSpeed = motionSpeed;
  const dashScene = oneOf(DASH_SCENES, patch.dashScene);
  if (dashScene) next.dashScene = dashScene;
  const glassFinish = oneOf(GLASS_FINISHES, patch.glassFinish);
  if (glassFinish) next.glassFinish = glassFinish;
  const beatMode = oneOf(BEAT_MODES, patch.beatMode);
  if (beatMode) next.beatMode = beatMode;
  const beatSource = oneOf(BEAT_SOURCES, patch.beatSource);
  if (beatSource) next.beatSource = beatSource;
  const beatColorMode = oneOf(BEAT_COLORS, patch.beatColorMode);
  if (beatColorMode) next.beatColorMode = beatColorMode;
  if (typeof patch.beatColor === 'string' && HEX.test(patch.beatColor)) next.beatColor = patch.beatColor.toLowerCase();
  const beatIntensity = clampInt(patch.beatIntensity, { min: 0, max: 100 });
  if (beatIntensity !== null) next.beatIntensity = beatIntensity;
  const beatSensitivity = clampInt(patch.beatSensitivity, { min: 0, max: 100 });
  if (beatSensitivity !== null) next.beatSensitivity = beatSensitivity;
  if (typeof patch.mascotEnabled === 'boolean') next.mascotEnabled = patch.mascotEnabled;
  if (typeof patch.mascotBeat === 'boolean') next.mascotBeat = patch.mascotBeat;
  if (typeof patch.mascotMirror === 'boolean') next.mascotMirror = patch.mascotMirror;
  const mascotVariant = oneOf(MASCOT_VARIANTS, patch.mascotVariant);
  if (mascotVariant) next.mascotVariant = mascotVariant;
  const mascotMotion = oneOf(MASCOT_MOTIONS, patch.mascotMotion);
  if (mascotMotion) next.mascotMotion = mascotMotion;
  const mascotAura = oneOf(MASCOT_AURAS, patch.mascotAura);
  if (mascotAura) next.mascotAura = mascotAura;
  if (patch.mascotPlacement === 'behind' || patch.mascotPlacement === 'front') next.mascotPlacement = patch.mascotPlacement;
  if (patch.mascotScope === 'home' || patch.mascotScope === 'all') next.mascotScope = patch.mascotScope;
  for (const key of ['mascotX', 'mascotY', 'mascotSize', 'mascotOpacity', 'mascotGlow'] as const) {
    const range = key === 'mascotSize' ? { min: 10, max: 95 } : { min: 0, max: 100 };
    const value = clampInt(patch[key], range);
    if (value !== null) next[key] = value;
  }
  const shape = oneOf(SHAPES, patch.shape);
  if (shape) next.shape = shape;
  const bgBlur = clampInt(patch.bgBlur, APPEARANCE_RANGES.bgBlur);
  if (bgBlur !== null) next.bgBlur = bgBlur;
  const bgDim = clampInt(patch.bgDim, APPEARANCE_RANGES.bgDim);
  if (bgDim !== null) next.bgDim = bgDim;
  const glassOpacity = clampInt(patch.glassOpacity, APPEARANCE_RANGES.glassOpacity);
  if (glassOpacity !== null) next.glassOpacity = glassOpacity;
  if (typeof patch.wallpaper === 'string' && WALLPAPER_ID_RE.test(patch.wallpaper)) next.wallpaper = patch.wallpaper;
  const font = oneOf(FONTS, patch.font);
  if (font) next.font = font;
  const textScale = clampInt(patch.textScale, APPEARANCE_RANGES.textScale);
  if (textScale !== null) next.textScale = textScale;
  const transition = oneOf(PAGE_TRANSITIONS, patch.transition);
  if (transition) next.transition = transition;
  const touchFx = oneOf(TOUCH_FX, patch.touchFx);
  if (touchFx) next.touchFx = touchFx;
  const gaugeStyle = oneOf(GAUGE_STYLES, patch.gaugeStyle);
  if (gaugeStyle) next.gaugeStyle = gaugeStyle;
  const standbyStyle = oneOf(STANDBY_STYLES, patch.standbyStyle);
  if (standbyStyle) next.standbyStyle = standbyStyle;
  const dockStyle = oneOf(DOCK_STYLES, patch.dockStyle);
  if (dockStyle) next.dockStyle = dockStyle;
  const sceneIntensity = clampInt(patch.sceneIntensity, APPEARANCE_RANGES.sceneIntensity);
  if (sceneIntensity !== null) next.sceneIntensity = sceneIntensity;
  if (typeof patch.weatherFx === 'boolean') next.weatherFx = patch.weatherFx;
  if (typeof patch.albumGlow === 'boolean') next.albumGlow = patch.albumGlow;
  if (typeof patch.bgMotion === 'boolean') next.bgMotion = patch.bgMotion;
  if (Array.isArray(patch.myLooks)) next.myLooks = sanitizeSavedLooks(patch.myLooks);
  if (typeof patch.lightsFollowAccent === 'boolean') next.lightsFollowAccent = patch.lightsFollowAccent;
  return next;
}

/**
 * A complete, valid look from anything: each look setting it carries is checked like any setting, the rest are the defaults. Only the
 * look's own keys are read, so a look can never carry saved looks (or anything else) inside it.
 */
export function lookFromUntrusted(raw: unknown): LookValues {
  const picked: Record<string, unknown> = {};
  if (isObj(raw)) for (const k of LOOK_KEYS) if (Object.prototype.hasOwnProperty.call(raw, k)) picked[k] = raw[k];
  return lookOf(mergeSettings(DEFAULT_SETTINGS, picked));
}

/** The saved looks as they are kept: valid ids (the first of any repeat wins), clean non-empty names, valid looks, at most the limit. */
export function sanitizeSavedLooks(list: readonly unknown[]): SavedLook[] {
  const out: SavedLook[] = [];
  const ids = new Set<string>();
  for (const item of list.slice(0, SAVED_LOOK_LIMITS.count * 4)) {
    if (out.length >= SAVED_LOOK_LIMITS.count) break;
    if (!isObj(item) || typeof item.id !== 'string' || !SAVED_LOOK_ID_RE.test(item.id) || ids.has(item.id)) continue;
    const name = cleanLookName(item.name);
    if (!name || !isObj(item.look)) continue;
    ids.add(item.id);
    out.push({ id: item.id, name, look: lookFromUntrusted(item.look) });
  }
  return out;
}

export function sanitizeSettings(raw: unknown): Settings {
  return mergeSettings(DEFAULT_SETTINGS, raw);
}

/** The fields each arrangement's patch may carry besides `version`. */
const ARRANGEMENT_FIELDS = { nav: ['position', 'size', 'labels', 'items'], launcher: ['hidden'], panel: ['tiles', 'sections'] } as const;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * The same JSON value, whatever the order of an object's keys. `b` is always something this code built (a sanitized value, a few levels
 * deep at most) and the recursion only goes as deep as BOTH sides do, so a sender who nests `a` thousands of levels deep costs nothing.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (isObj(a) && isObj(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => hasOwn(b, k) && sameJson(a[k], b[k]));
  }
  return false;
}

/**
 * After `next = mergeSettings(current, patch)`: did the rail, launcher or Quick Panel come out different from what the sender wrote?
 * Only the fields the patch carries are compared (a patch naming `position` says nothing about `items`), and a whole arrangement that was
 * ignored (not an object, or a `version` other than 1) counts as different. The sender has applied the same merge to its own copy, but to
 * the copy it HAD; when this says yes the server sends it the real result so the two cannot drift apart. Never throws.
 */
export function arrangementsCorrected(patch: unknown, next: Settings): boolean {
  if (!isObj(patch)) return false;
  try {
    for (const key of ['nav', 'launcher', 'panel'] as const) {
      if (!hasOwn(patch, key)) continue;
      const sent = patch[key];
      if (!isObj(sent) || sent.version !== 1) return true;
      const kept = next[key] as unknown as Record<string, unknown>;
      for (const field of ARRANGEMENT_FIELDS[key]) {
        if (!hasOwn(sent, field)) continue;
        if (key === 'panel' && field === 'sections') {
          // sections merge per name, so only the names the sender wrote are compared
          const sentSections = sent.sections;
          const keptSections = kept.sections as Record<string, unknown>;
          if (!isObj(sentSections)) return true;
          if (Object.keys(sentSections).some((name) => !hasOwn(keptSections, name) || !sameJson(sentSections[name], keptSections[name]))) return true;
        } else if (!sameJson(sent[field], kept[field])) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

function sanitizeConfig(raw: unknown): WidgetConfig | undefined {
  if (!isObj(raw)) return undefined;
  const out: WidgetConfig = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validate a layout coming from disk or the network. Returns null if it is
 * structurally unusable; clamps widget rectangles to the grid.
 */
export function sanitizeLayout(raw: unknown): DashboardLayout | null {
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.pages)) return null;
  const pages: DashboardLayout['pages'] = [];
  const seenPages = new Set<string>();
  for (const p of raw.pages.slice(0, 12)) {
    if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.widgets)) return null;
    if (seenPages.has(p.id)) return null;
    seenPages.add(p.id);
    const widgets: DashboardLayout['pages'][number]['widgets'] = [];
    const seen = new Set<string>();
    for (const w of p.widgets.slice(0, 48)) {
      if (!isObj(w) || typeof w.id !== 'string' || typeof w.type !== 'string') return null;
      if (seen.has(w.id)) return null;
      seen.add(w.id);
      const wd = int(w.w, 1, GRID_COLS);
      const ht = int(w.h, 1, GRID_ROWS);
      if (wd === null || ht === null) return null;
      const x = int(w.x, 0, GRID_COLS - wd);
      const y = int(w.y, 0, GRID_ROWS - ht);
      if (x === null || y === null) return null;
      const config = sanitizeConfig(w.config);
      widgets.push({ id: w.id, type: w.type, x, y, w: wd, h: ht, ...(config ? { config } : {}) });
    }
    pages.push({ id: p.id, name: p.name.slice(0, 24) || 'Page', widgets });
  }
  if (pages.length === 0) return null;
  return { version: 1, pages };
}

export function layoutOrDefault(raw: unknown): DashboardLayout {
  return sanitizeLayout(raw) ?? structuredClone(DEFAULT_LAYOUT);
}
