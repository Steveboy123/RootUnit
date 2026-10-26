import { definePalette } from './define';
import type { PaletteGroup } from './types';

/**
 * The four palettes the app shipped with. Their original tokens (bg … glow) are copied value-for-value from the
 * `[data-theme=…]` blocks that used to live in styles.css (a "legacy snapshot" test pins them); tokens a block did not set
 * were inherited from midnight, and are written out here with that same inherited value.
 * The tokens that did not exist before (nav, borderStrong, glass*, scrim, accentDefault, preview) are new.
 * Only Daylight's ok / warn / danger differ from what it used to inherit: midnight's light greens and ambers measure
 * 1.4–2:1 on Daylight's pale background, so they are darkened to pass the 3:1 rule.
 */

/** midnight's box-shadow, which carbon and ember inherited. */
const SHADOW_DARK = '0 10px 28px rgba(0, 0, 0, 0.35)';
/** midnight's status colours, which every dark core palette inherited. */
const STATUS_DARK = { ok: '#34d399', warn: '#fbbf24', danger: '#f87171' } as const;

export const CORE: PaletteGroup<'midnight' | 'carbon' | 'daylight' | 'ember'> = {
  midnight: definePalette({
    id: 'midnight',
    label: 'Midnight',
    blurb: 'Navy ink with a cyan edge. The classic.',
    scheme: 'dark',
    bg: '#070a12',
    bg2: '#0b101c',
    nav: '#0b101c',
    card: 'rgba(255, 255, 255, 0.055)',
    cardHi: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.09)',
    borderStrong: 'rgba(255, 255, 255, 0.32)',
    text: '#eef3fb',
    dim: '#8d98ad',
    track: 'rgba(255, 255, 255, 0.13)',
    shadow: SHADOW_DARK,
    glow: 0.14,
    ...STATUS_DARK,
    accentDefault: '#3dd5f3',
    onAccentMode: 'auto',
    glassFill: 'rgba(255, 255, 255, 0.08)',
    glassBorder: 'rgba(255, 255, 255, 0.16)',
    glassHighlight: 'rgba(255, 255, 255, 0.26)',
    scrim: '#070a12',
    preview: ['#070a12', '#20232a', '#3dd5f3'],
  }),

  carbon: definePalette({
    id: 'carbon',
    label: 'Carbon',
    blurb: 'Neutral graphite. Quiet and easy on the eyes.',
    scheme: 'dark',
    bg: '#0a0a0c',
    bg2: '#111114',
    nav: '#111114',
    card: 'rgba(255, 255, 255, 0.05)',
    cardHi: 'rgba(255, 255, 255, 0.095)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.32)',
    text: '#f1f1f3',
    dim: '#8e8e98',
    track: 'rgba(255, 255, 255, 0.13)',
    shadow: SHADOW_DARK,
    glow: 0.07,
    ...STATUS_DARK,
    accentDefault: '#7c9cff',
    onAccentMode: 'auto',
    glassFill: 'rgba(255, 255, 255, 0.08)',
    glassBorder: 'rgba(255, 255, 255, 0.16)',
    glassHighlight: 'rgba(255, 255, 255, 0.26)',
    scrim: '#0a0a0c',
    preview: ['#0a0a0c', '#212123', '#7c9cff'],
  }),

  daylight: definePalette({
    id: 'daylight',
    label: 'Daylight',
    blurb: 'Cool grey-blue and white. Clear in a bright cabin.',
    scheme: 'light',
    bg: '#e6ecf4',
    bg2: '#f4f7fb',
    nav: '#f4f7fb',
    card: '#ffffff',
    cardHi: '#eaf0f8',
    border: 'rgba(12, 30, 60, 0.1)',
    borderStrong: 'rgba(12, 30, 60, 0.45)',
    text: '#0e1a2c',
    dim: '#5a687f',
    track: 'rgba(12, 30, 60, 0.12)',
    shadow: '0 4px 14px rgba(20, 40, 80, 0.12)',
    glow: 0,
    ok: '#0f7a55',
    warn: '#a35a00',
    danger: '#c0302d',
    accentDefault: '#0f6bb5',
    onAccentMode: 'auto',
    glassFill: 'rgba(255, 255, 255, 0.62)',
    glassBorder: 'rgba(255, 255, 255, 0.85)',
    glassHighlight: 'rgba(255, 255, 255, 0.95)',
    scrim: '#e6ecf4',
    preview: ['#e6ecf4', '#ffffff', '#0f6bb5'],
  }),

  ember: definePalette({
    id: 'ember',
    label: 'Ember',
    blurb: 'Warm black with an orange glow. Gentle at night.',
    scheme: 'dark',
    bg: '#0d0504',
    bg2: '#150806',
    nav: '#150806',
    card: 'rgba(255, 130, 70, 0.07)',
    cardHi: 'rgba(255, 130, 70, 0.13)',
    border: 'rgba(255, 140, 80, 0.15)',
    borderStrong: 'rgba(255, 150, 90, 0.45)',
    text: '#ffdcc6',
    dim: '#b07a63',
    track: 'rgba(255, 140, 80, 0.17)',
    shadow: SHADOW_DARK,
    glow: 0.1,
    ...STATUS_DARK,
    accentDefault: '#fb923c',
    onAccentMode: 'auto',
    glassFill: 'rgba(255, 150, 90, 0.08)',
    glassBorder: 'rgba(255, 160, 100, 0.2)',
    glassHighlight: 'rgba(255, 190, 140, 0.3)',
    scrim: '#0d0504',
    preview: ['#0d0504', '#2c150d', '#fb923c'],
  }),
};
