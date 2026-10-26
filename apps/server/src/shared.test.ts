import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALBUM_MOTIONS,
  APPEARANCE_RANGES,
  BACKGROUNDS,
  BEAT_COLORS,
  BEAT_MODES,
  BUILTIN_WALLPAPERS,
  DASH_SCENES,
  DEPTH_STYLES,
  DOCK_STYLES,
  FONTS,
  GAUGE_STYLES,
  GLASS_FINISHES,
  MASCOT_AURAS,
  MASCOT_MOTIONS,
  MOTION_SPEEDS,
  PAGE_TRANSITIONS,
  STANDBY_STYLES,
  TOUCH_FX,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  EFFECTS,
  GRID_COLS,
  GRID_ROWS,
  SHAPES,
  SURFACES,
  THEME_IDS,
  WALLPAPER_ID_RE,
  layoutOrDefault,
  mergeSettings,
  sanitizeLayout,
  sanitizeSettings,
} from '@headunit/shared';

describe('layout validation', () => {
  it('accepts the default layout unchanged', () => {
    expect(sanitizeLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });

  it('default layout has no overlapping or out-of-grid widgets', () => {
    for (const page of DEFAULT_LAYOUT.pages) {
      const taken = new Set<string>();
      for (const w of page.widgets) {
        expect(w.x + w.w).toBeLessThanOrEqual(GRID_COLS);
        expect(w.y + w.h).toBeLessThanOrEqual(GRID_ROWS);
        for (let x = w.x; x < w.x + w.w; x++)
          for (let y = w.y; y < w.y + w.h; y++) {
            const k = `${x},${y}`;
            expect(taken.has(k), `${page.id}: ${w.id} overlaps at ${k}`).toBe(false);
            taken.add(k);
          }
      }
    }
  });

  it('rejects structurally bad layouts and falls back to the default', () => {
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout({ version: 2, pages: [] })).toBeNull();
    expect(sanitizeLayout({ version: 1, pages: [] })).toBeNull();
    const bad = { version: 1, pages: [{ id: 'a', name: 'A', widgets: [{ id: 'x', type: 'clock', x: 11, y: 0, w: 4, h: 1 }] }] };
    expect(sanitizeLayout(bad)).toBeNull();
    expect(layoutOrDefault(bad)).toEqual(DEFAULT_LAYOUT);
  });

  it('rejects duplicate ids and strips non-primitive config', () => {
    const dup = { version: 1, pages: [{ id: 'a', name: 'A', widgets: [
      { id: 'x', type: 'clock', x: 0, y: 0, w: 1, h: 1 },
      { id: 'x', type: 'clock', x: 1, y: 0, w: 1, h: 1 },
    ] }] };
    expect(sanitizeLayout(dup)).toBeNull();
    const cfg = { version: 1, pages: [{ id: 'a', name: 'A', widgets: [
      { id: 'x', type: 'gauge', x: 0, y: 0, w: 2, h: 2, config: { metric: 'rpm', evil: { a: 1 }, n: 3 } },
    ] }] };
    expect(sanitizeLayout(cfg)?.pages[0]?.widgets[0]?.config).toEqual({ metric: 'rpm', n: 3 });
  });
});

describe('settings validation', () => {
  it('applies valid fields and ignores invalid ones', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { theme: 'ember', accent: '#FF8800', units: 'imperial', clock24h: false });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: 'ember', accent: '#ff8800', units: 'imperial', clock24h: false });
    expect(mergeSettings(DEFAULT_SETTINGS, { theme: 'x', accent: 'red; background:url(x)', units: 5 })).toEqual(DEFAULT_SETTINGS);
  });

  it('validates artAccent and lockWhileDriving', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { artAccent: false, lockWhileDriving: false })).toMatchObject({ artAccent: false, lockWhileDriving: false });
    expect(mergeSettings(DEFAULT_SETTINGS, { artAccent: 'no', lockWhileDriving: 0 })).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.lockWhileDriving).toBe(true); // safe by default
  });

  it('validates the auto day/night and camera fields', () => {
    const ok = mergeSettings(DEFAULT_SETTINGS, { autoTheme: true, dayTheme: 'carbon', nightTheme: 'ember', nightStart: '20:15', nightEnd: '05:00', cameraMirror: true });
    expect(ok).toMatchObject({ autoTheme: true, dayTheme: 'carbon', nightTheme: 'ember', nightStart: '20:15', nightEnd: '05:00', cameraMirror: true });
    const bad = mergeSettings(DEFAULT_SETTINGS, { autoTheme: 'yes', dayTheme: 'nope', nightStart: '25:00', nightEnd: '7:5', cameraGuides: 1 });
    expect(bad).toEqual(DEFAULT_SETTINGS);
  });
});

