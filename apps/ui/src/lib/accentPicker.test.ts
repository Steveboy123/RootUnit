import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@headunit/shared';
import { hexToHsl, hslToHex, pickAccent, ratioText } from './accentPicker';
import { APPEARANCE_KEYS, appearanceResetPatch } from './appearanceReset';
import { PALETTE_LIST, contrastRatio, paletteOf } from './themes';

describe('custom accent', () => {
  it('converts hue / saturation / lightness to the lowercase #rrggbb the validator stores', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(360, 100, 50)).toBe('#ff0000');
    expect(hslToHex(-120, 100, 50)).toBe('#0000ff');
  });

  it('round-trips to within a rounding step', () => {
    for (const hex of ['#3dd5f3', '#7c9cff', '#a78bfa', '#34d399', '#fbbf24', '#fb923c', '#f472b6', '#f87171']) {
      const { h, s, l } = hexToHsl(hex);
      const back = hexToHsl(hslToHex(h, s, l));
      expect(Math.abs(back.h - h) <= 2 || Math.abs(back.h - h) >= 358, hex).toBe(true);
      expect(Math.abs(back.l - l)).toBeLessThanOrEqual(1);
    }
    expect(hexToHsl('not a colour')).toMatchObject({ s: 85 });
  });

  it('always reaches 3:1 against the background, for every hue and lightness the sliders offer, on every palette', () => {
    for (const p of PALETTE_LIST)
      for (let hue = 0; hue < 360; hue += 9)
        for (let light = 20; light <= 85; light += 5) {
          const r = pickAccent(p, hue, light);
          expect(r.accent, `${p.id} ${hue} ${light}`).toMatch(/^#[0-9a-f]{6}$/);
          const ratio = contrastRatio(r.accent, p.bg);
          expect(ratio, `${p.id} h${hue} l${light} -> ${r.accent}`).toBeGreaterThanOrEqual(3);
          expect(Math.abs(r.ratio - ratio)).toBeLessThan(1e-9);
          expect(contrastRatio(r.onAccent, r.accent), `${p.id} ink`).toBeGreaterThanOrEqual(4.5);
        }
  });

  it('only nudges a colour that needed it, and says so', () => {
    const midnight = paletteOf('midnight');
    expect(pickAccent(midnight, 190, 60)).toMatchObject({ adjusted: false });
    const dark = pickAccent(midnight, 240, 20);
    expect(dark.adjusted).toBe(true);
    expect(dark.accent).not.toBe(dark.requested);
    // On a light palette it is the pale colours that need darkening.
    const daylight = paletteOf('daylight');
    expect(pickAccent(daylight, 50, 85).adjusted).toBe(true);
    expect(pickAccent(daylight, 220, 35).adjusted).toBe(false);
  });

  it('clamps stray slider values instead of producing a wild colour', () => {
    const p = paletteOf('midnight');
    expect(pickAccent(p, 9999, -50).accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(pickAccent(p, Number.NaN, 50).accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('writes contrast the way people read it', () => {
    expect(ratioText(3)).toBe('3.0:1');
    expect(ratioText(4.59)).toBe('4.5:1');
    expect(ratioText(11.14)).toBe('11.1:1');
  });
});

describe('reset the look', () => {
  const patch = appearanceResetPatch();

  it('puts back exactly the look settings, at their defaults', () => {
    expect(Object.keys(patch).sort()).toEqual([...APPEARANCE_KEYS].sort());
    for (const k of APPEARANCE_KEYS) expect(patch[k], k).toEqual(DEFAULT_SETTINGS[k]);
  });

  it('leaves what is not the look alone', () => {
    for (const k of ['units', 'clock24h', 'musicSource', 'lockWhileDriving', 'textScale', 'nav', 'launcher', 'panel', 'cameraMirror', 'weather', 'lyrics', 'driveAuto', 'standbyMin'] as const)
      expect(patch, k).not.toHaveProperty(k);
  });
});
