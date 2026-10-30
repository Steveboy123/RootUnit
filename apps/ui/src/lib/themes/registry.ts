import { THEME_IDS, type ThemeId } from '@headunit/shared';
import { CORE } from './core';
import { GROUP_A } from './groupA';
import { GROUP_B } from './groupB';
import { GROUP_C } from './groupC';
import { GROUP_D } from './groupD';
import { GROUP_E } from './groupE';
import { GROUP_F } from './groupF';
import type { Palette } from './types';

/**
 * Every palette, keyed by ThemeId. The compiler enforces that all ids are present (and none extra) because the record type is
 * `Record<ThemeId, Palette>` and ThemeId derives from THEME_IDS in @headunit/shared. Each group file owns its own ids; this
 * file only merges them. Groups A–C and the core four are the v2 palettes, unchanged; D and E are new in RootUnit, F in 3.1.
 */
export const PALETTES: Record<ThemeId, Palette> = { ...CORE, ...GROUP_A, ...GROUP_B, ...GROUP_C, ...GROUP_D, ...GROUP_E, ...GROUP_F };

/** A palette by id. An unknown id (stale data from a different build) falls back to midnight instead of throwing. */
export function paletteOf(id: ThemeId): Palette {
  // Own keys only: an id like 'constructor' or '__proto__' must not resolve to something on Object.prototype.
  return typeof id === 'string' && Object.hasOwn(PALETTES, id) ? PALETTES[id] : PALETTES.midnight;
}

/** Palettes in the order tiles are shown (THEME_IDS order: dark, light, high-visibility). */
export const PALETTE_LIST: readonly Palette[] = THEME_IDS.map((id) => PALETTES[id]);

/** The two palettes built for direct sunlight and low vision (held to 7:1 text contrast). */
export const HIGH_VISIBILITY: ReadonlySet<ThemeId> = new Set<ThemeId>(['contrast', 'sunlit']);
