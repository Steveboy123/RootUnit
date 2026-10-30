import { describe, expect, it } from 'vitest';
import { Car, Gauge, House, LayoutGrid, MapPinned, Music2, Radio, Settings, Smartphone, Sparkles, Star, Waves, Zap } from 'lucide-react';
import { DEFAULT_NAV, NAV_ICONS, NAV_PRESETS, type NavConfig, type NavItem, type QuickActionPublic, type Scene } from '@headunit/shared';
import { FALLBACK_ICON, NAV_ICON_MAP, navIcon } from './icons';
import { matchNav, resolveNav } from './resolve';
import type { NavContext, NavPlace, ResolvedNavItem } from './types';
import { SCENE_GLYPHS } from '../../components/glyphs';

const APPS: NavContext['apps'] = [
  { id: 'gps', name: 'GPS', icon: Car },
  { id: 'findcar', name: 'Find my car', short: 'Find car', icon: MapPinned },
  { id: 'devices', name: 'Phones', icon: Smartphone, route: 'devices' },
  { id: 'vehicle', name: 'Vehicle', icon: Gauge, route: 'vehicle' },
  { id: 'trips', name: 'Trips', icon: Zap },
];
const scene = (id: string, name = 'Night drive', icon: Scene['icon'] = 'moon'): Scene => ({ id, name, icon, actions: {} });
const action = (id: string, name = 'Garage door', icon: QuickActionPublic['icon'] = 'door'): QuickActionPublic => ({ id, name, icon, confirm: false });
const ctx = (over: Partial<NavContext> = {}): NavContext => ({ apps: APPS, scenes: undefined, actions: undefined, ...over });

const cfg = (...items: NavItem[]): NavConfig => ({ version: 1, position: 'left', size: 'regular', labels: 'always', items: [...items, { id: 'spacer', to: { kind: 'gap' } }, { id: 'settings', to: { kind: 'route', route: 'settings' } }] });
const route = (id: string, r: 'home' | 'drive' | 'media' | 'aa' | 'apps' | 'settings'): NavItem => ({ id, to: { kind: 'route', route: r } });
const app = (id: string, a: string, label?: string): NavItem => ({ id, to: { kind: 'app', app: a }, ...(label ? { label } : {}) });
const tab = (id: string, t: 'spotify' | 'tidal' | 'youtube-music' | 'radio'): NavItem => ({ id, to: { kind: 'music', tab: t } });
const place = (route: NavPlace['route'], appId: string | null = null, musicTab: NavPlace['musicTab'] = 'spotify'): NavPlace => ({ route, appId, musicTab });

const resolved = (...items: NavItem[]) => resolveNav(cfg(...items), ctx({ scenes: [], actions: [] }));
const byId = (items: ResolvedNavItem[], id: string) => items.find((i) => i.id === id)!;

