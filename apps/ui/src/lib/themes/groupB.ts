import { definePalette } from './define';
import type { PaletteGroup } from './types';

/**
 * Group B: synthwave, crimson, mocha, royal, forest. Every token is written out by hand (no derive), then finished with
 * definePalette, which computes minDim from the colours so it cannot go stale. groupB.test.ts pins the measured contrast of every
 * rule and the perceptual distance to every other palette.
 *
 * Shared craft rules (so the five read as one family of "character" palettes, yet none is a recolour of another):
 *   · Depth is four steps: bg (the page) < bg2 (sheets) < card < cardHi (raised controls). nav (rail, top bar) sits between bg and bg2.
 *     Cards and cardHi are translucent tints of the palette's own material (violet glass, red lacquer, latte cream, brass, moss), so
 *     they pick up whatever sits behind them.
 *   · Large areas stay restrained; the accent is the only saturated colour that covers any area. Secondary notes (synthwave's cyan,
 *     royal's champagne) live in thin things only: specular lines, tracks, borders, status colours.
 *   · text / dim is a real hierarchy: text is 9:1+ on every surface (twice the 4.5 floor), dim is a calm ~9:1 on the page and never
 *     below 6:1 on any card, never the grey-on-grey 4.5 floor.
 *   · borders read on their own (hairline on a card); borderStrong reaches 3:1 on the page (outline surface, focus rings).
 *   · ok / warn / danger are re-hued toward each palette instead of the stock green / amber / red, and kept apart from the accent
 *     (a gold accent never shares a hue with its warning colour; a red accent never shares one with its danger colour).
 *   · box-shadow blur stays <= 28px (spec §9).
 */
