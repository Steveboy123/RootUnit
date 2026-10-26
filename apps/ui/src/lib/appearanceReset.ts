import { DEFAULT_SETTINGS, LOOK_KEYS, type Settings } from '@headunit/shared';

/** The look settings "Reset the look" puts back: the same keys a saved look holds (shared LOOK_KEYS). */
export const APPEARANCE_KEYS = LOOK_KEYS;

/** The settings patch of "Reset the look". */
export function appearanceResetPatch(): Partial<Settings> {
  return Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<Settings>;
}
