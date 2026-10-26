/**
 * Seeded fuzz for the navigation model.
 *
 * Every iteration builds an input (pure garbage, or a valid configuration that was then damaged in a few targeted ways: kinds swapped,
 * targets repeated, gaps inserted, arrays blown past the caps, ids spoiled...), freezes it all the way down, and checks the invariants the
 * rest of the system relies on. The generator is mulberry32, so a failure is reproducible: the message carries the master seed, the
 * iteration and that iteration's own seed. To replay one case:
 *
 *   NAV_FUZZ_ITER_SEED=<iterSeed> npx vitest run src/nav.fuzz.test.ts
 *
 * (and NAV_FUZZ_SEED=<seed> changes the master seed for a different batch of 20,000).
 *
 * Special characters are written as `\u{...}` escapes or built with String.fromCodePoint, never typed (a literal U+2028 breaks the parser).
 */
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAUNCHER,
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
  sanitizeLauncher,
  sanitizeNav,
  sanitizePanel,
  sanitizeSettings,
  targetKey,
  type LauncherConfig,
  type NavConfig,
  type PanelConfig,
  type Settings,
} from '@headunit/shared';

const SEED = Number(process.env.NAV_FUZZ_SEED ?? 0x5eed1e55) >>> 0;
const ONE_ITER_SEED = process.env.NAV_FUZZ_ITER_SEED === undefined ? null : Number(process.env.NAV_FUZZ_ITER_SEED) >>> 0;
const ITERATIONS = ONE_ITER_SEED === null ? 20_000 : 1;

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float = (): number => this.next();
  int = (n: number): number => Math.floor(this.next() * n);
  chance = (p: number): boolean => this.next() < p;
  pick = <T,>(list: readonly T[]): T => list[this.int(list.length)] as T;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const REFS = ['gps', 'findcar', 'quick-actions', 'perf', 'a1', 'constructor', 'prototype', 'app-1', 'p-xxxx', 'settings', 'home', 'x'.repeat(32), 'devices', 'vehicle'];
const IDS = ['abcd', 'scene001', 'garage01', 'constructor', 'x1y2z3', 'a'.repeat(24), 'zero0000', 'home', 'item1', 'item2', 'qqqq'];
const BAD_IDS: unknown[] = ['', 'abc', 'ABCD', 'has space', 'a'.repeat(25), 'under_score', 'settings', 'spacer', '__proto__', 'item1', 'item2', 'item3', 5, null, undefined, true, ['abcd'], { toString: () => 'abcd' }, 'abcd\n'];
const KINDS = ['route', 'app', 'music', 'scene', 'action', 'gap', 'page', 'do', 'nowplaying', '', 'ROUTE', 'toString', '__proto__'];

/** Strings that have caused (or could cause) trouble for a label. */
const LABELS = [
  'Home', 'Start', '', ' ', '  spaced   out  ', 'x'.repeat(10), 'x'.repeat(11), 'e\u{301}', 'e\u{200D}\u{301}', '\u{202E}rtl\u{202C}', '\u{1F600}'.repeat(11), 'a\u{0}b', 'a\u{2028}b\u{2029}c', '\u{3164}',
  'caf\u{E9}', 'cafe\u{301}', '\u{1100}\u{1161}\u{11A8}', 'A\u{30A}', 'zero\u{200B}width', 'x'.repeat(9) + 'e\u{301}', '\u{FB01}ne', '\u{FF21}\u{FF22}', 'a\u{E0041}b', '<b>x</b>', '__proto__', 'constructor', 'x'.repeat(300),
];

function randomString(r: Rng): string {
  const n = r.int(26);
  let s = '';
  for (let i = 0; i < n; i++) {
    const k = r.int(100);
    if (k < 45) s += String.fromCharCode(32 + r.int(95));
    else if (k < 52) s += String.fromCharCode(0xa0 + r.int(96)); // Latin-1
    else if (k < 62) s += String.fromCharCode(0x300 + r.int(112)); // combining marks
    else if (k < 68) s += String.fromCharCode(r.pick([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff, 0xad]));
    else if (k < 73) s += String.fromCharCode(r.pick([0, 1, 7, 8, 9, 10, 11, 12, 13, 27, 0x7f, 0x85, 0x9f]));
    else if (k < 78) s += String.fromCharCode(r.pick([0xa0, 0x1680, 0x2000, 0x2003, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0x3164, 0x2800, 0x115f, 0x1160, 0xffa0]));
    else if (k < 82) s += String.fromCharCode(0x1100 + r.int(256)); // Hangul jamo (they compose)
    else if (k < 86) s += String.fromCharCode(0xd800 + r.int(0x800)); // a lone surrogate
    else if (k < 93) s += String.fromCodePoint(0x1f300 + r.int(0x350)); // emoji
    else if (k < 95) s += String.fromCodePoint(0xe0000 + r.int(0x80)); // tag characters
    else if (k < 98) s += String.fromCodePoint(0x4e00 + r.int(0x200)); // CJK
    else s += String.fromCodePoint(0x10000 + r.int(0x10000));
  }
  return s;
}

function label(r: Rng): unknown {
  const k = r.int(10);
  if (k < 4) return r.pick(LABELS);
  if (k < 8) return randomString(r);
  return junk(r, 2);
}

