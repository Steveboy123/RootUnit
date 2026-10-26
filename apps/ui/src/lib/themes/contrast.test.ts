import { APPEARANCE_RANGES } from '@headunit/shared';
import { describe, expect, it } from 'vitest';
import {
  INK_DARK,
  MAX_DIM,
  INK_LIGHT,
  PALETTES,
  PALETTE_LIST,
  accentFor,
  backdropAt,
  composite,
  contrastRatio,
  derive,
  luminance,
  minDimFor,
  onAccentFor,
  overArt,
  paletteReport,
  parseColor,
  passesOverArt,
  thresholdsFor,
  toHex,
  worstCaseArt,
  ACCENT_SWATCHES,
} from './index';

const hue = (hex: string): number => {
  const c = parseColor(hex)!;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Deterministic pseudo-random colours so failures are reproducible. */
function colours(n: number): string[] {
  let s = 12345;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, () => `#${[next(), next(), next()].map((v) => Math.floor(v * 256).toString(16).padStart(2, '0')).join('')}`);
}

describe('parseColor', () => {
  it('reads #rgb, #rrggbb and rgb()/rgba() in every spelling the palettes use', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0A1b2C')).toEqual({ r: 10, g: 27, b: 44, a: 1 });
    expect(parseColor(' #3dd5f3 ')).toEqual({ r: 61, g: 213, b: 243, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 0.055)')).toEqual({ r: 255, g: 255, b: 255, a: 0.055 });
    expect(parseColor('rgba(12,30,60,.1)')).toEqual({ r: 12, g: 30, b: 60, a: 0.1 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('clamps out-of-range channels and alpha', () => {
    expect(parseColor('rgba(300, -5, 0, 2)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('returns null for anything else', () => {
    for (const bad of ['', 'red', 'transparent', '#ggg', '#12345', '#1234567', '#1234', 'rgba(1,2)', 'rgba(1,2,3,x)', 'rgba(1,2,3', 'rgb(a,b,c)', 'hsl(0,0%,0%)', 'var(--x)', 'rgba(1,2,3,4,5)']) {
      expect(parseColor(bad), bad).toBeNull();
    }
  });
});

describe('colour maths', () => {
  it('toHex rounds, clamps and drops alpha', () => {
    expect(toHex('#3DD5F3')).toBe('#3dd5f3');
    expect(toHex({ r: 300, g: -4, b: 127.6, a: 0.2 })).toBe('#ff0080');
  });

  it('composites translucent colours over opaque ones', () => {
    expect(composite('rgba(255, 255, 255, 0.5)', '#000000')).toEqual({ r: 128, g: 128, b: 128, a: 1 });
    expect(composite('rgba(255, 0, 0, 1)', '#0000ff')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(composite('rgba(255, 0, 0, 0)', '#0000ff')).toEqual({ r: 0, g: 0, b: 255, a: 1 });
    expect(composite('#123456', '#ffffff')).toEqual({ r: 18, g: 52, b: 86, a: 1 });
    // translucent over translucent keeps the combined alpha
    expect(composite('rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.5)').a).toBeCloseTo(0.75);
  });

  it('matches the WCAG reference values', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2); // the classic "just fails AA" grey
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2); // and the grey that just passes
    expect(contrastRatio('#3dd5f3', '#3dd5f3')).toBe(1);
  });

  it('throws on a colour that cannot be parsed (palette tokens must be valid)', () => {
    expect(() => luminance('nope')).toThrow(/Unparseable colour/);
  });
});

describe('thresholds', () => {
  it('hold the two accessibility palettes to 7:1 and everything else to 4.5:1', () => {
    for (const p of PALETTE_LIST) {
      const strict = p.id === 'contrast' || p.id === 'sunlit';
      const t = thresholdsFor(p);
      expect(t.text, p.id).toBe(strict ? 7 : 4.5);
      expect(t.dim, p.id).toBe(strict ? 7 : 4.5);
      expect(t.textOverArt, p.id).toBe(strict ? 7 : 4.5);
      expect(t.accent).toBe(3);
      expect(t.onAccent).toBe(4.5);
      expect(t.status).toBe(3);
    }
  });
});

describe('minDimFor (legibility over pictures)', () => {
  it('caps at the same number the settings validator clamps bgDim to', () => {
    expect(MAX_DIM).toBe(APPEARANCE_RANGES.bgDim.max);
  });

  it('assumes pure white art for dark palettes and pure black art for light ones', () => {
    expect(worstCaseArt('dark')).toBe('#ffffff');
    expect(worstCaseArt('light')).toBe('#000000');
  });

  it('backdropAt blends the scrim over the art by the dim percentage', () => {
    const p = PALETTES.midnight;
    expect(toHex(backdropAt(p, 0))).toBe('#ffffff');
    expect(toHex(backdropAt(p, 100))).toBe(p.scrim);
    // 50 %: halfway between white and the scrim, channel by channel
    expect(backdropAt(p, 50)).toMatchObject({ r: Math.round((255 + 7) / 2), g: Math.round((255 + 10) / 2), b: Math.round((255 + 18) / 2) });
    expect(toHex(backdropAt(PALETTES.daylight, 0))).toBe('#000000');
  });

  describe.each(PALETTE_LIST.map((p) => [p.id] as const))('%s', (id) => {
    const p = PALETTES[id];
    const t = thresholdsFor(p);

    it('is a whole percent within 0..90', () => {
      const m = minDimFor(p);
      expect(Number.isInteger(m)).toBe(true);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(90);
    });

    it('is minimal: one percent less fails, and everything from there up passes (monotonic)', () => {
      const m = minDimFor(p);
      if (m > 0) expect(passesOverArt(p, m - 1)).toBe(false);
      for (let d = m; d <= 90; d++) expect(passesOverArt(p, d), `dim ${d}`).toBe(true);
      for (let d = 0; d < m; d++) expect(passesOverArt(p, d), `dim ${d}`).toBe(false);
    });

    it('keeps text, dim text and text on glass legible over the worst-case picture at the minimum', () => {
      const m = minDimFor(p);
      // Recompute the backdrop by hand (channel mix of art and scrim) so this does not just echo composite().
      const art = p.scheme === 'dark' ? 255 : 0;
      const scrim = parseColor(p.scrim)!;
      const a = m / 100;
      const backdrop = `#${[scrim.r, scrim.g, scrim.b].map((c) => Math.round(art * (1 - a) + c * a).toString(16).padStart(2, '0')).join('')}`;
      expect(contrastRatio(p.text, backdrop)).toBeGreaterThanOrEqual(t.textOverArt);
      expect(contrastRatio(p.dim, backdrop)).toBeGreaterThanOrEqual(t.dimOverArt);
      const glass = composite(p.glassFill, backdrop);
      expect(contrastRatio(p.text, glass)).toBeGreaterThanOrEqual(t.textOverArt);
      expect(contrastRatio(p.dim, glass)).toBeGreaterThanOrEqual(t.dimOverArt);
      // and overArt() reports the same numbers
      const r = overArt(p, m);
      expect(r.text).toBeCloseTo(contrastRatio(p.text, backdrop), 1);
      expect(r.glassText).toBeCloseTo(contrastRatio(p.text, glass), 1);
    });

    it('is a true worst case: no other picture is harder to read over', () => {
      const m = minDimFor(p);
      const worst = overArt(p, m);
      const arts = ['#000000', '#222222', '#808080', '#cccccc', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#c0a060', '#204060', ...colours(40)];
      for (const art of arts) {
        const backdrop = backdropAt(p, m, art);
        const glass = composite(p.glassFill, backdrop);
        expect(contrastRatio(p.text, backdrop), `text over ${art}`).toBeGreaterThanOrEqual(worst.text - 0.05);
        expect(contrastRatio(p.dim, backdrop), `dim over ${art}`).toBeGreaterThanOrEqual(worst.dim - 0.05);
        expect(contrastRatio(p.text, glass), `glass text over ${art}`).toBeGreaterThanOrEqual(worst.glassText - 0.05);
        expect(contrastRatio(p.dim, glass), `glass dim over ${art}`).toBeGreaterThanOrEqual(worst.glassDim - 0.05);
        expect(contrastRatio(p.text, backdrop), `text over ${art}`).toBeGreaterThanOrEqual(t.textOverArt);
        for (const [name, fill] of [['card', p.card], ['cardHi', p.cardHi]] as const) {
          const surface = composite(fill, backdrop);
          expect(contrastRatio(p.text, surface), `${name} text over ${art}`).toBeGreaterThanOrEqual(t.textOverArt);
          expect(contrastRatio(p.dim, surface), `${name} dim over ${art}`).toBeGreaterThanOrEqual(t.dimOverArt);
        }
      }
    });

    it('also covers solid cards and the raised card fill (buttons, chips, inputs), not just glass', () => {
      const m = minDimFor(p);
      const r = overArt(p, m);
      for (const v of [r.cardText, r.cardHiText]) expect(v).toBeGreaterThanOrEqual(t.textOverArt);
      for (const v of [r.cardDim, r.cardHiDim]) expect(v).toBeGreaterThanOrEqual(t.dimOverArt);
      // those surfaces are what decides the minimum whenever they are the weakest link: one percent less must fail on some surface
      if (m > 0) {
        const below = overArt(p, m - 1);
        const worst = Math.min(below.text - t.textOverArt, below.glassText - t.textOverArt, below.cardText - t.textOverArt, below.cardHiText - t.textOverArt,
          below.dim - t.dimOverArt, below.glassDim - t.dimOverArt, below.cardDim - t.dimOverArt, below.cardHiDim - t.dimOverArt);
        expect(worst).toBeLessThan(0);
      }
    });
  });

  it('reports 90 (the cap) for a palette that can never be made legible, instead of looping or throwing', () => {
    const hopeless = { ...PALETTES.midnight, text: '#808080', dim: '#808080', scrim: '#808080' };
    expect(minDimFor(hopeless)).toBe(90);
    expect(passesOverArt(hopeless, 90)).toBe(false);
    expect(paletteReport(hopeless).ok).toBe(false);
  });

  it('counts the raised card fill: a brighter cardHi than glassFill raises the minimum (regression: buttons over art were unchecked)', () => {
    const base = PALETTES.midnight;
    const brighter = { ...base, cardHi: 'rgba(255, 255, 255, 0.16)' };
    expect(minDimFor(brighter)).toBeGreaterThan(minDimFor(base));
    expect(overArt(brighter, minDimFor(brighter)).cardHiDim).toBeGreaterThanOrEqual(3);
    // and the old rule (glass only) would have passed at the smaller dim, i.e. it really was a hole
    const old = overArt(brighter, minDimFor(base));
    expect(old.glassDim).toBeGreaterThanOrEqual(3);
    expect(old.cardHiDim).toBeLessThan(3);
  });

  it('grows when the text gets darker (a dim colour that is harder to read needs a darker backdrop)', () => {
    const base = PALETTES.midnight;
    const lighter = minDimFor({ ...base, dim: '#b8c2d6' });
    const darker = minDimFor({ ...base, dim: '#6f7a8f' });
    expect(lighter).toBeLessThan(minDimFor(base));
    expect(darker).toBeGreaterThanOrEqual(minDimFor(base));
  });
});

describe('onAccentFor', () => {
  it('uses the soft dark ink on light accents and white on dark ones, as the app always has', () => {
    expect(onAccentFor('#3dd5f3')).toBe(INK_DARK);
    expect(onAccentFor('#fbbf24')).toBe(INK_DARK);
    expect(onAccentFor('#1e3a8a')).toBe(INK_LIGHT);
  });

  it('is always legible (>= 4.5:1), falling back to pure black or white for mid-tones', () => {
    const seen = new Set<string>();
    for (const c of [...colours(600), ...ACCENT_SWATCHES]) {
      const ink = onAccentFor(c);
      seen.add(ink);
      expect(contrastRatio(ink, c), `${ink} on ${c}`).toBeGreaterThanOrEqual(4.5);
    }
    expect([...seen].every((i) => [INK_DARK, INK_LIGHT, '#000000', '#ffffff'].includes(i))).toBe(true);
    // a colour where the soft ink alone cannot reach 4.5 exists, and is handled with pure black
    const gap = colours(4000).find((c) => contrastRatio(INK_DARK, c) < 4.5 && contrastRatio(INK_LIGHT, c) < 4.5);
    expect(gap).toBeDefined();
    expect(onAccentFor(gap!)).toBe('#000000');
  });

  it('honours a preferred ink only when it is legible', () => {
    expect(onAccentFor('#3dd5f3', 'dark')).toBe(INK_DARK);
    expect(onAccentFor('#3dd5f3', 'light')).toBe(INK_DARK); // white on cyan is 1.8:1 — refused
    expect(onAccentFor('#1e3a8a', 'light')).toBe(INK_LIGHT);
    expect(onAccentFor('#1e3a8a', 'dark')).toBe(INK_LIGHT);
  });
});

describe('accentFor', () => {
  it('leaves an accent that already passes exactly as it is (the default look does not change)', () => {
    expect(accentFor(PALETTES.midnight, '#3dd5f3')).toEqual({ accent: '#3dd5f3', onAccent: '#06121a' });
    expect(accentFor(PALETTES.midnight, '#3DD5F3').accent).toBe('#3dd5f3');
    for (const s of ACCENT_SWATCHES) expect(accentFor(PALETTES.midnight, s).accent, s).toBe(s);
  });

  it('lightens on dark palettes and keeps the hue', () => {
    const r = accentFor(PALETTES.midnight, '#1e3a8a');
    expect(r.accent).not.toBe('#1e3a8a');
    expect(luminance(r.accent)).toBeGreaterThan(luminance('#1e3a8a'));
    expect(contrastRatio(r.accent, PALETTES.midnight.bg)).toBeGreaterThanOrEqual(3);
    expect(hueGap(hue(r.accent), hue('#1e3a8a'))).toBeLessThan(4);
    // minimal: one step less lightening would not have passed
    expect(contrastRatio(r.accent, PALETTES.midnight.bg)).toBeLessThan(3.4);
  });

  it('darkens on light palettes and keeps the hue', () => {
    const r = accentFor(PALETTES.daylight, '#3dd5f3');
    expect(luminance(r.accent)).toBeLessThan(luminance('#3dd5f3'));
    expect(contrastRatio(r.accent, PALETTES.daylight.bg)).toBeGreaterThanOrEqual(3);
    expect(hueGap(hue(r.accent), hue('#3dd5f3'))).toBeLessThan(4);
    expect(accentFor(PALETTES.daylight, '#0f6bb5').accent).toBe('#0f6bb5'); // already dark enough
  });

  it('gives every accent 3:1 on bg and legible ink on every palette (random sweep + swatches)', () => {
    for (const p of PALETTE_LIST) {
      for (const c of [...ACCENT_SWATCHES, '#000000', '#ffffff', '#808080', ...colours(150)]) {
        const r = accentFor(p, c);
        expect(contrastRatio(r.accent, p.bg), `${p.id} ${c} -> ${r.accent}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(r.onAccent, r.accent), `${p.id} ${r.accent}`).toBeGreaterThanOrEqual(4.5);
        expect(r.accent).toMatch(/^#[0-9a-f]{6}$/);
        expect(r.onAccent).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('falls back to the palette default when the text is not a colour', () => {
    for (const bad of ['', 'red', 'javascript:alert(1)', '#12', 'url(x)']) {
      expect(accentFor(PALETTES.ember, bad).accent, bad).toBe(PALETTES.ember.accentDefault);
    }
  });

  it('does not throw when the value is not even a string (stale or corrupt data)', () => {
    for (const bad of [undefined, null, 5, {}, [], true, () => '#fff']) {
      expect(() => accentFor(PALETTES.ember, bad as unknown as string), String(bad)).not.toThrow();
      expect(accentFor(PALETTES.ember, bad as unknown as string).accent).toBe(PALETTES.ember.accentDefault);
    }
  });
});

describe('paletteReport', () => {
  it('lists every rule with its measured ratio and passes for every shipped palette', () => {
    for (const p of PALETTE_LIST) {
      const r = paletteReport(p, ACCENT_SWATCHES);
      expect(r.id).toBe(p.id);
      expect(r.failures, `${p.id}: ${r.failures.map((f) => `${f.name} ${f.ratio.toFixed(2)}<${f.min}`).join('; ')}`).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.minDim).toBe(p.minDim);
      const names = r.checks.map((c) => c.name);
      for (const n of ['text on bg', 'text on card', 'dim on card', 'accentDefault on bg', 'ok on bg', 'warn on bg', 'danger on bg']) expect(names).toContain(n);
      for (const n of ['text on bg2', 'dim on bg2', 'text on nav', 'dim on nav', 'dim on cardHi over bg2', 'text on card over bg2']) expect(names, n).toContain(n);
      expect(names.filter((n) => n.includes('over worst-case art')).length).toBe(8);
      expect(names.filter((n) => n.startsWith('swatch')).length).toBe(ACCENT_SWATCHES.length);
    }
  });

  it('flags secondary text that only fails on bg2 (sheets) or on a card drawn over bg2, which bg alone would miss', () => {
    const base = PALETTES.midnight;
    // dim passes on bg but not on a lighter bg2
    const lightBg2 = { ...base, bg2: '#4a5568', nav: '#4a5568' };
    const r = paletteReport(lightBg2);
    expect(r.failures.map((f) => f.name)).toEqual(expect.arrayContaining(['dim on bg2', 'dim on nav']));
    expect(r.checks.find((c) => c.name === 'dim on bg')!.ok).toBe(true);
    // a card that is bright enough to pass over bg but not over a lighter bg2
    const hi = { ...base, bg2: '#2a3140', cardHi: 'rgba(255, 255, 255, 0.2)', dim: '#a5b0c6' };
    const names = paletteReport(hi).failures.map((f) => f.name);
    expect(names).toContain('dim on cardHi over bg2');
  });

  it('flags a palette that breaks a rule, naming it', () => {
    const bad = { ...PALETTES.midnight, text: '#202838', ok: '#0a0e18' };
    const r = paletteReport(bad);
    expect(r.ok).toBe(false);
    expect(r.failures.map((f) => f.name)).toEqual(expect.arrayContaining(['text on bg', 'ok on bg']));
    for (const f of r.failures) expect(f.ratio).toBeLessThan(f.min);
  });
});

describe('derive', () => {
  const base = PALETTES.carbon;
  const meta = { id: 'amoled', label: 'X', blurb: 'y', scheme: 'dark' } as const;

  it('keeps the base tokens, applies overrides and computes minDim', () => {
    const d = derive(base, { ...meta, dim: '#d0d0d8' });
    expect(d).toMatchObject({ id: 'amoled', label: 'X', blurb: 'y', bg: base.bg, text: base.text, dim: '#d0d0d8' });
    expect(d.minDim).toBe(minDimFor(d));
    expect(d.minDim).toBeLessThan(base.minDim); // brighter secondary text needs less dimming, so it was recomputed
  });

  it('makes scrim follow bg and nav follow bg2 unless they are given', () => {
    const d = derive(base, { ...meta, bg: '#101010', bg2: '#202020' });
    expect(d.scrim).toBe('#101010');
    expect(d.nav).toBe('#202020');
    const e = derive(base, { ...meta, bg: '#101010', bg2: '#202020', scrim: '#000000', nav: '#303030' });
    expect(e.scrim).toBe('#000000');
    expect(e.nav).toBe('#303030');
    const same = derive(base, meta);
    expect(same.scrim).toBe(base.scrim);
    expect(same.nav).toBe(base.nav);
  });

  it('rebuilds the preview swatches from the result unless given', () => {
    const d = derive(base, { ...meta, bg: '#101010', accentDefault: '#ff00ff' });
    expect(d.preview[0]).toBe('#101010');
    expect(d.preview[2]).toBe('#ff00ff');
    expect(d.preview[1]).toBe(toHex(composite(d.cardHi, d.bg)));
    expect(derive(base, { ...meta, preview: ['#111111', '#222222', '#333333'] }).preview).toEqual(['#111111', '#222222', '#333333']);
  });

  it('does not mutate the base', () => {
    const before = JSON.stringify(base);
    derive(base, { ...meta, bg: '#000000' });
    expect(JSON.stringify(base)).toBe(before);
  });
});
