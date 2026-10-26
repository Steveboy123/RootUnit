/**
 * Customisable navigation, the shared model (packages/shared/src/nav.ts and the nav/launcher/panel parts of validate.ts).
 *
 * The numbering follows the build plan (section 4.1, work package A). Groups 15 (the seeded fuzz) and 21 (the server) are in
 * nav.fuzz.test.ts and nav.server.test.ts. Group 19 and 20 (backups) are here because they only need the backup functions.
 *
 * NOTE for whoever edits this file: write invisible and special characters as `\u{...}` escapes or with String.fromCharCode, never as
 * the character itself (a literal U+2028 or U+2029 breaks the parser).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LAUNCHER,
  DEFAULT_LAYOUT,
  DEFAULT_NAV,
  DEFAULT_PANEL,
  DEFAULT_SETTINGS,
  ID_RE,
  LAUNCHER_LIMITS,
  NAV_ICONS,
  NAV_LABEL_MODES,
  NAV_LIMITS,
  NAV_MUSIC_TABS,
  NAV_POSITIONS,
  NAV_PRESETS,
  NAV_ROUTES,
  NAV_SIZES,
  QUICK_TILES,
  REF_RE,
  applyLauncherPatch,
  applyNavPatch,
  applyPanelPatch,
  arrangementsCorrected,
  cleanLabel,
  mergeSettings,
  newNavId,
  sanitizeLauncher,
  sanitizeNav,
  sanitizePanel,
  sanitizeSettings,
  targetKey,
  type LauncherConfig,
  type NavConfig,
  type NavItem,
  type PanelConfig,
  type Settings,
} from '@headunit/shared';
import { createBackup, restoreBackup, settingsToRestore, type BackupSinks, type CarriedArrangements } from './features/backup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A copy that is plain JSON (what arrives over the wire or from disk). */
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function deepFreeze<T>(v: T, seen = new Set<unknown>()): T {
  if (typeof v === 'object' && v !== null && !seen.has(v)) {
    seen.add(v);
    Object.freeze(v);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) if ('value' in d) deepFreeze(d.value, seen);
  }
  return v;
}

function isDeepFrozen(v: unknown, seen = new Set<unknown>()): boolean {
  if (typeof v !== 'object' || v === null || seen.has(v)) return true;
  seen.add(v);
  return Object.isFrozen(v) && Object.values(v).every((c) => isDeepFrozen(c, seen));
}

/** Every object reachable from a value (cycle-safe). */
function objectsIn(root: unknown, out = new Set<object>()): Set<object> {
  if (typeof root === 'object' && root !== null && !out.has(root)) {
    out.add(root);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(root))) if ('value' in d) objectsIn(d.value, out);
  }
  return out;
}

/** No object of `result` is one of `input` (sanitizers hand back fresh objects only). */
function sharesNothing(result: unknown, ...inputs: unknown[]): boolean {
  const theirs = new Set<object>();
  for (const i of inputs) objectsIn(i, theirs);
  return [...objectsIn(result)].every((o) => !theirs.has(o));
}

const keysOf = (o: object): string[] => Object.keys(o).sort();
const route = (id: string, r: string, extra: Record<string, unknown> = {}) => ({ id, to: { kind: 'route', route: r }, ...extra });
const app = (id: string, a: string, extra: Record<string, unknown> = {}) => ({ id, to: { kind: 'app', app: a }, ...extra });
const gap = (id = 'spacer') => ({ id, to: { kind: 'gap' } });
const SETTINGS_ITEM = { id: 'settings', to: { kind: 'route', route: 'settings' } } as const;
const pin = (i: number, extra: Record<string, unknown> = {}) => ({ id: `p${String(i).padStart(3, '0')}`, to: { kind: 'app', app: `app-${i}` }, ...extra });
const nav = (items: unknown, extra: Record<string, unknown> = {}) => ({ version: 1, items, ...extra });
const ids = (n: NavConfig) => n.items.map((i) => i.id);
const targets = (n: NavConfig) => n.items.map((i) => targetKey(i.to));

/** What a rail must look like, whatever went in: a list of everything wrong with it (empty when it is fine). */
function railProblems(n: NavConfig): string[] {
  const bad: string[] = [];
  if (Object.getPrototypeOf(n) !== Object.prototype) bad.push('prototype');
  if (keysOf(n).join() !== 'items,labels,position,size,version') bad.push(`keys ${keysOf(n).join()}`);
  if (n.version !== 1) bad.push('version');
  if (!(NAV_POSITIONS as readonly string[]).includes(n.position)) bad.push('position');
  if (!(NAV_SIZES as readonly string[]).includes(n.size)) bad.push('size');
  if (!(NAV_LABEL_MODES as readonly string[]).includes(n.labels)) bad.push('labels');
  if (!Array.isArray(n.items) || n.items.length < 2 || n.items.length > NAV_LIMITS.items) return [...bad, `item count ${n.items?.length}`];
  const last = n.items[n.items.length - 1];
  if (JSON.stringify(last) !== JSON.stringify(SETTINGS_ITEM)) bad.push('settings is not last and bare');
  const gaps = n.items.flatMap((it, i) => (it.to.kind === 'gap' ? [i] : []));
  if (gaps.length !== 1) return [...bad, `gap count ${gaps.length}`];
  const g = gaps[0]!;
  if (JSON.stringify(n.items[g]) !== JSON.stringify({ id: 'spacer', to: { kind: 'gap' } })) bad.push('gap shape');
  const foot = n.items.length - 2 - g;
  if (foot < 0 || foot > NAV_LIMITS.foot) bad.push(`foot ${foot}`);
  if (g + foot > NAV_LIMITS.items - 2) bad.push('head + foot over 8');
  const seenIds = new Set<string>();
  const seenTargets = new Set<string>();
  n.items.forEach((it, i) => {
    if (i === g || i === n.items.length - 1) return;
    if (Object.getPrototypeOf(it) !== Object.prototype || Object.getPrototypeOf(it.to) !== Object.prototype) bad.push('item prototype');
    if (!keysOf(it).every((k) => ['id', 'to', 'label', 'icon'].includes(k))) bad.push(`item keys ${keysOf(it).join()}`);
    if (typeof it.id !== 'string' || !ID_RE.test(it.id) || it.id === 'settings' || it.id === 'spacer' || seenIds.has(it.id)) bad.push(`id ${String(it.id)}`);
    seenIds.add(it.id);
    const k = targetKey(it.to);
    if (it.to.kind === 'gap' || k === 'route:settings' || seenTargets.has(k)) bad.push(`target ${k}`);
    seenTargets.add(k);
    if (it.label !== undefined && (typeof it.label !== 'string' || it.label === '' || Array.from(it.label).length > NAV_LIMITS.label || cleanLabel(it.label) !== it.label)) bad.push(`label ${String(it.label)}`);
    if (it.icon !== undefined && !(NAV_ICONS as readonly string[]).includes(it.icon)) bad.push(`icon ${String(it.icon)}`);
  });
  if (Buffer.byteLength(JSON.stringify(n)) >= 32 * 1024) bad.push('over 32 KB');
  return bad;
}
const expectRail = (n: NavConfig) => expect(railProblems(n)).toEqual([]);

/** Values that are not a valid anything: not an id, not a ref, not an enum member, not a boolean. */
const JUNK: Array<[string, unknown]> = [
  ['empty string', ''],
  ['zero', 0],
  ['one', 1],
  ['negative zero', -0],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['bigint', 5n],
  ['null', null],
  ['undefined', undefined],
  ['true', true],
  ['false', false],
  ['numeric string', '5'],
  ['empty array', []],
  ['array holding a valid id', ['abcd']],
  ['nested arrays', [[['abcd']]]],
  ['empty object', {}],
  ['object whose toString says abcd', { toString: () => 'abcd' }],
  ['object whose valueOf says 1', { valueOf: () => 1 }],
  ['String object', new String('abcd')],
  ['symbol', Symbol('abcd')],
  ['function', () => 'abcd'],
  ['date', new Date(0)],
  ['map', new Map([['a', 'b']])],
  ['regexp', /abcd/],
  ['__proto__ as a string', '__proto__'],
  ['toString as a string', 'toString'],
  ['hasOwnProperty as a string', 'hasOwnProperty'],
  ['100,000 character string', 'a'.repeat(100_000)],
  ['control characters', '\u{0}\u{7}\u{1B}'],
  ['bidi override around a valid word', '\u{202E}home\u{202C}'],
  ['valid id plus a newline', 'abcd\n'],
  ['valid id with a leading space', ' abcd'],
  ['upper case', 'ABCD'],
  ['a Cyrillic a in an otherwise valid id', '\u{430}bcd'],
  ['deeply nested object', JSON.parse('{"a":'.repeat(2000) + '1' + '}'.repeat(2000)) as unknown],
];

const customNav: NavConfig = sanitizeNav({
  version: 1,
  position: 'right',
  size: 'large',
  labels: 'never',
  items: [route('home', 'home', { label: 'Start', icon: 'star' }), app('gpsx', 'gps'), gap(), route('drive', 'drive')],
});

// ---------------------------------------------------------------------------
// 1. Golden
// ---------------------------------------------------------------------------

