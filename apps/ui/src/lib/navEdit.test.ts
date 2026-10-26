import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NAV,
  DEFAULT_SETTINGS,
  NAV_ICONS,
  NAV_LIMITS,
  NAV_PRESETS,
  sanitizeNav,
  targetKey,
  type NavConfig,
  type NavItem,
  type NavPatch,
  type NavPresetId,
  type NavTarget,
} from '@headunit/shared';
import { apply, useHeadUnit } from '../store';
import { openNavEditor } from './nav';
import { EDIT_LOCKED_MESSAGE, resetSpeedMemory } from './driving';
import {
  MAX_BUTTONS,
  addItem,
  applyPreset,
  buttonCount,
  canAdd,
  canMove,
  changedFields,
  countFit,
  createCommitScheduler,
  createNavSession,
  defaultNav,
  moveItem,
  nextFootCount,
  partsOf,
  removeItem,
  sameNav,
  scrollsAfter,
  setIcon,
  setLabel,
  setLook,
  type NavSessionDeps,
  type Timers,
  countFitAcross,
} from './navEdit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Freeze all the way down: a reducer that writes to its input throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
const frozen = (c: NavConfig): NavConfig => deepFreeze(structuredClone(c));
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const item = (id: string, to: NavTarget, extra: Partial<NavItem> = {}): NavItem => ({ id, to, ...extra });
const route = (r: 'home' | 'drive' | 'media' | 'aa' | 'apps'): NavTarget => ({ kind: 'route', route: r });
const app = (a: string): NavTarget => ({ kind: 'app', app: a });
const GAP: NavItem = { id: 'spacer', to: { kind: 'gap' } };
const SETTINGS: NavItem = { id: 'settings', to: { kind: 'route', route: 'settings' } };

/** A rail from its head and foot (the divider and Settings are added). */
function rail(head: NavItem[], foot: NavItem[] = [], over: Partial<NavConfig> = {}): NavConfig {
  return deepFreeze({ version: 1, position: 'left', size: 'regular', labels: 'always', ...over, items: [...head, GAP, ...foot, SETTINGS] } as NavConfig);
}
const ids = (c: NavConfig) => c.items.map((i) => i.id);
const names = (c: NavConfig) => ({ head: partsOf(c).head.map((i) => i.id), foot: partsOf(c).foot.map((i) => i.id) });

/** The invariants every reducer's result must hold (the sanitizer's, restated). */
function expectValid(c: NavConfig) {
  expect(sanitizeNav(c)).toEqual(c);
  expect(c.items.at(-1)).toEqual(SETTINGS);
  expect(c.items.filter((i) => i.to.kind === 'gap')).toHaveLength(1);
  expect(c.items.length).toBeLessThanOrEqual(NAV_LIMITS.items);
  expect(new Set(c.items.map((i) => i.id)).size).toBe(c.items.length);
  expect(new Set(c.items.map((i) => targetKey(i.to))).size).toBe(c.items.length);
  expect(partsOf(c).foot.length).toBeLessThanOrEqual(NAV_LIMITS.foot);
}

const A = item('aaaa', route('home'));
const B = item('bbbb', route('drive'));
const C = item('cccc', route('media'));
const D = item('dddd', route('aa'));
const E = item('eeee', route('apps'));

// ---------------------------------------------------------------------------
// Reading the rail
// ---------------------------------------------------------------------------

