import { THEME_IDS, type ThemeId } from '@headunit/shared';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_SWATCHES,
  PALETTES,
  PALETTE_KEYS,
  PALETTE_LIST,
  accentFor,
  composite,
  contrastRatio,
  minDimFor,
  paletteOf,
  parseColor,
  thresholdsFor,
  type Palette,
} from './index';
import { CORE } from './core';
import { GROUP_A } from './groupA';
import { GROUP_B } from './groupB';
import { GROUP_C } from './groupC';
import { GROUP_D } from './groupD';
import { GROUP_E } from './groupE';
import { GROUP_F } from './groupF';

const STRING_TOKENS = ['label', 'blurb', 'bg', 'bg2', 'nav', 'card', 'cardHi', 'border', 'borderStrong', 'text', 'dim', 'track', 'shadow', 'ok', 'warn', 'danger', 'accentDefault', 'glassFill', 'glassBorder', 'glassHighlight', 'scrim'] as const;
const OPAQUE_TOKENS = ['bg', 'bg2', 'nav', 'text', 'dim', 'ok', 'warn', 'danger', 'accentDefault', 'scrim'] as const;
const COLOUR_TOKENS = ['bg', 'bg2', 'nav', 'card', 'cardHi', 'border', 'borderStrong', 'text', 'dim', 'track', 'ok', 'warn', 'danger', 'accentDefault', 'glassFill', 'glassBorder', 'glassHighlight', 'scrim'] as const;

describe('palette registry', () => {
  it('has exactly one palette for every ThemeId and nothing else', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...THEME_IDS].sort());
    expect(PALETTE_LIST.map((p) => p.id)).toEqual([...THEME_IDS]);
    expect(new Set(PALETTE_LIST.map((p) => p.label)).size).toBe(THEME_IDS.length); // labels are distinct
  });

  it('keeps each palette under its own key, and each group to the ids it owns', () => {
    for (const id of THEME_IDS) expect(PALETTES[id].id, id).toBe(id);
    expect(Object.keys(CORE).sort()).toEqual(['carbon', 'daylight', 'ember', 'midnight']);
    expect(Object.keys(GROUP_A).sort()).toEqual(['amoled', 'aurora', 'nord', 'ocean']);
    expect(Object.keys(GROUP_B).sort()).toEqual(['crimson', 'forest', 'mocha', 'royal', 'synthwave']);
    expect(Object.keys(GROUP_C).sort()).toEqual(['contrast', 'mint', 'sand', 'sunlit']);
    expect(Object.keys(GROUP_D)).toHaveLength(14);
    expect(Object.keys(GROUP_E).sort()).toEqual(['arctic', 'concrete', 'latte', 'lavender', 'sakura']);
    expect(Object.keys(GROUP_F).sort()).toEqual(['abyss', 'holo', 'miami', 'neonoir', 'paper', 'peach', 'rosegold', 'toxic']);
    const owned = [...Object.keys(CORE), ...Object.keys(GROUP_A), ...Object.keys(GROUP_B), ...Object.keys(GROUP_C), ...Object.keys(GROUP_D), ...Object.keys(GROUP_E), ...Object.keys(GROUP_F)];
    expect(new Set(owned).size).toBe(owned.length); // no id owned twice
    expect(owned.length).toBe(THEME_IDS.length);
    for (const [group, ids] of [[CORE, Object.keys(CORE)], [GROUP_A, Object.keys(GROUP_A)], [GROUP_B, Object.keys(GROUP_B)], [GROUP_C, Object.keys(GROUP_C)], [GROUP_D, Object.keys(GROUP_D)], [GROUP_E, Object.keys(GROUP_E)], [GROUP_F, Object.keys(GROUP_F)]] as const) {
      for (const id of ids) expect((group as Record<string, Palette>)[id]?.id).toBe(id);
    }
  });

  it('paletteOf returns the registered palette and falls back to midnight for an unknown id', () => {
    for (const id of THEME_IDS) expect(paletteOf(id)).toBe(PALETTES[id]);
    expect(paletteOf('no-such-theme' as ThemeId)).toBe(PALETTES.midnight);
  });

  it('paletteOf never resolves prototype keys or non-strings to something that is not a palette', () => {
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '', 'MIDNIGHT', ' midnight', undefined, null, 5, {}, []]) {
      expect(paletteOf(bad as unknown as ThemeId), String(bad)).toBe(PALETTES.midnight);
    }
  });

  it('the first palette is the RootUnit default, obsidian, and it is dark', () => {
    expect(THEME_IDS[0]).toBe('obsidian');
    expect(PALETTES.obsidian.scheme).toBe('dark');
  });
});