function junkPrimitive(r: Rng): unknown {
  switch (r.int(24)) {
    case 0: return '';
    case 1: return r.pick([0, 1, -0, 2, -1, 1.5, 1e21, Number.MAX_SAFE_INTEGER]);
    case 2: return r.pick([NaN, Infinity, -Infinity]);
    case 3: return r.pick([5n, 0n, -1n]);
    case 4: return null;
    case 5: return undefined;
    case 6: return r.chance(0.5);
    case 7: return r.pick(['home', 'settings', 'spacer', 'gap', 'route', 'app', 'left', 'right', 'always']);
    case 8: return r.pick(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']);
    case 9: return r.pick(IDS);
    case 10: return r.pick(REFS);
    case 11: return r.chance(0.02) ? 'a'.repeat(100_000) : 'a'.repeat(r.int(60));
    case 12: return randomString(r);
    case 13: return Symbol('abcd');
    case 14: return () => 'abcd';
    case 15: return r.pick(['abcd\n', ' abcd', 'ABCD', '\u{430}bcd']);
    default: return r.pick(NAV_ICONS);
  }
}

function junk(r: Rng, depth = 0): unknown {
  const k = r.int(depth > 2 ? 4 : 14);
  if (k < 8) return junkPrimitive(r);
  if (k === 8) return Array.from({ length: r.int(5) }, () => junk(r, depth + 1));
  if (k === 9) return randomObject(r, depth + 1);
  if (k === 10) return r.pick([{ toString: () => 'abcd' }, { valueOf: () => 1 }, new String('abcd'), new Date(0), new Map(), /abcd/, Object.create(null) as object, ['abcd'], [[['abcd']]]]);
  if (k === 11) return JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"version":1,"items":[]}') as unknown;
  if (k === 12) {
    const sparse: unknown[] = [];
    sparse[r.int(5)] = junk(r, depth + 1);
    sparse.length = r.int(8);
    return sparse;
  }
  return Object.assign(Object.create(null) as object, { version: 1, items: [] });
}

function randomObject(r: Rng, depth: number): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (let i = r.int(5); i > 0; i--) {
    const key = r.pick(['version', 'items', 'to', 'kind', 'id', 'label', 'icon', 'route', 'app', 'tab', 'scene', 'action', 'position', 'size', 'labels', 'hidden', 'tiles', 'sections', 'constructor', 'toString', 'x']);
    o[key] = junk(r, depth + 1);
  }
  return o;
}

function ownProto(o: object, value: unknown): void {
  Object.defineProperty(o, '__proto__', { value, enumerable: true, configurable: true, writable: true });
}

function validTarget(r: Rng, allowGap = true): Record<string, unknown> {
  switch (r.int(allowGap ? 6 : 5)) {
    case 0: return { kind: 'route', route: r.pick(NAV_ROUTES) };
    case 1: return { kind: 'app', app: r.pick(REFS) };
    case 2: return { kind: 'music', tab: r.pick(NAV_MUSIC_TABS) };
    case 3: return { kind: 'scene', scene: r.pick(IDS) };
    case 4: return { kind: 'action', action: r.pick(IDS) };
    default: return { kind: 'gap' };
  }
}

function validItem(r: Rng, allowGap = false): Record<string, unknown> {
  const item: Record<string, unknown> = { id: r.chance(0.7) ? `i${r.int(1_000_000).toString(36)}`.padEnd(4, 'x') : r.pick(IDS), to: validTarget(r, allowGap) };
  if (r.chance(0.4)) item.label = r.pick(LABELS);
  if (r.chance(0.4)) item.icon = r.pick(NAV_ICONS);
  return item;
}

/** A configuration that is valid, or very close to it. */
function validNav(r: Rng): Record<string, unknown> {
  const n = r.int(13);
  const items: unknown[] = Array.from({ length: n }, () => validItem(r));
  if (r.chance(0.75)) items.splice(r.int(items.length + 1), 0, { id: 'spacer', to: { kind: 'gap' } });
  if (r.chance(0.8)) items.push({ id: 'settings', to: { kind: 'route', route: 'settings' } });
  return { version: 1, position: r.pick(NAV_POSITIONS), size: r.pick(NAV_SIZES), labels: r.pick(NAV_LABEL_MODES), items };
}

const itemsOf = (n: Record<string, unknown>): Array<Record<string, unknown>> | null => (Array.isArray(n.items) ? (n.items as Array<Record<string, unknown>>) : null);
/** A random entry of the list that is an object we can damage further (earlier damage may have left holes or junk). */
const someItem = (r: Rng, n: Record<string, unknown>): Record<string, unknown> | null => {
  const list = itemsOf(n);
  const objects = list ? list.filter((it) => typeof it === 'object' && it !== null && !Object.isFrozen(it)) : [];
  return objects.length ? r.pick(objects) : null;
};

