import { definePalette } from './define';
import type { PaletteGroup } from './types';

/**
 * Group A: amoled, ocean, nord, aurora. Every token is written out by hand (no derive), then finished with definePalette, which
 * computes minDim from the colours so it cannot go stale. groupA.test.ts pins the measured contrast of every rule and the
 * perceptual distance to every other palette.
 *
 * Shared craft rules (so the four read as one family but not as recolours of each other):
 *   · Depth is four steps: bg (the page) < bg2 (sheets, rail) < card < cardHi (raised controls). Cards and cardHi are translucent
 *     tints of the palette's own hue, so they pick up whatever sits behind them.
 *   · Large areas stay desaturated; the accent is the only saturated colour on screen.
 *   · text / dim is a real hierarchy (dim is about 8:1 on the page, never the grey-on-grey 4.5 floor).
 *   · borders read on their own (hairline on a card), borderStrong reaches 3:1 on the page (outline surface, focus rings).
 *   · ok / warn / danger are re-hued toward the palette instead of the stock green / amber / red.
 *   · accentDefault is a colour the palette's own ink works on: AMOLED's electric blue is tuned so white ink and the page both reach
 *     4.5:1 on it; the other three take the standard dark ink.
 */
export const GROUP_A: PaletteGroup<'amoled' | 'ocean' | 'nord' | 'aurora'> = {
  // amoled — True #000, hairline cards, crisp white, electric blue. Pixels stay off wherever nothing is drawn.
  amoled: definePalette({
    id: 'amoled',
    label: 'AMOLED',
    blurb: 'True black with hairline cards and an electric blue edge.',
    scheme: 'dark',
    bg: '#000000',
    bg2: '#0b0c10',
    nav: '#000000',
    card: 'rgba(255, 255, 255, 0.045)',
    cardHi: 'rgba(255, 255, 255, 0.09)',
    border: 'rgba(255, 255, 255, 0.14)',
    borderStrong: 'rgba(255, 255, 255, 0.42)',
    text: '#ffffff',
    dim: '#a3abba',
    track: 'rgba(255, 255, 255, 0.12)',
    shadow: '0 8px 26px rgba(0, 0, 0, 0.7)',
    glow: 0.07,
    ok: '#3ddc97',
    warn: '#ffb43b',
    danger: '#ff5c6c',
    accentDefault: '#256aff',
    onAccentMode: 'light',
    glassFill: 'rgba(230, 238, 255, 0.07)',
    glassBorder: 'rgba(215, 228, 255, 0.2)',
    glassHighlight: 'rgba(235, 242, 255, 0.3)',
    scrim: '#000000',
    preview: ['#000000', '#171717', '#256aff'],
  }),

  // ocean — Deep teal-blue depths, teal-tinted glass cards, aqua light. Cool and calm.
  ocean: definePalette({
    id: 'ocean',
    label: 'Ocean',
    blurb: 'Deep teal-blue with aqua light.',
    scheme: 'dark',
    bg: '#04202b',
    bg2: '#082a38',
    nav: '#062431',
    card: 'rgba(100, 215, 240, 0.06)',
    cardHi: 'rgba(110, 220, 245, 0.115)',
    border: 'rgba(130, 225, 245, 0.14)',
    borderStrong: 'rgba(140, 230, 250, 0.45)',
    text: '#e6f8fc',
    dim: '#8fbccb',
    track: 'rgba(130, 225, 245, 0.17)',
    shadow: '0 10px 28px rgba(0, 6, 12, 0.45)',
    glow: 0.18,
    ok: '#4ddf93',
    warn: '#f5c25a',
    danger: '#ff7a7f',
    accentDefault: '#2dd4cf',
    onAccentMode: 'auto',
    glassFill: 'rgba(140, 225, 245, 0.07)',
    glassBorder: 'rgba(160, 235, 250, 0.2)',
    glassHighlight: 'rgba(200, 245, 255, 0.32)',
    scrim: '#04202b',
    preview: ['#04202b', '#103642', '#2dd4cf'],
  }),

  // nord — Polar-night slate, frost cyan, aurora-borealis status colours. Quiet and elegant, deliberately lower contrast.
  nord: definePalette({
    id: 'nord',
    label: 'Nord',
    blurb: 'Slate blue-grey polar night with frost cyan.',
    scheme: 'dark',
    bg: '#272d38',
    bg2: '#2e3541',
    nav: '#2e3541',
    card: 'rgba(216, 222, 233, 0.06)',
    cardHi: 'rgba(216, 222, 233, 0.105)',
    border: 'rgba(216, 222, 233, 0.12)',
    borderStrong: 'rgba(216, 222, 233, 0.5)',
    text: '#eceff4',
    dim: '#b9c3d5',
    track: 'rgba(216, 222, 233, 0.15)',
    shadow: '0 10px 26px rgba(12, 16, 24, 0.35)',
    glow: 0.06,
    ok: '#a3be8c',
    warn: '#ebcb8b',
    danger: '#ef9199',
    accentDefault: '#88c0d0',
    onAccentMode: 'auto',
    glassFill: 'rgba(229, 233, 240, 0.07)',
    glassBorder: 'rgba(229, 233, 240, 0.2)',
    glassHighlight: 'rgba(236, 239, 244, 0.3)',
    scrim: '#272d38',
    preview: ['#272d38', '#3a404b', '#88c0d0'],
  }),

  // aurora — Indigo-violet night sky, soft lavender accent, mint-teal as its second light. Subtle cool glow.
  aurora: definePalette({
    id: 'aurora',
    label: 'Aurora',
    blurb: 'Indigo night with violet and teal light.',
    scheme: 'dark',
    bg: '#0b0a24',
    bg2: '#16143a',
    nav: '#110f31',
    card: 'rgba(170, 150, 255, 0.07)',
    cardHi: 'rgba(175, 160, 255, 0.125)',
    border: 'rgba(185, 170, 255, 0.15)',
    borderStrong: 'rgba(195, 185, 255, 0.52)',
    text: '#ece9ff',
    dim: '#a9a5d6',
    track: 'rgba(185, 170, 255, 0.17)',
    shadow: '0 10px 28px rgba(4, 2, 20, 0.5)',
    glow: 0.2,
    ok: '#5ee6c5',
    warn: '#f3c969',
    danger: '#ff7a95',
    accentDefault: '#a695ff',
    onAccentMode: 'auto',
    glassFill: 'rgba(190, 175, 255, 0.07)',
    glassBorder: 'rgba(205, 195, 255, 0.2)',
    glassHighlight: 'rgba(200, 230, 255, 0.34)',
    scrim: '#0b0a24',
    preview: ['#0b0a24', '#201d3f', '#a695ff'],
  }),
};