describe('matchNav: the most specific item is the current page', () => {
  const rail = resolved(route('home', 'home'), route('music', 'media'), tab('radio', 'radio'), route('apps', 'apps'), app('gpsx', 'gps'), app('phon', 'devices'), app('vehi', 'vehicle'));

  it('a pinned app beats the grouped Apps item; any other app falls back to Apps', () => {
    expect(matchNav(rail, place('app', 'gps'))).toBe('gpsx');
    expect(matchNav(rail, place('app', 'trips'))).toBe('apps');
    expect(matchNav(rail, place('apps'))).toBe('apps');
  });

  it('a pinned music tab beats the grouped Music item; the other tabs fall back to Music', () => {
    expect(matchNav(rail, place('media', null, 'radio'))).toBe('radio');
    expect(matchNav(rail, place('media', null, 'tidal'))).toBe('music');
    expect(matchNav(rail, place('media', null, 'spotify'))).toBe('music');
  });

  it('the full-screen player belongs to Music but never to a tab (even while radio is the tab)', () => {
    expect(matchNav(rail, place('nowplaying', null, 'radio'))).toBe('music');
    const onlyTab = resolved(tab('radio', 'radio'));
    expect(matchNav(onlyTab, place('nowplaying', null, 'radio'))).toBeNull();
  });

  it('Phones and Vehicle (apps that are pages) are active on their page; without a pin they count as Apps', () => {
    expect(matchNav(rail, place('devices'))).toBe('phon');
    expect(matchNav(rail, place('vehicle'))).toBe('vehi');
    const noPins = resolved(route('apps', 'apps'));
    expect(matchNav(noPins, place('devices'))).toBe('apps');
    expect(matchNav(noPins, place('vehicle'))).toBe('apps');
  });

  it('scenes, actions and the divider are never active', () => {
    const only = resolveNav(cfg({ id: 'night', to: { kind: 'scene', scene: 'night0001' } }, { id: 'garage', to: { kind: 'action', action: 'garage0001' } }), ctx({ scenes: [scene('night0001')], actions: [action('garage0001')] }));
    for (const r of ['home', 'drive', 'media', 'aa', 'apps', 'app', 'nowplaying', 'devices', 'vehicle'] as const) expect(matchNav(only, place(r, 'night0001')), r).toBeNull();
    expect(matchNav(only, place('settings'))).toBe('settings'); // only the fixed Settings item is a page here
  });

  it('every built-in page has its own item in the default rail', () => {
    const items = resolveNav(DEFAULT_NAV, ctx());
    const expected: [NavPlace['route'], string][] = [['home', 'home'], ['drive', 'drive'], ['media', 'music'], ['nowplaying', 'music'], ['aa', 'auto'], ['apps', 'apps'], ['app', 'apps'], ['devices', 'apps'], ['vehicle', 'apps'], ['settings', 'settings']];
    for (const [r, id] of expected) expect(matchNav(items, place(r, 'gps')), r).toBe(id);
  });

  it('ties go to the first item in the list', () => {
    const twin = (a: string, b: string) => [a, b].map((id): ResolvedNavItem => ({ ...resolved(app('xxxx', 'gps'))[0]!, id }));
    expect(matchNav(twin('first', 'second'), place('app', 'gps'))).toBe('first');
    expect(matchNav(twin('second', 'first'), place('app', 'gps'))).toBe('second');
    // the same with grouped route items
    const apps = [resolved(route('apps1', 'apps'))[0]!, resolved(route('apps2', 'apps'))[0]!];
    expect(matchNav(apps, place('apps'))).toBe('apps1');
  });

  it('a specific match later in the list still beats a grouped match earlier', () => {
    expect(matchNav(resolved(route('apps', 'apps'), app('gpsx', 'gps')), place('app', 'gps'))).toBe('gpsx');
  });

  it('a missing app is never active; the place falls through to the group', () => {
    const items = resolved(route('apps', 'apps'), app('gone', 'doesnotexist'));
    expect(byId(items, 'gone').state).toBe('missing');
    expect(matchNav(items, place('app', 'doesnotexist'))).toBe('apps');
    expect(matchNav(resolved(app('gone', 'doesnotexist')), place('app', 'doesnotexist'))).toBeNull();
  });

  it('is null when the rail has no button for the page (so Back can step in)', () => {
    expect(matchNav(resolved(route('home', 'home')), place('drive'))).toBeNull();
    expect(matchNav([], place('home'))).toBeNull();
  });
});

