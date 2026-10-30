import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOT_PRESET_COLOURS } from '@headunit/shared';
import { BOOT_CHOICES, BOOT_DEFAULTS, configScript, sanitizeBoot } from './bootStudio';

const bootFile = (name: string) => readFileSync(new URL(`../../../deploy/boot/${name}`, import.meta.url), 'utf8');

describe('the boot page draws every Boot Studio choice', () => {
  const runtime = bootFile('boot-runtime.js');
  const page = bootFile('loading.html');
  const listIn = (name: string) => {
    const m = runtime.match(new RegExp(`var ${name}=\\[([^\\]]*)\\]`));
    return m ? m[1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, '')) : [];
  };
  it('accepts exactly the shared choices', () => {
    expect(listIn('BG')).toEqual([...BOOT_CHOICES.bg]);
    expect(listIn('MOTION')).toEqual([...BOOT_CHOICES.motion]);
    expect(listIn('LOADER')).toEqual([...BOOT_CHOICES.loader]);
    expect(listIn('FONT')).toEqual([...BOOT_CHOICES.textStyle]);
    expect(listIn('TRANSITION')).toEqual([...BOOT_CHOICES.transition]);
  });
  it('knows each ready-made theme with the same colours', () => {
    for (const [name, c] of Object.entries(BOOT_PRESET_COLOURS))
      expect(runtime).toContain(`${name}:{bg:'${c.bgColor}',bg2:'${c.bgColor2}',accent:'${c.accent}',accent2:'${c.accent2}'}`);
  });
  it('has styles for every look, motion, loader, lettering and hand-over', () => {
    const attrs = { bg: BOOT_CHOICES.bg, motion: BOOT_CHOICES.motion, loader: BOOT_CHOICES.loader, font: BOOT_CHOICES.textStyle, transition: BOOT_CHOICES.transition };
    // The aurora background and wide lettering are the page's base styles; 'none' needs no rule except to hide the loader.
    const base = new Set(['aurora', 'wide', 'none']);
    for (const [attr, values] of Object.entries(attrs))
      for (const value of values) if (!base.has(value) || attr === 'loader') expect(page, `${attr}=${value}`).toContain(`[data-${attr}="${value}"]`);
  });
});

describe('Boot Studio settings', () => {
  it('starts with the safe original mascot theme', () => {
    expect(sanitizeBoot({})).toEqual(BOOT_DEFAULTS);
  });
  it('roundtrips every supported look and animation', () => {
    for (const bg of BOOT_CHOICES.bg)
      for (const loader of BOOT_CHOICES.loader)
        for (const motion of BOOT_CHOICES.motion) {
          const value=sanitizeBoot({ bg, loader, motion, size:77,accent:'#12ACAB', title:'CUSTOM BOOT' });
          expect(sanitizeBoot(JSON.parse(JSON.stringify(value)))).toEqual(value);
        }
  });
  it('keeps every v2 choice and accepts each RootUnit addition', () => {
    const v2 = {
      preset: ['neon', 'glass', 'matrix', 'sunset', 'minimal', 'custom'], bg: ['solid', 'gradient', 'aurora', 'grid', 'image'],
      motion: ['none', 'float', 'pulse', 'tilt', 'orbit', 'hologram'], loader: ['bar', 'ring', 'dots', 'scanner', 'none'],
      textStyle: ['wide', 'clean', 'mono'], transition: ['none', 'fade', 'zoom'],
    } as const;
    for (const key of Object.keys(v2) as Array<keyof typeof v2>) for (const value of v2[key]) expect(BOOT_CHOICES[key]).toContain(value);
    for (const key of Object.keys(BOOT_CHOICES) as Array<keyof typeof BOOT_CHOICES>)
      for (const value of BOOT_CHOICES[key]) expect(sanitizeBoot({ [key]: value })[key]).toBe(value);
  });
  it('enforces safe sizes, plain text, whitelisted choices and colors', () => {
    const v=sanitizeBoot({size:100000, positionX:-200, accent:'red; background:url(x)',
      title:'<script>alert(1)</script>\n\t', loader:'../../shell',showMascot:'false',
      transitionMs:Number.POSITIVE_INFINITY});
    expect(v.size).toBe(90);
    expect(v.positionX).toBe(0);
    expect(v.accent).toBe(BOOT_DEFAULTS.accent);
    expect(v.loader).toBe(BOOT_DEFAULTS.loader);
    expect(v.showMascot).toBe(true);
    expect(v.transitionMs).toBe(BOOT_DEFAULTS.transitionMs);
    expect(configScript(v)).not.toContain('<script>');
  });
});
