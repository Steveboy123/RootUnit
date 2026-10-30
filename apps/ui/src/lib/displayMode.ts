import type { Settings } from '@headunit/shared';

export type DisplayMode = 'auto' | 'day' | 'night' | 'custom';

/** The Quick Panel's three-way switch, read back from the settings: automatic, forced day, forced night (or neither: a look picked by hand). */
export function displayModeOf(s: Pick<Settings, 'autoTheme' | 'theme' | 'dayTheme' | 'nightTheme'>): DisplayMode {
  if (s.autoTheme) return 'auto';
  if (s.theme === s.nightTheme) return 'night';
  if (s.theme === s.dayTheme) return 'day';
  return 'custom';
}

/** The settings patch that makes the Quick Panel's choice true. */
export function displayModePatch(mode: Exclude<DisplayMode, 'custom'>, s: Pick<Settings, 'dayTheme' | 'nightTheme'>): Partial<Settings> {
  if (mode === 'auto') return { autoTheme: true };
  return { autoTheme: false, theme: mode === 'night' ? s.nightTheme : s.dayTheme };
}
