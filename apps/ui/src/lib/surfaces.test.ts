import { describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCHER, DEFAULT_NAV, DEFAULT_PANEL, ID_RE, NAV_LIMITS, NAV_PRESETS, QUICK_TILES, sanitizeLauncher, sanitizeNav, type LauncherConfig, type NavConfig, type NavItem, type QuickTile } from '@headunit/shared';
import type { AppBadge } from '../apps/registry';
import type { Tone } from '../components/ui';
import { PANEL_SECTIONS, QUICK_TILE_LABELS, hiddenApps, isHidden, isPinned, movePanelTile, panelTileRows, pinApp, showAllApps, toggleHidden, togglePanelTile, togglePin, unpinApp, visibleApps } from './surfaces';

/** Freeze everything, so any write to an input throws (the tests run as ES modules: strict mode). */
function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

const app = (id: string) => ({ id, name: id.toUpperCase() });
const APPS = ['trips', 'garage', 'system', 'notes', 'weather', 'arcade'].map(app);
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((a) => a.id);
const badge = (tone: Tone, text = 'x'): AppBadge => ({ text, tone });

describe('visibleApps: what the launcher draws', () => {
  it('leaves hidden apps out and keeps everyone else in the launcher order', () => {
    expect(ids(visibleApps(APPS, ['garage', 'weather'], {}, false))).toEqual(['trips', 'system', 'notes', 'arcade']);
  });

  it('shows everything when nothing is hidden', () => {
    expect(ids(visibleApps(APPS, [], {}, false))).toEqual(ids(APPS));
  });

  it('with the Hidden switch on, shows everything, hidden apps included, in order', () => {
    expect(ids(visibleApps(APPS, ['garage', 'weather'], {}, true))).toEqual(ids(APPS));
  });

  it('an app that needs a look (a warning or danger badge) stays even when hidden: hiding never buries a warning', () => {
    const badges = { garage: badge('danger', '1 overdue'), system: badge('warn', 'Hot') };
    expect(ids(visibleApps(APPS, ['garage', 'system', 'weather'], badges, false))).toEqual(['trips', 'garage', 'system', 'notes', 'arcade']);
  });

  it('a badge that only reports (running, recording) does not keep a hidden app on screen', () => {
    const badges = { trips: badge('ok', 'Recording'), notes: badge('info', 'New'), arcade: null };
    expect(ids(visibleApps(APPS, ['trips', 'notes', 'arcade'], badges, false))).toEqual(['garage', 'system', 'weather']);
  });

  it('a badge on an app that is not hidden changes nothing, and ids that are not apps are ignored', () => {
    expect(ids(visibleApps(APPS, ['no-such-app', '__proto__'], { garage: badge('danger') }, false))).toEqual(ids(APPS));
  });

  it('never reads an inherited property as a badge (an app called "constructor" is not warned about)', () => {
    expect(ids(visibleApps([app('constructor'), app('trips')], ['constructor'], {}, false))).toEqual(['trips']);
  });

  it('returns a new list and does not touch frozen inputs', () => {
    const apps = deepFreeze([...APPS]);
    const hidden = deepFreeze(['garage']);
    const badges = deepFreeze({ system: badge('warn') });
    const out = visibleApps(apps, hidden, badges, false);
    expect(out).not.toBe(apps);
    expect(visibleApps(apps, [], badges, false)).not.toBe(apps);
    expect(visibleApps(apps, hidden, badges, true)).not.toBe(apps);
    expect(ids(out)).not.toContain('garage');
  });
});

describe('hiddenApps and isHidden', () => {
  it('lists the hidden apps in launcher order and skips ids this build has no app for', () => {
    expect(ids(hiddenApps(APPS, ['weather', 'ghost', 'trips']))).toEqual(['trips', 'weather']);
    expect(hiddenApps(APPS, [])).toEqual([]);
  });
  it('isHidden asks the list', () => {
    const l = deepFreeze<LauncherConfig>({ version: 1, hidden: ['garage'] });
    expect([isHidden(l, 'garage'), isHidden(l, 'trips')]).toEqual([true, false]);
  });
});

