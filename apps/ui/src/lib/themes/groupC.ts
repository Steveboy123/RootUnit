import { definePalette } from './define';
import type { PaletteGroup } from './types';

/**
 * Group C: sand, mint (light) and contrast, sunlit (accessibility: held to 7:1 for text, thick borders, no translucency).
 * Every token is written out by hand (no derive), then finished with definePalette, which computes minDim from the colours so it
 * cannot go stale. groupC.test.ts pins the measured contrast of every rule and the perceptual distance to every other palette.
 *
 * Shared craft rules:
 *   · Light palettes (sand, mint) stack four steps the other way round from the dark ones: the page (bg) is the DARKEST tint, the
 *     second background (bg2: sheets, rail) lighter, the card the lightest, and the raised control fill (cardHi: buttons, chips,
 *     inputs) sits between page and card so it reads as a button on either. Shadows and hairlines carry the rest of the depth.
 *   · In the two mood palettes ink is never black: text is the page's own hue taken very dark, dim is the same hue one step lighter
 *     and still well above 4.5:1. Status colours are re-hued toward the page (olive green and crimson on paper, leaf green on mint)
 *     and darkened until they read at 4.5:1 on every surface, including the raised control fill and the rail.
 *   · Sand and mint differ in the SHAPE of their light, not only the tint: sand has a paper-margin rail lighter than the page, soft
 *     diffuse brown shadows; mint has a rail one step DEEPER than the page, firmer hairlines and a tight cool shadow. Both carry
 *     a barely-there accent glow in the page corner (5-6 %), the only tint that is not a flat colour.
 *   · The accessibility palettes (contrast, sunlit) draw their structure with line, not tone: opaque fills only, a visible border
 *     (border >= 7:1 on every surface; the engine floors its width at 2px for them) and borderStrong at the maximum; text, dim,
 *     accent and status colours all at 7:1 or better on every surface they can sit on (status on its own tinted badge: 6:1, the
 *     most that red and orange allow without turning pink); no shadow (it only adds noise in glare) and no glow. The "no shadow"
 *     is written as a zero-size transparent shadow, not `none`: glass puts an inset highlight in front of it in a comma list,
 *     and `none` inside a list voids the whole declaration.
 *   · accentDefault is a colour the palette's ink works on, with a margin. Mint, contrast and sunlit pick one that already reaches
 *     the text threshold as small text; sand deliberately takes a livelier terracotta (3.5:1 on the page, a fine graphic colour for
 *     buttons, arcs and sliders) and lets the engine's accentText deepen it for small text (a test pins that it stays the same hue).
 */
