import { DEFAULT_SETTINGS, THEME_IDS, mergeSettings } from '@headunit/shared';
import { describe, expect, it } from 'vitest';
import { PALETTES, PRESETS, PRESET_GROUPS, activePreset, presetPatch } from './index';

describe('presets', () => {
  it('have unique ids and labels, and every group is offered', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
    for (const g of PRESET_GROUPS) expect(PRESETS.some((p) => p.group === g.id), g.id).toBe(true);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s only carries values the settings validator accepts', (_id, preset) => {
    const patch = presetPatch(preset);
    const applied = mergeSettings(DEFAULT_SETTINGS, patch);
    for (const [k, v] of Object.entries(patch)) expect(applied[k as keyof typeof applied], k).toBe(typeof v === 'string' && k === 'accent' ? v.toLowerCase() : v);
    expect(activePreset(applied)?.id).toBeDefined();
  });

  it('a wallpaper preset names its wallpaper, and only wallpaper presets do', () => {
    for (const p of PRESETS) expect(p.patch.wallpaper !== undefined, p.id).toBe(p.patch.background === 'wallpaper');
  });

  it('keeps v2’s 14 Looks and 16 3D scenes', () => {
    expect(PRESETS.filter((p) => p.group === 'looks')).toHaveLength(14);
    expect(PRESETS.filter((p) => p.group === 'scenes')).toHaveLength(16);
    // spot checks pinned to v2's exact values
    // RootUnit adds the matching finish (type, transition, gauges, bar, mascot) on top; v2's own values are all still there.
    expect(PRESETS.find((p) => p.id === 'cyber-neon')?.patch).toMatchObject({
      theme: 'synthwave', accent: '#ff4fd8', background: 'grid', surface: 'neon', albumMotion: 'hologram', depthStyle: 'deep',
      motionSpeed: 'cinematic', effects: 'full', dashScene: 'orbits', glassFinish: 'prismatic',
    });
    expect(PRESETS.find((p) => p.id === 'classic')?.patch).toEqual({ theme: 'midnight', surface: 'solid', background: 'none', shape: 'soft', accent: '#3dd5f3' });
  });

  it('every palette new in RootUnit is shown off by at least one signature theme or design style', () => {
    const v2 = new Set(['midnight', 'carbon', 'amoled', 'ember', 'ocean', 'forest', 'aurora', 'synthwave', 'nord', 'mocha', 'crimson', 'royal', 'daylight', 'sand', 'mint', 'contrast', 'sunlit']);
    const used = new Set(PRESETS.filter((p) => p.group === 'signature' || p.group === 'styles').map((p) => p.patch.theme));
    for (const id of THEME_IDS) if (!v2.has(id)) expect(used.has(id), id).toBe(true);
  });

  it('every option added in 3.1 is shown off by at least one look', () => {
    const fresh = {
      theme: ['neonoir', 'miami', 'toxic', 'rosegold', 'abyss', 'holo', 'paper', 'peach'],
      surface: ['brutal', 'holo', 'terminal', 'lumen'],
      background: ['halftone', 'lowpoly', 'rays', 'plasma'],
      wallpaper: ['cherry-road', 'cyber-alley', 'miami-beach', 'deep-sea', 'holo-waves', 'paper-hills'],
      dashScene: ['highway', 'sakura', 'embers', 'radar', 'skyline', 'lightning'],
      transition: ['cube', 'drop', 'tilt', 'portal'],
      touchFx: ['sparkle', 'ring', 'press'],
      gaugeStyle: ['led', 'hud'],
      standbyStyle: ['nixie', 'words', 'binary'],
      albumMotion: ['cube', 'mirror', 'sleeve'],
      dockStyle: ['neon', 'bubbles'],
      mascotMotion: ['bounce', 'drift'],
      mascotAura: ['rings', 'aurora'],
    } as const;
    const missing: string[] = [];
    for (const [key, values] of Object.entries(fresh))
      for (const v of values) if (!PRESETS.some((p) => (p.patch as Record<string, unknown>)[key] === v)) missing.push(`${key}=${v}`);
    expect(missing).toEqual([]);
  });

  it('the RootUnit signature preset is exactly the default look', () => {
    expect(activePreset(DEFAULT_SETTINGS)?.id).toBe('rootunit');
    expect(PALETTES[DEFAULT_SETTINGS.theme].accentDefault).toBe(DEFAULT_SETTINGS.accent);
  });

  it('every featured look and 3D scene is fully matched: wallpaper art, motion, type, transition, bar and mascot all chosen together', () => {
    for (const p of PRESETS.filter((x) => x.group === 'featured' || x.group === 'scenes')) {
      for (const k of ['font', 'transition', 'gaugeStyle', 'dockStyle', 'touchFx', 'mascotMotion', 'mascotAura', 'albumMotion', 'dashScene', 'motionSpeed'] as const) expect(p.patch[k], `${p.id}.${k}`).toBeDefined();
      expect(p.thumb, p.id).toBeDefined();
    }
  });

  it('the showcase looks from the reference sheets are all offered by name', () => {
    const labels = new Set(PRESETS.map((p) => p.label));
    for (const name of ['Retro Synthwave', 'Arctic Crystal', 'Phantom Pink', 'Liquid Chrome', 'Stealth AMOLED', 'Nature Drive', 'Cyber Neon', 'Ocean Glass', 'Vinyl Lounge', 'Aurora 3D', 'Night Racer', 'AMOLED Eclipse', 'Sunset GT', 'Focus HUD'])
      expect(labels.has(name), name).toBe(true);
  });
});