describe.each(THEME_IDS.map((id) => [id] as const))('palette %s: token completeness', (id) => {
  const p: Palette = PALETTES[id];

  it('defines every token of the schema, and no others', () => {
    expect(Object.keys(p).sort()).toEqual([...PALETTE_KEYS].sort());
    for (const k of PALETTE_KEYS) expect(p[k], k).not.toBeUndefined();
    for (const k of PALETTE_KEYS) expect(p[k], k).not.toBeNull();
  });

  it('has non-empty text tokens and parseable colours', () => {
    for (const k of STRING_TOKENS) expect(typeof p[k] === 'string' && p[k].trim().length > 0, k).toBe(true);
    for (const k of COLOUR_TOKENS) expect(parseColor(p[k]), `${k} = ${p[k]}`).not.toBeNull();
    expect(p.scheme === 'dark' || p.scheme === 'light').toBe(true);
    expect(['auto', 'dark', 'light']).toContain(p.onAccentMode);
  });

  it('keeps opaque tokens opaque and glass tokens translucent-capable rgba', () => {
    for (const k of OPAQUE_TOKENS) expect(parseColor(p[k])!.a, k).toBe(1);
    for (const k of ['glassFill', 'glassBorder', 'glassHighlight'] as const) expect(p[k], k).toMatch(/^rgba\(/);
    expect(p.bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.scrim).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.scrim.toLowerCase()).toBe(p.bg.toLowerCase()); // normally == bg (spec §2)
  });

  it('has a numeric glow in 0..1, a minDim that equals the computed one, and three opaque preview swatches', () => {
    expect(typeof p.glow).toBe('number');
    expect(p.glow).toBeGreaterThanOrEqual(0);
    expect(p.glow).toBeLessThanOrEqual(1);
    expect(Number.isInteger(p.minDim)).toBe(true);
    expect(p.minDim).toBeGreaterThanOrEqual(0);
    expect(p.minDim).toBeLessThanOrEqual(90);
    expect(p.minDim).toBe(minDimFor(p));
    expect(p.preview).toHaveLength(3);
    for (const c of p.preview) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.preview[0].toLowerCase()).toBe(p.bg.toLowerCase());
    expect(p.preview[2].toLowerCase()).toBe(p.accentDefault.toLowerCase());
  });

  it('declares a scheme that matches its colours (dark palettes have light text, light palettes dark text)', () => {
    const textLum = contrastRatio(p.text, '#000000');
    const bgLum = contrastRatio(p.bg, '#000000');
    if (p.scheme === 'dark') expect(textLum).toBeGreaterThan(bgLum);
    else expect(textLum).toBeLessThan(bgLum);
  });
});