export const GROUP_C: PaletteGroup<'sand' | 'mint' | 'contrast' | 'sunlit'> = {
  // sand — Warm paper, espresso ink, terracotta. Soft, diffuse brown shadows: a page of heavy cream stock.
  sand: definePalette({
    id: 'sand',
    label: 'Sand',
    blurb: 'Warm paper with terracotta.',
    scheme: 'light',
    bg: '#e9dcc4',
    bg2: '#f6efe1',
    nav: '#f4ecdc',
    card: '#fffbf2',
    cardHi: '#f3e9d5',
    border: 'rgba(92, 62, 28, 0.17)',
    borderStrong: 'rgba(80, 52, 22, 0.6)',
    text: '#2a1c10',
    dim: '#5e4d3b',
    track: 'rgba(92, 62, 28, 0.17)',
    shadow: '0 1px 2px rgba(92, 62, 28, 0.1), 0 10px 24px rgba(92, 62, 28, 0.16)',
    glow: 0.06,
    ok: '#2f6d2c',
    warn: '#855010',
    danger: '#a62440',
    accentDefault: '#b9552b',
    onAccentMode: 'light',
    glassFill: 'rgba(255, 251, 242, 0.62)',
    glassBorder: 'rgba(255, 252, 245, 0.85)',
    glassHighlight: 'rgba(255, 255, 250, 0.95)',
    scrim: '#e9dcc4',
    preview: ['#e9dcc4', '#fffbf2', '#b9552b'],
  }),

  // mint — Pale green-grey page, white-green cards, deep teal. Fresh and crisp: tighter shadows, firmer hairlines.
  mint: definePalette({
    id: 'mint',
    label: 'Mint',
    blurb: 'Pale green-grey with deep teal.',
    scheme: 'light',
    bg: '#d6e8de',
    bg2: '#e9f4ee',
    nav: '#cde2d6',
    card: '#f7fcf9',
    cardHi: '#e3f0e9',
    border: 'rgba(8, 60, 50, 0.17)',
    borderStrong: 'rgba(6, 50, 42, 0.58)',
    text: '#0c2622',
    dim: '#365550',
    track: 'rgba(8, 60, 50, 0.16)',
    shadow: '0 1px 2px rgba(8, 60, 50, 0.08), 0 6px 18px rgba(8, 60, 50, 0.12)',
    glow: 0.05,
    ok: '#256c2d',
    warn: '#845009',
    danger: '#a92f2d',
    accentDefault: '#0a6e69',
    onAccentMode: 'light',
    glassFill: 'rgba(250, 255, 252, 0.6)',
    glassBorder: 'rgba(250, 255, 252, 0.85)',
    glassHighlight: 'rgba(255, 255, 255, 0.95)',
    scrim: '#d6e8de',
    preview: ['#d6e8de', '#f7fcf9', '#0a6e69'],
  }),

  // contrast — Pure black, pure white, yellow #ffd400. Structure from 2px borders, never from tone; opaque everywhere.
  contrast: definePalette({
    id: 'contrast',
    label: 'High contrast',
    blurb: 'Pure black and white with yellow. Maximum legibility.',
    scheme: 'dark',
    bg: '#000000',
    bg2: '#000000',
    nav: '#000000',
    card: '#0f0f0f',
    cardHi: '#202020',
    border: '#adadad',
    borderStrong: '#ffffff',
    text: '#ffffff',
    dim: '#d6d6d6',
    track: '#666666',
    shadow: '0 0 0 0 rgba(0, 0, 0, 0)',
    glow: 0,
    ok: '#3df58a',
    warn: '#ff9124',
    danger: '#ff8a88',
    accentDefault: '#ffd400',
    onAccentMode: 'dark',
    glassFill: 'rgba(15, 15, 15, 0.98)',
    glassBorder: 'rgba(255, 255, 255, 1)',
    glassHighlight: 'rgba(255, 255, 255, 0.5)',
    scrim: '#000000',
    preview: ['#000000', '#202020', '#ffd400'],
  }),

  // sunlit — White page, black ink, bold blue, 2px slate borders; for a screen in direct sunlight. No tint, no shadow, no grey text.
  sunlit: definePalette({
    id: 'sunlit',
    label: 'Sunlit',
    blurb: 'White and black with bold blue, for direct sunlight.',
    scheme: 'light',
    bg: '#ffffff',
    bg2: '#f1f4f9',
    nav: '#f1f4f9',
    card: '#ffffff',
    cardHi: '#e9eef6',
    border: '#3a4350',
    borderStrong: '#000000',
    text: '#000000',
    dim: '#262e3c',
    track: '#8b94a3',
    shadow: '0 0 0 0 rgba(0, 0, 0, 0)',
    glow: 0,
    ok: '#00592d',
    warn: '#753f00',
    danger: '#9e0005',
    accentDefault: '#003bc4',
    onAccentMode: 'light',
    glassFill: 'rgba(255, 255, 255, 0.98)',
    glassBorder: 'rgba(0, 0, 0, 1)',
    glassHighlight: 'rgba(255, 255, 255, 1)',
    scrim: '#ffffff',
    preview: ['#ffffff', '#e9eef6', '#003bc4'],
  }),
};
