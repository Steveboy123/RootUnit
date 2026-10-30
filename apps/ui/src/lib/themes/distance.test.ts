import { THEME_IDS } from '@headunit/shared';
import { describe, expect, it } from 'vitest';
import { PALETTES, composite, toRgba, type Palette } from './index';

/** Rough perceptual distance between two palettes: the page, a raised card, the text and the accent, in RGB space (0..~1700). */
function distance(a: Palette, b: Palette): number {
  const d = (x: string | ReturnType<typeof toRgba>, y: string | ReturnType<typeof toRgba>) => {
    const p = toRgba(x);
    const q = toRgba(y);
    return Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b);
  };
  return d(a.bg, b.bg) + d(composite(a.cardHi, a.bg), composite(b.cardHi, b.bg)) + d(a.text, b.text) + d(a.accentDefault, b.accentDefault);
}

describe('palettes are not recolours of each other', () => {
  it('every pair differs at least three quarters as much as the closest pair v2 shipped', () => {
    const v2 = ['midnight', 'carbon', 'amoled', 'ember', 'ocean', 'forest', 'aurora', 'synthwave', 'nord', 'mocha', 'crimson', 'royal', 'daylight', 'sand', 'mint', 'contrast', 'sunlit'] as const;
    let v2Min = Infinity;
    for (let i = 0; i < v2.length; i++) for (let j = i + 1; j < v2.length; j++) v2Min = Math.min(v2Min, distance(PALETTES[v2[i]!], PALETTES[v2[j]!]));
    const close: string[] = [];
    for (let i = 0; i < THEME_IDS.length; i++)
      for (let j = i + 1; j < THEME_IDS.length; j++) {
        const a = PALETTES[THEME_IDS[i]!];
        const b = PALETTES[THEME_IDS[j]!];
        const dist = distance(a, b);
        if (dist < v2Min * 0.75) close.push(`${a.id}~${b.id}: ${Math.round(dist)} (< ${Math.round(v2Min * 0.75)})`);
      }
    expect(close).toEqual([]);
  });
});