describe('legacy snapshot: the four original palettes', () => {
  // The values of the [data-theme] blocks in styles.css before the theme engine, with the cascade resolved: a token a block did
  // not set was inherited from midnight (the :root block). Copied verbatim from git history; do not "tidy" these.
  const MIDNIGHT = {
    bg: '#070a12',
    bg2: '#0b101c',
    card: 'rgba(255, 255, 255, 0.055)',
    cardHi: 'rgba(255, 255, 255, 0.1)',
    border: 'rgba(255, 255, 255, 0.09)',
    text: '#eef3fb',
    dim: '#8d98ad',
    track: 'rgba(255, 255, 255, 0.13)',
    shadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
    glow: 0.14,
    ok: '#34d399',
    warn: '#fbbf24',
    danger: '#f87171',
  };
  const LEGACY: Record<'midnight' | 'carbon' | 'daylight' | 'ember', typeof MIDNIGHT> = {
    midnight: MIDNIGHT,
    carbon: { ...MIDNIGHT, bg: '#0a0a0c', bg2: '#111114', card: 'rgba(255, 255, 255, 0.05)', cardHi: 'rgba(255, 255, 255, 0.095)', border: 'rgba(255, 255, 255, 0.08)', text: '#f1f1f3', dim: '#8e8e98', glow: 0.07 },
    daylight: {
      ...MIDNIGHT,
      bg: '#e6ecf4', bg2: '#f4f7fb', card: '#ffffff', cardHi: '#eaf0f8', border: 'rgba(12, 30, 60, 0.1)', text: '#0e1a2c', dim: '#5a687f',
      track: 'rgba(12, 30, 60, 0.12)', shadow: '0 4px 14px rgba(20, 40, 80, 0.12)', glow: 0,
    },
    ember: { ...MIDNIGHT, bg: '#0d0504', bg2: '#150806', card: 'rgba(255, 130, 70, 0.07)', cardHi: 'rgba(255, 130, 70, 0.13)', border: 'rgba(255, 140, 80, 0.15)', text: '#ffdcc6', dim: '#b07a63', track: 'rgba(255, 140, 80, 0.17)', glow: 0.1 },
  };
  // Tokens allowed to differ because the legacy value breaks a §5 rule (each is proven to below). Nothing else may change.
  const CORRECTED: Partial<Record<keyof typeof LEGACY, Array<'ok' | 'warn' | 'danger'>>> = { daylight: ['ok', 'warn', 'danger'] };

  for (const id of ['midnight', 'carbon', 'daylight', 'ember'] as const) {
    it(`${id} keeps every legacy token value exactly (except proven corrections)`, () => {
      const legacy = LEGACY[id];
      const corrected: string[] = CORRECTED[id] ?? [];
      for (const [token, value] of Object.entries(legacy) as Array<[keyof typeof MIDNIGHT, string | number]>) {
        if (corrected.includes(token)) expect(PALETTES[id][token], `${id}.${token} is a declared correction`).not.toBe(value);
        else expect(PALETTES[id][token], `${id}.${token}`).toBe(value);
      }
    });

    it(`${id} uses the rail's old background (bg2) as its nav colour`, () => {
      expect(PALETTES[id].nav).toBe(LEGACY[id].bg2);
    });
  }

  it('every correction is justified: the legacy value really failed the 3:1 rule on that palette', () => {
    for (const [id, tokens] of Object.entries(CORRECTED) as Array<[keyof typeof LEGACY, Array<'ok' | 'warn' | 'danger'>]>) {
      for (const t of tokens) {
        expect(contrastRatio(LEGACY[id][t], LEGACY[id].bg), `${id}.${t} legacy`).toBeLessThan(3);
        expect(contrastRatio(PALETTES[id][t], PALETTES[id].bg), `${id}.${t} corrected`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('the default accent on the default palette is unchanged by accentFor', () => {
    expect(accentFor(PALETTES.midnight, '#3dd5f3')).toEqual({ accent: '#3dd5f3', onAccent: '#06121a' });
  });
});

describe.each(THEME_IDS.map((id) => [id] as const))('palette %s: contrast rules (spec §5)', (id) => {
  const p = PALETTES[id];
  const t = thresholdsFor(p);
  const onBg = (c: string) => composite(c, p.bg);

  it('text reaches the text threshold on bg and on cards', () => {
    expect(contrastRatio(p.text, p.bg), 'text/bg').toBeGreaterThanOrEqual(t.text);
    expect(contrastRatio(p.text, onBg(p.card)), 'text/card').toBeGreaterThanOrEqual(t.text);
    expect(contrastRatio(p.text, onBg(p.cardHi)), 'text/cardHi').toBeGreaterThanOrEqual(t.text);
  });

  it('text and dim text also reach their thresholds on bg2 and nav, and on cards drawn over bg2 (sheets, dialogs, the rail)', () => {
    const onBg2 = (c: string) => composite(c, p.bg2);
    for (const [name, surface] of [['bg2', p.bg2], ['nav', p.nav], ['card over bg2', onBg2(p.card)], ['cardHi over bg2', onBg2(p.cardHi)]] as const) {
      expect(contrastRatio(p.text, surface), `text/${name}`).toBeGreaterThanOrEqual(t.text);
      expect(contrastRatio(p.dim, surface), `dim/${name}`).toBeGreaterThanOrEqual(t.dim);
    }
  });

  it('dim text reaches the dim threshold on cards and bg', () => {
    expect(contrastRatio(p.dim, onBg(p.card)), 'dim/card').toBeGreaterThanOrEqual(t.dim);
    expect(contrastRatio(p.dim, onBg(p.cardHi)), 'dim/cardHi').toBeGreaterThanOrEqual(t.dim);
    expect(contrastRatio(p.dim, p.bg), 'dim/bg').toBeGreaterThanOrEqual(t.dim);
  });

  it('accentDefault reaches 3:1 on bg and has legible ink', () => {
    expect(contrastRatio(p.accentDefault, p.bg)).toBeGreaterThanOrEqual(3);
    const r = accentFor(p, p.accentDefault);
    expect(r.accent).toBe(p.accentDefault.toLowerCase()); // already passes, so untouched
    expect(contrastRatio(r.onAccent, r.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('honours its onAccentMode on its own accentDefault', () => {
    const ink = accentFor(p, p.accentDefault).onAccent;
    const dark = ink !== '#ffffff';
    if (p.onAccentMode === 'dark') expect(dark, `${p.accentDefault} wants dark ink`).toBe(true);
    if (p.onAccentMode === 'light') expect(dark, `${p.accentDefault} wants light ink`).toBe(false);
  });

  it('every swatch is usable after accentFor (>= 3:1 on bg, ink >= 4.5:1)', () => {
    for (const s of ACCENT_SWATCHES) {
      const r = accentFor(p, s);
      expect(contrastRatio(r.accent, p.bg), `${s} -> ${r.accent}`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.onAccent, r.accent), `ink on ${r.accent}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status colours reach 3:1 on bg', () => {
    for (const k of ['ok', 'warn', 'danger'] as const) expect(contrastRatio(p[k], p.bg), k).toBeGreaterThanOrEqual(t.status);
  });

  it('glass: text and dim text stay legible on glassFill over the worst-case picture at minDim, and on solid cards too', () => {
    const art = p.scheme === 'dark' ? '#ffffff' : '#000000';
    const a = p.minDim / 100;
    const backdrop = composite({ ...parseColor(p.scrim)!, a }, art);
    const glass = composite(p.glassFill, backdrop);
    expect(contrastRatio(p.text, glass), 'text/glass').toBeGreaterThanOrEqual(t.textOverArt);
    expect(contrastRatio(p.dim, glass), 'dim/glass').toBeGreaterThanOrEqual(t.dimOverArt);
    const card = composite(p.card, backdrop);
    expect(contrastRatio(p.text, card), 'text/card over art').toBeGreaterThanOrEqual(t.textOverArt);
    expect(contrastRatio(p.dim, card), 'dim/card over art').toBeGreaterThanOrEqual(t.dimOverArt);
    // buttons, chips and inputs are filled with cardHi: that is the surface most text sits on
    const cardHi = composite(p.cardHi, backdrop);
    expect(contrastRatio(p.text, cardHi), 'text/cardHi over art').toBeGreaterThanOrEqual(t.textOverArt);
    expect(contrastRatio(p.dim, cardHi), 'dim/cardHi over art').toBeGreaterThanOrEqual(t.dimOverArt);
  });

  it('the two accessibility palettes use no translucency for text surfaces', () => {
    if (id !== 'contrast' && id !== 'sunlit') return;
    for (const k of ['card', 'cardHi', 'border', 'borderStrong', 'track'] as const) expect(parseColor(p[k])!.a, k).toBe(1);
    expect(parseColor(p.glassFill)!.a).toBeGreaterThanOrEqual(0.95);
  });
});

describe('no placeholder palettes are left', () => {
  it('every non-core palette file is hand-written: no DESIGN-ME markers, no derive()', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const file of ['groupA.ts', 'groupB.ts', 'groupC.ts', 'groupD.ts', 'groupE.ts']) {
      const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
      expect(text, file).not.toMatch(/DESIGN-ME/);
      expect(text, file).not.toMatch(/\bderive\(/);
    }
  });
});
