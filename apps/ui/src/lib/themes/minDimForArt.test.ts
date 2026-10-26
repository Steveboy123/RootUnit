import { describe, expect, it } from 'vitest';
import {
  MAX_DIM,
  PALETTE_LIST,
  PALETTES,
  composite,
  contrastRatio,
  greyOfLuminance,
  luminance,
  minDimFor,
  minDimForArt,
  overArt,
  overArtChecker,
  passesOverArt,
  thresholdsFor,
  worstCaseArt,
  worstCaseLuminance,
} from './index';

const LUMS = [0, 0.001, 0.01, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];

describe('greyOfLuminance', () => {
  it('is exact at the ends and round-trips close to the luminance asked for', () => {
    expect(greyOfLuminance(0)).toMatchObject({ r: 0, g: 0, b: 0, a: 1 });
    expect(greyOfLuminance(1)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(greyOfLuminance(1, 'light')).toMatchObject({ r: 255 });
    for (const l of LUMS) {
      const g = greyOfLuminance(l);
      expect(g.r).toBe(g.g);
      expect(g.g).toBe(g.b);
      expect(Math.abs(luminance(g) - l), String(l)).toBeLessThan(0.012);
    }
  });

  it('never rounds toward the easier picture: up for dark palettes, down for light ones', () => {
    for (const l of LUMS) {
      expect(luminance(greyOfLuminance(l, 'dark'))).toBeGreaterThanOrEqual(l - 1e-9);
      expect(luminance(greyOfLuminance(l, 'light'))).toBeLessThanOrEqual(l + 1e-9);
    }
  });

  it('clamps out-of-range input and treats NaN as the worst case', () => {
    expect(greyOfLuminance(-3).r).toBe(0);
    expect(greyOfLuminance(7).r).toBe(255);
    expect(greyOfLuminance(Number.NaN, 'dark').r).toBe(255);
    expect(greyOfLuminance(Number.NaN, 'light').r).toBe(0);
    expect(greyOfLuminance(Number.POSITIVE_INFINITY, 'dark').r).toBe(255);
  });
});

describe('minDimForArt', () => {
  it('equals palette.minDim at the worst-case picture, for every palette (white behind dark palettes, black behind light ones)', () => {
    for (const p of PALETTE_LIST) {
      expect(worstCaseLuminance(p.scheme), p.id).toBe(luminance(worstCaseArt(p.scheme)));
      expect(minDimForArt(p, worstCaseLuminance(p.scheme)), p.id).toBe(p.minDim);
      expect(minDimForArt(p, worstCaseLuminance(p.scheme)), p.id).toBe(minDimFor(p));
    }
    // The wording of the task: "white art". True as stated for every dark palette.
    for (const p of PALETTE_LIST.filter((q) => q.scheme === 'dark')) expect(minDimForArt(p, 1), p.id).toBe(p.minDim);
  });

  it('is monotonic: brighter art needs more dim on a dark palette, darker art needs more on a light one', () => {
    for (const p of PALETTE_LIST) {
      const dims = LUMS.map((l) => minDimForArt(p, l));
      for (let i = 1; i < dims.length; i++) {
        if (p.scheme === 'dark') expect(dims[i]!, `${p.id} @${LUMS[i]}`).toBeGreaterThanOrEqual(dims[i - 1]!);
        else expect(dims[i]!, `${p.id} @${LUMS[i]}`).toBeLessThanOrEqual(dims[i - 1]!);
      }
    }
  });

  it('is the SMALLEST dim that passes: contrast meets every threshold at the result and something fails one percent below', () => {
    for (const p of PALETTE_LIST) {
      const t = thresholdsFor(p);
      for (const l of LUMS) {
        const d = minDimForArt(p, l);
        const art = greyOfLuminance(l, p.scheme);
        expect(d, `${p.id} @${l}`).toBeGreaterThanOrEqual(0);
        expect(d, `${p.id} @${l}`).toBeLessThanOrEqual(MAX_DIM);
        const r = overArt(p, d, art);
        for (const [name, ratio, min] of [
          ['text', r.text, t.textOverArt],
          ['dim', r.dim, t.dimOverArt],
          ['glass text', r.glassText, t.textOverArt],
          ['glass dim', r.glassDim, t.dimOverArt],
          ['card text', r.cardText, t.textOverArt],
          ['card dim', r.cardDim, t.dimOverArt],
          ['cardHi text', r.cardHiText, t.textOverArt],
          ['cardHi dim', r.cardHiDim, t.dimOverArt],
        ] as const) {
          expect(ratio, `${p.id} @${l}: ${name} at ${d}%`).toBeGreaterThanOrEqual(min);
        }
        expect(passesOverArt(p, d, art), `${p.id} @${l}`).toBe(true);
        if (d > 0) expect(passesOverArt(p, d - 1, art), `${p.id} @${l} at ${d - 1}%`).toBe(false);
      }
    }
  });

  it('holds for a coloured picture of the same luminance too (the scrim is composited per channel, so check real colours)', () => {
    const t = thresholdsFor(PALETTES.midnight);
    for (const rgb of [
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 255, b: 0, a: 1 },
      { r: 30, g: 60, b: 255, a: 1 },
      { r: 255, g: 220, b: 40, a: 1 },
      { r: 230, g: 80, b: 200, a: 1 },
      { r: 40, g: 200, b: 220, a: 1 },
    ]) {
      const l = luminance(rgb);
      const d = minDimForArt(PALETTES.midnight, l);
      const r = overArt(PALETTES.midnight, d, rgb);
      // Saturated pictures can come out a hair darker or lighter than the grey stand-in; the planner adds a margin for that.
      expect(r.text, JSON.stringify(rgb)).toBeGreaterThanOrEqual(t.textOverArt - 0.35);
      expect(r.cardHiText, JSON.stringify(rgb)).toBeGreaterThanOrEqual(t.textOverArt - 0.35);
    }
  });

  it('asks for very little with art that is already dark enough, and a lot with art that is as bright as it gets', () => {
    for (const p of PALETTE_LIST.filter((q) => q.scheme === 'dark')) {
      expect(minDimForArt(p, 0.02), p.id).toBeLessThan(25);
      expect(minDimForArt(p, 1), p.id).toBeGreaterThan(55);
    }
  });

  it('answers with a whole percent in 0..90 for any number it is given', () => {
    for (const p of PALETTE_LIST) {
      for (const l of [Number.NaN, -1, 2, Infinity, -Infinity]) {
        const d = minDimForArt(p, l);
        expect(Number.isInteger(d), `${p.id} ${l}`).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(MAX_DIM);
      }
    }
  });

  it('leaves minDimFor and overArt alone when no picture is passed (backwards compatible)', () => {
    for (const p of PALETTE_LIST) {
      expect(overArt(p, 50)).toEqual(overArt(p, 50, worstCaseArt(p.scheme)));
      expect(passesOverArt(p, p.minDim)).toBe(true);
      if (p.minDim > 0) expect(passesOverArt(p, p.minDim - 1)).toBe(false);
      const backdrop = composite({ ...composite(p.scrim, '#000000'), a: 0.5 }, worstCaseArt(p.scheme));
      expect(contrastRatio(p.text, backdrop)).toBeGreaterThan(1);
    }
  });
});

describe('overArtChecker (the fast form of passesOverArt used for the Backdrop floor)', () => {
  it('gives exactly the answers of passesOverArt, for every palette, many dims and many picture colours', () => {
    const colors: Array<string | { r: number; g: number; b: number; a: number }> = ['#ffffff', '#000000', '#ff0000', '#00ff88', '#3355aa', '#ffd400', '#1a1a1a', '#808080'];
    for (let i = 0; i < 40; i++) colors.push({ r: (i * 53) % 256, g: (i * 97) % 256, b: (i * 193) % 256, a: 1 });
    for (const p of PALETTE_LIST) {
      const passes = overArtChecker(p);
      for (const c of colors) for (let d = 0; d <= MAX_DIM; d += 3) expect(passes(d, c), `${p.id} ${JSON.stringify(c)} ${d}`).toBe(passesOverArt(p, d, c));
      // out-of-range dims are clamped the same way
      expect(passes(-10, '#ffffff')).toBe(passesOverArt(p, -10, '#ffffff'));
      expect(passes(500, '#ffffff')).toBe(passesOverArt(p, 500, '#ffffff'));
    }
  });
});