/** Targeted damage. Each one makes a near-valid configuration invalid in one specific way. */
const DAMAGE: Array<(r: Rng, n: Record<string, unknown>) => void> = [
  (r, n) => void (n[r.pick(['position', 'size', 'labels'])] = r.chance(0.5) ? junk(r) : r.pick(['middle', 'top', 'LEFT', ' left', 'huge', 'sometimes'])),
  (r, n) => void (n.version = r.pick([2, '1', 1.5, 0, -1, null, true, [1], 1n])),
  (_r, n) => void delete n.version,
  (_r, n) => void delete n.items,
  (r, n) => void (n.items = Array.from({ length: 11 + r.int(70) }, () => validItem(r, r.chance(0.1)))), // blown past the caps
  (r, n) => {
    const list = itemsOf(n);
    if (list) for (let i = 1 + r.int(3); i > 0; i--) list.splice(r.int(list.length + 1), 0, { id: r.pick(['spacer', 'gap1', 'abcd', 5]), to: { kind: 'gap' }, ...(r.chance(0.3) ? { label: 'Hi', icon: 'star' } : {}) });
  },
  (r, n) => {
    const list = itemsOf(n);
    if (!list) return;
    const at = list.findIndex((it) => (it as { to?: { route?: string } } | null | undefined)?.to?.route === 'settings');
    if (at >= 0) list.splice(at, 1);
    if (r.chance(0.5)) list.splice(r.int(list.length + 1), 0, { id: r.pick(['settings', 'abcd', 'zzzz']), to: { kind: 'route', route: 'settings' }, ...(r.chance(0.5) ? { label: 'Settings', icon: 'settings' } : {}) });
  },
  (r, n) => {
    const list = itemsOf(n);
    const it = someItem(r, n);
    if (list && it) list.splice(r.int(list.length + 1), 0, r.chance(0.5) ? { ...it } : { ...it, id: r.pick(IDS) });
  },
  (r, n) => {
    const it = someItem(r, n);
    if (it) it.id = r.pick(BAD_IDS);
  },
  (r, n) => {
    const it = someItem(r, n);
    if (it && typeof it.to === 'object' && it.to !== null) (it.to as Record<string, unknown>).kind = r.pick(KINDS);
  },
  (r, n) => {
    const it = someItem(r, n);
    if (!it) return;
    const k = r.int(4);
    if (k === 0) delete it.to;
    else if (k === 1) delete it.id;
    else if (k === 2 && typeof it.to === 'object' && it.to !== null) delete (it.to as Record<string, unknown>).kind;
    else it.to = junk(r);
  },
  (r, n) => {
    const it = someItem(r, n);
    if (!it) return;
    const target = r.chance(0.5) ? n : r.chance(0.5) ? it : (it.to as Record<string, unknown> | undefined);
    if (typeof target !== 'object' || target === null) return;
    if (r.chance(0.5)) ownProto(target, randomObject(r, 1));
    else target[r.pick(['extra', 'constructor', 'toString', 'prototype'])] = junk(r);
  },
  (r, n) => {
    const it = someItem(r, n);
    if (it) r.chance(0.6) ? (it.label = label(r)) : (it.icon = r.chance(0.5) ? junk(r) : r.pick(['Home', 'star ', 'STAR', '']));
  },
  (r, n) => void (n.items = junk(r)),
  (r, n) => {
    const list = itemsOf(n);
    if (!list) return;
    if (r.chance(0.5) && list.length) delete list[r.int(list.length)];
    else list.length += r.int(5);
  },
  (r, n) => {
    const list = itemsOf(n);
    if (list) for (let i = list.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
  },
  (r, n) => {
    const list = itemsOf(n);
    if (list?.length) list[r.int(list.length)] = junk(r) as Record<string, unknown>;
  },
  (r, n) => {
    const list = itemsOf(n);
    if (list && list.length > 1) list[r.int(list.length)] = list[r.int(list.length)]!; // the same object twice
  },
];

function generateNavInput(r: Rng): unknown {
  const k = r.int(100);
  if (k < 15) return junk(r); // pure garbage
  if (k < 20) return r.pick(Object.values(NAV_PRESETS));
  const n = validNav(r);
  for (let i = r.int(5); i > 0; i--) r.pick(DAMAGE)(r, n);
  return n;
}

/** What actually crosses the wire or the disk: JSON text parsed again. Falls back to the raw value when it cannot be written as JSON. */
function asJson(v: unknown): { value: unknown; isJson: boolean } {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? { value: v, isJson: false } : { value: JSON.parse(text) as unknown, isJson: true };
  } catch {
    return { value: v, isJson: false };
  }
}

function deepFreeze<T>(v: T, seen = new Set<unknown>()): T {
  if (typeof v === 'object' && v !== null && !seen.has(v)) {
    seen.add(v);
    Object.freeze(v);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(v))) if ('value' in d) deepFreeze(d.value, seen);
  }
  return v;
}

function objectsIn(root: unknown, out = new Set<object>()): Set<object> {
  if (typeof root === 'object' && root !== null && !out.has(root)) {
    out.add(root);
    for (const d of Object.values(Object.getOwnPropertyDescriptors(root))) if ('value' in d) objectsIn(d.value, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Invisible and non-ASCII characters written out, so a failure message can be read (and copied) as it is. */
const escaped = (s: string): string => s.replace(/[^\x20-\x7e]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);

class Failure extends Error {}
function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Failure(what);
}

const sameKeys = (o: object, keys: string[]): boolean => Object.keys(o).sort().join() === [...keys].sort().join();
const plainObject = (o: unknown): boolean => typeof o === 'object' && o !== null && Object.getPrototypeOf(o) === Object.prototype;
const plainArray = (a: unknown): boolean => Array.isArray(a) && Object.getPrototypeOf(a) === Array.prototype;
const size = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));

