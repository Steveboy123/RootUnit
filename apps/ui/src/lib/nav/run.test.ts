import { DEFAULT_NAV, sanitizeNav, type NavConfig } from '@headunit/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { APPS } from '../../apps/registry';
import { useHeadUnit } from '../../store';
import { resolveNav } from './resolve';
import { isAlreadyThere, runTarget } from './run';
import type { ResolvedNavItem } from './types';

const resolve = (nav: NavConfig) => resolveNav(nav, { apps: APPS, scenes: [], actions: [] });
const item = (items: ResolvedNavItem[], id: string) => items.find((i) => i.id === id)!;

const pinned = sanitizeNav({
  version: 1,
  items: [
    { id: 'home', to: { kind: 'route', route: 'home' } },
    { id: 'music', to: { kind: 'route', route: 'media' } },
    { id: 'apps', to: { kind: 'route', route: 'apps' } },
    { id: 'notes', to: { kind: 'app', app: 'notes' } },
    { id: 'phones', to: { kind: 'app', app: 'devices' } },
    { id: 'radio', to: { kind: 'music', tab: 'radio' } },
    { id: 'tidal', to: { kind: 'music', tab: 'tidal' } },
  ],
});

const at = (over: Partial<ReturnType<typeof useHeadUnit.getState>>) =>
  useHeadUnit.setState({ route: 'home', appId: null, musicTab: 'spotify', quickPanel: false, ...over });

beforeEach(() => at({}));

describe('isAlreadyThere', () => {
  const items = resolve(pinned);

  it('is true only on the very page the item points at', () => {
    expect(isAlreadyThere(item(items, 'home'), { route: 'home', appId: null, musicTab: 'spotify' })).toBe(true);
    expect(isAlreadyThere(item(items, 'home'), { route: 'drive', appId: null, musicTab: 'spotify' })).toBe(false);
    expect(isAlreadyThere(item(items, 'notes'), { route: 'app', appId: 'notes', musicTab: 'spotify' })).toBe(true);
    expect(isAlreadyThere(item(items, 'notes'), { route: 'app', appId: 'trips', musicTab: 'spotify' })).toBe(false);
    expect(isAlreadyThere(item(items, 'radio'), { route: 'media', appId: null, musicTab: 'radio' })).toBe(true);
    expect(isAlreadyThere(item(items, 'radio'), { route: 'media', appId: null, musicTab: 'tidal' })).toBe(false);
  });

  it('is NOT true just because the grouped item is highlighted: Apps inside an app or on Phones, Music on Now playing', () => {
    expect(isAlreadyThere(item(items, 'apps'), { route: 'app', appId: 'notes', musicTab: 'spotify' })).toBe(false);
    expect(isAlreadyThere(item(items, 'apps'), { route: 'devices', appId: null, musicTab: 'spotify' })).toBe(false);
    expect(isAlreadyThere(item(items, 'apps'), { route: 'vehicle', appId: null, musicTab: 'spotify' })).toBe(false);
    expect(isAlreadyThere(item(items, 'music'), { route: 'nowplaying', appId: null, musicTab: 'spotify' })).toBe(false);
  });

  it('counts the Phones page as "there" for a pinned Phones app', () => {
    expect(isAlreadyThere(item(items, 'phones'), { route: 'devices', appId: null, musicTab: 'spotify' })).toBe(true);
  });

  it('is never true for the divider or for a scene or action', () => {
    const odd = resolve(DEFAULT_NAV).find((i) => i.kind === 'gap')!;
    expect(isAlreadyThere(odd, { route: 'home', appId: null, musicTab: 'spotify' })).toBe(false);
  });
});

describe('runTarget: tapping a rail button always leads somewhere sensible', () => {
  const items = resolve(pinned);

  it('Apps from inside an app opens the launcher (the regression this guards)', () => {
    at({ route: 'app', appId: 'notes' });
    runTarget(item(items, 'apps'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'apps', appId: null });
  });

  it('Apps from the Phones page opens the launcher', () => {
    at({ route: 'devices' });
    runTarget(item(items, 'apps'));
    expect(useHeadUnit.getState().route).toBe('apps');
  });

  it('Music from the full-screen player opens the music page', () => {
    at({ route: 'nowplaying' });
    runTarget(item(items, 'music'));
    expect(useHeadUnit.getState().route).toBe('media');
  });

  it('a pinned app opens its own page, and a pinned music tab selects its tab', () => {
    runTarget(item(items, 'notes'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'app', appId: 'notes' });
    runTarget(item(items, 'radio'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'media', musicTab: 'radio' });
    runTarget(item(items, 'tidal'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'media', musicTab: 'tidal' });
  });

  it('a pinned Phones app opens the Phones page', () => {
    runTarget(item(items, 'phones'));
    expect(useHeadUnit.getState().route).toBe('devices');
  });

  it('tapping the page you are already on only closes the Quick Panel', () => {
    at({ route: 'app', appId: 'notes', quickPanel: true });
    runTarget(item(items, 'notes'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'app', appId: 'notes', quickPanel: false });
    at({ route: 'home', quickPanel: true });
    runTarget(item(items, 'home'));
    expect(useHeadUnit.getState()).toMatchObject({ route: 'home', quickPanel: false });
  });

  it('adds nothing to the Back history when you tap where you already are', () => {
    at({ route: 'home' });
    useHeadUnit.getState().go('settings');
    runTarget(item(items, 'notes')); // settings -> notes
    runTarget(item(items, 'notes')); // already there: no second entry
    useHeadUnit.getState().back();
    // With a duplicate entry Back would land on the same app again and fall through to Home.
    expect(useHeadUnit.getState().route).toBe('settings');
  });

  it('does nothing for a missing, loading or divider item', () => {
    const gap = resolve(DEFAULT_NAV).find((i) => i.kind === 'gap')!;
    at({ route: 'home' });
    runTarget(gap);
    runTarget({ ...item(items, 'notes'), state: 'missing' });
    runTarget({ ...item(items, 'notes'), state: 'loading' });
    expect(useHeadUnit.getState().route).toBe('home');
  });
});