describe('toggleHidden', () => {
  const launcher = deepFreeze<LauncherConfig>({ version: 1, hidden: ['garage', 'notes'] });

  it('hides an app by adding it at the end, without touching the input', () => {
    const next = toggleHidden(launcher, 'trips');
    expect(next.hidden).toEqual(['garage', 'notes', 'trips']);
    expect(next).not.toBe(launcher);
    expect(launcher.hidden).toEqual(['garage', 'notes']);
  });

  it('shows a hidden app again by taking it out', () => {
    expect(toggleHidden(launcher, 'garage').hidden).toEqual(['notes']);
    expect(toggleHidden(DEFAULT_LAUNCHER, 'garage').hidden).toEqual(['garage']);
    expect(toggleHidden(toggleHidden(DEFAULT_LAUNCHER, 'garage'), 'garage').hidden).toEqual([]);
  });

  it('gives the same launcher back when nothing can change: an id that is not an app id', () => {
    for (const bad of ['', 'x', 'Garage', 'two words', '1abc', 'a'.repeat(40), '__proto__ ']) expect(toggleHidden(launcher, bad), JSON.stringify(bad)).toBe(launcher);
  });

  it('gives the same launcher back when 16 are already hidden, but un-hiding still works at the limit', () => {
    const full = deepFreeze<LauncherConfig>({ version: 1, hidden: Array.from({ length: 16 }, (_, i) => `app-${String.fromCharCode(97 + i)}`) });
    expect(toggleHidden(full, 'one-more')).toBe(full);
    expect(toggleHidden(full, 'app-a').hidden).toHaveLength(15);
  });

  it('what it returns is what the server would keep', () => {
    const next = toggleHidden(launcher, 'weather');
    expect(sanitizeLauncher(next)).toEqual(next);
  });
});

describe('showAllApps', () => {
  it('empties the list; an empty list comes back as the same object', () => {
    const l = deepFreeze<LauncherConfig>({ version: 1, hidden: ['garage'] });
    expect(showAllApps(l)).toEqual({ version: 1, hidden: [] });
    expect(showAllApps(DEFAULT_LAUNCHER)).toBe(DEFAULT_LAUNCHER);
  });
});

