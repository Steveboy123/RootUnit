import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV, NAV_PRESETS, type NavConfig, type NavItem } from '@headunit/shared';
import type { Route } from '../../store';
import { APPS } from '../../apps/registry';
import { resolveNav } from './resolve';
import type { NavPlace, ResolvedNavItem } from './types';
import { railFor, showBack } from './useNav';

const ROUTES: Route[] = ['home', 'drive', 'media', 'aa', 'apps', 'app', 'nowplaying', 'devices', 'vehicle', 'settings'];
const place = (route: Route, appId: string | null = null): NavPlace => ({ route, appId, musicTab: 'spotify' });
const rail = (...items: NavItem[]): NavConfig => ({ version: 1, position: 'left', size: 'regular', labels: 'always', items: [...items, { id: 'spacer', to: { kind: 'gap' } }, { id: 'settings', to: { kind: 'route', route: 'settings' } }] });
const resolve = (config: NavConfig): ResolvedNavItem[] => resolveNav(config, { apps: APPS, scenes: [], actions: [] });
const route = (id: string, r: 'home' | 'drive' | 'media' | 'aa' | 'apps'): NavItem => ({ id, to: { kind: 'route', route: r } });

describe('railFor: which button a page lives under', () => {
  it('apps, Phones and Vehicle are under Apps; the full-screen player is under Music; everything else is its own', () => {
    expect(ROUTES.map((r) => [r, railFor(r)])).toEqual([
      ['home', 'home'], ['drive', 'drive'], ['media', 'media'], ['aa', 'aa'], ['apps', 'apps'], ['app', 'apps'], ['nowplaying', 'media'], ['devices', 'apps'], ['vehicle', 'apps'], ['settings', 'settings'],
    ]);
  });
});

describe('the Back rule: shown for a page the rail groups elsewhere, or that the rail has no button for', () => {
  const standard = resolve(DEFAULT_NAV);

  it('the default rail: Back only on the deeper pages (an app, Phones, Vehicle, the player), never on a page with its own button', () => {
    const back = ROUTES.filter((r) => showBack(place(r, 'gps'), standard));
    expect(back).toEqual(['app', 'nowplaying', 'devices', 'vehicle']);
  });

  it('Home never shows Back, even with Home taken off the rail', () => {
    expect(showBack(place('home'), standard)).toBe(false);
    expect(showBack(place('home'), resolve(rail(route('drive0', 'drive'))))).toBe(false);
    expect(showBack(place('home'), [])).toBe(false);
  });

  it('a page the rail has no button for gets Back (rule 2): Apps taken off, then the launcher needs one', () => {
    const noApps = resolve(rail(route('home', 'home'), route('drive', 'drive')));
    expect(showBack(place('apps'), noApps)).toBe(true);
    expect(showBack(place('drive'), noApps)).toBe(false);
    expect(showBack(place('media'), noApps)).toBe(true);
    expect(showBack(place('aa'), noApps)).toBe(true);
    expect(showBack(place('settings'), noApps)).toBe(false); // Settings is always there
  });

  it('a pinned app keeps Back through rule 1: it is an app page even when the rail highlights it', () => {
    const pinned = resolve(rail({ id: 'gpsx', to: { kind: 'app', app: 'gps' } }));
    expect(showBack(place('app', 'gps'), pinned)).toBe(true);
    expect(showBack(place('devices'), resolve(rail({ id: 'phon', to: { kind: 'app', app: 'devices' } })))).toBe(true);
  });

  it('a button that points at something gone does not count as a way back', () => {
    const items = resolve(rail({ id: 'ghst', to: { kind: 'app', app: 'nolongerthere' } }, route('home', 'home')));
    expect(items.find((i) => i.id === 'ghst')?.state).toBe('missing');
    expect(showBack(place('apps'), items)).toBe(true);
  });

  it('every preset: Back appears exactly where the preset has no button', () => {
    const noBack = (name: keyof typeof NAV_PRESETS) => ROUTES.filter((r) => r !== 'app' && !showBack(place(r, 'gps'), resolve(NAV_PRESETS[name])));
    expect(noBack('default')).toEqual(['home', 'drive', 'media', 'aa', 'apps', 'settings']);
    expect(noBack('minimal')).toEqual(['home', 'media', 'aa', 'settings']);
    expect(noBack('driver')).toEqual(['home', 'drive', 'media', 'aa', 'settings']);
  });
});
