import { describe, expect, it } from 'vitest';
import { BOOT_CHOICES, BOOT_DEFAULTS, configScript, sanitizeBoot } from './bootStudio';

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