describe('resolveNav: what each item draws', () => {
  it('the default rail is today\'s rail: Home, Drive, Music, Auto, Apps, divider, Settings', () => {
    const items = resolveNav(DEFAULT_NAV, ctx());
    expect(items.map((i) => [i.id, i.kind, i.label])).toEqual([['home', 'go', 'Home'], ['drive', 'go', 'Drive'], ['music', 'go', 'Music'], ['auto', 'go', 'Auto'], ['apps', 'go', 'Apps'], ['spacer', 'gap', ''], ['settings', 'go', 'Settings']]);
    expect(items.map((i) => i.Icon)).toEqual([House, Gauge, Music2, Car, LayoutGrid, Sparkles, Settings]);
    expect(items.every((i) => i.state === 'ok')).toBe(true);
  });

  it('a custom label and icon replace the defaults', () => {
    const [item] = resolved({ id: 'home', to: { kind: 'route', route: 'home' }, label: 'Start', icon: 'star' });
    expect(item).toMatchObject({ label: 'Start', customLabel: 'Start', iconId: 'star', Icon: Star });
  });

  it('Settings is fixed: no label and no icon survive, and it says so', () => {
    const hostile = { ...cfg(), items: [{ id: 'settings', to: { kind: 'route', route: 'settings' }, label: 'Totally Home', icon: 'home' }] } as unknown as NavConfig;
    const s = byId(resolveNav(hostile, ctx()), 'settings');
    expect(s).toMatchObject({ label: 'Settings', Icon: Settings, fixed: true, customLabel: null, iconId: null });
  });

  it('an app is named by its short name, then its name; a label overrides both', () => {
    const items = resolved(app('aaaa', 'findcar'), app('bbbb', 'gps'), app('cccc', 'trips', 'Journeys'));
    expect(items.map((i) => i.label).slice(0, 3)).toEqual(['Find car', 'GPS', 'Journeys']);
    expect(byId(items, 'aaaa').Icon).toBe(MapPinned);
  });

  it('an app that is a page remembers its route; a normal app has none', () => {
    const items = resolved(app('page', 'devices'), app('norm', 'gps'));
    expect(byId(items, 'page').appRoute).toBe('devices');
    expect(byId(items, 'norm').appRoute).toBeNull();
  });

  it('music tabs have names and icons of their own', () => {
    const items = resolved(tab('aaaa', 'spotify'), tab('bbbb', 'tidal'), tab('cccc', 'youtube-music'), tab('dddd', 'radio'));
    expect(items.slice(0, 4).map((i) => i.label)).toEqual(['Spotify', 'TIDAL', 'YT Music', 'Radio']);
    expect(byId(items, 'bbbb').Icon).toBe(Waves);
    expect(byId(items, 'dddd').Icon).toBe(Radio);
  });

  it('every label is non-empty and at most 10 characters for every kind that is shown', () => {
    const items = resolveNav(cfg(route('aaaa', 'home'), app('bbbb', 'findcar'), tab('cccc', 'youtube-music'), { id: 'dddd', to: { kind: 'scene', scene: 'night0001' } }, { id: 'eeee', to: { kind: 'action', action: 'garage0001' } }), ctx({ scenes: [scene('night0001', 'Night drive')], actions: [action('garage0001', 'Garage')] }));
    for (const i of items.filter((x) => x.kind !== 'gap')) {
      expect(i.label.length, i.id).toBeGreaterThan(0);
      expect(Array.from(i.label).length, i.id).toBeLessThanOrEqual(12); // a scene or action name may be longer than a typed label: the rail ellipsises it
    }
  });
});

describe('resolveNav: references to things that may not exist', () => {
  const pins = cfg({ id: 'night', to: { kind: 'scene', scene: 'night0001' } }, { id: 'garage', to: { kind: 'action', action: 'garage0001' } }, app('ghst', 'ghostapp'));

  it('before the server has sent its lists, scenes and actions are dimmed (loading), not hidden', () => {
    const items = resolveNav(pins, ctx({ scenes: undefined, actions: undefined }));
    expect(byId(items, 'night').state).toBe('loading');
    expect(byId(items, 'garage').state).toBe('loading');
  });

  it('once loaded, a pin to a scene or action that is gone is missing, and one that exists is ok with its own name', () => {
    const gone = resolveNav(pins, ctx({ scenes: [], actions: [] }));
    expect(byId(gone, 'night').state).toBe('missing');
    expect(byId(gone, 'garage').state).toBe('missing');
    const there = resolveNav(pins, ctx({ scenes: [scene('night0001', 'Night drive', 'moon')], actions: [action('garage0001', 'Garage door', 'door')] }));
    expect(byId(there, 'night')).toMatchObject({ state: 'ok', kind: 'run', label: 'Night drive' });
    expect(byId(there, 'night').Icon).toBe(SCENE_GLYPHS.moon);
    expect(byId(there, 'garage')).toMatchObject({ state: 'ok', kind: 'run', label: 'Garage door' });
  });

  it('only the list that arrived counts: scenes loaded, actions still loading', () => {
    const items = resolveNav(pins, ctx({ scenes: [scene('night0001')], actions: undefined }));
    expect(byId(items, 'night').state).toBe('ok');
    expect(byId(items, 'garage').state).toBe('loading');
  });

  it('an unknown app is missing (and is still returned, so the editor can list it)', () => {
    const ghost = byId(resolveNav(pins, ctx()), 'ghst');
    expect(ghost.state).toBe('missing');
    expect(ghost.label).toBe('ghostapp');
  });

  it('a scene whose icon this build does not know (or is a prototype name) still draws', () => {
    for (const icon of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'zzz']) {
      const items = resolveNav(pins, ctx({ scenes: [scene('night0001', 'X', icon as Scene['icon'])] }));
      expect(byId(items, 'night').Icon, icon).toBe(Sparkles);
    }
    const items = resolveNav(pins, ctx({ actions: [action('garage0001', 'X', 'constructor' as QuickActionPublic['icon'])] }));
    expect(byId(items, 'garage').Icon).toBe(Zap);
  });
});