function checkRail(n: NavConfig, where: string): void {
  check(plainObject(n) && sameKeys(n, ['version', 'position', 'size', 'labels', 'items']), `${where}: shape of the config ${JSON.stringify(Object.keys(n))}`);
  check(n.version === 1, `${where}: version`);
  check((NAV_POSITIONS as readonly string[]).includes(n.position) && (NAV_SIZES as readonly string[]).includes(n.size) && (NAV_LABEL_MODES as readonly string[]).includes(n.labels), `${where}: scalar fields`);
  check(plainArray(n.items) && n.items.length >= 2 && n.items.length <= NAV_LIMITS.items, `${where}: item count ${n.items?.length}`);
  const last = n.items[n.items.length - 1]!;
  check(plainObject(last) && sameKeys(last, ['id', 'to']) && last.id === 'settings' && plainObject(last.to) && sameKeys(last.to, ['kind', 'route']) && last.to.kind === 'route' && (last.to as { route: string }).route === 'settings', `${where}: Settings must be last and bare`);
  const gaps = n.items.flatMap((it, i) => (it.to.kind === 'gap' ? [i] : []));
  check(gaps.length === 1, `${where}: ${gaps.length} gaps`);
  const g = gaps[0]!;
  const divider = n.items[g]!;
  check(divider.id === 'spacer' && sameKeys(divider, ['id', 'to']) && sameKeys(divider.to, ['kind']), `${where}: divider shape`);
  const foot = n.items.length - 2 - g;
  check(foot >= 0 && foot <= NAV_LIMITS.foot, `${where}: foot of ${foot}`);
  check(g + foot <= NAV_LIMITS.items - 2, `${where}: head ${g} + foot ${foot} over 8`);
  const ids = new Set<string>();
  const keys = new Set<string>();
  n.items.forEach((it, i) => {
    if (i === g || i === n.items.length - 1) return;
    check(plainObject(it) && plainObject(it.to), `${where}: item prototype`);
    check(Object.keys(it).every((k) => k === 'id' || k === 'to' || k === 'label' || k === 'icon'), `${where}: item keys ${Object.keys(it)}`);
    check(typeof it.id === 'string' && ID_RE.test(it.id) && it.id !== 'settings' && it.id !== 'spacer' && !ids.has(it.id), `${where}: id ${String(it.id)}`);
    ids.add(it.id);
    const t = it.to as unknown as Record<string, unknown>;
    switch (t.kind) {
      case 'route': check(sameKeys(t, ['kind', 'route']) && (NAV_ROUTES as readonly unknown[]).includes(t.route) && t.route !== 'settings', `${where}: route target`); break;
      case 'app': check(sameKeys(t, ['kind', 'app']) && typeof t.app === 'string' && REF_RE.test(t.app), `${where}: app target`); break;
      case 'music': check(sameKeys(t, ['kind', 'tab']) && (NAV_MUSIC_TABS as readonly unknown[]).includes(t.tab), `${where}: music target`); break;
      case 'scene': check(sameKeys(t, ['kind', 'scene']) && typeof t.scene === 'string' && ID_RE.test(t.scene), `${where}: scene target`); break;
      case 'action': check(sameKeys(t, ['kind', 'action']) && typeof t.action === 'string' && ID_RE.test(t.action), `${where}: action target`); break;
      default: check(false, `${where}: target kind ${String(t.kind)}`);
    }
    const key = targetKey(it.to);
    check(!keys.has(key), `${where}: repeated target ${key}`);
    keys.add(key);
    if ('label' in it) check(typeof it.label === 'string' && it.label !== '' && Array.from(it.label).length <= NAV_LIMITS.label && cleanLabel(it.label) === it.label, `${where}: label ${JSON.stringify(it.label)}`);
    if ('icon' in it) check((NAV_ICONS as readonly unknown[]).includes(it.icon), `${where}: icon`);
  });
  check(size(n) < 32 * 1024, `${where}: serialised size ${size(n)}`);
}

function checkLauncher(l: LauncherConfig, where: string): void {
  check(plainObject(l) && sameKeys(l, ['version', 'hidden']) && l.version === 1 && plainArray(l.hidden), `${where}: shape`);
  check(l.hidden.length <= LAUNCHER_LIMITS.hidden && new Set(l.hidden).size === l.hidden.length && l.hidden.every((h) => typeof h === 'string' && REF_RE.test(h)), `${where}: hidden ${JSON.stringify(l.hidden)}`);
}

function checkPanel(p: PanelConfig, where: string): void {
  check(plainObject(p) && sameKeys(p, ['version', 'tiles', 'sections']) && p.version === 1 && plainArray(p.tiles), `${where}: shape`);
  check(new Set(p.tiles).size === p.tiles.length && p.tiles.every((t) => (QUICK_TILES as readonly unknown[]).includes(t)), `${where}: tiles ${JSON.stringify(p.tiles)}`);
  check(plainObject(p.sections) && sameKeys(p.sections, ['scenes', 'actions', 'sleep']) && Object.values(p.sections).every((v) => typeof v === 'boolean'), `${where}: sections`);
}

