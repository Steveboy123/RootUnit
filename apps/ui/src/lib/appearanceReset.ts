import { DEFAULT_SETTINGS, type Settings } from '@headunit/shared';

/**
 * Every setting that is part of the look: colours, cards, background, motion, type, gauges, music-reactive light, the mascot and the
 * navigation bar's style. "Reset the look" puts exactly these back. Units, the clock, music, camera, text size, the navigation's
 * buttons and the dashboard are not the look, so they stay as they are.
 */
export const APPEARANCE_KEYS = [
  'theme', 'accent', 'artAccent', 'autoTheme', 'autoThemeMode', 'dayTheme', 'nightTheme', 'nightStart', 'nightEnd',
  'surface', 'depthStyle', 'glassFinish', 'glassOpacity', 'shape',
  'background', 'wallpaper', 'bgBlur', 'bgDim', 'dashScene', 'sceneIntensity', 'weatherFx',
  'effects', 'motionSpeed', 'albumMotion', 'albumGlow', 'bgMotion', 'transition', 'touchFx',
  'font', 'gaugeStyle', 'standbyStyle', 'dockStyle',
  'beatMode', 'beatSource', 'beatColorMode', 'beatColor', 'beatIntensity', 'beatSensitivity',
  'mascotEnabled', 'mascotVariant', 'mascotMotion', 'mascotAura', 'mascotPlacement', 'mascotScope',
  'mascotX', 'mascotY', 'mascotSize', 'mascotOpacity', 'mascotGlow', 'mascotBeat', 'mascotMirror',
] as const satisfies ReadonlyArray<keyof Settings>;

/** The settings patch of "Reset the look". */
export function appearanceResetPatch(): Partial<Settings> {
  return Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<Settings>;
}