describe('resolveNav: never throws, whatever it is given', () => {
  const junk: unknown[] = [
    undefined, null, 0, NaN, -0, 5n, '', 'abcd', [], ['abcd'], {}, { items: 'x' }, { version: 2, items: [] }, { version: 1, items: null },
    { toString: () => 'abcd' },
    { version: 1, position: 'bottom', size: 'huge', labels: 7, items: [null, 5, 'x', [], { id: {}, to: null }, { id: 'abcd', to: { kind: 'app', app: { toString: () => 'gps' } } }] },
    JSON.parse('{"version":1,"items":[{"id":"__proto__","to":{"kind":"route","route":"home"}},{"id":"abcd","to":{"kind":"__proto__"}}]}'),
    { version: 1, items: Array.from({ length: 100_000 }, () => ({ id: 'abcd', to: { kind: 'gap' } })) },
    { version: 1, items: [{ id: 'abcd', to: { kind: 'route', route: 'home' }, label: 'x'.repeat(100_000), icon: '__proto__' }] },
  ];
  it('returns a drawable rail for every junk config (a broken one becomes the default)', () => {
    for (const j of junk) {
      let out: ResolvedNavItem[] = [];
      expect(() => (out = resolveNav(j as NavConfig, ctx())), String(typeof j)).not.toThrow();
      expect(out.length).toBeGreaterThanOrEqual(2);
      expect(out.at(-1)!.id).toBe('settings');
      for (const i of out) expect(typeof i.Icon === 'function' || typeof i.Icon === 'object').toBe(true);
    }
  });

  it('survives junk in the lists it looks things up in', () => {
    const items = resolveNav(DEFAULT_NAV, { apps: [null, undefined, 5, { id: {} }] as never, scenes: [null, 4, {}] as never, actions: 'nope' as never });
    expect(items).toHaveLength(7);
    const pinsToJunk = cfg({ id: 'night', to: { kind: 'scene', scene: 'night0001' } }, app('xxxx', 'gps'));
    expect(() => resolveNav(pinsToJunk, { apps: [null, { id: {} }] as never, scenes: [null, 4, { id: 'night0001', icon: {} }] as never, actions: [] })).not.toThrow();
  });

  it('does not change a frozen config or context, and returns fresh objects every time', () => {
    const frozenCtx = Object.freeze({ apps: Object.freeze([...APPS]), scenes: Object.freeze([scene('night0001')]), actions: Object.freeze([action('garage0001')]) }) as NavContext;
    const a = resolveNav(DEFAULT_NAV, frozenCtx);
    const b = resolveNav(DEFAULT_NAV, frozenCtx);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]!.to).not.toBe(DEFAULT_NAV.items[0]!.to); // sanitised copy, never the shared default
  });

  it('every preset resolves to itself, item for item', () => {
    for (const [name, preset] of Object.entries(NAV_PRESETS)) expect(resolveNav(preset, ctx()).map((i) => i.id), name).toEqual(preset.items.map((i) => i.id));
  });
});

describe('icons: looked up through a Map, so an id is never an object key', () => {
  it('every icon the vocabulary offers has a drawing, and nothing else does', () => {
    expect(NAV_ICON_MAP).toBeInstanceOf(Map);
    expect([...NAV_ICON_MAP.keys()].sort()).toEqual([...NAV_ICONS].sort());
    for (const id of NAV_ICONS) expect(navIcon(id), id).toBe(NAV_ICON_MAP.get(id));
  });

  it('an id this build does not know, or a prototype name, is the plain fallback; no id is nothing', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'newerbuild']) expect(navIcon(id as never), id).toBe(FALLBACK_ICON);
    expect(navIcon(null)).toBeNull();
    expect(navIcon(undefined)).toBeNull();
    expect(navIcon('' as never)).toBeNull();
  });
});