function checkSettings(s: Settings, where: string): void {
  check(sameKeys(s, Object.keys(DEFAULT_SETTINGS)), `${where}: keys of Settings ${Object.keys(s)}`);
  checkRail(s.nav, `${where}.nav`);
  checkLauncher(s.launcher, `${where}.launcher`);
  checkPanel(s.panel, `${where}.panel`);
  check(size(s) < 32 * 1024, `${where}: settings size ${size(s)}`);
}

// ---------------------------------------------------------------------------
// An independent reading of the spec, to compare with (on JSON inputs only)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const getOwn = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const member = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === 'string' ? list.find((x) => x === v) : undefined);

function modelTarget(v: unknown): Record<string, unknown> | null {
  if (!isObj(v)) return null;
  const kind = getOwn(v, 'kind');
  if (kind === 'route') { const route = member(NAV_ROUTES, getOwn(v, 'route')); return route ? { kind, route } : null; }
  if (kind === 'app') { const app = getOwn(v, 'app'); return typeof app === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(app) ? { kind, app } : null; }
  if (kind === 'music') { const tab = member(NAV_MUSIC_TABS, getOwn(v, 'tab')); return tab ? { kind, tab } : null; }
  if (kind === 'scene') { const scene = getOwn(v, 'scene'); return typeof scene === 'string' && /^[a-z0-9]{4,24}$/.test(scene) ? { kind, scene } : null; }
  if (kind === 'action') { const action = getOwn(v, 'action'); return typeof action === 'string' && /^[a-z0-9]{4,24}$/.test(action) ? { kind, action } : null; }
  return kind === 'gap' ? { kind } : null;
}

function modelNav(raw: unknown, fb: NavConfig): NavConfig {
  const copy = (n: NavConfig): NavConfig => JSON.parse(JSON.stringify(n)) as NavConfig;
  if (!isObj(raw) || getOwn(raw, 'version') !== 1) return copy(fb);
  const position = member(NAV_POSITIONS, getOwn(raw, 'position')) ?? fb.position;
  const sizeValue = member(NAV_SIZES, getOwn(raw, 'size')) ?? fb.size;
  const labels = member(NAV_LABEL_MODES, getOwn(raw, 'labels')) ?? fb.labels;
  const list = getOwn(raw, 'items');
  if (!Array.isArray(list)) return { version: 1, position, size: sizeValue, labels, items: copy(fb).items };

  const scanned = list.slice(0, 40);
  const taken = new Map<string, true>([['settings', true], ['spacer', true]]);
  const seen = new Map<string, true>();
  const kept: Array<Record<string, unknown>> = [];
  let sawSettings = false;
  let split = -1;
  let repairs = 0;
  for (const entry of scanned) {
    if (!isObj(entry)) continue;
    const to = modelTarget(getOwn(entry, 'to'));
    if (!to) continue;
    if (to.kind === 'route' && to.route === 'settings') { sawSettings = true; continue; }
    if (to.kind === 'gap') { if (split < 0) split = kept.length; continue; }
    const key = `${String(to.kind)}:${String(to.route ?? to.app ?? to.tab ?? to.scene ?? to.action)}`;
    if (seen.has(key)) continue;
    seen.set(key, true);
    const wanted = getOwn(entry, 'id');
    let id: string;
    if (typeof wanted === 'string' && /^[a-z0-9]{4,24}$/.test(wanted) && !taken.has(wanted)) id = wanted;
    else {
      id = `item${++repairs}`;
      while (taken.has(id)) id = `item${++repairs}`;
    }
    taken.set(id, true);
    const item: Record<string, unknown> = { id, to };
    const text = cleanLabel(getOwn(entry, 'label'));
    if (text !== undefined) item.label = text;
    const icon = member(NAV_ICONS, getOwn(entry, 'icon'));
    if (icon) item.icon = icon;
    kept.push(item);
  }
  const mk = (items: unknown[]) => ({ version: 1, position, size: sizeValue, labels, items }) as NavConfig;
  if (scanned.length > 0 && kept.length === 0 && !sawSettings) return mk(copy(fb).items as unknown[]); // junk only: keep the rail we had
  const cut = split < 0 ? kept.length : split;
  const head = kept.slice(0, cut);
  const foot = kept.slice(cut);
  const spill = foot.splice(2);
  head.push(...spill);
  while (head.length + foot.length > 8) head.pop();
  return mk([...head, { id: 'spacer', to: { kind: 'gap' } }, ...foot, { id: 'settings', to: { kind: 'route', route: 'settings' } }]);
}

function modelLauncher(raw: unknown, fb: LauncherConfig): LauncherConfig {
  const base = { version: 1, hidden: [...fb.hidden] } as LauncherConfig;
  if (!isObj(raw) || getOwn(raw, 'version') !== 1) return base;
  const hidden = getOwn(raw, 'hidden');
  if (!Array.isArray(hidden)) return base;
  const out: string[] = [];
  for (const v of hidden.slice(0, 32)) if (typeof v === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(v) && !out.includes(v) && out.length < 16) out.push(v);
  return { version: 1, hidden: out };
}