describe('1. golden: the default is today\'s rail', () => {
  it('has the same buttons in the same order with the divider before Settings', () => {
    // The old NavRail.tsx: Home, Drive, Music (route media), Auto (route aa), Apps, then the divider, then Settings.
    expect(DEFAULT_NAV.items.map((i) => [i.id, targetKey(i.to)])).toEqual([
      ['home', 'route:home'],
      ['drive', 'route:drive'],
      ['music', 'route:media'],
      ['auto', 'route:aa'],
      ['apps', 'route:apps'],
      ['spacer', 'gap'],
      ['settings', 'route:settings'],
    ]);
  });

  it('starts at the left, regular size, labels always, and carries no overrides', () => {
    expect(DEFAULT_NAV).toMatchObject({ version: 1, position: 'left', size: 'regular', labels: 'always' });
    for (const it of DEFAULT_NAV.items) expect(keysOf(it)).toEqual(['id', 'to']);
  });

  it('shows every Quick Panel tile in today\'s order and every section, and hides no app', () => {
    expect(DEFAULT_PANEL.tiles).toEqual(['camera', 'standby', 'passenger', 'lights', 'aa', 'phones', 'bt']);
    expect(DEFAULT_PANEL.sections).toEqual({ scenes: true, actions: true, sleep: true });
    expect(DEFAULT_LAUNCHER).toEqual({ version: 1, hidden: [] });
    expect(DEFAULT_SETTINGS.nav).toBe(DEFAULT_NAV);
    expect(DEFAULT_SETTINGS.launcher).toBe(DEFAULT_LAUNCHER);
    expect(DEFAULT_SETTINGS.panel).toBe(DEFAULT_PANEL);
  });

  it('keeps the vocabularies as the spec lists them (they are append-only)', () => {
    expect([...NAV_ROUTES]).toEqual(['home', 'drive', 'media', 'aa', 'apps', 'settings']);
    expect([...NAV_MUSIC_TABS]).toEqual(['spotify', 'tidal', 'youtube-music', 'radio']);
    expect([...NAV_POSITIONS]).toEqual(['left', 'right']);
    expect([...NAV_SIZES]).toEqual(['compact', 'regular', 'large']);
    expect([...NAV_LABEL_MODES]).toEqual(['always', 'active', 'never']);
    expect([...QUICK_TILES]).toEqual(['camera', 'standby', 'passenger', 'lights', 'aa', 'phones', 'bt']);
    expect(NAV_LIMITS).toEqual({ items: 10, foot: 2, scan: 40, label: 10 });
    expect(LAUNCHER_LIMITS).toEqual({ hidden: 16, scan: 32 });
    expect(NAV_ICONS).toHaveLength(42);
    expect(new Set(NAV_ICONS).size).toBe(NAV_ICONS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotence
// ---------------------------------------------------------------------------

describe('2. sanitizing twice changes nothing', () => {
  const messy: unknown[] = [
    DEFAULT_NAV,
    customNav,
    nav([]),
    nav([SETTINGS_ITEM]),
    nav([pin(1), pin(1), pin(2, { id: 'ZZ' }), gap(), gap(), pin(3), pin(4), pin(5), pin(6), SETTINGS_ITEM, pin(7)]),
    nav(Array.from({ length: 60 }, (_, i) => pin(i + 1)), { position: 'right', size: 'compact', labels: 'active' }),
    nav([route('x1', 'home', { label: ' e\u{200D}\u{301}\u{200B}  tre\u{301}s  long label here ' })]),
    nav([{}, null, 7, 'x']),
    { version: 2, items: [pin(1)] },
    'garbage',
    null,
  ];

  it.each(messy.map((m, i) => [i, m] as const))('input %i: the output is a fixed point and survives a JSON round trip', (_i, input) => {
    const once = sanitizeNav(input);
    expectRail(once);
    expect(sanitizeNav(once)).toEqual(once);
    expect(sanitizeNav(json(once))).toEqual(once);
    // the fallback matters only when the input has nothing to say
    expect(sanitizeNav(once, customNav)).toEqual(once);
  });

  it('is the same on every call (no state, no randomness)', () => {
    const input = nav([{ id: 'BAD', to: { kind: 'app', app: 'gps' } }, pin(2, { id: 'also bad' })]);
    const a = sanitizeNav(input);
    expect(sanitizeNav(input)).toEqual(a);
    expect(sanitizeNav(json(input))).toEqual(a);
  });

  it('a patch applied twice gives the same result as applied once', () => {
    const patch = { version: 1, position: 'right', items: [pin(1), pin(2), gap(), pin(3)] };
    const once = applyNavPatch(DEFAULT_NAV, patch);
    expect(applyNavPatch(once, patch)).toEqual(once);
    const lp = { version: 1, hidden: ['gps', 'gps', 'BAD'] };
    expect(applyLauncherPatch(applyLauncherPatch(DEFAULT_LAUNCHER, lp), lp)).toEqual(applyLauncherPatch(DEFAULT_LAUNCHER, lp));
    const pp = { version: 1, tiles: ['bt', 'bt', 'camera'], sections: { sleep: false } };
    expect(applyPanelPatch(applyPanelPatch(DEFAULT_PANEL, pp), pp)).toEqual(applyPanelPatch(DEFAULT_PANEL, pp));
  });
});

// ---------------------------------------------------------------------------
// 3. Presets
// ---------------------------------------------------------------------------

describe('3. the presets', () => {
  it.each(Object.entries(NAV_PRESETS))('%s is a fixed point of sanitizeNav and a fresh copy comes back', (_name, preset) => {
    const out = sanitizeNav(preset);
    expect(out).toEqual(preset);
    expect(out).not.toBe(preset);
    expect(sharesNothing(out, preset)).toBe(true);
    expectRail(out);
  });

  it('are the three the spec names, with the contents the spec gives', () => {
    expect(Object.keys(NAV_PRESETS)).toEqual(['default', 'minimal', 'driver']);
    expect(NAV_PRESETS.default).toBe(DEFAULT_NAV);
    expect(NAV_PRESETS.minimal.items.map((i) => targetKey(i.to))).toEqual(['route:home', 'route:media', 'route:aa', 'gap', 'route:settings']);
    expect(NAV_PRESETS.minimal).toMatchObject({ labels: 'active', size: 'regular' });
    expect(NAV_PRESETS.driver.items.map((i) => targetKey(i.to))).toEqual(['route:drive', 'route:media', 'route:aa', 'gap', 'route:settings']);
    expect(NAV_PRESETS.driver).toMatchObject({ labels: 'active', size: 'large' });
  });

  it('applying a preset through a patch lands on exactly the preset', () => {
    for (const preset of Object.values(NAV_PRESETS)) expect(applyNavPatch(customNav, json(preset))).toEqual(preset);
  });
});

// ---------------------------------------------------------------------------
// 4. Settings invariants
// ---------------------------------------------------------------------------

describe('4. Settings is always there, last, bare, and called settings', () => {
  const fixed = { id: 'settings', to: { kind: 'route', route: 'settings' } };
  const inputs: Array<[string, unknown]> = [
    ['absent', nav([pin(1), pin(2)])],
    ['first', nav([SETTINGS_ITEM, pin(1), pin(2)])],
    ['in the middle, after the divider', nav([pin(1), gap(), SETTINGS_ITEM, pin(2)])],
    ['listed three times', nav([SETTINGS_ITEM, pin(1), SETTINGS_ITEM, SETTINGS_ITEM])],
    ['with a label and an icon', nav([pin(1), { id: 'abcd', to: { kind: 'route', route: 'settings' }, label: 'Totally Settings', icon: 'star' }])],
    ['under another id', nav([pin(1), { id: 'qqqq', to: { kind: 'route', route: 'settings' } }])],
    ['past the cap', nav([...Array.from({ length: 12 }, (_, i) => pin(i + 1)), SETTINGS_ITEM])],
    ['an empty list', nav([])],
    ['nothing but Settings', nav([SETTINGS_ITEM])],
  ];

  it.each(inputs)('%s', (_name, input) => {
    const out = sanitizeNav(input);
    expect(out.items.at(-1)).toStrictEqual(fixed);
    expect(out.items.filter((i) => targetKey(i.to) === 'route:settings')).toHaveLength(1);
    expect(out.items.filter((i) => i.id === 'settings')).toHaveLength(1);
    expectRail(out);
  });

  it('cannot be impersonated: no other item takes the id, label or icon', () => {
    const out = sanitizeNav(nav([pin(1, { id: 'settings', label: 'Settings', icon: 'settings' }), app('abcd', 'settings', { label: 'Settings' })]));
    expect(ids(out)).toEqual(['item1', 'abcd', 'spacer', 'settings']);
    expect(out.items.at(-1)).toStrictEqual(fixed);
  });
});

// ---------------------------------------------------------------------------
// 5. Exactly one gap
// ---------------------------------------------------------------------------

describe('5. exactly one divider, called spacer, just before the foot', () => {
  const cases: Array<[string, unknown, string[]]> = [
    ['none', nav([pin(1), pin(2)]), ['p001', 'p002', 'spacer', 'settings']],
    ['one in the middle', nav([pin(1), gap(), pin(2)]), ['p001', 'spacer', 'p002', 'settings']],
    ['several: the first one splits', nav([pin(1), gap('aaaa'), pin(2), gap('bbbb'), pin(3), gap('cccc')]), ['p001', 'spacer', 'p002', 'p003', 'settings']],
    ['first: everything is foot, extra goes to the head', nav([gap(), pin(1), pin(2), pin(3)]), ['p003', 'spacer', 'p001', 'p002', 'settings']],
    ['last', nav([pin(1), pin(2), gap()]), ['p001', 'p002', 'spacer', 'settings']],
    ['a divider carrying a label and an icon', nav([pin(1), { id: 'xxxx', to: { kind: 'gap' }, label: 'Hi', icon: 'star' }, pin(2)]), ['p001', 'spacer', 'p002', 'settings']],
    ['a divider whose extra fields are junk', nav([pin(1), { id: 5, to: { kind: 'gap', route: 'home', app: 'gps' } }, pin(2)]), ['p001', 'spacer', 'p002', 'settings']],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    const out = sanitizeNav(input);
    expect(ids(out)).toEqual(expected);
    expect(out.items.filter((i) => i.to.kind === 'gap')).toHaveLength(1);
    expect(out.items.find((i) => i.to.kind === 'gap')).toStrictEqual({ id: 'spacer', to: { kind: 'gap' } });
  });

  it('a divider cannot be smuggled in as an ordinary item id', () => {
    const out = sanitizeNav(nav([pin(1, { id: 'spacer' })]));
    expect(ids(out)).toEqual(['item1', 'spacer', 'settings']);
    expect(out.items[0]?.to.kind).toBe('app');
  });
});

// ---------------------------------------------------------------------------
// 6. Cap and foot
// ---------------------------------------------------------------------------

describe('6. the cap of ten and the foot of two', () => {
  it('moves foot items beyond two to the end of the head', () => {
    const out = sanitizeNav(nav([pin(1), pin(2), pin(3), gap(), pin(4), pin(5), pin(6), pin(7), pin(8)]));
    expect(ids(out)).toEqual(['p001', 'p002', 'p003', 'p006', 'p007', 'p008', 'spacer', 'p004', 'p005', 'settings']);
  });

  it('drops the last head items until head and foot together are eight', () => {
    const out = sanitizeNav(nav([...[1, 2, 3, 4, 5, 6, 7].map((i) => pin(i)), gap(), pin(8), pin(9), pin(10)]));
    // head 1..7 and foot 8, 9, 10: 10 goes to the head's end (8 + 2 = 10 > 8), then 10 and 7 are dropped
    expect(ids(out)).toEqual(['p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'spacer', 'p008', 'p009', 'settings']);
    expect(out.items).toHaveLength(10);
  });

  it('exactly eight buttons fit; a ninth does not', () => {
    const eight = sanitizeNav(nav([1, 2, 3, 4, 5, 6, 7, 8].map((i) => pin(i))));
    expect(ids(eight)).toEqual(['p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008', 'spacer', 'settings']);
    const nine = sanitizeNav(nav([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => pin(i))));
    expect(ids(nine)).toEqual(ids(eight));
  });

  it('cap + missing Settings: ten ordinary items and no Settings still end with Settings, and it is not what gets dropped', () => {
    const out = sanitizeNav(nav(Array.from({ length: 10 }, (_, i) => pin(i + 1))));
    expect(out.items).toHaveLength(10);
    expect(out.items.at(-1)).toStrictEqual(SETTINGS_ITEM);
    expect(ids(out).slice(0, 8)).toEqual(['p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008']);
  });

  it('cap + Settings listed somewhere inside a long list: it takes no slot of its own', () => {
    const items = [pin(1), pin(2), pin(3), pin(4), SETTINGS_ITEM, ...Array.from({ length: 8 }, (_, i) => pin(i + 5))];
    const out = sanitizeNav(nav(items));
    expect(ids(out)).toEqual(['p001', 'p002', 'p003', 'p004', 'p005', 'p006', 'p007', 'p008', 'spacer', 'settings']);
  });

  it('never returns more than ten items or more than two foot items, whatever the shape', () => {
    for (let head = 0; head <= 12; head++) {
      for (let foot = 0; foot <= 12; foot++) {
        const items = [...Array.from({ length: head }, (_, i) => pin(i + 1)), gap(), ...Array.from({ length: foot }, (_, i) => pin(head + i + 1))];
        const out = sanitizeNav(nav(items));
        if (head + foot > 0) expectRail(out);
      }
    }
  });

  it('only the first forty entries are even looked at', () => {
    const junk = Array.from({ length: 39 }, () => 'junk');
    const out = sanitizeNav(nav([...junk, pin(1), pin(2), pin(3)]));
    expect(ids(out)).toEqual(['p001', 'spacer', 'settings']); // entry 40 is the last one read
    // forty entries of junk and then valid ones: the valid ones are never seen, so it is garbage and the default comes back
    expect(sanitizeNav(nav([...Array.from({ length: 40 }, () => 'junk'), pin(1), SETTINGS_ITEM]))).toEqual(DEFAULT_NAV);
  });

  it('removed entries do not count against the scan, but dropped duplicates still take a place in the first forty', () => {
    const items = [...Array.from({ length: 40 }, () => pin(1)), pin(2)];
    expect(ids(sanitizeNav(nav(items)))).toEqual(['p001', 'spacer', 'settings']);
  });
});

// ---------------------------------------------------------------------------
// 7. Deterministic id repair
// ---------------------------------------------------------------------------

describe('7. ids are repaired the same way every time, never randomly', () => {
  it('numbers a bad id item1, item2... in the order the items survive', () => {
    const bad: unknown[] = ['ABCD', 'abc', 'a'.repeat(25), 5, null, { toString: () => 'abcd' }, ['abcd'], undefined];
    const items = bad.map((id, i) => ({ id, to: { kind: 'app', app: `app-${i}` } }));
    const out = sanitizeNav(nav(items));
    expect(ids(out)).toEqual(['item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7', 'item8', 'spacer', 'settings']);
  });

  it('keeps a good id, and a repair never lands on an id that is in use', () => {
    const out = sanitizeNav(nav([pin(1, { id: 'item2' }), pin(2, { id: 'BAD' }), pin(3, { id: 'ALSO BAD' })]));
    expect(ids(out)).toEqual(['item2', 'item1', 'item3', 'spacer', 'settings']);
  });

  it('a repeated id is repaired on the second item, the first keeps it', () => {
    expect(ids(sanitizeNav(nav([pin(1, { id: 'dupe' }), pin(2, { id: 'dupe' }), pin(3, { id: 'dupe' })])))).toEqual(['dupe', 'item1', 'item2', 'spacer', 'settings']);
  });

  it('the two reserved ids are never given to an ordinary item', () => {
    expect(ids(sanitizeNav(nav([pin(1, { id: 'settings' }), pin(2, { id: 'spacer' })])))).toEqual(['item1', 'item2', 'spacer', 'settings']);
  });

  it('a dropped duplicate does not use up a number', () => {
    const out = sanitizeNav(nav([route('BAD', 'home'), route('BAD', 'home'), route('BAD', 'drive')]));
    expect(ids(out)).toEqual(['item1', 'item2', 'spacer', 'settings']);
    expect(targets(out)).toEqual(['route:home', 'route:drive', 'gap', 'route:settings']);
  });

  it('never asks for a random number: the same input gives the same output and no random source is touched', () => {
    const random = vi.spyOn(Math, 'random');
    const values = vi.spyOn(globalThis.crypto, 'getRandomValues');
    try {
      const input = nav([pin(1, { id: 'BAD' }), pin(2, { id: 'BAD' }), pin(3)]);
      const runs = [sanitizeNav(input), sanitizeNav(input), sanitizeNav(json(input)), applyNavPatch(DEFAULT_NAV, input)];
      for (const r of runs) expect(r).toEqual(runs[0]);
      expect(random).not.toHaveBeenCalled();
      expect(values).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      values.mockRestore();
    }
  });
});

describe('newNavId (the one place a random id is made, on the screen that creates an item)', () => {
  it('is n and nine base-36 characters: a valid, unreserved item id', () => {
    for (let i = 0; i < 500; i++) {
      const id = newNavId();
      expect(id).toMatch(/^n[0-9a-z]{9}$/);
      expect(ID_RE.test(id)).toBe(true);
      expect(['settings', 'spacer']).not.toContain(id);
      expect(id).not.toMatch(/^item\d+$/);
    }
  });

  it('does not repeat', () => {
    expect(new Set(Array.from({ length: 2000 }, () => newNavId())).size).toBe(2000);
  });

  it('maps each random byte to a base-36 digit by remainder', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => (a.set([0, 1, 9, 10, 35, 36, 71, 255, 254]), a) });
    try {
      expect(newNavId()).toBe('n0' + '1' + '9' + 'a' + 'z' + '0' + 'z' + '3' + '2');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to Math.random when there is no crypto, or it throws', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // byte 128, 128 % 36 = 20 = k
    try {
      vi.stubGlobal('crypto', undefined);
      expect(newNavId()).toBe('n' + 'k'.repeat(9));
      vi.stubGlobal('crypto', {
        getRandomValues() {
          throw new Error('locked down');
        },
      });
      expect(newNavId()).toBe('n' + 'k'.repeat(9));
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate targets
// ---------------------------------------------------------------------------

describe('8. the same destination is on the rail once, the first wins', () => {
  it('collapses a repeated route, app, music tab, scene and action', () => {
    const items = [
      route('aaa1', 'home', { label: 'First' }),
      route('aaa2', 'home', { label: 'Second', icon: 'star' }),
      app('bbb1', 'gps'),
      app('bbb2', 'gps'),
      { id: 'ccc1', to: { kind: 'music', tab: 'tidal' } },
      { id: 'ccc2', to: { kind: 'music', tab: 'tidal' } },
      { id: 'ddd1', to: { kind: 'scene', scene: 'scene001' } },
      { id: 'ddd2', to: { kind: 'scene', scene: 'scene001' } },
      { id: 'eee1', to: { kind: 'action', action: 'garage01' } },
      { id: 'eee2', to: { kind: 'action', action: 'garage01' } },
    ];
    const out = sanitizeNav(nav(items));
    expect(ids(out)).toEqual(['aaa1', 'bbb1', 'ccc1', 'ddd1', 'eee1', 'spacer', 'settings']);
    expect(out.items[0]).toStrictEqual({ id: 'aaa1', to: { kind: 'route', route: 'home' }, label: 'First' });
  });

  it('is decided by the destination, not the id, the label or stray fields', () => {
    const out = sanitizeNav(nav([route('aaa1', 'home'), { id: 'aaa2', to: { kind: 'route', route: 'home', app: 'gps' }, label: 'x' }]));
    expect(ids(out)).toEqual(['aaa1', 'spacer', 'settings']);
  });

  it('keeps the same name in different kinds apart', () => {
    const items = [app('aaa1', 'abcd'), { id: 'aaa2', to: { kind: 'scene', scene: 'abcd' } }, { id: 'aaa3', to: { kind: 'action', action: 'abcd' } }, route('aaa4', 'media'), { id: 'aaa5', to: { kind: 'music', tab: 'radio' } }];
    expect(ids(sanitizeNav(nav(items)))).toEqual(['aaa1', 'aaa2', 'aaa3', 'aaa4', 'aaa5', 'spacer', 'settings']);
  });

  it('targetKey gives one distinct key per destination', () => {
    const keys = [
      targetKey({ kind: 'route', route: 'home' }),
      targetKey({ kind: 'app', app: 'home' }),
      targetKey({ kind: 'music', tab: 'radio' }),
      targetKey({ kind: 'scene', scene: 'radio' }),
      targetKey({ kind: 'action', action: 'radio' }),
      targetKey({ kind: 'gap' }),
    ];
    expect(keys).toEqual(['route:home', 'app:home', 'music:radio', 'scene:radio', 'action:radio', 'gap']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 9. REF_RE and ID_RE
// ---------------------------------------------------------------------------

describe('9. REF_RE accepts app ids like gps; ID_RE is only asked about strings', () => {
  it('REF_RE accepts the app ids the registry uses and rejects the rest', () => {
    for (const ok of ['gps', 'findcar', 'quick-actions', 'ab', 'a1', 'p-xxxx', 'a'.repeat(32), 'constructor']) expect(REF_RE.test(ok), ok).toBe(true);
    for (const bad of ['', 'a', 'A1', '1a', '-ab', 'ab c', 'ab\n', ' ab', 'ab_c', 'a'.repeat(33), 'caf\u{E9}', '__proto__', 'a.b', 'a/b']) expect(REF_RE.test(bad), JSON.stringify(bad)).toBe(false);
    expect(REF_RE.global).toBe(false);
    expect(ID_RE.global).toBe(false);
  });

  it('keeps a three letter app (gps) as an app target', () => {
    expect(sanitizeNav(nav([app('aaa1', 'gps')])).items[0]?.to).toEqual({ kind: 'app', app: 'gps' });
  });

  it('asks the patterns only about strings: a value that merely prints as a valid id is not one', () => {
    const lookalikes: unknown[] = [['abcd'], { toString: () => 'abcd' }, new String('abcd'), { valueOf: () => 'abcd', toString: () => 'abcd' }];
    for (const v of lookalikes) {
      expect(ID_RE.test(v as string), 'the pattern on its own would have said yes').toBe(true);
      const out = sanitizeNav(nav([{ id: 'aaa1', to: { kind: 'scene', scene: v } }, { id: 'aaa2', to: { kind: 'action', action: v } }, { id: 'aaa3', to: { kind: 'app', app: v } }, { id: v, to: { kind: 'route', route: 'home' } }]));
      expect(ids(out)).toEqual(['item1', 'spacer', 'settings']); // only the home item survives, with a repaired id
      expect(sanitizeLauncher({ version: 1, hidden: [v] }).hidden).toEqual([]);
      expect(sanitizePanel({ version: 1, tiles: [v, 'bt'] }).tiles).toEqual(['bt']);
    }
  });

  it('a scene or action id must match ID_RE, an app ref must match REF_RE (they are different shapes)', () => {
    const out = sanitizeNav(nav([{ id: 'aaa1', to: { kind: 'scene', scene: 'gps' } }, { id: 'aaa2', to: { kind: 'action', action: 'has-dash' } }, app('aaa3', 'ABCD'), app('aaa4', 'abc_d'), { id: 'aaa5', to: { kind: 'scene', scene: 'abcd' } }]));
    expect(targets(out)).toEqual(['scene:abcd', 'gap', 'route:settings']);
  });
});

// ---------------------------------------------------------------------------
// 10. Junk in every field
// ---------------------------------------------------------------------------

describe('10. junk in every field', () => {
  const home = route('home', 'home');
  const entryShapes: Array<[string, (j: unknown) => unknown, 'dropped' | 'repaired' | 'unlabelled' | 'bare']> = [
    ['the entry itself', (j) => j, 'dropped'],
    ['id', (j) => ({ id: j, to: { kind: 'app', app: 'gps' } }), 'repaired'],
    ['to', (j) => ({ id: 'aaa1', to: j }), 'dropped'],
    ['to.kind', (j) => ({ id: 'aaa1', to: { kind: j } }), 'dropped'],
    ['to.route', (j) => ({ id: 'aaa1', to: { kind: 'route', route: j } }), 'dropped'],
    ['to.app', (j) => ({ id: 'aaa1', to: { kind: 'app', app: j } }), 'dropped'],
    ['to.tab', (j) => ({ id: 'aaa1', to: { kind: 'music', tab: j } }), 'dropped'],
    ['to.scene', (j) => ({ id: 'aaa1', to: { kind: 'scene', scene: j } }), 'dropped'],
    ['to.action', (j) => ({ id: 'aaa1', to: { kind: 'action', action: j } }), 'dropped'],
    ['label', (j) => ({ id: 'aaa1', to: { kind: 'app', app: 'gps' }, label: j }), 'unlabelled'],
    ['icon', (j) => ({ id: 'aaa1', to: { kind: 'app', app: 'gps' }, icon: j }), 'bare'],
  ];

  describe.each(entryShapes)('in an item: %s', (_where, make, outcome) => {
    it.each(JUNK)('%s', (_name, j) => {
      const out = sanitizeNav(nav([home, make(j)]));
      expectRail(out);
      const second = out.items[1];
      if (outcome === 'dropped') {
        expect(ids(out)).toEqual(['home', 'spacer', 'settings']);
      } else {
        expect(ids(out).slice(0, 1)).toEqual(['home']);
        expect(second?.to).toEqual({ kind: 'app', app: 'gps' });
        if (outcome === 'repaired') expect(second?.id).toBe('item1'); // none of the junk is a valid id
        if (outcome === 'bare') expect(keysOf(second!)).toEqual(['id', 'to']);
        if (outcome === 'unlabelled') {
          if (typeof j !== 'string') expect('label' in second!).toBe(false);
          else expect(second?.label).toBe(cleanLabel(j));
        }
      }
    });
  });

  describe.each([['position'], ['size'], ['labels']])('as %s', (field) => {
    it.each(JUNK)('%s', (_name, j) => {
      expect(sanitizeNav({ ...json(DEFAULT_NAV), [field]: j })).toEqual(DEFAULT_NAV);
      // an invalid value keeps the stored one, not the default
      expect(sanitizeNav({ ...json(customNav), [field]: j }, customNav)).toEqual(customNav);
    });
  });

  describe('as the list, the whole value or the version', () => {
    it.each(JUNK)('%s', (_name, j) => {
      if (Array.isArray(j)) expectRail(sanitizeNav({ ...json(DEFAULT_NAV), items: j })); // an array, however useless: it is what the list is
      else {
        expect(sanitizeNav({ ...json(DEFAULT_NAV), items: j })).toEqual(DEFAULT_NAV); // not an array: the stored items stay
        expect(sanitizeNav({ ...json(customNav), items: j }, customNav)).toEqual(customNav);
      }
      expect(sanitizeNav(j)).toEqual(DEFAULT_NAV);
      expect(sanitizeNav(j, customNav)).toEqual(customNav);
      if (j !== 1) expect(sanitizeNav({ ...json(DEFAULT_NAV), version: j, position: 'right' })).toEqual(DEFAULT_NAV);
      expect(sanitizeNav(nav([home, j, j, home]))).toEqual(sanitizeNav(nav([home])));
    });
  });

  describe('in the launcher and the Quick Panel', () => {
    it.each(JUNK)('%s', (_name, j) => {
      expect(sanitizeLauncher({ version: 1, hidden: [j, 'gps', j] })).toEqual({ version: 1, hidden: ['gps'] });
      if (!Array.isArray(j)) {
        expect(sanitizeLauncher({ version: 1, hidden: j }, { version: 1, hidden: ['gps'] })).toEqual({ version: 1, hidden: ['gps'] });
        expect(sanitizePanel({ version: 1, tiles: j }).tiles).toEqual([...QUICK_TILES]);
      }
      expect(sanitizeLauncher(j)).toEqual(DEFAULT_LAUNCHER);
      expect(sanitizePanel({ version: 1, tiles: [j, 'bt', j] }).tiles).toEqual(['bt']);
      if (typeof j !== 'boolean') expect(sanitizePanel({ version: 1, sections: { scenes: j, actions: j, sleep: j } }).sections).toEqual({ scenes: true, actions: true, sleep: true });
      expect(sanitizePanel({ version: 1, sections: j }).sections).toEqual({ scenes: true, actions: true, sleep: true });
      expect(sanitizePanel(j)).toEqual(DEFAULT_PANEL);
    });
  });

  describe('as a settings patch', () => {
    it.each(JUNK)('%s', (_name, j) => {
      expect(mergeSettings(DEFAULT_SETTINGS, { nav: j, launcher: j, panel: j })).toEqual(DEFAULT_SETTINGS);
      if (!Array.isArray(j)) {
        expect(mergeSettings(DEFAULT_SETTINGS, { nav: { version: 1, position: j, size: j, labels: j, items: j }, launcher: { version: 1, hidden: j }, panel: { version: 1, tiles: j, sections: j } })).toEqual(DEFAULT_SETTINGS);
      }
      expect(mergeSettings(DEFAULT_SETTINGS, { nav: { version: 1, position: j, size: j, labels: j }, panel: { version: 1, sections: j } })).toEqual(DEFAULT_SETTINGS);
    });
  });

  it('survives junk at every position of one large list', () => {
    const items = JUNK.flatMap(([, j]) => [j, { id: j, to: j, label: j, icon: j }]);
    expectRail(sanitizeNav(nav(items)));
    expect(sanitizeNav(nav(items))).toEqual(DEFAULT_NAV); // all of it is garbage
  });
});

// ---------------------------------------------------------------------------
// 11. __proto__ and friends
// ---------------------------------------------------------------------------

describe('11. prototype pollution and look-alike keys', () => {
  const protoKeys = (): string[] => Object.getOwnPropertyNames(Object.prototype).sort();
  const evil = [
    '{"version":1,"__proto__":{"polluted":true,"items":[]},"constructor":{"prototype":{"polluted":true}},"items":[{"id":"__proto__","__proto__":{"polluted":true},"to":{"kind":"route","route":"home","__proto__":{"polluted":true}}},{"id":"constructor","to":{"kind":"app","app":"constructor"}},{"id":"prototype","to":{"kind":"app","app":"prototype"},"label":"__proto__"}]}',
    '{"version":1,"position":"right","__proto__":{"version":2},"items":[{"to":{"kind":"scene","scene":"__proto__"}},{"to":{"kind":"action","action":"constructor"}},{"to":{"__proto__":{"kind":"route","route":"drive"}}}]}',
    '{"__proto__":{"version":1,"items":[{"id":"abcd","to":{"kind":"route","route":"drive"}}]}}',
  ];

  it.each(evil.map((e, i) => [i, e] as const))('payload %i leaves Object.prototype and every result clean', (_i, text) => {
    const before = protoKeys();
    const payload = JSON.parse(text) as unknown;
    const results: unknown[] = [
      sanitizeNav(payload),
      applyNavPatch(DEFAULT_NAV, payload),
      sanitizeLauncher(payload),
      applyLauncherPatch(DEFAULT_LAUNCHER, payload),
      sanitizePanel(payload),
      applyPanelPatch(DEFAULT_PANEL, payload),
      mergeSettings(DEFAULT_SETTINGS, { nav: payload, launcher: payload, panel: payload, __proto__: undefined }),
      mergeSettings(DEFAULT_SETTINGS, JSON.parse(`{"nav":${text},"launcher":${text},"panel":${text},"__proto__":{"polluted":true}}`)),
    ];
    expect(protoKeys()).toEqual(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
    for (const r of results) {
      expect(JSON.stringify(r)).not.toContain('polluted');
      expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
      expect(Object.hasOwn(r as object, '__proto__')).toBe(false);
    }
    expectRail(results[0] as NavConfig);
  });

  it('keeps ids and refs that merely look like prototype members as plain data', () => {
    const out = sanitizeNav(JSON.parse(evil[0]!) as unknown);
    // `constructor` and `prototype` are valid ids (lower case letters); `__proto__` is not (underscores), so that one is repaired
    expect(ids(out)).toEqual(['item1', 'constructor', 'prototype', 'spacer', 'settings']);
    expect(out.items[1]?.to).toEqual({ kind: 'app', app: 'constructor' });
    expect(out.items[2]?.label).toBe('__proto__');
    expect(Object.getPrototypeOf(out.items[1])).toBe(Object.prototype);
  });

  it('only own properties count: fields found on the prototype are not read', () => {
    const inherited = Object.create({ version: 1, position: 'right', items: [pin(1)] }) as unknown;
    expect(sanitizeNav(inherited)).toEqual(DEFAULT_NAV);
    class Config {
      version = 1;
      items = [pin(1)];
    }
    expect(sanitizeNav(new Config())).toEqual(DEFAULT_NAV); // a class instance is not a plain object
    const item = Object.create({ to: { kind: 'route', route: 'home' } }) as unknown;
    expect(sanitizeNav(nav([item]))).toEqual(DEFAULT_NAV);
    const proto = Object.create({ kind: 'route', route: 'home' }) as unknown;
    expect(sanitizeNav(nav([{ id: 'aaa1', to: proto }]))).toEqual(DEFAULT_NAV);
  });

  it('a patch whose prototype was swapped (an object literal with __proto__) reads only its own fields', () => {
    const patch = { version: 1, __proto__: { position: 'right' } };
    expect(applyNavPatch(DEFAULT_NAV, patch)).toEqual(DEFAULT_NAV);
  });
});

// ---------------------------------------------------------------------------
// 12. Labels
// ---------------------------------------------------------------------------

describe('12. label normalisation', () => {
  const acute = '\u{301}';
  const lone = (n: number) => String.fromCharCode(n);

  it('composes to NFC', () => {
    expect(cleanLabel('Cafe' + acute)).toBe('Caf\u{E9}');
    expect(cleanLabel('e' + acute)).toBe('\u{E9}');
  });

  it('removes invisible formatting characters (Cf): zero-width, bidi controls, BOM, soft hyphen, tags', () => {
    expect(cleanLabel('a\u{200B}b\u{200D}c\u{200E}d\u{202E}e\u{2066}f\u{FEFF}g\u{AD}h\u{E0041}i')).toBe('abcdefghi');
    expect(cleanLabel('\u{202E}txet\u{202C}')).toBe('txet');
  });

  it('is stable when removing a joiner leaves a letter and its accent to compose', () => {
    // the first version normalised before it removed the joiner: the result came back different the second time
    const once = cleanLabel('e\u{200D}' + acute);
    expect(once).toBe('\u{E9}');
    expect(cleanLabel(once)).toBe(once);
  });

  it('turns control characters and line separators into spaces, then collapses whitespace', () => {
    expect(cleanLabel('a\tb\nc\r\nd\u{0}e')).toBe('a b c d e');
    expect(cleanLabel('a\u{7}b\u{1B}c\u{85}d\u{7F}e')).toBe('a b c d e');
    expect(cleanLabel('a\u{2028}b\u{2029}c')).toBe('a b c');
    expect(cleanLabel('  a   b  ')).toBe('a b');
    expect(cleanLabel('a\u{A0}\u{3000}\u{2003}b')).toBe('a b');
  });

  it('treats characters that draw as nothing as spaces: a label made only of them is no label', () => {
    expect(cleanLabel('\u{3164}\u{2800}\u{115F}\u{1160}\u{FFA0}')).toBeUndefined();
    expect(cleanLabel('a\u{3164}b')).toBe('a b');
  });

  it('cuts to ten code points, never in the middle of a surrogate pair', () => {
    expect(cleanLabel('abcdefghijkl')).toBe('abcdefghij');
    const smile = '\u{1F600}';
    expect(cleanLabel(smile.repeat(10))).toBe(smile.repeat(10));
    expect(cleanLabel(smile.repeat(11))).toBe(smile.repeat(10));
    expect(cleanLabel('abcdefghi' + smile + 'xyz')).toBe('abcdefghi' + smile);
    expect(Array.from(cleanLabel('\u{10400}'.repeat(30))!)).toHaveLength(10);
  });

  it('trims again after the cut, and never ends in a space', () => {
    expect(cleanLabel('abcdefghi jkl')).toBe('abcdefghi');
    expect(cleanLabel('abcdefghij kl')).toBe('abcdefghij');
  });

  it('removes a lone half of a surrogate pair, wherever it sits', () => {
    expect(cleanLabel('a' + lone(0xd800) + 'b')).toBe('ab');
    expect(cleanLabel('a' + lone(0xdc00) + 'b')).toBe('ab');
    expect(cleanLabel('ab' + lone(0xd83d))).toBe('ab');
    expect(cleanLabel(lone(0xdc00) + lone(0xd83d))).toBeUndefined();
    expect(cleanLabel(lone(0xd83d) + lone(0xde00))).toBe('\u{1F600}'); // a high then a low surrogate IS a pair
  });

  it('gives nothing for empty, whitespace-only or non-string values', () => {
    for (const v of ['', ' ', '\n\t', '\u{200B}', '\u{202E}', lone(0xd800), 5, null, undefined, true, [], ['abc'], { toString: () => 'abc' }, new String('abc'), 5n]) expect(cleanLabel(v), String(typeof v)).toBeUndefined();
  });

  it('is bounded: only the start of a huge string is looked at', () => {
    const started = Date.now();
    expect(cleanLabel('x'.repeat(5_000_000))).toBe('x'.repeat(10));
    expect(cleanLabel('\u{301}'.repeat(5_000_000))?.length).toBe(10);
    expect(cleanLabel('x' + ' '.repeat(300) + 'y')).toBe('x'); // the visible text is beyond what is read
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is idempotent on a battery of awkward strings', () => {
    const awkward = [
      'e\u{200D}' + acute, 'a' + acute + acute + acute, acute + 'a', ' ' + acute, 'a ' + acute, 'a\u{200B} ' + acute, '\u{1100}\u{1161}\u{11A8}', '\u{1100}\u{200D}\u{1161}', 'A\u{30A}\u{323}',
      '\u{FB01}ne', '\u{2126}\u{212B}', 'x'.repeat(9) + 'e' + acute, 'x'.repeat(10) + acute, 'x'.repeat(9) + ' ' + acute, '\u{3164}a\u{3164}', lone(0xd83d) + 'a', 'a' + lone(0xdc00),
      '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}', '\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}', 'a\u{2028}' + acute + '\u{2029}b', '\u{0}' + acute + 'e', 'e\u{0}' + acute, 'e\u{AD}' + acute,
    ];
    for (const s of awkward) {
      const once = cleanLabel(s);
      expect(cleanLabel(once), JSON.stringify(s)).toBe(once);
    }
  });

  it('shapes a label in the rail: kept on ordinary items, never on Settings or the divider', () => {
    const out = sanitizeNav(nav([route('aaa1', 'home', { label: '  Start\u{200B}  ' }), route('aaa2', 'drive', { label: '   ' }), { id: 'settings', to: { kind: 'route', route: 'settings' }, label: 'Evil' }, gap()]));
    expect(out.items[0]?.label).toBe('Start');
    expect('label' in out.items[1]!).toBe(false);
    expect(out.items.at(-1)).toStrictEqual(SETTINGS_ITEM);
    expect(keysOf(out.items.find((i) => i.to.kind === 'gap')!)).toEqual(['id', 'to']);
  });
});

// ---------------------------------------------------------------------------
// 13. Versions and patches
// ---------------------------------------------------------------------------

describe('13. an unknown version is ignored on a patch, and a patch merges per field', () => {
  const wrong: unknown[] = [{ position: 'right' }, { version: 2, position: 'right' }, { version: '1', position: 'right' }, { version: 1.0000001, position: 'right' }, { version: [1], position: 'right' }, { version: true, position: 'right' }, { version: null, position: 'right' }, 'right', 5, null, undefined, [], [{ version: 1 }], true];

  it.each(wrong.map((w, i) => [i, w] as const))('patch %i leaves the current value alone (the very same object)', (_i, patch) => {
    expect(applyNavPatch(customNav, patch)).toBe(customNav);
    expect(applyLauncherPatch({ version: 1, hidden: ['gps'] }, patch)).toEqual({ version: 1, hidden: ['gps'] });
    const launcher: LauncherConfig = { version: 1, hidden: ['gps'] };
    const panel: PanelConfig = { version: 1, tiles: ['bt'], sections: { scenes: false, actions: true, sleep: true } };
    expect(applyLauncherPatch(launcher, patch)).toBe(launcher);
    expect(applyPanelPatch(panel, patch)).toBe(panel);
    const settings = mergeSettings({ ...DEFAULT_SETTINGS, nav: customNav, launcher, panel }, { nav: patch, launcher: patch, panel: patch });
    expect(settings.nav).toBe(customNav);
    expect(settings.launcher).toBe(launcher);
    expect(settings.panel).toBe(panel);
  });

  it('an unknown version as the stored value (sanitizing) gives the fallback', () => {
    expect(sanitizeNav({ version: 2, position: 'right', items: [pin(1)] })).toEqual(DEFAULT_NAV);
    expect(sanitizeNav({ version: 2, position: 'right', items: [pin(1)] }, customNav)).toEqual(customNav);
  });

  it('each field the patch carries replaces the stored one whole; the others stay', () => {
    expect(applyNavPatch(customNav, { version: 1, position: 'left' })).toEqual({ ...customNav, position: 'left' });
    expect(applyNavPatch(customNav, { version: 1, size: 'compact' })).toEqual({ ...customNav, size: 'compact' });
    expect(applyNavPatch(customNav, { version: 1, labels: 'always' })).toEqual({ ...customNav, labels: 'always' });
    const items = applyNavPatch(customNav, { version: 1, items: [pin(1)] });
    expect(items).toMatchObject({ position: 'right', size: 'large', labels: 'never' });
    expect(targets(items)).toEqual(['app:app-1', 'gap', 'route:settings']); // replaced, not appended to
    expect(applyNavPatch(customNav, { version: 1 })).toEqual(customNav);
  });

  it('an invalid field in a patch keeps the stored value of that field only', () => {
    const out = applyNavPatch(customNav, { version: 1, position: 'bottom', size: 'compact', labels: 5, items: 'nope' });
    expect(out).toEqual({ ...customNav, size: 'compact' });
  });

  it('an explicit undefined means "not given"', () => {
    expect(applyNavPatch(customNav, { version: 1, position: undefined, items: undefined, size: 'compact' })).toEqual({ ...customNav, size: 'compact' });
  });

  it('launcher: hidden is replaced whole; panel: tiles are replaced whole and sections merge per name', () => {
    const l: LauncherConfig = { version: 1, hidden: ['gps', 'findcar'] };
    expect(applyLauncherPatch(l, { version: 1, hidden: ['perf'] })).toEqual({ version: 1, hidden: ['perf'] });
    expect(applyLauncherPatch(l, { version: 1, hidden: [] })).toEqual({ version: 1, hidden: [] });
    expect(applyLauncherPatch(l, { version: 1 })).toEqual(l);
    expect(applyLauncherPatch(l, { version: 1, hidden: 'perf' })).toEqual(l);
    const p: PanelConfig = { version: 1, tiles: ['camera', 'bt'], sections: { scenes: true, actions: false, sleep: true } };
    expect(applyPanelPatch(p, { version: 1, tiles: ['aa'] })).toEqual({ ...p, tiles: ['aa'] });
    expect(applyPanelPatch(p, { version: 1, sections: { scenes: false } })).toEqual({ ...p, sections: { scenes: false, actions: false, sleep: true } });
    expect(applyPanelPatch(p, { version: 1, sections: { sleep: 'no', actions: true, evil: true } })).toEqual({ ...p, sections: { scenes: true, actions: true, sleep: true } });
    expect(applyPanelPatch(p, { version: 1, sections: 5 })).toEqual(p);
    expect(applyPanelPatch(p, { version: 1, tiles: [] })).toEqual({ ...p, tiles: [] });
  });

  it('mergeSettings runs the three arrangements by their own rules and leaves the other keys alone', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, { theme: 'ember', nav: { version: 1, position: 'right' }, launcher: { version: 1, hidden: ['gps'] }, panel: { version: 1, tiles: ['bt'] } });
    expect(out).toEqual({ ...DEFAULT_SETTINGS, theme: 'ember', nav: { ...DEFAULT_NAV, position: 'right' }, launcher: { version: 1, hidden: ['gps'] }, panel: { ...DEFAULT_PANEL, tiles: ['bt'] } });
  });

  it('a patch without a nav key keeps the very same nav object (cheap for memoised screens)', () => {
    const cur = { ...DEFAULT_SETTINGS, nav: customNav };
    expect(mergeSettings(cur, { theme: 'ember' }).nav).toBe(customNav);
  });

  it('does not mutate the current settings or the patch', () => {
    const cur = deepFreeze(structuredClone({ ...DEFAULT_SETTINGS, nav: customNav }));
    const patch = deepFreeze({ nav: { version: 1, items: [pin(1), pin(1)] }, launcher: { version: 1, hidden: ['gps'] }, panel: { version: 1, tiles: ['bt'], sections: { sleep: false } } });
    expect(() => mergeSettings(cur, patch)).not.toThrow();
    expect(cur.nav).toEqual(customNav);
  });
});

// ---------------------------------------------------------------------------
// 14. Garbage items
// ---------------------------------------------------------------------------

describe('14. a list of garbage gives the default rail, never a Settings-only one', () => {
  const garbage: Array<[string, unknown]> = [
    ['one empty object', [{}]],
    ['mixed non-objects', [null, 1, 'x', true, [], [[]]]],
    ['unknown kinds', [{ to: { kind: 'nope' } }, { to: { kind: 'page', page: 'p-1' } }, { to: { kind: 'do', do: 'passenger' } }]],
    ['no targets', [{ id: 'abcd' }, { id: 'efgh', label: 'x' }]],
    ['removed vocabulary (devices and vehicle are not routes any more)', [route('aaa1', 'devices'), route('aaa2', 'vehicle'), route('aaa3', 'nowplaying'), route('aaa4', 'app')]],
    ['forty junk entries', Array.from({ length: 40 }, () => 7)],
    ['a divider and nothing else', [gap()]],
    ['dividers only', [gap('aaaa'), gap('bbbb')]],
  ];

  it.each(garbage)('%s', (_name, items) => {
    expect(sanitizeNav(nav(items))).toEqual(DEFAULT_NAV);
  });

  it('keeps position, size and labels that were fine', () => {
    expect(sanitizeNav(nav([{}], { position: 'right', size: 'large', labels: 'never' }))).toEqual({ ...DEFAULT_NAV, position: 'right', size: 'large', labels: 'never' });
    expect(sanitizeNav(nav([{}], { position: 'bottom', size: 'compact' }))).toEqual({ ...DEFAULT_NAV, size: 'compact' });
  });

  it('brings back the fallback rail (the default when loading, the current rail for a live patch), with its scalars', () => {
    const out = sanitizeNav(nav([{}]), customNav);
    expect(out).toEqual(customNav);
    expect(sanitizeNav(nav([{}]))).toEqual(DEFAULT_NAV); // nothing to fall back on but the default: what a damaged file on disk gets
  });

  it('a list that is not an array at all keeps the fallback\'s items instead', () => {
    expect(sanitizeNav(nav('rail'), customNav)).toEqual(customNav);
    expect(sanitizeNav(nav({ 0: pin(1), length: 1 }), customNav)).toEqual(customNav);
  });

  it('a short list is a choice, not damage: an empty list, or Settings alone, is a Settings-only rail', () => {
    for (const items of [[], [SETTINGS_ITEM], [SETTINGS_ITEM, null, 5], [{}, SETTINGS_ITEM]]) {
      const out = sanitizeNav(nav(items));
      expect(targets(out)).toEqual(['gap', 'route:settings']);
      expectRail(out);
    }
  });

  it('valid entries among the garbage are kept', () => {
    expect(ids(sanitizeNav(nav([{}, null, pin(1), 'x', pin(2)])))).toEqual(['p001', 'p002', 'spacer', 'settings']);
  });

  it('through a patch: garbage items leave the current rail as it is, other fields in the patch still apply', () => {
    const out = applyNavPatch(customNav, { version: 1, items: [{}], size: 'compact' });
    expect(out.items).toEqual(customNav.items); // a client that sends what this build cannot read does not wipe a customised rail
    expect(out).toMatchObject({ position: 'right', size: 'compact', labels: 'never' });
  });
});

// ---------------------------------------------------------------------------
// Hostile objects built in code (JSON cannot produce any of these)
// ---------------------------------------------------------------------------

describe('objects that JSON cannot make: getters, proxies, holes, null prototypes, cycles', () => {
  it('never runs a getter: an accessor property reads as "not there"', () => {
    let calls = 0;
    const raw = {
      version: 1,
      get position() {
        calls++;
        return 'right';
      },
      get items(): unknown {
        calls++;
        throw new Error('boom');
      },
    };
    expect(sanitizeNav(raw)).toEqual(DEFAULT_NAV);
    expect(calls).toBe(0);
    const item = {
      id: 'aaa1',
      get to(): unknown {
        calls++;
        return { kind: 'route', route: 'home' };
      },
    };
    expect(sanitizeNav(nav([item, pin(1)]))).toEqual(sanitizeNav(nav([pin(1)])));
    expect(calls).toBe(0);
    const list: unknown[] = [pin(1)];
    Object.defineProperty(list, 1, { get: () => (calls++, pin(2)), enumerable: true });
    expect(ids(sanitizeNav(nav(list)))).toEqual(['p001', 'spacer', 'settings']);
    expect(calls).toBe(0);
  });

  it('does not throw for a proxy whose traps throw: the fallback comes back', () => {
    const trap = (name: string) => () => {
      throw new Error(name);
    };
    const hostile = (target: object) => new Proxy(target, { getPrototypeOf: trap('proto'), getOwnPropertyDescriptor: trap('descriptor'), get: trap('get'), has: trap('has'), ownKeys: trap('keys') });
    expect(sanitizeNav(hostile({ version: 1 }), customNav)).toEqual(customNav);
    expect(sanitizeNav(nav(hostile([pin(1)])), customNav)).toEqual(customNav);
    expect(sanitizeNav(nav([hostile({ id: 'aaa1' }), pin(1)]), customNav)).toEqual(customNav); // one hostile entry anywhere: the whole input is distrusted
    expect(sanitizeLauncher(hostile({ version: 1 }), { version: 1, hidden: ['gps'] })).toEqual({ version: 1, hidden: ['gps'] });
    expect(sanitizePanel(hostile({ version: 1 }))).toEqual(DEFAULT_PANEL);
    expect(applyNavPatch(customNav, hostile({ version: 1 }))).toEqual(customNav);
    expect(arrangementsCorrected({ nav: hostile({ version: 1 }) }, DEFAULT_SETTINGS)).toBe(true);
  });

  it('reads only the first forty entries of an array that claims to be enormous', () => {
    let reads = 0;
    const huge = new Proxy([] as unknown[], {
      get: (t, k, r) => (k === 'length' ? 1e9 : Reflect.get(t, k, r)),
      getOwnPropertyDescriptor: (t, k) => {
        if (typeof k === 'string' && /^\d+$/.test(k)) {
          reads++;
          return { value: pin(reads), writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    });
    const started = Date.now();
    const out = sanitizeNav(nav(huge));
    expect(reads).toBe(NAV_LIMITS.scan);
    expectRail(out);
    reads = 0;
    sanitizeLauncher({ version: 1, hidden: huge });
    expect(reads).toBe(LAUNCHER_LIMITS.scan);
    reads = 0;
    sanitizePanel({ version: 1, tiles: huge });
    expect(reads).toBe(QUICK_TILES.length * 2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('copes with a sparse array of absurd length and with a million entries, in a bounded time', () => {
    const sparse: unknown[] = [];
    sparse.length = 4_294_967_295;
    sparse[3] = pin(1);
    const started = Date.now();
    expect(ids(sanitizeNav(nav(sparse)))).toEqual(['p001', 'spacer', 'settings']);
    expect(sanitizeLauncher({ version: 1, hidden: sparse })).toEqual(DEFAULT_LAUNCHER);
    const million = new Array<unknown>(1_000_000).fill(pin(1));
    expect(ids(sanitizeNav(nav(million)))).toEqual(['p001', 'spacer', 'settings']);
    const wide = nav([{ id: 'a'.repeat(100_000), label: 'x'.repeat(100_000), icon: 'y'.repeat(100_000), to: { kind: 'app', app: 'z'.repeat(100_000) } }]);
    expect(sanitizeNav(wide)).toEqual(DEFAULT_NAV);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('holes in an array read as nothing', () => {
    // eslint-disable-next-line no-sparse-arrays
    const holes = [, pin(1), , , pin(2), ,];
    expect(ids(sanitizeNav(nav(holes)))).toEqual(['p001', 'p002', 'spacer', 'settings']);
    expect(sanitizeNav(nav(new Array(5)))).toEqual(DEFAULT_NAV); // five holes: nothing kept, so garbage
  });

  it('accepts a null-prototype object as plain, and frozen or sealed objects', () => {
    const bare = Object.assign(Object.create(null) as object, { version: 1, items: [Object.assign(Object.create(null) as object, { id: 'aaa1', to: Object.assign(Object.create(null) as object, { kind: 'app', app: 'gps' }) })] });
    const out = sanitizeNav(bare);
    expect(ids(out)).toEqual(['aaa1', 'spacer', 'settings']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(sanitizeNav(deepFreeze(structuredClone(customNav)))).toEqual(customNav);
    expect(sanitizeNav(Object.seal({ version: 1, items: Object.seal([Object.seal(pin(1))]) }))).toEqual(sanitizeNav(nav([pin(1)])));
  });

  it('is not fooled by a cycle, an array-like object or a typed array', () => {
    const cyc: Record<string, unknown> = { version: 1 };
    cyc.items = [cyc, { id: 'aaa1', to: cyc }];
    expect(sanitizeNav(cyc)).toEqual(DEFAULT_NAV);
    expect(sanitizeNav(nav({ length: 1, 0: pin(1) }))).toEqual(DEFAULT_NAV);
    expect(sanitizeNav(nav(new Uint8Array(3)))).toEqual(DEFAULT_NAV);
    expect(sanitizeLauncher({ version: 1, hidden: new Set(['gps']) })).toEqual(DEFAULT_LAUNCHER);
  });

  it('a fallback that is itself broken is made whole first, so the result is still a valid rail', () => {
    for (const broken of [undefined, null, 5, 'x', [], {}, { version: 1 }, { version: 1, items: 'x' }, { version: 1, position: 'bottom', items: [{ id: 'x' }] }, { version: 1, items: [pin(1), pin(1)], size: 3 }]) {
      const out = sanitizeNav(nav('not an array'), broken as never);
      expectRail(out);
      expectRail(sanitizeNav(5, broken as never));
      expectRail(applyNavPatch(broken as never, { version: 1, position: 'right' }));
    }
    for (const gone of [undefined, null, 5, 'x', [], {}]) expectRail(applyNavPatch(gone as never, { version: 2 })); // a patch that is ignored still never hands back nothing
    expect(sanitizeLauncher({ version: 1, hidden: 'x' }, undefined as never)).toEqual(DEFAULT_LAUNCHER);
    expect(sanitizePanel({ version: 1, tiles: 'x' }, null as never)).toEqual(DEFAULT_PANEL);
    expect(applyLauncherPatch(undefined as never, { version: 1, hidden: ['gps'] })).toEqual({ version: 1, hidden: ['gps'] });
    expect(applyPanelPatch(undefined as never, { version: 1, tiles: ['bt'] })).toEqual({ ...DEFAULT_PANEL, tiles: ['bt'] });
  });

  it('mergeSettings does not throw when the current settings predate the three keys', () => {
    const { nav: _n, launcher: _l, panel: _p, ...legacy } = DEFAULT_SETTINGS;
    const out = mergeSettings(legacy as Settings, { nav: { version: 1, position: 'right' }, launcher: { version: 1, hidden: ['gps'] }, panel: { version: 1, tiles: ['bt'] } });
    expect(out.nav).toEqual({ ...DEFAULT_NAV, position: 'right' });
    expect(out.launcher).toEqual({ version: 1, hidden: ['gps'] });
    expect(out.panel).toEqual({ ...DEFAULT_PANEL, tiles: ['bt'] });
    expect(() => mergeSettings(legacy as Settings, { nav: { version: 2 } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 16. Launcher and panel
// ---------------------------------------------------------------------------

describe('16. sanitizeLauncher', () => {
  it('needs version 1 and a hidden array, else the fallback comes back (as a copy)', () => {
    const fb: LauncherConfig = { version: 1, hidden: ['gps'] };
    for (const raw of [null, 'x', { hidden: ['perf'] }, { version: 2, hidden: ['perf'] }, { version: 1 }, { version: 1, hidden: 'perf' }, { version: 1, hidden: { 0: 'perf', length: 1 } }]) {
      const out = sanitizeLauncher(raw, fb);
      expect(out).toEqual(fb);
      expect(out).not.toBe(fb);
      expect(out.hidden).not.toBe(fb.hidden);
    }
  });

  it('keeps strings that are app refs, in order, once each', () => {
    expect(sanitizeLauncher({ version: 1, hidden: ['gps', 'Bad', 'findcar', 'gps', '', 'x', 'quick-actions', 5, 'p-xxxx'] }).hidden).toEqual(['gps', 'findcar', 'quick-actions', 'p-xxxx']);
  });

  it('caps at sixteen, keeping the first sixteen', () => {
    const many = Array.from({ length: 20 }, (_, i) => `app-${i}`);
    expect(sanitizeLauncher({ version: 1, hidden: many }).hidden).toEqual(many.slice(0, 16));
  });

  it('only scans the first thirty-two entries', () => {
    const list = [...Array.from({ length: 32 }, () => 'BAD'), 'gps'];
    expect(sanitizeLauncher({ version: 1, hidden: list }).hidden).toEqual([]);
    expect(sanitizeLauncher({ version: 1, hidden: [...list.slice(1), 'gps'] }).hidden).toEqual(['gps']);
    // duplicates inside the first 32 do not stop later refs from being seen as long as they are within 32
    expect(sanitizeLauncher({ version: 1, hidden: [...Array.from({ length: 31 }, () => 'gps'), 'perf', 'late-one'] }).hidden).toEqual(['gps', 'perf']);
  });

  it('an empty list is legal and nothing is hidden; a list of junk is also empty (it hides nothing)', () => {
    expect(sanitizeLauncher({ version: 1, hidden: [] }, { version: 1, hidden: ['gps'] }).hidden).toEqual([]);
    expect(sanitizeLauncher({ version: 1, hidden: [1, 2, 3] }, { version: 1, hidden: ['gps'] }).hidden).toEqual([]);
  });

  it('keeps dangling refs: whether an app still exists is decided when it is drawn', () => {
    expect(sanitizeLauncher({ version: 1, hidden: ['removed-app', 'ghost'] }).hidden).toEqual(['removed-app', 'ghost']);
  });

  it('returns fresh objects, and an extra field is not copied', () => {
    const raw = { version: 1, hidden: ['gps'], evil: { a: 1 } };
    const out = sanitizeLauncher(raw);
    expect(out).toEqual({ version: 1, hidden: ['gps'] });
    expect(sharesNothing(out, raw)).toBe(true);
  });
});

describe('16. sanitizePanel', () => {
  it('needs version 1, else the fallback comes back (as a copy)', () => {
    const fb: PanelConfig = { version: 1, tiles: ['bt'], sections: { scenes: false, actions: false, sleep: false } };
    for (const raw of [null, 'x', {}, { tiles: ['camera'] }, { version: 2, tiles: ['camera'] }]) {
      const out = sanitizePanel(raw, fb);
      expect(out).toEqual(fb);
      expect(sharesNothing(out, fb)).toBe(true);
    }
  });

  it('filters tiles to the vocabulary, removes repeats and keeps the order given', () => {
    expect(sanitizePanel({ version: 1, tiles: ['bt', 'nope', 'camera', 'bt', 5, 'aa', 'camera'] }).tiles).toEqual(['bt', 'camera', 'aa']);
    expect(sanitizePanel({ version: 1, tiles: [...QUICK_TILES].reverse() }).tiles).toEqual([...QUICK_TILES].reverse());
  });

  it('an intentional empty list is legal; a non-empty list with nothing valid in it is damage and the fallback tiles come back', () => {
    expect(sanitizePanel({ version: 1, tiles: [] }).tiles).toEqual([]);
    expect(sanitizePanel({ version: 1, tiles: ['nope', 5, null] }).tiles).toEqual([...QUICK_TILES]);
    const fb: PanelConfig = { version: 1, tiles: ['bt', 'camera'], sections: { scenes: true, actions: true, sleep: true } };
    expect(sanitizePanel({ version: 1, tiles: ['nope'] }, fb).tiles).toEqual(['bt', 'camera']);
    expect(sanitizePanel({ version: 1, tiles: ['nope'], sections: { sleep: false } }, fb).sections.sleep).toBe(false); // the sections are judged on their own
  });

  it('a tiles value that is not an array keeps the fallback tiles', () => {
    expect(sanitizePanel({ version: 1, tiles: 'camera' }).tiles).toEqual([...QUICK_TILES]);
    expect(sanitizePanel({ version: 1 }).tiles).toEqual([...QUICK_TILES]);
  });

  it('only scans the first fourteen entries', () => {
    expect(sanitizePanel({ version: 1, tiles: [...Array.from({ length: 14 }, () => 'nope'), 'camera'] }).tiles).toEqual([...QUICK_TILES]); // garbage within the window
    expect(sanitizePanel({ version: 1, tiles: [...Array.from({ length: 13 }, () => 'nope'), 'camera', 'bt'] }).tiles).toEqual(['camera']);
  });

  it('takes each section as a boolean, else the fallback value; unknown names are ignored and not copied', () => {
    const out = sanitizePanel({ version: 1, sections: JSON.parse('{"scenes":false,"actions":"no","sleep":0,"extra":true,"__proto__":{"sleep":false}}') as unknown });
    expect(out.sections).toEqual({ scenes: false, actions: true, sleep: true });
    expect(keysOf(out.sections)).toEqual(['actions', 'scenes', 'sleep']);
    expect(sanitizePanel({ version: 1, sections: { scenes: false } }, { version: 1, tiles: ['bt'], sections: { scenes: true, actions: false, sleep: false } }).sections).toEqual({ scenes: false, actions: false, sleep: false });
  });

  it('returns fresh objects', () => {
    const raw = { version: 1, tiles: ['bt'], sections: { scenes: true, actions: true, sleep: true }, extra: {} };
    expect(sharesNothing(sanitizePanel(raw), raw, DEFAULT_PANEL)).toBe(true);
    expect(sharesNothing(sanitizePanel(null), DEFAULT_PANEL)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// arrangementsCorrected (the server's decision to resend)
// ---------------------------------------------------------------------------

describe('arrangementsCorrected: does the sender need to be told what was kept?', () => {
  const merged = (patch: Record<string, unknown>) => mergeSettings(DEFAULT_SETTINGS, patch);

  it('says no for a clean patch, however the object keys are ordered', () => {
    const patches = [
      { nav: { version: 1, position: 'right' } },
      { nav: { version: 1, items: json(NAV_PRESETS.minimal.items) } },
      { nav: json(NAV_PRESETS.driver) },
      { nav: { version: 1, items: [{ to: { route: 'home', kind: 'route' }, id: 'home' }, { to: { kind: 'gap' }, id: 'spacer' }, { to: { route: 'settings', kind: 'route' }, id: 'settings' }] } },
      { launcher: { version: 1, hidden: ['gps', 'perf'] } },
      { panel: { version: 1, tiles: ['bt', 'camera'] } },
      { panel: { version: 1, sections: { scenes: false } } },
      { panel: { version: 1, tiles: [], sections: { scenes: false, actions: false, sleep: false } } },
      { nav: { version: 1 } },
      { theme: 'ember', accent: '#112233' },
      {},
    ];
    for (const p of patches) expect(arrangementsCorrected(p, merged(p)), JSON.stringify(p)).toBe(false);
  });

  it('says yes when something the sender wrote was repaired, dropped or refused', () => {
    const patches = [
      { nav: { version: 1, position: 'bottom' } },
      { nav: { version: 1, items: [pin(1), pin(1)] } },
      { nav: { version: 1, items: [{ id: 'BAD', to: { kind: 'app', app: 'gps' } }] } },
      { nav: { version: 1, items: [pin(1)] } }, // Settings and the divider were added
      { nav: { version: 1, items: 'nope' } },
      { nav: { version: 1, labels: 7 } },
      { nav: { position: 'right' } },
      { nav: { version: 2, position: 'right' } },
      { nav: 'right' },
      { nav: null },
      { launcher: { version: 1, hidden: ['gps', 'BAD'] } },
      { launcher: { version: 1, hidden: ['gps', 'gps'] } },
      { launcher: { hidden: ['gps'] } },
      { panel: { version: 1, tiles: ['bt', 'bt'] } },
      { panel: { version: 1, tiles: ['nope'] } },
      { panel: { version: 1, sections: { scenes: 'no' } } },
      { panel: { version: 1, sections: { evil: true } } },
      { panel: { version: 1, sections: 5 } },
      { panel: [] },
    ];
    for (const p of patches) expect(arrangementsCorrected(p, merged(p)), JSON.stringify(p)).toBe(true);
  });

  it('does not look at keys outside the three arrangements, and never throws', () => {
    expect(arrangementsCorrected({ theme: 'nope', bgBlur: '5' }, merged({ theme: 'nope' }))).toBe(false);
    for (const [, j] of JUNK) {
      expect(() => arrangementsCorrected(j, DEFAULT_SETTINGS)).not.toThrow();
      expect(() => arrangementsCorrected({ nav: j, launcher: j, panel: j }, DEFAULT_SETTINGS)).not.toThrow();
    }
    expect(arrangementsCorrected({ nav: { version: 1, position: 'right' } }, {} as Settings)).toBe(true); // a broken result: tell the sender
  });

  it('is cheap on a deeply nested patch', () => {
    const deep = JSON.parse('['.repeat(20_000) + ']'.repeat(20_000)) as unknown;
    const started = Date.now();
    expect(arrangementsCorrected({ nav: { version: 1, items: deep }, launcher: { version: 1, hidden: deep } }, DEFAULT_SETTINGS)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// 17. Parity: mergeSettings knows every key of Settings
// ---------------------------------------------------------------------------

type Variant<K extends keyof Settings> = { valid: unknown; expected: Settings[K]; invalid: unknown };
/** One row per Settings key. The type is a mapped type over `keyof Settings`: add a key to Settings and this stops compiling. */
const VARIANT: { [K in keyof Settings]: Variant<K> } = {
  theme: { valid: 'ember', expected: 'ember', invalid: 'not-a-theme' },
  accent: { valid: '#AABBCC', expected: '#aabbcc', invalid: 'red; background:url(x)' },
  surface: { valid: 'neon', expected: 'neon', invalid: 'plastic' },
  background: { valid: 'grid', expected: 'grid', invalid: 'video' },
  effects: { valid: 'full', expected: 'full', invalid: 'ultra' },
  albumMotion: { valid: 'hologram', expected: 'hologram', invalid: 'loading' },
  depthStyle: { valid: 'deep', expected: 'deep', invalid: 'super-deep' },
  motionSpeed: { valid: 'cinematic', expected: 'cinematic', invalid: 'warp' },
  dashScene: { valid: 'orbits', expected: 'orbits', invalid: 'stars' },
  glassFinish: { valid: 'iridescent', expected: 'iridescent', invalid: 'molten' },
  beatMode: { valid: 'rings', expected: 'rings', invalid: 'lasers' },
  beatSource: { valid: 'microphone', expected: 'microphone', invalid: 'spotify-api' },
  beatColorMode: { valid: 'rainbow', expected: 'rainbow', invalid: 'infrared' },
  beatColor: { valid: '#FF3300', expected: '#ff3300', invalid: 'red' },
  beatIntensity: { valid: 83.6, expected: 84, invalid: '100' },
  beatSensitivity: { valid: 77.7, expected: 78, invalid: null },
  mascotEnabled: { valid: false, expected: false, invalid: 'false' },
  mascotVariant: { valid: 'armored', expected: 'armored', invalid: 'gold' },
  mascotMotion: { valid: 'glitch', expected: 'glitch', invalid: 'dance' },
  mascotAura: { valid: 'sparks', expected: 'sparks', invalid: 'fire' },
  mascotPlacement: { valid: 'front', expected: 'front', invalid: 'over' },
  mascotScope: { valid: 'all', expected: 'all', invalid: 'some' },
  mascotX: { valid: 12.4, expected: 12, invalid: '12' },
  mascotY: { valid: 140, expected: 100, invalid: null },
  mascotSize: { valid: 3, expected: 10, invalid: NaN },
  mascotOpacity: { valid: 40, expected: 40, invalid: '40%' },
  mascotGlow: { valid: 90, expected: 90, invalid: true },
  mascotBeat: { valid: true, expected: true, invalid: 1 },
  mascotMirror: { valid: true, expected: true, invalid: 'yes' },
  font: { valid: 'future', expected: 'future', invalid: 'comic-sans' },
  textScale: { valid: 200, expected: 130, invalid: '110' },
  transition: { valid: 'flip', expected: 'flip', invalid: 'teleport' },
  touchFx: { valid: 'pop', expected: 'pop', invalid: 'shake' },
  gaugeStyle: { valid: 'needle', expected: 'needle', invalid: 'sundial' },
  standbyStyle: { valid: 'flip', expected: 'flip', invalid: 'blank' },
  dockStyle: { valid: 'ghost', expected: 'ghost', invalid: 'floating' },
  sceneIntensity: { valid: 2, expected: 10, invalid: '50' },
  weatherFx: { valid: true, expected: true, invalid: 'on' },
  shape: { valid: 'round', expected: 'round', invalid: 'pointy' },
  bgBlur: { valid: 33.6, expected: 34, invalid: '33' },
  bgDim: { valid: 80, expected: 80, invalid: NaN },
  glassOpacity: { valid: 12, expected: 12, invalid: null },
  wallpaper: { valid: 'user:me.jpg', expected: 'user:me.jpg', invalid: 'user:../x' },
  units: { valid: 'imperial', expected: 'imperial', invalid: 'furlongs' },
  clock24h: { valid: false, expected: false, invalid: 'false' },
  autoTheme: { valid: true, expected: true, invalid: 1 },
  dayTheme: { valid: 'sand', expected: 'sand', invalid: 'dusk' },
  nightTheme: { valid: 'amoled', expected: 'amoled', invalid: 'dusk' },
  nightStart: { valid: '21:45', expected: '21:45', invalid: '25:00' },
  nightEnd: { valid: '05:15', expected: '05:15', invalid: '5:15' },
  cameraMirror: { valid: true, expected: true, invalid: 'yes' },
  cameraGuides: { valid: false, expected: false, invalid: 0 },
  artAccent: { valid: false, expected: false, invalid: null },
  lockWhileDriving: { valid: false, expected: false, invalid: 'off' },
  musicSource: { valid: 'tidal', expected: 'tidal', invalid: 'demo' },
  autoThemeMode: { valid: 'sun', expected: 'sun', invalid: 'moon' },
  weather: { valid: false, expected: false, invalid: 'no' },
  lyrics: { valid: true, expected: true, invalid: 'on' },
  driveAuto: { valid: true, expected: true, invalid: 1 },
  standbyMin: { valid: 15, expected: 15, invalid: '15' },
  nav: { valid: { version: 1, position: 'right', size: 'large' }, expected: { ...DEFAULT_NAV, position: 'right', size: 'large' }, invalid: { position: 'right', size: 'large' } },
  launcher: { valid: { version: 1, hidden: ['gps', 'perf'] }, expected: { version: 1, hidden: ['gps', 'perf'] }, invalid: { hidden: ['gps'] } },
  panel: { valid: { version: 1, tiles: ['bt', 'camera'], sections: { scenes: false } }, expected: { version: 1, tiles: ['bt', 'camera'], sections: { scenes: false, actions: true, sleep: true } }, invalid: { tiles: ['bt'] } },
};

/** The Settings keys a variant table does not cover (plus the table's keys that Settings does not have). */
function uncovered(settings: object, table: object): string[] {
  const have = new Set(Object.keys(table));
  const want = new Set(Object.keys(settings));
  return [...[...want].filter((k) => !have.has(k)), ...[...have].filter((k) => !want.has(k)).map((k) => `${k} (not a Settings key)`)];
}

describe('17. mergeSettings honours the valid value and ignores the invalid one, for every key of Settings', () => {
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;
  const single = (k: keyof Settings, value: unknown) => mergeSettings(DEFAULT_SETTINGS, { [k]: value });
  const allValid = Object.fromEntries(keys.map((k) => [k, VARIANT[k].valid])) as Record<string, unknown>;
  const ALL_SET = mergeSettings(DEFAULT_SETTINGS, allValid);

  it('the table covers every key of DEFAULT_SETTINGS, and nothing else', () => {
    expect(uncovered(DEFAULT_SETTINGS, VARIANT)).toEqual([]);
  });

  it('the exhaustiveness check does fail when a key is added to Settings or to the table alone', () => {
    expect(uncovered({ ...DEFAULT_SETTINGS, brandNewSetting: 1 }, VARIANT)).toEqual(['brandNewSetting']);
    expect(uncovered(DEFAULT_SETTINGS, { ...VARIANT, typo: {} })).toEqual(['typo (not a Settings key)']);
    const { theme: _t, ...short } = VARIANT;
    expect(uncovered(DEFAULT_SETTINGS, short)).toEqual(['theme']);
  });

  it.each(keys)('%s: the valid value is applied, and nothing else moves', (k) => {
    const v = VARIANT[k];
    expect(JSON.stringify(v.expected), 'a variant must differ from the default or it proves nothing').not.toBe(JSON.stringify(DEFAULT_SETTINGS[k]));
    expect(single(k, v.valid)).toEqual({ ...DEFAULT_SETTINGS, [k]: v.expected });
  });

  it.each(keys)('%s: the invalid value changes nothing', (k) => {
    expect(single(k, VARIANT[k].invalid)).toEqual(DEFAULT_SETTINGS);
  });

  it.each(keys)('%s: the invalid value keeps the CURRENT value, it does not reset to the default', (k) => {
    expect(mergeSettings(ALL_SET, { [k]: VARIANT[k].invalid })).toEqual(ALL_SET);
  });

  it('all the valid values at once equal the sum of the parts, and survive a disk round trip', () => {
    for (const k of keys) expect(ALL_SET[k], k).toEqual(VARIANT[k].expected);
    expect(sanitizeSettings(json(ALL_SET))).toEqual(ALL_SET);
    expect(sanitizeSettings(json(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });

  it('a patch cannot add a key', () => {
    const out = mergeSettings(DEFAULT_SETTINGS, { ...allValid, brandNewSetting: 1, __proto__: { polluted: 1 } });
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

// ---------------------------------------------------------------------------
// 18. sanitizeSettings
// ---------------------------------------------------------------------------

describe('18. sanitizeSettings', () => {
  it('turns an empty or garbage blob into exactly DEFAULT_SETTINGS', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    for (const raw of [null, undefined, 'x', 5, [], [1], true, ...JUNK.map(([, j]) => j)]) expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('a settings file written before this feature loads with the default rail, launcher and panel', () => {
    const { nav: _n, launcher: _l, panel: _p, ...before } = DEFAULT_SETTINGS;
    const loaded = sanitizeSettings(json({ ...before, theme: 'ember', units: 'imperial' }));
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, theme: 'ember', units: 'imperial' });
    expect(loaded.nav).toEqual(DEFAULT_NAV);
  });

  it('a damaged nav in a settings file does not touch the other keys', () => {
    const loaded = sanitizeSettings({ theme: 'ember', nav: { version: 1, position: 'sideways', items: [{ nope: 1 }] }, launcher: 'x', panel: { version: 9 } });
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, theme: 'ember' });
  });

  it('a rail with a newer position (bottom, planned for later) loads with the rest kept', () => {
    const loaded = sanitizeSettings({ nav: { version: 1, position: 'bottom', size: 'large', items: json(NAV_PRESETS.minimal.items) } });
    expect(loaded.nav).toEqual({ ...NAV_PRESETS.minimal, position: 'left', size: 'large', labels: 'always' });
  });

  it('is the same as itself: a loaded value loads again unchanged', () => {
    const custom = mergeSettings(DEFAULT_SETTINGS, { nav: json(customNav), launcher: { version: 1, hidden: ['gps'] }, panel: { version: 1, tiles: ['bt'], sections: { sleep: false } } });
    expect(sanitizeSettings(json(custom))).toEqual(custom);
    expect(sanitizeSettings(sanitizeSettings(json(custom)))).toEqual(custom);
  });
});

// ---------------------------------------------------------------------------
// 19 and 20. Backups
// ---------------------------------------------------------------------------

describe('19 and 20. backups carry the rail; old ones leave what was arranged since alone', () => {
  const sinks = () => {
    const got: { settings?: Settings; carried?: CarriedArrangements } = {};
    const noop = async () => undefined;
    const s: BackupSinks = { settings: (x, carried) => void ((got.settings = x), (got.carried = carried)), layout: () => undefined, garage: noop, trips: noop, notes: noop, scenes: noop, radio: noop };
    return { got, sinks: s };
  };
  const sources = (settings: Settings) => ({ settings: () => settings, layout: () => DEFAULT_LAYOUT, garage: () => ({}), trips: () => ({}), notes: () => [], scenes: () => [], radio: () => ({}) });

  it('19. a backup made before this feature (no nav, launcher or panel) says it carries none of them, and the rest is restored', async () => {
    const { nav: _n, launcher: _l, panel: _p, ...before } = { ...DEFAULT_SETTINGS, theme: 'ember' as const, accent: '#fb923c' };
    const bundle = { app: 'rpi-head-unit', version: 2, createdAt: '2026-01-01T00:00:00.000Z', data: { settings: before, layout: DEFAULT_LAYOUT } };
    const { got, sinks: s } = sinks();
    const report = await restoreBackup(json(bundle), s);
    expect(report.restored).toEqual(['settings', 'layout']);
    expect(got.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'ember', accent: '#fb923c' });
    expect(got.carried).toEqual({ nav: false, launcher: false, panel: false });
    // (what the sink does with that is settingsToRestore, below)
    expect(got.settings?.nav).toEqual(DEFAULT_NAV);
  });

  it('19. what was arranged since stays when the backup knew nothing of it, and a backup that carries it wins', () => {
    const mine = mergeSettings(DEFAULT_SETTINGS, { nav: { version: 1, position: 'right', size: 'large', labels: 'never', items: [route('home', 'home')] }, launcher: { version: 1, hidden: ['perf'] }, panel: { version: 1, tiles: ['bt'] } });
    const restored = { ...DEFAULT_SETTINGS, theme: 'ember' as const };
    const none = settingsToRestore(restored, { nav: false, launcher: false, panel: false }, mine);
    expect([none.theme, none.nav, none.launcher, none.panel]).toEqual(['ember', mine.nav, mine.launcher, mine.panel]);
    const all = settingsToRestore(restored, { nav: true, launcher: true, panel: true }, mine);
    expect([all.nav, all.launcher, all.panel]).toEqual([DEFAULT_NAV, DEFAULT_LAUNCHER, DEFAULT_PANEL]);
    const some = settingsToRestore(restored, { nav: true, launcher: false, panel: false }, mine);
    expect([some.nav, some.launcher, some.panel]).toEqual([DEFAULT_NAV, mine.launcher, mine.panel]);
  });

  it('19. an even older backup (version 1) restores the same way', async () => {
    const { got, sinks: s } = sinks();
    await restoreBackup({ app: 'rpi-head-unit', version: 1, createdAt: 'x', data: { settings: { theme: 'ocean' } } }, s);
    expect(got.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'ocean' });
    expect(got.carried).toEqual({ nav: false, launcher: false, panel: false });
  });

  it('20. a backup with a custom rail, launcher and panel restores exactly that, through a JSON file', async () => {
    const custom = mergeSettings(DEFAULT_SETTINGS, {
      theme: 'forest',
      nav: { version: 1, position: 'right', size: 'compact', labels: 'active', items: [route('home', 'home', { label: 'Start', icon: 'star' }), app('aaa1', 'gps'), { id: 'aaa2', to: { kind: 'music', tab: 'tidal' } }, gap(), pin(1)] },
      launcher: { version: 1, hidden: ['perf', 'findcar'] },
      panel: { version: 1, tiles: ['camera', 'bt'], sections: { actions: false } },
    });
    const bundle = json(createBackup(sources(custom), new Date('2026-05-05T10:00:00Z')));
    const { got, sinks: s } = sinks();
    await restoreBackup(bundle, s);
    expect(got.settings).toEqual(custom);
    expect(got.settings?.nav).not.toEqual(DEFAULT_NAV);
  });

  it('20. references to apps, scenes and actions that do not exist stay as data (sanitizing is structural only)', async () => {
    const dangling = mergeSettings(DEFAULT_SETTINGS, {
      nav: {
        version: 1,
        items: [app('aaa1', 'app-from-a-newer-build'), { id: 'aaa2', to: { kind: 'scene', scene: 'scene-gone'.replace('-', '') } }, { id: 'aaa3', to: { kind: 'action', action: 'garage01' } }, route('aaa4', 'drive'), gap()],
      },
      launcher: { version: 1, hidden: ['ghost-app'] },
    });
    expect(targets(dangling.nav)).toEqual(['app:app-from-a-newer-build', 'scene:scenegone', 'action:garage01', 'route:drive', 'gap', 'route:settings']);
    const { got, sinks: s } = sinks();
    await restoreBackup(json(createBackup(sources(dangling))), s);
    expect(got.settings?.nav).toEqual(dangling.nav);
    expect(got.settings?.launcher.hidden).toEqual(['ghost-app']);
  });

  it('20. a backup with a nav from a newer build (unknown version) restores the default nav and keeps the rest', async () => {
    const bundle = json(createBackup(sources({ ...DEFAULT_SETTINGS, theme: 'nord' })));
    (bundle.data.settings as { nav: unknown }).nav = { version: 2, position: 'right', items: [pin(1)] };
    const { got, sinks: s } = sinks();
    await restoreBackup(bundle, s);
    expect(got.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'nord' });
  });

  it('20. a hostile backup cannot smuggle anything in through the rail', async () => {
    const bundle = json(createBackup(sources(DEFAULT_SETTINGS)));
    bundle.data.settings = JSON.parse('{"theme":"ember","__proto__":{"polluted":true},"nav":{"version":1,"__proto__":{"polluted":true},"items":[{"id":"x","to":{"kind":"route","route":"drive"},"label":"\\u202eevil\\u200b","icon":"<script>"},{"__proto__":{"polluted":true}}]},"launcher":{"version":1,"hidden":["__proto__","constructor"]},"panel":{"version":1,"tiles":["constructor"],"sections":{"__proto__":{"scenes":false}}}}');
    const { got, sinks: s } = sinks();
    await restoreBackup(bundle, s);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(got.settings?.theme).toBe('ember');
    expect(got.settings?.nav.items[0]).toEqual({ id: 'item1', to: { kind: 'route', route: 'drive' }, label: 'evil' });
    expect(got.settings?.launcher.hidden).toEqual(['constructor']);
    expect(got.settings?.panel).toEqual(DEFAULT_PANEL);
  });
});

// ---------------------------------------------------------------------------
// The size budget
// ---------------------------------------------------------------------------

describe('the size budget: the worst possible configuration stays far below 32 KB', () => {
  it('eight items with the longest ids, refs and labels, and a full launcher and panel', () => {
    const astral = '\u{1F600}'.repeat(10);
    const refs = Array.from({ length: 8 }, (_, i) => `r${String(i)}${'x'.repeat(30)}`);
    const worst = mergeSettings(DEFAULT_SETTINGS, {
      nav: {
        version: 1,
        position: 'right',
        size: 'large',
        labels: 'active',
        items: refs.map((r, i) => ({ id: `${'i'.repeat(23)}${i}`, to: { kind: 'app', app: r }, label: astral, icon: 'thermometer' })),
      },
      launcher: { version: 1, hidden: Array.from({ length: 16 }, (_, i) => `h${String(i).padStart(2, '0')}${'y'.repeat(28)}`) },
      panel: { version: 1, tiles: [...QUICK_TILES], sections: { scenes: true, actions: true, sleep: true } },
    });
    expect(worst.nav.items).toHaveLength(10);
    expect(worst.nav.items[0]?.label).toBe(astral);
    expect(worst.launcher.hidden).toHaveLength(16);
    const nav = Buffer.byteLength(JSON.stringify(worst.nav));
    const all = Buffer.byteLength(JSON.stringify({ nav: worst.nav, launcher: worst.launcher, panel: worst.panel }));
    expect(nav).toBeLessThan(4 * 1024);
    expect(all).toBeLessThan(8 * 1024);
    expect(Buffer.byteLength(JSON.stringify(worst))).toBeLessThan(32 * 1024);
  });
});

// ---------------------------------------------------------------------------
// 22. Frozen defaults, fresh results
// ---------------------------------------------------------------------------

describe('22. defaults are frozen all the way down; sanitizers never hand back what they were given', () => {
  it('DEFAULT_NAV, DEFAULT_LAUNCHER, DEFAULT_PANEL and every preset are deep-frozen', () => {
    for (const v of [DEFAULT_NAV, DEFAULT_LAUNCHER, DEFAULT_PANEL, ...Object.values(NAV_PRESETS)]) expect(isDeepFrozen(v)).toBe(true);
    expect(() => ((DEFAULT_NAV as { position: string }).position = 'right')).toThrow(TypeError);
    expect(() => (DEFAULT_NAV.items as NavItem[]).push(DEFAULT_NAV.items[0]!)).toThrow(TypeError);
    expect(() => ((DEFAULT_NAV.items[0]!.to as { route: string }).route = 'drive')).toThrow(TypeError);
    expect(() => (DEFAULT_LAUNCHER.hidden as string[]).push('gps')).toThrow(TypeError);
    expect(() => (DEFAULT_PANEL.tiles as string[]).pop()).toThrow(TypeError);
    expect(() => ((DEFAULT_PANEL.sections as { sleep: boolean }).sleep = false)).toThrow(TypeError);
  });

  it('a result is fresh and unfrozen, so a caller may edit it without touching a default', () => {
    for (const [name, out, def] of [
      ['nav', sanitizeNav(DEFAULT_NAV), DEFAULT_NAV],
      ['nav from junk', sanitizeNav('junk'), DEFAULT_NAV],
      ['nav from garbage items', sanitizeNav(nav([{}])), DEFAULT_NAV],
      ['nav with a non-array list', sanitizeNav(nav('x')), DEFAULT_NAV],
      ['launcher', sanitizeLauncher(DEFAULT_LAUNCHER), DEFAULT_LAUNCHER],
      ['launcher from junk', sanitizeLauncher(7), DEFAULT_LAUNCHER],
      ['panel', sanitizePanel(DEFAULT_PANEL), DEFAULT_PANEL],
      ['panel from junk', sanitizePanel(7), DEFAULT_PANEL],
    ] as const) {
      expect(sharesNothing(out, def), name).toBe(true);
      expect(Object.isFrozen(out), name).toBe(false);
    }
    const out = sanitizeNav(DEFAULT_NAV);
    out.items.forEach((i) => expect(DEFAULT_NAV.items.includes(i)).toBe(false));
    (out.items as NavItem[]).pop();
    expect(DEFAULT_NAV.items).toHaveLength(7);
  });

  it('a result never shares an object with the input or the fallback', () => {
    const input = json(nav([route('aaa1', 'home', { label: 'Hi' }), pin(1), gap(), pin(2)], { position: 'right' }));
    const fallback = sanitizeNav(nav([pin(3)]));
    expect(sharesNothing(sanitizeNav(input), input)).toBe(true);
    expect(sharesNothing(sanitizeNav(input, fallback), input, fallback)).toBe(true);
    expect(sharesNothing(sanitizeNav('junk', fallback), fallback)).toBe(true);
    expect(sharesNothing(sanitizeNav(nav('x'), fallback), fallback)).toBe(true);
    expect(sharesNothing(applyNavPatch(fallback, { version: 1, position: 'right' }), fallback)).toBe(true);
    expect(sharesNothing(applyNavPatch(fallback, { version: 1, items: input.items }), fallback, input)).toBe(true);
    const lp = { version: 1, hidden: ['gps'] };
    expect(sharesNothing(sanitizeLauncher(lp), lp)).toBe(true);
    expect(sharesNothing(applyLauncherPatch(DEFAULT_LAUNCHER, lp), lp, DEFAULT_LAUNCHER)).toBe(true);
    const pp = { version: 1, tiles: ['bt'], sections: { sleep: false } };
    expect(sharesNothing(applyPanelPatch(DEFAULT_PANEL, pp), pp, DEFAULT_PANEL)).toBe(true);
  });

  it('works on frozen input without trying to change it', () => {
    const input = deepFreeze(json(nav([pin(1, { id: 'BAD' }), pin(1), gap(), ...Array.from({ length: 12 }, (_, i) => pin(i + 2))], { position: 'right' })));
    expectRail(sanitizeNav(input));
    expect(sanitizeNav(input)).toEqual(sanitizeNav(json(input)));
    expect(ids(sanitizeNav(input))[0]).toBe('item1'); // it really ran (a swallowed TypeError would have given the default rail)
    expect(sanitizeNav(deepFreeze(customNav))).toEqual(customNav);
  });
});