describe('partsOf / buttonCount / sameNav', () => {
  it('splits the default rail into five scrolling buttons and an empty foot (Settings and the divider are in neither)', () => {
    const p = partsOf(DEFAULT_NAV);
    expect(p.head.map((i) => i.id)).toEqual(['home', 'drive', 'music', 'auto', 'apps']);
    expect(p.foot).toEqual([]);
    expect(buttonCount(DEFAULT_NAV)).toBe(6);
  });

  it('puts what follows the divider in the foot, in order', () => {
    expect(names(rail([A, B], [C, D]))).toEqual({ head: ['aaaa', 'bbbb'], foot: ['cccc', 'dddd'] });
  });

  it('sameNav compares content, not identity: an id, a label, an icon, a target or a scalar each make a difference', () => {
    const base = rail([A, B]);
    expect(sameNav(base, plain(base))).toBe(true);
    expect(sameNav(base, rail([A, item('bbbb', route('drive'), { label: 'Go' })]))).toBe(false);
    expect(sameNav(base, rail([A, item('bbbb', route('drive'), { icon: 'car' })]))).toBe(false);
    expect(sameNav(base, rail([A, item('bbbb', app('gps'))]))).toBe(false);
    expect(sameNav(base, rail([A, item('zzzz', route('drive'))]))).toBe(false);
    expect(sameNav(base, rail([B, A]))).toBe(false);
    expect(sameNav(base, rail([A, B], [], { position: 'right' }))).toBe(false);
    expect(sameNav(base, rail([A, B], [], { size: 'large' }))).toBe(false);
    expect(sameNav(base, rail([A, B], [], { labels: 'never' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveItem
// ---------------------------------------------------------------------------

describe('moveItem', () => {
  it('swaps with the neighbour inside the scrolling head', () => {
    const c = rail([A, B, C]);
    expect(names(moveItem(c, 'bbbb', 'up')).head).toEqual(['bbbb', 'aaaa', 'cccc']);
    expect(names(moveItem(c, 'bbbb', 'down')).head).toEqual(['aaaa', 'cccc', 'bbbb']);
  });

  it('moving the first button up, or a pinned last button down, changes nothing (the same object comes back)', () => {
    const c = rail([A, B], [C, D]);
    expect(moveItem(c, 'aaaa', 'up')).toBe(c);
    expect(moveItem(c, 'dddd', 'down')).toBe(c);
  });

  it('"down" on the last scrolling button pins it as the FIRST pinned button (crossing the divider)', () => {
    const c = rail([A, B, C], [D]);
    const next = moveItem(c, 'cccc', 'down');
    expect(names(next)).toEqual({ head: ['aaaa', 'bbbb'], foot: ['cccc', 'dddd'] });
    expectValid(next);
  });

  it('"up" on the first pinned button lets it scroll again as the LAST scrolling button', () => {
    const c = rail([A, B], [C, D]);
    const next = moveItem(c, 'cccc', 'up');
    expect(names(next)).toEqual({ head: ['aaaa', 'bbbb', 'cccc'], foot: ['dddd'] });
    expectValid(next);
  });

  it('crossing works with an empty foot, and with a single-button head (the head may end up empty)', () => {
    const one = rail([A]);
    const pinned = moveItem(one, 'aaaa', 'down');
    expect(names(pinned)).toEqual({ head: [], foot: ['aaaa'] });
    expectValid(pinned);
    expect(names(moveItem(pinned, 'aaaa', 'up'))).toEqual({ head: ['aaaa'], foot: [] });
  });

  it('swaps inside the pinned foot', () => {
    const c = rail([A], [B, C]);
    expect(names(moveItem(c, 'cccc', 'up'))).toEqual({ head: ['aaaa'], foot: ['cccc', 'bbbb'] });
    expect(names(moveItem(c, 'bbbb', 'down'))).toEqual({ head: ['aaaa'], foot: ['cccc', 'bbbb'] });
  });

  it('refuses to pin a third button: the foot holds two', () => {
    const c = rail([A, B], [C, D]);
    expect(moveItem(c, 'bbbb', 'down')).toBe(c);
    expect(canMove(c, 'bbbb', 'down')).toBe(false);
    expect(canMove(c, 'bbbb', 'up')).toBe(true);
  });

  it('Settings, the divider and an unknown id do not move', () => {
    const c = rail([A, B], [C]);
    for (const id of ['settings', 'spacer', 'nope', '', '__proto__', 'constructor']) {
      expect(moveItem(c, id, 'up')).toBe(c);
      expect(moveItem(c, id, 'down')).toBe(c);
    }
  });

  it('keeps Settings last and the rail valid through a long walk down and back up', () => {
    let c = rail([A, B, C, D]);
    for (let i = 0; i < 12; i++) {
      c = moveItem(c, 'aaaa', 'down');
      expectValid(c);
    }
    expect(names(c)).toEqual({ head: ['bbbb', 'cccc', 'dddd'], foot: ['aaaa'] });
    for (let i = 0; i < 12; i++) {
      c = moveItem(c, 'aaaa', 'up');
      expectValid(c);
    }
    expect(names(c)).toEqual({ head: ['aaaa', 'bbbb', 'cccc', 'dddd'], foot: [] });
  });

  it('keeps labels and icons on the moved button, and the look of the rail', () => {
    const c = rail([A, item('bbbb', route('drive'), { label: 'Go', icon: 'car' })], [], { position: 'right', size: 'large', labels: 'active' });
    const next = moveItem(c, 'bbbb', 'up');
    expect(partsOf(next).head[0]).toEqual({ id: 'bbbb', to: route('drive'), label: 'Go', icon: 'car' });
    expect([next.position, next.size, next.labels]).toEqual(['right', 'large', 'active']);
  });

  it('does not touch its input (deep-frozen) and returns new objects', () => {
    const c = frozen(rail([A, B, C], [D]));
    const next = moveItem(c, 'cccc', 'down');
    expect(next).not.toBe(c);
    expect(next.items).not.toBe(c.items);
    expect(ids(c)).toEqual(['aaaa', 'bbbb', 'cccc', 'spacer', 'dddd', 'settings']);
  });
});

describe('nextFootCount', () => {
  const c = rail([A, B], [C]);
  it('grows when the last scrolling button goes down, shrinks when the first pinned one goes up, otherwise stays', () => {
    expect(nextFootCount(c, 'bbbb', 'down')).toBe(2);
    expect(nextFootCount(c, 'cccc', 'up')).toBe(0);
    expect(nextFootCount(c, 'aaaa', 'down')).toBe(1);
    expect(nextFootCount(c, 'aaaa', 'up')).toBe(1);
    expect(nextFootCount(c, 'cccc', 'down')).toBe(1);
    expect(nextFootCount(c, 'unknown', 'down')).toBe(1);
  });
  it('is what makes the move refuse: a full foot would grow to three', () => {
    const full = rail([A, B], [C, D]);
    expect(nextFootCount(full, 'bbbb', 'down')).toBe(3);
    expect(nextFootCount(full, 'bbbb', 'down')).toBeGreaterThan(NAV_LIMITS.foot);
  });
});

// ---------------------------------------------------------------------------
// addItem / canAdd
// ---------------------------------------------------------------------------

describe('addItem', () => {
  it('appends to the end of the scrolling head, with a fresh valid id and no label or icon of its own', () => {
    const next = addItem(DEFAULT_NAV, app('gps'));
    const added = partsOf(next).head.at(-1)!;
    expect(added.to).toEqual(app('gps'));
    expect(added.id).toMatch(/^[a-z0-9]{4,24}$/);
    expect(Object.keys(added).sort()).toEqual(['id', 'to']);
    expect(partsOf(next).head).toHaveLength(6);
    expectValid(next);
  });

  it('uses a different id each time, and an id given by the caller if it is valid', () => {
    const one = partsOf(addItem(DEFAULT_NAV, app('gps'))).head.at(-1)!.id;
    const two = partsOf(addItem(DEFAULT_NAV, app('gps'))).head.at(-1)!.id;
    expect(one).not.toBe(two);
    expect(partsOf(addItem(DEFAULT_NAV, app('gps'), { id: 'mine1' })).head.at(-1)!.id).toBe('mine1');
  });

  it('a clashing id (or an invalid one) is repaired by the sanitizer, never duplicated', () => {
    const clash = addItem(DEFAULT_NAV, app('gps'), { id: 'home' });
    expectValid(clash);
    expect(new Set(ids(clash)).size).toBe(ids(clash).length);
    expectValid(addItem(DEFAULT_NAV, app('gps'), { id: 'NOT VALID!' }));
  });

  it('stops at the cap: 8 buttons besides the divider and Settings (10 entries), and then returns the same object', () => {
    let c: NavConfig = rail([]);
    const apps = ['gps', 'trips', 'garage', 'system', 'notes', 'weather', 'timers', 'perf', 'lights'];
    for (const a of apps.slice(0, MAX_BUTTONS)) c = addItem(c, app(a));
    expect(c.items).toHaveLength(NAV_LIMITS.items);
    expect(buttonCount(c)).toBe(NAV_LIMITS.items - 1);
    const refused = addItem(c, app(apps[MAX_BUTTONS]!));
    expect(refused).toBe(c);
    expect(canAdd(c, app(apps[MAX_BUTTONS]!))).toBe('full');
    expectValid(c);
  });

  it('counts pinned buttons towards the cap too', () => {
    const c = rail([A, B, C, D, E, item('ffff', app('gps')), item('gggg', app('trips'))], [item('hhhh', app('garage'))]);
    expect(MAX_BUTTONS).toBe(8);
    expect(canAdd(c, app('perf'))).toBe('full');
    expect(addItem(c, app('perf'))).toBe(c);
  });

  it('refuses what is already on the rail (any button with the same destination), whatever its id or label', () => {
    const c = rail([item('xxxx', app('gps'), { label: 'Map' }), A]);
    expect(canAdd(c, app('gps'))).toBe('pinned');
    expect(addItem(c, app('gps'))).toBe(c);
    expect(addItem(c, route('home'))).toBe(c);
    expect(canAdd(c, app('trips'))).toBeNull();
  });

  it('knows the same destination across kinds: scene "abcd" and action "abcd" are different buttons', () => {
    const c = addItem(rail([]), { kind: 'scene', scene: 'abcd' });
    expect(canAdd(c, { kind: 'action', action: 'abcd' })).toBeNull();
    expect(canAdd(c, { kind: 'scene', scene: 'abcd' })).toBe('pinned');
  });

  it('refuses Settings and the divider (they are fixed)', () => {
    expect(canAdd(DEFAULT_NAV, { kind: 'route', route: 'settings' })).toBe('fixed');
    expect(canAdd(DEFAULT_NAV, { kind: 'gap' })).toBe('fixed');
    expect(addItem(DEFAULT_NAV, { kind: 'gap' })).toBe(DEFAULT_NAV);
    expect(addItem(DEFAULT_NAV, { kind: 'route', route: 'settings' })).toBe(DEFAULT_NAV);
  });

  it('can add straight into the pinned foot, which holds two', () => {
    let c = addItem(rail([A]), app('gps'), { where: 'foot' });
    expect(names(c).foot).toHaveLength(1);
    c = addItem(c, app('trips'), { where: 'foot' });
    expect(names(c).foot).toHaveLength(2);
    expect(addItem(c, app('garage'), { where: 'foot' })).toBe(c);
    expect(names(addItem(c, app('garage'))).head).toHaveLength(2);
    expectValid(c);
  });

  it('does not touch a frozen input', () => {
    const c = frozen(DEFAULT_NAV);
    const next = addItem(c, app('gps'));
    expect(next).not.toBe(c);
    expect(c.items).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// removeItem
// ---------------------------------------------------------------------------

describe('removeItem', () => {
  it('takes a button off, wherever it is, and keeps the order of the rest', () => {
    const c = rail([A, B, C], [D]);
    expect(names(removeItem(c, 'bbbb'))).toEqual({ head: ['aaaa', 'cccc'], foot: ['dddd'] });
    expect(names(removeItem(c, 'dddd'))).toEqual({ head: ['aaaa', 'bbbb', 'cccc'], foot: [] });
  });

  it('refuses Settings, the divider and an unknown id (the same object comes back)', () => {
    const c = rail([A], [B]);
    for (const id of ['settings', 'spacer', 'nope', '']) expect(removeItem(c, id)).toBe(c);
  });

  it('removing everything leaves a valid rail with just Settings (the way back is Settings itself)', () => {
    let c = rail([A, B], [C]);
    for (const id of ['aaaa', 'bbbb', 'cccc']) c = removeItem(c, id);
    expect(ids(c)).toEqual(['spacer', 'settings']);
    expectValid(c);
  });

  it('frees a slot for adding again', () => {
    let c: NavConfig = rail([]);
    for (const a of ['gps', 'trips', 'garage', 'system', 'notes', 'weather', 'timers', 'perf']) c = addItem(c, app(a));
    expect(canAdd(c, app('lights'))).toBe('full');
    c = removeItem(c, partsOf(c).head[0]!.id);
    expect(canAdd(c, app('lights'))).toBeNull();
  });

  it('does not touch a frozen input', () => {
    const c = frozen(DEFAULT_NAV);
    expect(removeItem(c, 'drive').items).toHaveLength(6);
    expect(c.items).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// setLabel / setIcon
// ---------------------------------------------------------------------------

describe('setLabel', () => {
  const c = rail([A, B]);
  const labelOf = (cfg: NavConfig, id: string) => cfg.items.find((i) => i.id === id)?.label;

  it('sets a label, cleaned the way the server cleans it', () => {
    expect(labelOf(setLabel(c, 'aaaa', '  My   car  '), 'aaaa')).toBe('My car');
    expect(labelOf(setLabel(c, 'aaaa', 'a​b‮c'), 'aaaa')).toBe('abc');
    expect(labelOf(setLabel(c, 'aaaa', 'Café'), 'aaaa')).toBe('Café');
    expect(labelOf(setLabel(c, 'aaaa', 'a\nb\tc'), 'aaaa')).toBe('a b c');
  });

  it('cuts at 10 characters (code points, so an emoji is one)', () => {
    expect(labelOf(setLabel(c, 'aaaa', 'abcdefghijklmnop'), 'aaaa')).toBe('abcdefghij');
    const emoji = '\u{1F697}'.repeat(12);
    expect(Array.from(labelOf(setLabel(c, 'aaaa', emoji), 'aaaa')!)).toHaveLength(10);
  });

  it('an empty (or whitespace, or null) label clears it: the usual name comes back', () => {
    const named = setLabel(c, 'aaaa', 'Mine');
    for (const empty of ['', '   ', '​', null]) expect(labelOf(setLabel(named, 'aaaa', empty), 'aaaa')).toBeUndefined();
    expect('label' in setLabel(named, 'aaaa', '').items[0]!).toBe(false);
  });

  it('keeps the icon, the target and the other buttons', () => {
    const withIcon = setIcon(c, 'aaaa', 'star');
    const next = setLabel(withIcon, 'aaaa', 'Hi');
    expect(next.items[0]).toEqual({ id: 'aaaa', to: route('home'), label: 'Hi', icon: 'star' });
    expect(next.items[1]).toEqual(B);
  });

  it('setting what is already there changes nothing (the same object)', () => {
    const named = setLabel(c, 'aaaa', 'Mine');
    expect(setLabel(named, 'aaaa', 'Mine')).toBe(named);
    expect(setLabel(named, 'aaaa', ' Mine ')).toBe(named);
    expect(setLabel(c, 'aaaa', '')).toBe(c);
  });

  it('works for pinned buttons; refuses Settings, the divider and unknown ids', () => {
    const p = rail([A], [B]);
    expect(labelOf(setLabel(p, 'bbbb', 'Pinned'), 'bbbb')).toBe('Pinned');
    for (const id of ['settings', 'spacer', 'nope']) expect(setLabel(p, id, 'Evil')).toBe(p);
  });

  it('a non-string slips through the type as junk and is treated as no label', () => {
    const named = setLabel(c, 'aaaa', 'Mine');
    expect(labelOf(setLabel(named, 'aaaa', 42 as unknown as string), 'aaaa')).toBeUndefined();
  });

  it('does not touch a frozen input', () => {
    const f = frozen(c);
    setLabel(f, 'aaaa', 'Mine');
    expect(f.items[0]).toEqual(A);
  });
});

describe('setIcon', () => {
  const c = rail([A, B]);
  it('sets any icon of the vocabulary and clears it with null', () => {
    for (const icon of NAV_ICONS) expect(setIcon(c, 'aaaa', icon).items[0]!.icon).toBe(icon);
    expect('icon' in setIcon(setIcon(c, 'aaaa', 'star'), 'aaaa', null).items[0]!).toBe(false);
  });
  it('refuses an icon that is not in the vocabulary', () => {
    expect(setIcon(c, 'aaaa', 'rocket' as never)).toBe(c);
    expect(setIcon(c, 'aaaa', '__proto__' as never)).toBe(c);
  });
  it('refuses Settings (its picture is fixed), the divider and unknown ids; same icon changes nothing', () => {
    for (const id of ['settings', 'spacer', 'nope']) expect(setIcon(c, id, 'star')).toBe(c);
    const starred = setIcon(c, 'aaaa', 'star');
    expect(setIcon(starred, 'aaaa', 'star')).toBe(starred);
    expect(setIcon(c, 'aaaa', null)).toBe(c);
  });
  it('keeps the label', () => {
    expect(setIcon(setLabel(c, 'aaaa', 'Mine'), 'aaaa', 'star').items[0]).toEqual({ id: 'aaaa', to: route('home'), label: 'Mine', icon: 'star' });
  });
});

// ---------------------------------------------------------------------------
// setLook / presets / reset
// ---------------------------------------------------------------------------

describe('setLook', () => {
  it('changes the named fields and leaves the buttons alone', () => {
    const c = rail([A, B]);
    const next = setLook(c, { position: 'right', size: 'large' });
    expect([next.position, next.size, next.labels]).toEqual(['right', 'large', 'always']);
    expect(next.items).toEqual(c.items);
    expect(setLook(next, { labels: 'never' }).labels).toBe('never');
  });
  it('a value that is not in the vocabulary is ignored', () => {
    const c = rail([A]);
    expect(setLook(c, { position: 'top' as never })).toBe(c);
    expect(setLook(c, { size: 'huge' as never, labels: 'sometimes' as never })).toBe(c);
  });
  it('no change at all is the same object', () => {
    const c = rail([A]);
    expect(setLook(c, {})).toBe(c);
    expect(setLook(c, { position: 'left', size: 'regular', labels: 'always' })).toBe(c);
  });
});

describe('applyPreset', () => {
  const PRESETS = ['default', 'minimal', 'driver'] as const;

  it('the three presets are fixed points of the sanitizer', () => {
    for (const id of PRESETS) expect(sanitizeNav(NAV_PRESETS[id]), id).toEqual(NAV_PRESETS[id]);
  });

  it('on a left rail, each preset gives exactly the shipped preset', () => {
    for (const id of PRESETS) expect(applyPreset(rail([A, B, C], [D], { size: 'compact', labels: 'never' }), id), id).toEqual(NAV_PRESETS[id]);
  });

  it('keeps NOTHING of the old buttons: not an id, a label, an icon, a pinned button or a scene', () => {
    const mine = rail([item('mine1', app('gps'), { label: 'Mine', icon: 'star' }), item('mine2', { kind: 'scene', scene: 'abcd' })], [item('mine3', { kind: 'action', action: 'wxyz' })]);
    for (const id of PRESETS) {
      const next = applyPreset(mine, id);
      expect(ids(next).some((x) => x.startsWith('mine')), id).toBe(false);
      expect(next.items.every((i) => i.to.kind !== 'scene' && i.to.kind !== 'action' && i.to.kind !== 'app'), id).toBe(true);
      expect(next.items.some((i) => i.label !== undefined || i.icon !== undefined), id).toBe(false);
    }
  });

  it('leaves the side of the screen alone (that is about where the hand is, not what is on the rail)', () => {
    const right = rail([A], [], { position: 'right' });
    for (const id of PRESETS) {
      const next = applyPreset(right, id);
      expect(next.position, id).toBe('right');
      expect(next.items, id).toEqual(NAV_PRESETS[id].items);
      expectValid(next);
    }
  });

  it('Minimal and Driver are what the spec says', () => {
    expect(names(applyPreset(DEFAULT_NAV, 'minimal'))).toEqual({ head: ['home', 'music', 'auto'], foot: [] });
    expect(applyPreset(DEFAULT_NAV, 'minimal').labels).toBe('active');
    expect(names(applyPreset(DEFAULT_NAV, 'driver'))).toEqual({ head: ['drive', 'music', 'auto'], foot: [] });
    expect([applyPreset(DEFAULT_NAV, 'driver').size, applyPreset(DEFAULT_NAV, 'driver').labels]).toEqual(['large', 'active']);
  });

  it('an unknown preset changes nothing, and the result is a fresh object (the shared presets stay frozen and unshared)', () => {
    const c = rail([A]);
    expect(applyPreset(c, 'everything' as NavPresetId)).toBe(c);
    expect(applyPreset(c, '__proto__' as NavPresetId)).toBe(c);
    const next = applyPreset(DEFAULT_NAV, 'default');
    expect(next).not.toBe(DEFAULT_NAV);
    expect(next.items).not.toBe(DEFAULT_NAV.items);
    expect(Object.isFrozen(next)).toBe(false);
    expect(Object.isFrozen(DEFAULT_NAV)).toBe(true);
  });

  it('defaultNav is today\'s rail as a fresh object', () => {
    expect(defaultNav()).toEqual(DEFAULT_NAV);
    expect(defaultNav()).not.toBe(DEFAULT_NAV);
  });
});

// ---------------------------------------------------------------------------
// How much fits
// ---------------------------------------------------------------------------

describe('countFit', () => {
  // Heights are the three real screens: 600 (default tier), 480 and 400 (the tight tier). Each number was checked in a browser against the
  // rail's own scrolling: with one more button the head scrolls (a rail holds at most 9 buttons, so the 10 at 600px compact is as far as
  // the arithmetic goes: the browser check there ran to 9 and did not scroll).
  const table: Array<[size: 'compact' | 'regular' | 'large', tier: 'default' | 'tight', height: number, fits: number]> = [
    ['compact', 'default', 600, 10],
    ['regular', 'default', 600, 9],
    ['large', 'default', 600, 8],
    ['compact', 'tight', 480, 9],
    ['regular', 'tight', 480, 8],
    ['large', 'tight', 480, 7],
    ['compact', 'tight', 400, 7],
    ['regular', 'tight', 400, 6],
    ['large', 'tight', 400, 6],
  ];
  it.each(table)('%s on a %s screen %ipx high holds %i buttons', (size, tier, height, fits) => {
    expect(countFit(height, size, tier)).toBe(fits);
  });

  it('a bigger rail size holds fewer, a taller screen holds more', () => {
    for (const tier of ['default', 'tight'] as const) {
      expect(countFit(500, 'compact', tier)).toBeGreaterThanOrEqual(countFit(500, 'regular', tier));
      expect(countFit(500, 'regular', tier)).toBeGreaterThanOrEqual(countFit(500, 'large', tier));
      expect(countFit(600, 'regular', tier)).toBeGreaterThan(countFit(300, 'regular', tier));
    }
  });

  it('is exactly at the edge: one more pixel of rail adds a button only when a whole button fits', () => {
    // regular, default: room = h - 28, 58 per button => 9 buttons need 550
    expect(countFit(549, 'regular', 'default')).toBe(8);
    expect(countFit(550, 'regular', 'default')).toBe(9);
  });

  it('junk heights hold nothing (and never throw)', () => {
    for (const h of [0, -5, NaN, Infinity, -Infinity, 10]) expect(countFit(h, 'regular', 'default')).toBe(0);
  });
});

describe('scrollsAfter', () => {
  it('is null while everything fits, or while the rail has not been measured', () => {
    expect(scrollsAfter(DEFAULT_NAV, 6)).toBeNull();
    expect(scrollsAfter(DEFAULT_NAV, 9)).toBeNull();
    expect(scrollsAfter(DEFAULT_NAV, null)).toBeNull();
  });
  it('is the number of scrolling buttons that fit once the pinned ones and Settings have their places', () => {
    const c = rail([A, B, C, D, E]); // 5 + Settings = 6 buttons
    expect(scrollsAfter(c, 5)).toBe(4);
    expect(scrollsAfter(c, 3)).toBe(2);
    expect(scrollsAfter(rail([A, B, C, D], [E]), 4)).toBe(2); // pinned E and Settings take two of four
  });
  it('never goes below zero: when not even the pinned buttons fit, every scrolling button is past the line', () => {
    expect(scrollsAfter(rail([A, B], [C, D]), 2)).toBe(0);
    expect(scrollsAfter(rail([A]), 0)).toBe(0);
  });
  it('a button the rail does not draw takes no room: it neither counts nor starts the scrolling', () => {
    const c = rail([A, B, C, D, E]);
    const gone = new Set(['bbbb', 'cccc']);
    // 6 fit = Settings + 5 scrolling: A, D, E are drawn, so nothing scrolls
    expect(scrollsAfter(c, 6, gone)).toBeNull();
    // 3 fit = Settings + 2 scrolling: A and D fit, the line goes before E (index 4), past the two hidden ones
    expect(scrollsAfter(c, 3, gone)).toBe(4);
    // without the hidden set the same room puts the line earlier
    expect(scrollsAfter(c, 3)).toBe(2);
    // a hidden button right after the line stays on the near side of it
    expect(scrollsAfter(rail([A, B, C]), 2, new Set(['bbbb']))).toBe(2);
  });
  it('a hidden pinned button gives its place back', () => {
    const c = rail([A, B, C], [D]);
    expect(scrollsAfter(c, 3)).toBe(1); // D and Settings take two of three places
    expect(scrollsAfter(c, 3, new Set(['dddd']))).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// A random walk over all the reducers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the reducers together: a seeded random walk', () => {
  it('every step is valid, never mutates its (frozen) input, and refusals are the same object', () => {
    const seed = 20260711;
    const rnd = mulberry32(seed);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
    const appIds = ['gps', 'trips', 'garage', 'system', 'notes', 'weather', 'timers', 'perf', 'lights', 'scenes'];
    let c = frozen(DEFAULT_NAV);
    for (let step = 0; step < 1500; step++) {
      const before = JSON.stringify(c);
      const any = [...c.items.map((i) => i.id), 'nope', 'settings'];
      const op = Math.floor(rnd() * 8);
      let next: NavConfig;
      if (op === 0) next = moveItem(c, pick(any), pick(['up', 'down'] as const));
      else if (op === 1) next = addItem(c, rnd() < 0.7 ? app(pick(appIds)) : { kind: 'scene', scene: `sc${Math.floor(rnd() * 6)}ab` }, { where: rnd() < 0.2 ? 'foot' : 'head' });
      else if (op === 2) next = removeItem(c, pick(any));
      else if (op === 3) next = setLabel(c, pick(any), pick(['', ' x ', 'abcdefghijklmnop', 'Home', '​', 'a\nb']));
      else if (op === 4) next = setIcon(c, pick(any), pick([null, ...NAV_ICONS]));
      else if (op === 5) next = setLook(c, { position: pick(['left', 'right', undefined] as const), size: pick(['compact', 'regular', 'large', undefined] as const) });
      else if (op === 6) next = applyPreset(c, pick(['default', 'minimal', 'driver'] as const));
      else next = setLook(c, { labels: pick(['always', 'active', 'never', undefined] as const) });
      try {
        expectValid(next);
      } catch (e) {
        throw new Error(`seed ${seed} step ${step} op ${op}: ${String(e)}`);
      }
      expect(JSON.stringify(c), `seed ${seed} step ${step}: input changed`).toBe(before);
      c = deepFreeze(next);
    }
  });
});

// ---------------------------------------------------------------------------
// What differs
// ---------------------------------------------------------------------------

describe('changedFields', () => {
  const base = rail([A, B]);
  it('names only what changed', () => {
    expect(changedFields(base, base)).toEqual({});
    expect(changedFields(base, setLook(base, { position: 'right' }))).toEqual({ position: 'right' });
    expect(changedFields(base, setLook(base, { size: 'large', labels: 'never' }))).toEqual({ size: 'large', labels: 'never' });
    expect(Object.keys(changedFields(base, moveItem(base, 'bbbb', 'up')))).toEqual(['items']);
  });
  it('an equal but distinct items list is not a change', () => {
    expect(changedFields(base, plain(base))).toEqual({});
  });
  it('a preset changes the buttons, size and names, not the side', () => {
    expect(Object.keys(changedFields(base, applyPreset(base, 'driver'))).sort()).toEqual(['items', 'labels', 'size']);
  });
});

// ---------------------------------------------------------------------------
// The commit scheduler
// ---------------------------------------------------------------------------

/** A clock run by hand. */
function fakeClock() {
  let now = 0;
  let next = 1;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set(fn, ms) {
      const id = next++;
      jobs.set(id, { at: now + ms, fn });
      return id;
    },
    clear(h) {
      jobs.delete(h as number);
    },
  };
  return {
    timers,
    get pending() {
      return jobs.size;
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        jobs.delete(due[0]);
        due[1].fn();
      }
      now = end;
    },
  };
}

describe('createCommitScheduler', () => {
  it('sends 400 ms after the last change, not before', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.push({ position: 'right' });
    clock.advance(399);
    expect(sent).toEqual([]);
    expect(s.waiting).toBe(true);
    clock.advance(1);
    expect(sent).toEqual([{ version: 1, position: 'right' }]);
    expect(s.waiting).toBe(false);
  });

  it('every new change restarts the wait, and the changes go out together as one patch', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.push({ position: 'right' });
    clock.advance(300);
    s.push({ size: 'large' });
    clock.advance(300);
    expect(sent).toEqual([]);
    clock.advance(100);
    expect(sent).toEqual([{ version: 1, position: 'right', size: 'large' }]);
    expect(clock.pending).toBe(0);
  });

  it('a later change to the same field wins; items and look fields travel separately only when only one was changed', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.push({ size: 'large' });
    s.push({ size: 'compact' });
    clock.advance(400);
    expect(sent).toEqual([{ version: 1, size: 'compact' }]);
    s.push({ items: DEFAULT_NAV.items });
    clock.advance(400);
    expect(sent[1]).toEqual({ version: 1, items: DEFAULT_NAV.items });
    expect(Object.keys(sent[1]!)).toEqual(['version', 'items']);
  });

  it('flush sends at once and cancels the timer; flushing with nothing waiting sends nothing', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.flush();
    expect(sent).toEqual([]);
    s.push({ labels: 'never' });
    s.flush();
    expect(sent).toEqual([{ version: 1, labels: 'never' }]);
    expect(clock.pending).toBe(0);
    clock.advance(1000);
    expect(sent).toHaveLength(1);
    s.flush();
    expect(sent).toHaveLength(1);
  });

  it('cancel forgets what was waiting', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.push({ labels: 'never' });
    s.cancel();
    clock.advance(1000);
    s.flush();
    expect(sent).toEqual([]);
    expect(s.waiting).toBe(false);
  });

  it('an empty push, or one whose fields are undefined, starts nothing and wipes nothing', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { timers: clock.timers });
    s.push({});
    s.push({ size: undefined });
    expect(clock.pending).toBe(0);
    expect(s.waiting).toBe(false);
    s.push({ size: 'large' });
    s.push({ size: undefined, labels: 'never' });
    clock.advance(400);
    expect(sent).toEqual([{ version: 1, size: 'large', labels: 'never' }]);
  });

  it('the delay can be changed; the real clock is the default', () => {
    const clock = fakeClock();
    const sent: NavPatch[] = [];
    const s = createCommitScheduler((p) => sent.push(p), { delay: 50, timers: clock.timers });
    s.push({ size: 'large' });
    clock.advance(50);
    expect(sent).toHaveLength(1);
    vi.useFakeTimers();
    try {
      const real: NavPatch[] = [];
      const r = createCommitScheduler((p) => real.push(p));
      r.push({ size: 'large' });
      vi.advanceTimersByTime(399);
      expect(real).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(real).toEqual([{ version: 1, size: 'large' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The editing session
// ---------------------------------------------------------------------------

function session(initial: NavConfig = DEFAULT_NAV) {
  const clock = fakeClock();
  const shown: Array<NavConfig | null> = [];
  const saved: NavPatch[] = [];
  const deps: NavSessionDeps = { initial, show: (d) => shown.push(d), save: (p) => saved.push(p), timers: clock.timers };
  return { s: createNavSession(deps), clock, shown, saved };
}

describe('createNavSession', () => {
  it('shows the saved rail as the first draft', () => {
    const { shown, s } = session();
    expect(shown).toEqual([DEFAULT_NAV]);
    expect(s.dirty).toBe(false);
    expect(s.draft).toEqual(DEFAULT_NAV);
  });

  it('an edit shows at once but is saved only after 400 ms', () => {
    const { s, shown, saved, clock } = session();
    s.edit(moveItem(s.draft, 'drive', 'down'));
    expect(shown.at(-1)).toEqual(s.draft);
    expect(partsOf(s.draft).head.map((i) => i.id)).toEqual(['home', 'music', 'drive', 'auto', 'apps']);
    expect(saved).toEqual([]);
    clock.advance(399);
    expect(saved).toEqual([]);
    clock.advance(1);
    expect(saved).toHaveLength(1);
    expect(s.dirty).toBe(true);
  });

  it('Items edits send {version:1, items} and nothing else', () => {
    const { s, saved, clock } = session();
    s.edit(removeItem(s.draft, 'apps'));
    clock.advance(400);
    expect(Object.keys(saved[0]!).sort()).toEqual(['items', 'version']);
    expect(saved[0]).toEqual({ version: 1, items: s.draft.items });
  });

  it('Look edits send only the field that changed', () => {
    const { s, saved, clock } = session();
    s.edit(setLook(s.draft, { position: 'right' }));
    clock.advance(400);
    s.edit(setLook(s.draft, { size: 'large' }));
    s.edit(setLook(s.draft, { labels: 'active' }));
    clock.advance(400);
    expect(saved).toEqual([
      { version: 1, position: 'right' },
      { version: 1, size: 'large', labels: 'active' },
    ]);
  });

  it('an edit that changes nothing neither shows nor saves', () => {
    const { s, shown, clock, saved } = session();
    const n = shown.length;
    s.edit(s.draft);
    s.edit(plain(s.draft));
    s.edit(setLook(s.draft, {}));
    clock.advance(1000);
    expect(shown).toHaveLength(n);
    expect(saved).toEqual([]);
  });

  it('junk handed to edit is ignored (the draft stays as it was)', () => {
    const { s, saved, clock } = session();
    s.edit(null as unknown as NavConfig);
    s.edit({ version: 2 } as unknown as NavConfig);
    s.edit({ version: 1, items: 'no' } as unknown as NavConfig);
    clock.advance(1000);
    expect(s.draft).toEqual(DEFAULT_NAV);
    expect(saved).toEqual([]);
  });

  it('close flushes what is waiting, stops showing the draft, and ignores any later edit', () => {
    const { s, shown, saved, clock } = session();
    s.edit(removeItem(s.draft, 'apps'));
    expect(saved).toEqual([]);
    s.close();
    expect(saved).toHaveLength(1);
    expect(shown.at(-1)).toBeNull();
    s.edit(removeItem(s.draft, 'drive'));
    clock.advance(1000);
    expect(saved).toHaveLength(1);
    expect(shown.at(-1)).toBeNull();
    s.close();
    expect(saved).toHaveLength(1);
  });

  it('closing with nothing changed saves nothing', () => {
    const { s, saved } = session();
    s.close();
    expect(saved).toEqual([]);
  });

  it('flush (unmount, pagehide, the car starting to move) saves without closing', () => {
    const { s, saved, shown } = session();
    s.edit(setLook(s.draft, { size: 'large' }));
    s.flush();
    expect(saved).toEqual([{ version: 1, size: 'large' }]);
    s.edit(setLook(s.draft, { size: 'compact' }));
    expect(shown.at(-1)).toEqual(s.draft);
  });

  it('Revert puts back the rail from when the editor opened, and saves ALL of it at once', () => {
    const start = rail([A, B, C], [], { position: 'right', size: 'large' });
    const { s, saved, shown } = session(start);
    s.edit(removeItem(s.draft, 'aaaa'));
    s.edit(setLook(s.draft, { position: 'left', labels: 'never' }));
    expect(s.dirty).toBe(true);
    s.revert();
    expect(s.draft).toEqual(start);
    expect(shown.at(-1)).toEqual(start);
    expect(s.dirty).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ version: 1, position: 'right', size: 'large', labels: 'always', items: start.items });
  });

  it('Revert with nothing changed does nothing', () => {
    const { s, saved } = session();
    s.revert();
    expect(saved).toEqual([]);
  });

  it('Reset gives the default navigation, saved at once, whatever it was', () => {
    const { s, saved } = session(rail([A], [B], { position: 'right', size: 'large', labels: 'never' }));
    s.reset();
    expect(s.draft).toEqual(DEFAULT_NAV);
    expect(saved).toEqual([{ version: 1, position: 'left', size: 'regular', labels: 'always', items: DEFAULT_NAV.items }]);
    s.reset();
    expect(saved).toHaveLength(1);
  });

  it('Reset can be taken back with Revert', () => {
    const start = rail([A, B]);
    const { s, saved } = session(start);
    s.reset();
    s.revert();
    expect(s.draft).toEqual(start);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.items).toEqual(start.items);
  });

  it('resend sends again only what this session changed, at once, with the latest values', () => {
    const { s, saved, clock } = session();
    s.edit(setLook(s.draft, { size: 'large' }));
    clock.advance(400);
    s.edit(removeItem(s.draft, 'apps'));
    s.edit(setLook(s.draft, { size: 'compact' }));
    clock.advance(400);
    expect(saved).toHaveLength(2);
    s.resend();
    expect(saved).toHaveLength(3);
    expect(saved[2]).toEqual({ version: 1, size: 'compact', items: s.draft.items });
    expect(Object.keys(saved[2]!).sort()).toEqual(['items', 'size', 'version']);
  });

  it('resend with nothing changed, or after close, sends nothing', () => {
    const { s, saved } = session();
    s.resend();
    expect(saved).toEqual([]);
    s.edit(setLook(s.draft, { size: 'large' }));
    s.close();
    const n = saved.length;
    s.resend();
    expect(saved).toHaveLength(n);
  });

  it('resend after Revert sends the whole opening rail (Revert touched every field)', () => {
    const { s, saved } = session();
    s.edit(setLook(s.draft, { size: 'large' }));
    s.revert();
    saved.length = 0;
    s.resend();
    expect(Object.keys(saved[0]!).sort()).toEqual(['items', 'labels', 'position', 'size', 'version']);
  });

  it('the snapshot is a copy: changing the object it was made from afterwards changes nothing', () => {
    const start = structuredClone(DEFAULT_NAV) as { -readonly [K in keyof NavConfig]: NavConfig[K] };
    const { s } = session(start);
    start.position = 'right';
    expect(s.snapshot.position).toBe('left');
  });
});

// ---------------------------------------------------------------------------
// With the real store: the rail reads the draft, a remote change is not shown, openNavEditor
// ---------------------------------------------------------------------------

const settingsWith = (nav: NavConfig) => ({ ...DEFAULT_SETTINGS, nav });

function bindToStore(clock = fakeClock()) {
  const st = () => useHeadUnit.getState();
  const s = createNavSession({
    initial: st().settings!.nav,
    show: (d) => st().setNavDraft(d),
    save: (patch) => st().patchSettings({ nav: patch }),
    timers: clock.timers,
  });
  /** What the rail would draw. */
  const shown = () => st().navDraft ?? st().settings!.nav;
  return { s, clock, shown, saved: () => st().settings!.nav };
}

describe('the draft in the store', () => {
  beforeEach(() => {
    useHeadUnit.setState({ settings: settingsWith(DEFAULT_NAV), navDraft: null, navEditor: null, conn: 'open' });
  });
  afterEach(() => {
    useHeadUnit.setState({ settings: null, navDraft: null, navEditor: null, conn: 'connecting' });
  });

  it('the rail shows an edit at once; the saved rail follows 400 ms later', () => {
    const { s, clock, shown, saved } = bindToStore();
    s.edit(setLook(s.draft, { position: 'right' }));
    expect(shown().position).toBe('right');
    expect(saved().position).toBe('left');
    clock.advance(400);
    expect(saved().position).toBe('right');
  });

  it('a rail that arrives from another screen while the editor is open is stored but not shown; closing sends only what was changed here', () => {
    const { s, clock, shown, saved } = bindToStore();
    s.edit(removeItem(s.draft, 'apps'));
    // another screen moves the rail to the right and pins Drive
    const remote = setLook(moveItem(DEFAULT_NAV, 'drive', 'down'), { position: 'right' });
    apply({ t: 'settings', data: settingsWith(remote) });
    expect(useHeadUnit.getState().settings!.nav).toEqual(remote);
    expect(shown().position).toBe('left');
    expect(partsOf(shown()).head.map((i) => i.id)).toEqual(['home', 'drive', 'music', 'auto']);
    // nothing has been sent yet; on close the buttons I changed win, the side I did not touch stays as the other screen set it
    s.close();
    expect(useHeadUnit.getState().navDraft).toBeNull();
    const final = useHeadUnit.getState().settings!.nav;
    expect(partsOf(final).head.map((i) => i.id)).toEqual(['home', 'drive', 'music', 'auto']);
    expect(final.position).toBe('right');
    clock.advance(1000);
    expect(useHeadUnit.getState().settings!.nav).toEqual(final);
  });

  it('closing sends the draft even if the 400 ms have not passed', () => {
    const { s, saved } = bindToStore();
    s.edit(removeItem(s.draft, 'drive'));
    expect(partsOf(saved()).head.map((i) => i.id)).toContain('drive');
    s.close();
    expect(partsOf(saved()).head.map((i) => i.id)).not.toContain('drive');
  });

  it('Revert restores the rail as it was when the editor opened, even after it was saved', () => {
    const { s, clock, saved } = bindToStore();
    s.edit(applyPreset(s.draft, 'driver'));
    clock.advance(400);
    expect(partsOf(saved()).head).toHaveLength(3);
    s.revert();
    expect(saved()).toEqual(DEFAULT_NAV);
  });
});

describe('openNavEditor', () => {
  const toast = vi.fn();
  const vehicle = (speedKmh: number) => ({ connected: true, speedKmh }) as never;
  beforeEach(() => {
    toast.mockClear();
    resetSpeedMemory();
    useHeadUnit.setState({ settings: settingsWith(DEFAULT_NAV), conn: 'open', vehicle: null, svc: {}, passenger: false, navEditor: null, navDraft: null, quickPanel: false, showToast: toast });
  });
  afterEach(() => {
    useHeadUnit.setState({ settings: null, conn: 'connecting', vehicle: null, svc: {}, passenger: false, navEditor: null, navDraft: null });
  });

  it('opens on the Items tab when the car is parked and the head unit is reachable', () => {
    expect(openNavEditor()).toBe(true);
    expect(useHeadUnit.getState().navEditor).toEqual({ tab: 'items' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('opens on the tab asked for', () => {
    expect(openNavEditor('look')).toBe(true);
    expect(useHeadUnit.getState().navEditor).toEqual({ tab: 'look' });
  });

  it('is refused while the car is moving, with a plain message', () => {
    useHeadUnit.setState({ vehicle: vehicle(60) });
    expect(openNavEditor()).toBe(false);
    expect(useHeadUnit.getState().navEditor).toBeNull();
    expect(toast).toHaveBeenCalledWith(EDIT_LOCKED_MESSAGE);
  });

  it('is refused just above the driving threshold and allowed at or below it', () => {
    useHeadUnit.setState({ vehicle: vehicle(9) });
    expect(openNavEditor()).toBe(false);
    useHeadUnit.setState({ vehicle: vehicle(8) });
    expect(openNavEditor()).toBe(true);
  });

  it('"I\'m a passenger" lifts the lock, and so does turning the lock off', () => {
    useHeadUnit.setState({ vehicle: vehicle(60), passenger: true });
    expect(openNavEditor()).toBe(true);
    useHeadUnit.setState({ navEditor: null, passenger: false, settings: { ...settingsWith(DEFAULT_NAV), lockWhileDriving: false } });
    expect(openNavEditor()).toBe(true);
  });

  it('with no live speed it never locks (it will not lock on a guess)', () => {
    useHeadUnit.setState({ vehicle: null });
    expect(openNavEditor()).toBe(true);
  });

  it('a speed that drops out right after the car was moving still counts as moving', () => {
    useHeadUnit.setState({ vehicle: vehicle(80) });
    expect(openNavEditor()).toBe(false);
    useHeadUnit.setState({ vehicle: null }); // OBD link lost, no GPS fix
    expect(openNavEditor()).toBe(false);
  });

  it('does not toast when the Quick Panel is open: its footer already says to park', () => {
    useHeadUnit.setState({ vehicle: vehicle(60), quickPanel: true });
    expect(openNavEditor()).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('is refused while the connection to the head unit is down (the change could not be saved)', () => {
    for (const conn of ['connecting', 'closed'] as const) {
      toast.mockClear();
      useHeadUnit.setState({ conn });
      expect(openNavEditor(), conn).toBe(false);
      expect(useHeadUnit.getState().navEditor, conn).toBeNull();
      expect(toast).toHaveBeenCalledWith('Reconnect to the head unit to customise navigation');
    }
  });

  it('the driving check comes first: moving and offline says to pull over', () => {
    useHeadUnit.setState({ vehicle: vehicle(60), conn: 'closed' });
    expect(openNavEditor()).toBe(false);
    expect(toast).toHaveBeenCalledWith(EDIT_LOCKED_MESSAGE);
  });
});

describe('countFitAcross', () => {
  it('counts buttons across a bottom bar, fewer when they are bigger', () => {
    expect(countFitAcross(1000, 'regular')).toBe(12);
    expect(countFitAcross(1000, 'large')).toBeLessThan(countFitAcross(1000, 'regular'));
    expect(countFitAcross(1000, 'compact')).toBeGreaterThan(countFitAcross(1000, 'regular'));
    expect(countFitAcross(0, 'regular')).toBe(0);
    expect(countFitAcross(Number.NaN, 'regular')).toBe(0);
  });
});