function modelPanel(raw: unknown, fb: PanelConfig): PanelConfig {
  const base = { version: 1, tiles: [...fb.tiles], sections: { ...fb.sections } } as PanelConfig;
  if (!isObj(raw) || getOwn(raw, 'version') !== 1) return base;
  const out = base as unknown as { tiles: string[]; sections: Record<string, boolean> };
  const tiles = getOwn(raw, 'tiles');
  if (Array.isArray(tiles)) {
    const window = tiles.slice(0, 14);
    const valid: string[] = [];
    for (const t of window) { const m = member(QUICK_TILES, t); if (m && !valid.includes(m)) valid.push(m); }
    out.tiles = window.length > 0 && valid.length === 0 ? [...fb.tiles] : valid;
  }
  const sections = getOwn(raw, 'sections');
  if (isObj(sections)) for (const k of ['scenes', 'actions', 'sleep']) { const v = getOwn(sections, k); if (typeof v === 'boolean') out.sections[k] = v; }
  return base;
}

/** Should the sender be told? An independent statement of the rule, for JSON patches. */
function modelCorrected(patch: Record<string, unknown>, next: Settings): boolean {
  const fields: Record<'nav' | 'launcher' | 'panel', string[]> = { nav: ['position', 'size', 'labels', 'items'], launcher: ['hidden'], panel: ['tiles', 'sections'] };
  for (const key of ['nav', 'launcher', 'panel'] as const) {
    if (!Object.hasOwn(patch, key)) continue;
    const sent = patch[key];
    if (!isObj(sent) || sent.version !== 1) return true;
    const kept = next[key] as unknown as Record<string, unknown>;
    for (const f of fields[key]) {
      if (!Object.hasOwn(sent, f)) continue;
      if (key === 'panel' && f === 'sections') {
        const s = sent.sections;
        if (!isObj(s)) return true;
        for (const name of Object.keys(s)) if (!isDeepStrictEqual(s[name], (kept.sections as Record<string, unknown>)[name]) || !Object.hasOwn(kept.sections as object, name)) return true;
      } else if (!isDeepStrictEqual(sent[f], kept[f])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface Stats {
  iterations: number;
  jsonInputs: number;
  garbageToDefault: number;
  rich: number;
  capped: number;
  footed: number;
  repaired: number;
  labelled: number;
  settingsOnly: number;
  corrected: number;
  notCorrected: number;
}

function customFallback(r: Rng): NavConfig {
  return sanitizeNav(validNav(r));
}

function oneIteration(r: Rng, stats: Stats, ctx: { input?: unknown; output?: unknown }): void {
  stats.iterations++;

  // ---- the rail ---------------------------------------------------------
  const generated = generateNavInput(r);
  const { value: input, isJson } = r.chance(0.5) ? asJson(generated) : { value: generated, isJson: false };
  ctx.input = input;
  const fallback = r.chance(0.7) ? DEFAULT_NAV : customFallback(r);
  deepFreeze(input);
  const frozenFallback = fallback === DEFAULT_NAV ? fallback : deepFreeze(structuredClone(fallback));

  const out = sanitizeNav(input, frozenFallback);
  ctx.output = out;
  checkRail(out, 'sanitizeNav');
  const objects = objectsIn(input);
  objectsIn(frozenFallback, objects);
  check([...objectsIn(out)].every((o) => !objects.has(o)), 'sanitizeNav returned an object it was given');
  check(isDeepStrictEqual(sanitizeNav(input, frozenFallback), out), 'sanitizeNav is not deterministic');
  check(isDeepStrictEqual(sanitizeNav(out, frozenFallback), out), 'sanitizeNav is not idempotent');
  check(isDeepStrictEqual(sanitizeNav(out), out) && isDeepStrictEqual(sanitizeNav(out, customFallback(new Rng(r.int(1e9)))), out), 'the fallback changed the result for an already valid rail');
  const wire = JSON.parse(JSON.stringify(out)) as unknown;
  check(isDeepStrictEqual(sanitizeNav(wire), out), 'a JSON round trip changed a sanitized rail');
  if (isJson) {
    stats.jsonInputs++;
    const expected = modelNav(input, frozenFallback);
    check(isDeepStrictEqual(out, expected), `sanitizeNav differs from the model of the spec:\n  model: ${JSON.stringify(expected)}\n  actual: ${JSON.stringify(out)}`);
  }
  const ordinary = out.items.length - 2; // everything but the divider and Settings
  if (isDeepStrictEqual(out.items, frozenFallback.items) && !isDeepStrictEqual(input, frozenFallback)) stats.garbageToDefault++;
  if (ordinary >= 4) stats.rich++;
  if (Array.isArray((input as { items?: unknown } | null)?.items) && ((input as { items: unknown[] }).items.length > 10) && out.items.length === 10) stats.capped++;
  if (out.items.length - 2 - out.items.findIndex((i) => i.to.kind === 'gap') >= 1) stats.footed++;
  if (out.items.some((i) => /^item\d+$/.test(i.id))) stats.repaired++;
  if (out.items.some((i) => i.label !== undefined)) stats.labelled++;
  if (out.items.length === 2) stats.settingsOnly++;

  // ---- a patch over a known rail -------------------------------------------
  const current = sanitizeNav(generateNavInput(r));
  const patchSource = generateNavInput(r);
  const patch: Record<string, unknown> = r.chance(0.8) ? { version: 1 } : {};
  const src = isObj(patchSource) ? patchSource : {};
  for (const f of ['position', 'size', 'labels', 'items'] as const) if (r.chance(0.5) && Object.hasOwn(src, f)) patch[f] = src[f];
  if (r.chance(0.2)) patch.items = junk(r);
  if (r.chance(0.1)) patch.version = junk(r);
  deepFreeze(patch);
  deepFreeze(current);
  const applied = applyNavPatch(current, patch);
  checkRail(applied, 'applyNavPatch');
  check(isDeepStrictEqual(applyNavPatch(applied, patch), applied), 'applying a patch twice differs from applying it once');
  if (patch.version !== 1) check(applied === current, 'an ignored patch must hand back the current value');
  else {
    const p = patch as Record<string, unknown>;
    for (const f of ['position', 'size', 'labels'] as const) {
      const given = Object.hasOwn(p, f) ? member(f === 'position' ? NAV_POSITIONS : f === 'size' ? NAV_SIZES : NAV_LABEL_MODES, p[f]) : undefined;
      check(applied[f] === (given ?? current[f]), `patch field ${f}`);
    }
    if (!Object.hasOwn(p, 'items') || !Array.isArray(p.items)) check(isDeepStrictEqual(applied.items, current.items), 'a patch without a list must keep the list');
  }

  // ---- the launcher and the panel --------------------------------------------
  const lSrc = r.chance(0.5) ? { version: 1, hidden: Array.from({ length: r.int(40) }, () => (r.chance(0.7) ? r.pick(REFS) : junk(r))) } : junk(r);
  const lj = asJson(lSrc);
  deepFreeze(lj.value);
  const lFallback: LauncherConfig = r.chance(0.5) ? DEFAULT_LAUNCHER : { version: 1, hidden: [r.pick(REFS)].filter((x) => REF_RE.test(x)) };
  const launcher = sanitizeLauncher(lj.value, lFallback);
  checkLauncher(launcher, 'sanitizeLauncher');
  check(isDeepStrictEqual(sanitizeLauncher(launcher), launcher) && isDeepStrictEqual(sanitizeLauncher(launcher, lFallback), launcher), 'sanitizeLauncher is not idempotent');
  if (lj.isJson) check(isDeepStrictEqual(launcher, modelLauncher(lj.value, lFallback)), 'sanitizeLauncher differs from the model');
  checkLauncher(applyLauncherPatch(lFallback, lj.value), 'applyLauncherPatch');

  const pSrc = r.chance(0.6)
    ? { version: 1, tiles: Array.from({ length: r.int(20) }, () => (r.chance(0.8) ? r.pick(QUICK_TILES) : junk(r))), sections: r.chance(0.7) ? { scenes: r.chance(0.5), actions: r.chance(0.5), ...(r.chance(0.3) ? { sleep: junk(r) } : {}), ...(r.chance(0.2) ? { extra: true } : {}) } : junk(r) }
    : junk(r);
  const pj = asJson(pSrc);
  deepFreeze(pj.value);
  const pFallback: PanelConfig = r.chance(0.5) ? DEFAULT_PANEL : { version: 1, tiles: [r.pick(QUICK_TILES)], sections: { scenes: r.chance(0.5), actions: r.chance(0.5), sleep: r.chance(0.5) } };
  const panel = sanitizePanel(pj.value, pFallback);
  checkPanel(panel, 'sanitizePanel');
  check(isDeepStrictEqual(sanitizePanel(panel), panel) && isDeepStrictEqual(sanitizePanel(panel, pFallback), panel), 'sanitizePanel is not idempotent');
  if (pj.isJson) check(isDeepStrictEqual(panel, modelPanel(pj.value, pFallback)), 'sanitizePanel differs from the model');
  checkPanel(applyPanelPatch(pFallback, pj.value), 'applyPanelPatch');

  // ---- all of Settings, and the decision to resend ---------------------------
  const base: Settings = { ...DEFAULT_SETTINGS, nav: current, launcher: lFallback, panel: pFallback };
  const settingsPatch: Record<string, unknown> = {};
  if (r.chance(0.8)) settingsPatch.nav = patch;
  if (r.chance(0.5)) settingsPatch.launcher = lj.value;
  if (r.chance(0.5)) settingsPatch.panel = pj.value;
  if (r.chance(0.3)) settingsPatch.theme = junk(r);
  if (r.chance(0.1)) settingsPatch[r.pick(['nav', 'launcher', 'panel'])] = junk(r);
  const merged = mergeSettings(base, settingsPatch);
  checkSettings(merged, 'mergeSettings');
  if (Object.hasOwn(settingsPatch, 'nav') && settingsPatch.nav === patch) check(isDeepStrictEqual(merged.nav, applied), 'mergeSettings and applyNavPatch disagree');
  if (!Object.hasOwn(settingsPatch, 'nav')) check(merged.nav === current, 'a patch without nav must keep the very same nav object');
  const wireSettings = sanitizeSettings(JSON.parse(JSON.stringify(merged)));
  check(isDeepStrictEqual(wireSettings, merged), 'the disk round trip of Settings changed it');

  const jsonPatch = asJson(settingsPatch);
  if (jsonPatch.isJson) {
    const jp = jsonPatch.value as Record<string, unknown>;
    const next = mergeSettings(base, jp);
    const said = arrangementsCorrected(jp, next);
    check(said === modelCorrected(jp, next), `arrangementsCorrected said ${said} for ${JSON.stringify(jp).slice(0, 300)}`);
    if (said) stats.corrected++;
    else stats.notCorrected++;
  }
  // a clean patch (what the editor sends: the sanitized value itself) never makes the server resend
  const clean = { nav: JSON.parse(JSON.stringify(merged.nav)) as unknown, launcher: JSON.parse(JSON.stringify(merged.launcher)) as unknown, panel: JSON.parse(JSON.stringify(merged.panel)) as unknown };
  check(arrangementsCorrected(clean, mergeSettings(merged, clean)) === false, 'a clean patch was reported as corrected');
  check(arrangementsCorrected({ nav: { version: 1, items: (clean.nav as { items: unknown }).items } }, merged) === false, 'a clean items patch was reported as corrected');
  check(arrangementsCorrected({ panel: { version: 1, sections: { scenes: merged.panel.sections.scenes } } }, merged) === false, 'a clean sections patch was reported as corrected');
}

describe('15. seeded fuzz of the navigation model', () => {
  it(`holds its invariants for ${ITERATIONS.toLocaleString('en-US')} generated inputs (seed ${SEED})`, () => {
    const master = mulberry32(SEED);
    const stats: Stats = { iterations: 0, jsonInputs: 0, garbageToDefault: 0, rich: 0, capped: 0, footed: 0, repaired: 0, labelled: 0, settingsOnly: 0, corrected: 0, notCorrected: 0 };
    const prototypeKeys = Object.getOwnPropertyNames(Object.prototype).sort().join();
    for (let i = 0; i < ITERATIONS; i++) {
      const iterSeed = ONE_ITER_SEED ?? Math.floor(master() * 4294967296);
      const ctx: { input?: unknown; output?: unknown } = {};
      try {
        oneIteration(new Rng(iterSeed), stats, ctx);
      } catch (err) {
        const show = (v: unknown) => {
          try {
            return escaped(JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? `${x}n` : typeof x === 'symbol' || typeof x === 'function' ? String(x) : x)) ?? String(v)).slice(0, 3000);
          } catch {
            return escaped(String(v)).slice(0, 3000);
          }
        };
        const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        throw new Error(`NAV FUZZ FAILED  seed=${SEED}  iteration=${i}  iterSeed=${iterSeed}\n  ${why}\n  input:  ${show(ctx.input)}\n  output: ${show(ctx.output)}\n  replay: NAV_FUZZ_ITER_SEED=${iterSeed} npx vitest run src/nav.fuzz.test.ts`, { cause: err });
      }
      if (i % 1000 === 999) check(Object.getOwnPropertyNames(Object.prototype).sort().join() === prototypeKeys && ({} as Record<string, unknown>).polluted === undefined, `Object.prototype was changed (seed=${SEED} iteration=${i})`);
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(prototypeKeys);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (ONE_ITER_SEED === null) {
      // The run must have been interesting: garbage AND near-valid inputs, and every repair rule actually exercised.
      const share = (n: number) => n / stats.iterations;
      expect(share(stats.jsonInputs), 'JSON inputs').toBeGreaterThan(0.25);
      expect(share(stats.garbageToDefault), 'garbage falling back to the default rail').toBeGreaterThan(0.03);
      expect(share(stats.rich), 'rails with four or more ordinary items').toBeGreaterThan(0.3);
      expect(share(stats.capped), 'lists over the cap').toBeGreaterThan(0.02);
      expect(share(stats.footed), 'rails with a foot').toBeGreaterThan(0.15);
      expect(share(stats.repaired), 'rails with a repaired id').toBeGreaterThan(0.05);
      expect(share(stats.labelled), 'rails with a label').toBeGreaterThan(0.1);
      expect(stats.settingsOnly, 'Settings-only rails').toBeGreaterThan(20);
      expect(stats.corrected, 'patches reported as corrected').toBeGreaterThan(500);
      expect(stats.notCorrected, 'patches reported as clean').toBeGreaterThan(500);
    }
  }, 180_000);

  it('cleanLabel: always short, plain, normalised and stable, for 20,000 random strings', () => {
    const master = mulberry32(SEED ^ 0xa5a5a5a5);
    const stripped = /[\p{Cc}\p{Cf}\p{Cs}\u{2028}\u{2029}\u{115f}\u{1160}\u{3164}\u{ffa0}\u{2800}]/u;
    for (let i = 0; i < ITERATIONS; i++) {
      const iterSeed = Math.floor(master() * 4294967296);
      const r = new Rng(iterSeed);
      const input = r.chance(0.1) ? r.pick(LABELS) : randomString(r) + (r.chance(0.2) ? randomString(r) : '');
      const once = cleanLabel(input);
      const where = `seed=${SEED} iteration=${i} iterSeed=${iterSeed} input=${escaped(JSON.stringify(input))}`;
      if (once === undefined) {
        expect(cleanLabel(once), where).toBeUndefined();
        continue;
      }
      expect(Array.from(once).length, where).toBeLessThanOrEqual(NAV_LIMITS.label);
      expect(once, where).not.toBe('');
      expect(stripped.test(once), where).toBe(false);
      expect(once.normalize('NFC'), where).toBe(once);
      expect(once, where).toBe(once.trim());
      expect(once.includes('  '), where).toBe(false);
      expect(/\s/.test(once.replace(/ /g, '')), where).toBe(false);
      expect(cleanLabel(once), where).toBe(once);
    }
  }, 120_000);
});