describe('pinApp, unpinApp, isPinned', () => {
  const routeIds = (n: NavConfig) => n.items.map((i) => i.id);

  it('adds the app as the last scrolling button, before the divider; Settings stays last', () => {
    const next = pinApp(DEFAULT_NAV, 'garage', 'pinned1')!;
    expect(routeIds(next)).toEqual(['home', 'drive', 'music', 'auto', 'apps', 'pinned1', 'spacer', 'settings']);
    expect(next.items[5]).toEqual({ id: 'pinned1', to: { kind: 'app', app: 'garage' } });
    expect(isPinned(next, 'garage')).toBe(true);
    expect(isPinned(DEFAULT_NAV, 'garage')).toBe(false);
  });

  it('does not touch the (frozen) input and returns a new rail', () => {
    const before = JSON.stringify(DEFAULT_NAV);
    const next = pinApp(DEFAULT_NAV, 'trips')!;
    expect(next).not.toBe(DEFAULT_NAV);
    expect(JSON.stringify(DEFAULT_NAV)).toBe(before);
    expect(next.items).not.toBe(DEFAULT_NAV.items);
  });

  it('keeps the pinned foot where it is: the app goes before the divider, not after it', () => {
    const withFoot = deepFreeze(sanitizeNav({ ...DEFAULT_NAV, items: [...DEFAULT_NAV.items.slice(0, 6), { id: 'night', to: { kind: 'scene', scene: 'nightdrive' } }, DEFAULT_NAV.items[6]!] }));
    const next = pinApp(withFoot, 'gps', 'gps1')!;
    expect(routeIds(next)).toEqual(['home', 'drive', 'music', 'auto', 'apps', 'gps1', 'spacer', 'night', 'settings']);
  });

  it('keeps position, size and label mode, and the custom labels of the other buttons', () => {
    const custom = deepFreeze<NavConfig>({ ...NAV_PRESETS.driver, position: 'right', items: [{ id: 'drive', to: { kind: 'route', route: 'drive' }, label: 'Go', icon: 'car' }, ...NAV_PRESETS.driver.items.slice(1)] });
    const next = pinApp(custom, 'notes')!;
    expect([next.position, next.size, next.labels]).toEqual(['right', 'large', 'active']);
    expect(next.items[0]).toEqual({ id: 'drive', to: { kind: 'route', route: 'drive' }, label: 'Go', icon: 'car' });
  });

  it('an app that is already on the rail comes back as the same rail', () => {
    const next = pinApp(DEFAULT_NAV, 'garage')!;
    expect(pinApp(next, 'garage')).toBe(next);
  });

  it('refuses (null) once the rail is full: 10 buttons with the divider and Settings, so 8 to pin', () => {
    let nav: NavConfig = DEFAULT_NAV; // 5 buttons
    for (const a of ['trips', 'garage', 'system']) nav = pinApp(nav, a)!; // 8
    expect(nav.items).toHaveLength(NAV_LIMITS.items);
    expect(pinApp(nav, 'notes')).toBeNull();
    expect(nav.items.filter((i) => i.to.kind === 'app')).toHaveLength(3); // nothing was dropped to make room
  });

  it('refuses when the pinned foot uses the room as well', () => {
    const items: NavItem[] = [
      ...['home', 'drive', 'media', 'aa', 'apps'].map((r, i) => ({ id: `route${i}`, to: { kind: 'route', route: r } }) as NavItem),
      { id: 'app1', to: { kind: 'app', app: 'trips' } },
      DEFAULT_NAV.items[5]!,
      { id: 'foot1', to: { kind: 'scene', scene: 'sceneone' } },
      { id: 'foot2', to: { kind: 'action', action: 'acttwo' } },
      DEFAULT_NAV.items[6]!,
    ];
    const full = sanitizeNav({ ...DEFAULT_NAV, items });
    expect(full.items).toHaveLength(10);
    expect(pinApp(full, 'garage')).toBeNull();
    expect(isPinned(full, 'garage')).toBe(false);
  });

  it('refuses an id that is not an app id', () => {
    for (const bad of ['', 'X', 'a b', '9lives', '__proto__']) expect(pinApp(DEFAULT_NAV, bad), JSON.stringify(bad)).toBeNull();
  });

  it('pins an app this build does not know (references resolve at draw time and are never pruned)', () => {
    expect(isPinned(pinApp(DEFAULT_NAV, 'from-a-newer-build')!, 'from-a-newer-build')).toBe(true);
  });

  it('makes a valid id of its own (never random in a way the sanitizer rejects), and repairs a clash instead of failing', () => {
    const made = pinApp(DEFAULT_NAV, 'garage')!.items[5]!;
    expect(ID_RE.test(made.id)).toBe(true);
    const clash = pinApp(DEFAULT_NAV, 'garage', 'home')!;
    expect(isPinned(clash, 'garage')).toBe(true);
    expect(new Set(clash.items.map((i) => i.id)).size).toBe(clash.items.length);
  });

  it('what it returns is what the server would keep (a fixed point of the sanitizer)', () => {
    const next = pinApp(DEFAULT_NAV, 'garage', 'pin1')!;
    expect(sanitizeNav(next)).toEqual(next);
  });

  it('unpin takes the app off and leaves everything else; a rail without it comes back unchanged', () => {
    const pinned = deepFreeze(pinApp(DEFAULT_NAV, 'garage', 'pin1')!);
    const back = unpinApp(pinned, 'garage');
    expect(back).toEqual(DEFAULT_NAV);
    expect(back).not.toBe(pinned);
    expect(isPinned(back, 'garage')).toBe(false);
    expect(unpinApp(DEFAULT_NAV, 'garage')).toBe(DEFAULT_NAV);
  });

  it('unpinning leaves the sanitizer\'s own rules intact: Settings last, one divider, even when nothing else is left', () => {
    const lone = deepFreeze(sanitizeNav({ ...DEFAULT_NAV, items: [{ id: 'gpsx', to: { kind: 'app', app: 'gps' } }, ...DEFAULT_NAV.items.slice(5)] }));
    const empty = unpinApp(lone, 'gps');
    expect(empty.items.map((i) => i.id)).toEqual(['spacer', 'settings']);
  });

  it('togglePin: pin, unpin, or full', () => {
    const pinned = togglePin(DEFAULT_NAV, 'garage', 'pin1');
    expect(pinned.kind).toBe('pin');
    expect(pinned.kind === 'pin' && isPinned(pinned.nav, 'garage')).toBe(true);
    const unpinned = togglePin((pinned as { nav: NavConfig }).nav, 'garage');
    expect(unpinned.kind).toBe('unpin');
    expect(unpinned.kind === 'unpin' && isPinned(unpinned.nav, 'garage')).toBe(false);
    let nav: NavConfig = DEFAULT_NAV;
    for (const a of ['trips', 'garage', 'system']) nav = pinApp(nav, a)!;
    expect(togglePin(nav, 'notes')).toEqual({ kind: 'full' });
    expect(togglePin(nav, 'trips').kind).toBe('unpin'); // a full rail can still be made smaller
  });
});