describe('appearance vocabulary', () => {
  /** Every value a v2 head unit could have saved. RootUnit must keep accepting all of them, so a settings.json carries over unchanged. */
  const V2 = {
    themes: ['midnight', 'carbon', 'amoled', 'ember', 'ocean', 'forest', 'aurora', 'synthwave', 'nord', 'mocha', 'crimson', 'royal', 'daylight', 'sand', 'mint', 'contrast', 'sunlit'],
    surfaces: ['solid', 'glass', 'outline', 'neon'],
    backgrounds: ['none', 'art-blur', 'art-cover', 'art-ambient', 'aurora', 'gradient', 'grid', 'weave', 'wallpaper'],
    wallpapers: ['night-road', 'city-lights', 'mountains', 'dunes', 'waves'],
    albumMotions: ['still', 'vinyl', 'float', 'hologram', 'glass', 'orbit', 'prism'],
    depthStyles: ['flat', 'soft', 'deep', 'crystal'],
    motionSpeeds: ['off', 'calm', 'cinematic'],
    dashScenes: ['off', 'glow', 'orbits', 'grid'],
    glassFinishes: ['clear', 'frosted', 'prismatic'],
    beatModes: ['off', 'glow', 'wash', 'rings', 'spectrum'],
    beatColors: ['accent', 'album', 'rainbow', 'custom'],
    mascotMotions: ['still', 'float', 'hologram', 'tilt'],
  } as const;

  it('lists every palette once: dark, then light, then the two high-visibility ones last', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    expect(THEME_IDS.length).toBe(36);
    expect(THEME_IDS.slice(-2)).toEqual(['contrast', 'sunlit']);
    for (const id of V2.themes) expect(THEME_IDS).toContain(id);
  });

  it('keeps every v2 option and lists each option once', () => {
    const pairs: Array<[readonly string[], readonly string[]]> = [
      [SURFACES, V2.surfaces],
      [BACKGROUNDS, V2.backgrounds],
      [BUILTIN_WALLPAPERS, V2.wallpapers],
      [ALBUM_MOTIONS, V2.albumMotions],
      [DEPTH_STYLES, V2.depthStyles],
      [MOTION_SPEEDS, V2.motionSpeeds],
      [DASH_SCENES, V2.dashScenes],
      [GLASS_FINISHES, V2.glassFinishes],
      [BEAT_MODES, V2.beatModes],
      [BEAT_COLORS, V2.beatColors],
      [MASCOT_MOTIONS, V2.mascotMotions],
    ];
    for (const [list, v2] of pairs) {
      for (const value of v2) expect(list).toContain(value);
      expect(list.length).toBeGreaterThan(v2.length);
    }
    expect([...EFFECTS]).toEqual(['minimal', 'balanced', 'full']);
    expect([...SHAPES]).toEqual(['sharp', 'soft', 'round']);
    for (const list of [SURFACES, BACKGROUNDS, EFFECTS, SHAPES, BUILTIN_WALLPAPERS, ALBUM_MOTIONS, DEPTH_STYLES, MOTION_SPEEDS, DASH_SCENES, GLASS_FINISHES, BEAT_MODES, BEAT_COLORS, MASCOT_MOTIONS, MASCOT_AURAS, FONTS, PAGE_TRANSITIONS, TOUCH_FX, GAUGE_STYLES, STANDBY_STYLES, DOCK_STYLES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('has the documented numeric ranges', () => {
    expect(APPEARANCE_RANGES).toEqual({
      bgBlur: { min: 0, max: 60 },
      bgDim: { min: 0, max: 90 },
      glassOpacity: { min: 0, max: 100 },
      textScale: { min: 85, max: 130 },
      sceneIntensity: { min: 10, max: 100 },
    });
  });

  it('defaults are the RootUnit look, and every default is a value the validator accepts', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      theme: 'obsidian', surface: 'glass', background: 'mesh', effects: 'balanced', shape: 'soft',
      bgBlur: 28, bgDim: 45, glassOpacity: 50, wallpaper: 'night-road', textScale: 100, sceneIntensity: 60,
      dayTheme: 'daylight', nightTheme: 'midnight',
    });
    expect(mergeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    for (const k of ['bgBlur', 'bgDim', 'glassOpacity', 'textScale', 'sceneIntensity'] as const) {
      expect(DEFAULT_SETTINGS[k]).toBeGreaterThanOrEqual(APPEARANCE_RANGES[k].min);
      expect(DEFAULT_SETTINGS[k]).toBeLessThanOrEqual(APPEARANCE_RANGES[k].max);
    }
    expect(WALLPAPER_ID_RE.test(DEFAULT_SETTINGS.wallpaper)).toBe(true);
    expect(THEME_IDS).toContain(DEFAULT_SETTINGS.theme);
    expect(THEME_IDS).toContain(DEFAULT_SETTINGS.dayTheme);
    expect(THEME_IDS).toContain(DEFAULT_SETTINGS.nightTheme);
  });

  it('a v2 settings.json loads with every value it saved', () => {
    const v2 = {
      theme: 'synthwave', accent: '#ff4fd8', surface: 'neon', background: 'grid', effects: 'full', albumMotion: 'hologram', depthStyle: 'deep',
      motionSpeed: 'cinematic', dashScene: 'orbits', glassFinish: 'prismatic', beatMode: 'rings', mascotMotion: 'tilt', shape: 'sharp', wallpaper: 'dunes',
    };
    expect(sanitizeSettings(JSON.parse(JSON.stringify(v2)))).toMatchObject(v2);
  });

  it('is declared once: no other source file carries its own list of palette ids', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const allowed = (rel: string) => rel === 'packages/shared/src/appearance.ts' || rel.startsWith('apps/ui/src/lib/themes/');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    for (const d of ['packages/shared/src', 'apps/server/src', 'apps/ui/src']) walk(join(root, d));
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(root, f).split('\\').join('/');
      if (allowed(rel)) continue;
      const text = readFileSync(f, 'utf8');
      const quoted = THEME_IDS.filter((id) => text.includes(`'${id}'`) || text.includes(`"${id}"`));
      if (quoted.length >= 3) offenders.push(`${rel}: ${quoted.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('appearance settings validation', () => {
  it('accepts every palette for theme, dayTheme and nightTheme', () => {
    for (const id of THEME_IDS) {
      expect(mergeSettings(DEFAULT_SETTINGS, { theme: id, dayTheme: id, nightTheme: id })).toMatchObject({ theme: id, dayTheme: id, nightTheme: id });
    }
  });

  it('accepts every surface, background, effects level and shape', () => {
    for (const v of SURFACES) expect(mergeSettings(DEFAULT_SETTINGS, { surface: v }).surface).toBe(v);
    for (const v of BACKGROUNDS) expect(mergeSettings(DEFAULT_SETTINGS, { background: v }).background).toBe(v);
    for (const v of EFFECTS) expect(mergeSettings(DEFAULT_SETTINGS, { effects: v }).effects).toBe(v);
    for (const v of SHAPES) expect(mergeSettings(DEFAULT_SETTINGS, { shape: v }).shape).toBe(v);
  });

  it('ignores anything that is not an exact member of an option list', () => {
    const junk: unknown[] = ['', 'Glass', ' glass', 'glass ', 'GLASS', 'glass\n', 'x', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 0, 1, true, null, undefined, [], ['glass'], {}, { toString: () => 'glass' }];
    for (const v of junk) {
      expect(mergeSettings(DEFAULT_SETTINGS, { theme: v, dayTheme: v, nightTheme: v, surface: v, background: v, effects: v, shape: v }), String(JSON.stringify(v))).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps the current value when only some fields are invalid', () => {
    const cur = mergeSettings(DEFAULT_SETTINGS, { surface: 'neon', shape: 'round', theme: 'synthwave' });
    expect(mergeSettings(cur, { surface: 'nope', shape: 'round', theme: 5, background: 'grid' })).toEqual({ ...cur, background: 'grid' });
  });

  it('rounds and clamps bgBlur, bgDim and glassOpacity into their ranges', () => {
    const m = (patch: Record<string, unknown>) => mergeSettings(DEFAULT_SETTINGS, patch);
    expect(m({ bgBlur: 0, bgDim: 0, glassOpacity: 0 })).toMatchObject({ bgBlur: 0, bgDim: 0, glassOpacity: 0 });
    expect(m({ bgBlur: 60, bgDim: 90, glassOpacity: 100 })).toMatchObject({ bgBlur: 60, bgDim: 90, glassOpacity: 100 });
    expect(m({ bgBlur: 61, bgDim: 91, glassOpacity: 101 })).toMatchObject({ bgBlur: 60, bgDim: 90, glassOpacity: 100 });
    expect(m({ bgBlur: -1, bgDim: -50, glassOpacity: -0.4 })).toMatchObject({ bgBlur: 0, bgDim: 0, glassOpacity: 0 });
    expect(m({ bgBlur: 1e9, bgDim: 1e308, glassOpacity: -1e9 })).toMatchObject({ bgBlur: 60, bgDim: 90, glassOpacity: 0 });
    expect(m({ bgBlur: 33.6, bgDim: 12.2, glassOpacity: 49.5 })).toMatchObject({ bgBlur: 34, bgDim: 12, glassOpacity: 50 });
    expect(Object.is(m({ bgDim: -0.2 }).bgDim, 0)).toBe(true); // never -0
  });

  it('ignores numbers that are not numbers', () => {
    for (const v of ['50', '', 'NaN', NaN, Infinity, -Infinity, null, undefined, true, [], [5], {}, { valueOf: () => 5 }, 5n]) {
      expect(mergeSettings(DEFAULT_SETTINGS, { bgBlur: v, bgDim: v, glassOpacity: v }), String(typeof v)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('accepts built-in wallpapers and plain user file names', () => {
    for (const id of BUILTIN_WALLPAPERS) expect(mergeSettings(DEFAULT_SETTINGS, { wallpaper: id }).wallpaper).toBe(id);
    // The same names the wallpapers route serves (WALLPAPER_NAME_RE): a letter or digit first, spaces allowed after it.
    for (const id of ['user:photo.jpg', 'user:My_Road-2.PNG', 'user:a', 'user:My Photo.jpg', 'user:a b  c.webp', 'user:a.', 'user:1-2_3.avif', `user:${'x'.repeat(100)}`]) {
      expect(mergeSettings(DEFAULT_SETTINGS, { wallpaper: id }).wallpaper, id).toBe(id);
    }
  });

  it('rejects anything else as a wallpaper id, including injection-like strings', () => {
    const bad: unknown[] = [
      '', 'user:', 'User:photo.jpg', 'NIGHT-ROAD', 'night-road ', ' night-road', 'night-road\n', 'night-road2', 'night', 'user:photo.jpg\n', `user:${'x'.repeat(101)}`,
      'user:../etc/passwd', 'user:a/b.jpg', 'user:a\\b.jpg', 'user:..%2f..%2fx', 'user:a;b', 'user:a"b', "user:a'b", 'user:<script>alert(1)</script>',
      'user:x");background:url(//evil/x)', 'user:a\u0000b', 'user:é.jpg', 'url(http://evil/x.png)', 'http://evil/x.png', '//evil/x.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
      '__proto__', 'user:a\r\nb', 5, null, undefined, ['night-road'], {},
      // path-navigation tokens: made only of dots, so they would walk up out of data/wallpapers if ever joined to a path or URL
      'user:.', 'user:..', 'user:...', `user:${'.'.repeat(100)}`,
      // hidden files, a name that starts with punctuation or a space, a ".." anywhere, and control characters other than a plain space
      'user:..hidden.webp', 'user:.hidden.png', 'user:a..b', 'user:-.', 'user:_', 'user: lead.jpg', 'user:a\tb.jpg', 'user:a\u00a0b.jpg',
    ];
    for (const v of bad) {
      expect(mergeSettings(DEFAULT_SETTINGS, { wallpaper: v }).wallpaper, JSON.stringify(v)).toBe(DEFAULT_SETTINGS.wallpaper);
    }
  });

  it('WALLPAPER_ID_RE is stateless and anchored', () => {
    expect(WALLPAPER_ID_RE.global).toBe(false);
    expect(WALLPAPER_ID_RE.test('waves')).toBe(true);
    expect(WALLPAPER_ID_RE.test('waves')).toBe(true);
    expect(WALLPAPER_ID_RE.test('xwaves')).toBe(false);
    expect(WALLPAPER_ID_RE.test('wavesx')).toBe(false);
  });

  it('old settings blobs without the new keys load as the default look', () => {
    const old = {
      theme: 'ember', accent: '#fb923c', units: 'imperial', clock24h: false, autoTheme: true, dayTheme: 'daylight', nightTheme: 'carbon',
      nightStart: '20:00', nightEnd: '06:00', cameraMirror: true, cameraGuides: false, artAccent: false, lockWhileDriving: false, musicSource: 'demo',
    };
    const s = sanitizeSettings(JSON.parse(JSON.stringify(old)));
    // `demo` was removed as a saved music source (v0.2.6); an old blob that still carries it loads as Auto.
    expect(s).toMatchObject({ ...old, musicSource: 'auto' });
    expect(s).toMatchObject({ surface: 'glass', background: 'mesh', effects: 'balanced', shape: 'soft', bgBlur: 28, bgDim: 45, glassOpacity: 50, wallpaper: 'night-road' });
    // …and a blob from before even the theme keys existed.
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizeSettings survives garbage and round-trips its own output', () => {
    for (const raw of [null, undefined, 'x', 5, [], [1, 2], true]) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    const custom = mergeSettings(DEFAULT_SETTINGS, { theme: 'sunlit', surface: 'neon', background: 'wallpaper', effects: 'full', shape: 'sharp', bgBlur: 7, bgDim: 80, glassOpacity: 12, wallpaper: 'user:me.jpg' });
    expect(sanitizeSettings(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
    expect(sanitizeSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))).toEqual(DEFAULT_SETTINGS);
  });

  it('a patch cannot add keys the type does not have', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { surface: 'glass', evil: 'x', __proto__: { polluted: 1 } });
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect((s as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
});
