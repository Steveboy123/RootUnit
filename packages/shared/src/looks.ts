import type { Settings } from './types';

/**
 * Every setting that is part of the look: colours, cards, background, motion, type, gauges, music-reactive light, the mascot and the
 * navigation bar's style. A saved look ("My looks") stores exactly these, and "Reset the look" puts exactly these back. Units, the
 * clock, music, camera, text size, the navigation's buttons and the dashboard are not the look.
 */
export const LOOK_KEYS = [
  'theme', 'accent', 'artAccent', 'autoTheme', 'autoThemeMode', 'dayTheme', 'nightTheme', 'nightStart', 'nightEnd',
  'surface', 'depthStyle', 'glassFinish', 'glassOpacity', 'shape',
  'background', 'wallpaper', 'bgBlur', 'bgDim', 'dashScene', 'sceneIntensity', 'weatherFx',
  'effects', 'motionSpeed', 'albumMotion', 'albumGlow', 'bgMotion', 'transition', 'touchFx',
  'font', 'gaugeStyle', 'standbyStyle', 'dockStyle',
  'beatMode', 'beatSource', 'beatColorMode', 'beatColor', 'beatIntensity', 'beatSensitivity',
  'mascotEnabled', 'mascotVariant', 'mascotMotion', 'mascotAura', 'mascotPlacement', 'mascotScope',
  'mascotX', 'mascotY', 'mascotSize', 'mascotOpacity', 'mascotGlow', 'mascotBeat', 'mascotMirror',
] as const satisfies ReadonlyArray<keyof Settings>;

export type LookKey = (typeof LOOK_KEYS)[number];
/** The values of one complete look. */
export type LookValues = Pick<Settings, LookKey>;

/** A look the owner saved under a name. */
export interface SavedLook {
  /** Lower-case letters, digits and dashes, 1–40 characters; unique in the list. */
  id: string;
  /** Plain text, 1–24 characters. */
  name: string;
  look: LookValues;
}

export const SAVED_LOOK_LIMITS = {
  /** How many looks can be saved. */
  count: 16,
  /** Longest name, in characters. */
  name: 24,
} as const;

export const SAVED_LOOK_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Just the look out of a full set of settings. */
export function lookOf(settings: Settings): LookValues {
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, settings[k]])) as LookValues;
}

/** A name as it is stored: control characters removed, white space collapsed, trimmed, at most SAVED_LOOK_LIMITS.name characters. */
export function cleanLookName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return [...raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, SAVED_LOOK_LIMITS.name).join('').trim();
}