describe('Quick Panel tiles: movePanelTile', () => {
  const tiles = deepFreeze<readonly QuickTile[]>(['camera', 'standby', 'passenger', 'phones']);

  it('swaps a tile with its neighbour, up or down, in a new list', () => {
    expect(movePanelTile(tiles, 'passenger', -1)).toEqual(['camera', 'passenger', 'standby', 'phones']);
    expect(movePanelTile(tiles, 'standby', 1)).toEqual(['camera', 'passenger', 'standby', 'phones']);
    expect(movePanelTile(tiles, 'passenger', -1)).not.toBe(tiles);
    expect(tiles).toEqual(['camera', 'standby', 'passenger', 'phones']);
  });

  it('does nothing at the ends, or for a tile that is not shown (the same list comes back)', () => {
    expect(movePanelTile(tiles, 'camera', -1)).toBe(tiles);
    expect(movePanelTile(tiles, 'phones', 1)).toBe(tiles);
    expect(movePanelTile(tiles, 'lights', 1)).toBe(tiles);
    expect(movePanelTile([], 'camera', 1)).toEqual([]);
  });

  it('moving a tile and moving it back is a round trip', () => {
    expect(movePanelTile(movePanelTile(tiles, 'standby', 1), 'standby', -1)).toEqual(tiles);
  });
});

describe('Quick Panel tiles: togglePanelTile', () => {
  it('hides a shown tile, in a new list', () => {
    const tiles = deepFreeze<readonly QuickTile[]>([...QUICK_TILES]);
    const next = togglePanelTile(tiles, 'lights');
    expect(next).toEqual(['camera', 'standby', 'passenger', 'aa', 'phones', 'bt']);
    expect(tiles).toHaveLength(7);
  });

  it('shows a hidden tile where the default order has it: hiding then showing any tile is a round trip', () => {
    for (const tile of QUICK_TILES) {
      const hidden = togglePanelTile(DEFAULT_PANEL.tiles, tile);
      expect(hidden, tile).not.toContain(tile);
      expect(togglePanelTile(hidden, tile), tile).toEqual(QUICK_TILES);
    }
  });

  it('puts a tile before the first shown tile that follows it by default, and last when none does', () => {
    expect(togglePanelTile(['phones', 'camera'], 'standby')).toEqual(['standby', 'phones', 'camera']);
    expect(togglePanelTile(['camera', 'standby'], 'bt')).toEqual(['camera', 'standby', 'bt']);
    expect(togglePanelTile([], 'aa')).toEqual(['aa']);
  });
});

describe('panelTileRows: the Settings list', () => {
  it('shown tiles first in their order, then the hidden ones in the default order; every tile exactly once', () => {
    const rows = panelTileRows(['phones', 'camera']);
    expect(rows.map((r) => r.tile)).toEqual(['phones', 'camera', 'standby', 'passenger', 'lights', 'aa', 'bt']);
    expect(rows.map((r) => r.shown)).toEqual([true, true, false, false, false, false, false]);
  });

  it('only shown tiles can move, and not past the ends', () => {
    const rows = panelTileRows(['camera', 'standby', 'bt']);
    expect(rows.map((r) => [r.canUp, r.canDown])).toEqual([[false, true], [true, true], [true, false], [false, false], [false, false], [false, false], [false, false]]);
    expect(panelTileRows(['camera']).map((r) => [r.canUp, r.canDown])[0]).toEqual([false, false]);
  });

  it('shows all seven as hidden when the panel has no tiles, and skips junk and repeats in a damaged list', () => {
    expect(panelTileRows([]).every((r) => !r.shown)).toBe(true);
    expect(panelTileRows([]).map((r) => r.tile)).toEqual(QUICK_TILES);
    const damaged = panelTileRows(['camera', 'camera', 'nope', 'bt'] as unknown as QuickTile[]);
    expect(damaged.map((r) => r.tile)).toEqual(['camera', 'bt', 'standby', 'passenger', 'lights', 'aa', 'phones']);
    expect(damaged.filter((r) => r.shown)).toHaveLength(2);
  });
});

describe('names', () => {
  it('every tile of the shared vocabulary has a plain name, and no other key is named', () => {
    expect(Object.keys(QUICK_TILE_LABELS).sort()).toEqual([...QUICK_TILES].sort());
    for (const t of QUICK_TILES) expect(QUICK_TILE_LABELS[t].length).toBeGreaterThan(2);
  });
  it('the three sections are the three the panel config has', () => {
    expect(PANEL_SECTIONS.map((s) => s.key)).toEqual(Object.keys(DEFAULT_PANEL.sections));
  });
});