export const GROUP_B: PaletteGroup<'synthwave' | 'crimson' | 'mocha' | 'royal' | 'forest'> = {
  // synthwave — 80s night drive: deep violet, hot-pink accent, a cyan second light on the edges. Highest glow of the set.
  synthwave: definePalette({
    id: 'synthwave',
    label: 'Synthwave',
    blurb: 'Deep violet night with hot pink neon and a cyan edge.',
    scheme: 'dark',
    bg: '#180a2e',
    bg2: '#210d43',
    nav: '#1b0b38',
    card: 'rgba(230, 110, 255, 0.085)',
    cardHi: 'rgba(235, 120, 255, 0.135)',
    border: 'rgba(255, 120, 225, 0.22)',
    borderStrong: 'rgba(255, 140, 235, 0.6)',
    text: '#fbeaff',
    dim: '#c8abe8',
    track: 'rgba(110, 225, 255, 0.2)',
    shadow: '0 10px 28px rgba(10, 0, 30, 0.55)',
    glow: 0.26,
    ok: '#37e6d0',
    warn: '#ffc94f',
    danger: '#ff6a6a',
    accentDefault: '#ff4dac',
    onAccentMode: 'dark',
    glassFill: 'rgba(220, 130, 255, 0.08)',
    glassBorder: 'rgba(255, 150, 235, 0.3)',
    glassHighlight: 'rgba(170, 240, 255, 0.4)',
    scrim: '#180a2e',
    preview: ['#180a2e', '#34194a', '#ff4dac'],
  }),

  // crimson — Red-lacquer black, racing-red accent, cool instrument-white text. Aggressive but every red passes.
  crimson: definePalette({
    id: 'crimson',
    label: 'Crimson',
    blurb: 'Red-black with racing red. Sharp and sporty.',
    scheme: 'dark',
    bg: '#14050b',
    bg2: '#1e0912',
    nav: '#180711',
    card: 'rgba(255, 35, 85, 0.075)',
    cardHi: 'rgba(255, 50, 92, 0.125)',
    border: 'rgba(255, 82, 112, 0.2)',
    borderStrong: 'rgba(255, 105, 125, 0.62)',
    text: '#f6eded',
    dim: '#c9a3a6',
    track: 'rgba(255, 235, 235, 0.15)',
    shadow: '0 10px 28px rgba(8, 0, 2, 0.55)',
    glow: 0.14,
    ok: '#4fd48a',
    warn: '#ffb02e',
    danger: '#ff7b85',
    accentDefault: '#ff3547',
    onAccentMode: 'dark',
    glassFill: 'rgba(255, 90, 100, 0.07)',
    glassBorder: 'rgba(255, 110, 120, 0.24)',
    glassHighlight: 'rgba(255, 190, 195, 0.32)',
    scrim: '#14050b',
    preview: ['#14050b', '#310b15', '#ff3547'],
  }),

  // mocha — Coffee-brown with latte-cream cards and a rose-gold accent. The lightest, softest dark palette.
  mocha: definePalette({
    id: 'mocha',
    label: 'Mocha',
    blurb: 'Warm coffee brown with rose-gold.',
    scheme: 'dark',
    bg: '#20150d',
    bg2: '#2d1d13',
    nav: '#271910',
    card: 'rgba(255, 205, 160, 0.07)',
    cardHi: 'rgba(255, 205, 160, 0.125)',
    border: 'rgba(255, 228, 205, 0.13)',
    borderStrong: 'rgba(255, 228, 205, 0.42)',
    text: '#f7e9dd',
    dim: '#ccb6a4',
    track: 'rgba(255, 228, 205, 0.16)',
    shadow: '0 10px 28px rgba(12, 6, 2, 0.45)',
    glow: 0.1,
    ok: '#9ccf8e',
    warn: '#edc15f',
    danger: '#e85a50',
    accentDefault: '#f0a894',
    onAccentMode: 'dark',
    glassFill: 'rgba(255, 228, 205, 0.07)',
    glassBorder: 'rgba(255, 228, 205, 0.2)',
    glassHighlight: 'rgba(255, 240, 225, 0.3)',
    scrim: '#20150d',
    preview: ['#20150d', '#3c2c1f', '#f0a894'],
  }),

  // royal — Instrument-cluster black, brass hairlines, champagne text, one warm gold accent. Luxury, never loud.
  royal: definePalette({
    id: 'royal',
    label: 'Royal',
    blurb: 'Black, brass and champagne gold.',
    scheme: 'dark',
    bg: '#090806',
    bg2: '#15120c',
    nav: '#0f0d08',
    card: 'rgba(255, 228, 170, 0.05)',
    cardHi: 'rgba(255, 230, 175, 0.1)',
    border: 'rgba(226, 188, 92, 0.26)',
    borderStrong: 'rgba(240, 196, 110, 0.6)',
    text: '#f4e9cf',
    dim: '#b9ac8a',
    track: 'rgba(255, 235, 190, 0.14)',
    shadow: '0 10px 28px rgba(0, 0, 0, 0.6)',
    glow: 0.08,
    ok: '#5ccf95',
    warn: '#fb8c3a',
    danger: '#f0605a',
    accentDefault: '#e2bc5c',
    onAccentMode: 'dark',
    glassFill: 'rgba(255, 220, 150, 0.06)',
    glassBorder: 'rgba(240, 200, 120, 0.26)',
    glassHighlight: 'rgba(255, 236, 180, 0.34)',
    scrim: '#090806',
    preview: ['#090806', '#221e17', '#e2bc5c'],
  }),

  // forest — Moss-green black, leaf-light cards, a fresh emerald-lime accent. Natural and calm.
  forest: definePalette({
    id: 'forest',
    label: 'Forest',
    blurb: 'Deep moss green with fresh emerald light.',
    scheme: 'dark',
    bg: '#07130c',
    bg2: '#0e2217',
    nav: '#0b1a11',
    card: 'rgba(130, 235, 165, 0.06)',
    cardHi: 'rgba(135, 235, 170, 0.115)',
    border: 'rgba(150, 240, 180, 0.14)',
    borderStrong: 'rgba(160, 245, 190, 0.45)',
    text: '#e8f4e6',
    dim: '#a0bda5',
    track: 'rgba(150, 235, 180, 0.17)',
    shadow: '0 10px 28px rgba(0, 8, 2, 0.5)',
    glow: 0.14,
    ok: '#3fd9b4',
    warn: '#f2c14e',
    danger: '#f27d6b',
    accentDefault: '#79e06a',
    onAccentMode: 'dark',
    glassFill: 'rgba(150, 240, 180, 0.065)',
    glassBorder: 'rgba(165, 245, 195, 0.2)',
    glassHighlight: 'rgba(210, 255, 225, 0.3)',
    scrim: '#07130c',
    preview: ['#07130c', '#162c1e', '#79e06a'],
  }),
};
