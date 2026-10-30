import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, lookOf, type Settings } from '@headunit/shared';
import { decodeLook, encodeLook } from './lookCode';
import { seededRandom, surpriseLook } from './surprise';
import { HIGH_VISIBILITY, PALETTES } from './themes';

const look = (over: Partial<Settings> = {}) => lookOf({ ...DEFAULT_SETTINGS, ...over });

describe('share codes', () => {
  it('round-trips a look and its name', () => {
    const l = look({ theme: 'neonoir', surface: 'lumen', wallpaper: 'cyber-alley', background: 'wallpaper', mascotX: 12, accent: '#ff2e63' });
    const code = encodeLook('Night  run', l);
    expect(code.startsWith('RU1.')).toBe(true);
    expect(decodeLook(code)).toEqual({ name: 'Night run', look: l });
  });

  it('keeps codes short by leaving out what matches the defaults', () => {
    expect(encodeLook('Default', look()).length).toBeLessThan(40);
  });

  it('survives being split over lines or padded with spaces', () => {
    const code = encodeLook('X', look({ theme: 'toxic' }));
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(decodeLook(messy)?.look.theme).toBe('toxic');
  });

  it('turns a hostile or damaged code into a valid look or nothing', () => {
    expect(decodeLook('hello')).toBeNull();
    expect(decodeLook('RU1.%%%')).toBeNull();
    expect(decodeLook('RU1.' + 'A'.repeat(7000))).toBeNull();
    expect(decodeLook('RU1.' + btoa('not json'))).toBeNull();
    expect(decodeLook('RU1.' + btoa('[1,2]'))).toBeNull();
    const evil = 'RU1.' + btoa(JSON.stringify({ n: '<b>x</b>\u0000', l: { theme: 'nope', accent: 'red;x', units: 'imperial', myLooks: [1], mascotSize: 999 } })).replace(/=+$/, '');
    const out = decodeLook(evil)!;
    expect(out.look).toEqual(look({ mascotSize: 95 }));
    expect(out.name).toBe('<b>x</b>');
    expect(out.look).not.toHaveProperty('units');
  });

  it('carries names in any language', () => {
    expect(decodeLook(encodeLook('夜のドライブ ✨', look()))?.name).toBe('夜のドライブ ✨');
  });
});

describe('surprise me', () => {
  it('is always a valid set of settings', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const patch = surpriseLook(seededRandom(seed));
      const merged = mergeSettings(DEFAULT_SETTINGS, patch);
      for (const [k, v] of Object.entries(patch)) expect((merged as unknown as Record<string, unknown>)[k], `${seed} ${k}`).toEqual(v);
    }
  });

  it('keeps the pairings that make a look hang together', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const p = surpriseLook(seededRandom(seed));
      const palette = PALETTES[p.theme!];
      expect(HIGH_VISIBILITY.has(p.theme!)).toBe(false);
      expect(p.accent).toBe(palette.accentDefault.toLowerCase());
      if (p.surface === 'terminal' || p.surface === 'hud') expect([p.shape, ['mono', 'tech'].includes(p.font!)]).toEqual(['sharp', true]);
      if (p.surface === 'clay' || p.surface === 'aero') expect(p.shape).toBe('round');
      if (p.surface === 'brutal') expect(['press', 'pop']).toContain(p.touchFx);
      if (palette.scheme === 'light') {
        expect(['neon', 'terminal', 'hud']).not.toContain(p.surface);
        expect(p.dockStyle).not.toBe('neon');
      }
      if (p.background === 'wallpaper') expect(p.wallpaper).toBeTruthy();
    }
  });

  it('gives the same look for the same seed, and different looks for different ones', () => {
    expect(surpriseLook(seededRandom(7))).toEqual(surpriseLook(seededRandom(7)));
    const themes = new Set(Array.from({ length: 50 }, (_, i) => surpriseLook(seededRandom(i + 1)).theme));
    expect(themes.size).toBeGreaterThan(15);
  });
});
